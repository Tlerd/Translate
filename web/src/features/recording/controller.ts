import { WebSpeechRecognizer } from './speech-recognition';
import { WebAudioRecorder } from './audio-recorder';
import { LiveUtteranceAssembler, type TranscriptSnapshot } from './utterance-assembler';
import { LiveTranslationScheduler, type ScheduledTranslationEvent } from './translation-scheduler';
import { streamTranslate } from '@/lib/api-client';
import {
  createRecording,
  updateRecording,
  addAudioChunk,
  saveCaption,
} from '@/storage/recordings';
import type {
  ClassroomMode,
  RecordingState,
  CaptionItem,
} from '@/shared/recording';

export interface ControllerState {
  recordingId: string | null;
  state: RecordingState;
  mode: ClassroomMode;
  sourceLanguage: string;
  targetLanguage: string;
  translationModelKey: string;
  durationMs: number;
  audioVolume: number;
  speechState: 'idle' | 'listening' | 'reconnecting' | 'stopped';
  captions: CaptionItem[];
  error: string | null;
  epoch: number;
  pauseMs: number;
  readingPauseMs: number;
}

export interface StartOptions {
  mode?: ClassroomMode;
  sourceLanguage?: string;
  targetLanguage?: string;
  translationModelKey?: string;
  context?: string;
  glossary?: string;
  pauseMs?: number;
  readingPauseMs?: number;
}

export class ClassroomController {
  private state: ControllerState = {
    recordingId: null,
    state: 'stopped',
    mode: 'lecture',
    sourceLanguage: 'ja-JP',
    targetLanguage: 'vi',
    translationModelKey: 'google:gemini-3.5-flash-lite',
    durationMs: 0,
    audioVolume: 0,
    speechState: 'idle',
    captions: [],
    error: null,
    epoch: 0,
    pauseMs: 900,
    readingPauseMs: 900,
  };

  private listeners: Set<(state: ControllerState) => void> = new Set();

  private speechRecognizer: WebSpeechRecognizer | null = null;
  private audioRecorder: WebAudioRecorder | null = null;
  private assembler: LiveUtteranceAssembler | null = null;
  private scheduler: LiveTranslationScheduler | null = null;

  private startTime = 0;
  private durationIntervalId: ReturnType<typeof setInterval> | null = null;
  private sessionEpoch = 0;
  private configRevision = 1;
  private activeBlockId = 1;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private hasPendingTranscript = false;
  private seenSpeechSnapshots = new Map<string, { text: string; isFinal: boolean; revision: number }>();
  private speechItemLocations = new Map<string, { captionId: number; blockId: number; startMs: number }>();
  private pendingCaptionWrites = new Set<Promise<void>>();
  private captionWriteChain: Promise<void> = Promise.resolve();
  private starting: Promise<string> | null = null;
  private stopping: Promise<void> | null = null;

  constructor() {
    this.checkStoragePersistence();
  }

  private async checkStoragePersistence(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      try {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
          await navigator.storage.persist();
        }
      } catch {
        // Non-fatal
      }
    }
  }

  public subscribe(listener: (state: ControllerState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch (err) {
        console.error('Error in controller subscriber:', err);
      }
    }
  }

  public snapshot(): ControllerState {
    return {
      ...this.state,
      captions: [...this.state.captions],
    };
  }

  public async start(options: StartOptions = {}): Promise<string> {
    if (this.stopping) await this.stopping;
    if (this.starting) return this.starting;
    const task = this.startInternal(options);
    this.starting = task;
    try {
      return await task;
    } finally {
      if (this.starting === task) this.starting = null;
    }
  }

  private async startInternal(options: StartOptions): Promise<string> {
    if (this.state.state === 'recording') {
      return this.state.recordingId!;
    }

    this.sessionEpoch++;
    const currentEpoch = this.sessionEpoch;

    const mode = options.mode || this.state.mode;
    const sourceLanguage = options.sourceLanguage || this.state.sourceLanguage;
    const targetLanguage = options.targetLanguage || this.state.targetLanguage;
    const translationModelKey = options.translationModelKey || this.state.translationModelKey;
    const pauseMs = ClassroomController.clampPause(options.pauseMs ?? this.state.pauseMs);
    const readingPauseMs = ClassroomController.clampPause(options.readingPauseMs ?? this.state.readingPauseMs);

    const recording = await createRecording({
      mode,
      sourceLanguage,
      targetLanguage,
      translationModelKey,
      context: options.context,
      glossary: options.glossary,
    });

    const recordingId = recording.id;
    this.startTime = Date.now();
    this.activeBlockId = 1;

    this.state = {
      recordingId,
      state: 'recording',
      mode,
      sourceLanguage,
      targetLanguage,
      translationModelKey,
      durationMs: 0,
      audioVolume: 0,
      speechState: 'listening',
      captions: [],
      error: null,
      epoch: currentEpoch,
      pauseMs,
      readingPauseMs,
    };
    this.hasPendingTranscript = false;
    this.captionRevisions.clear();
    this.seenSpeechSnapshots.clear();
    this.speechItemLocations.clear();
    this.notify();

    // Duration timer
    this.durationIntervalId = setInterval(() => {
      if (this.state.state !== 'recording' || this.sessionEpoch !== currentEpoch) return;
      const durationMs = Date.now() - this.startTime;
      this.state.durationMs = durationMs;
      this.notify();
    }, 500);

    // Live Utterance Assembler
    this.assembler = new LiveUtteranceAssembler(mode);

    // Live Translation Scheduler
    this.scheduler = new LiveTranslationScheduler({
      runner: async (source, direction, history, signal, requestSnapshot, onDelta) => {
        return new Promise<string>((resolve, reject) => {
          let accumulated = '';
          let completedText = '';
          const reqId = `tr_${recordingId}_${Date.now()}`;
          void streamTranslate(
            {
              requestId: reqId,
              recordingId,
              captionId: requestSnapshot?.captionId || 1,
              sessionEpoch: currentEpoch,
              revision: requestSnapshot?.revision || 1,
              configRevision: this.configRevision,
              modelKey: this.state.translationModelKey,
              sourceLanguage: direction.sourceCode,
              targetLanguage: direction.targetCode,
              text: source,
              context: options.context,
              glossary: options.glossary,
              previousTurns: history,
            },
            (delta) => {
              accumulated += delta;
              onDelta?.(delta);
            },
            (fullText) => {
              completedText = fullText;
            },
            (err) => {
              console.warn('Live translation error:', err);
              // Keep deltas already shown in the caption, but let scheduler mark it failed.
            },
            signal
          ).then(() => resolve(completedText || accumulated), reject);
        });
      },
      sourceLanguage: sourceLanguage.split('-')[0],
      targetLanguage,
      minIntervalMs: 700,
    });

    // Assembler -> Scheduler pipeline
    this.assembler.subscribe((snapshot: TranscriptSnapshot) => {
      if (this.sessionEpoch !== currentEpoch) return;
      const previousRevision = this.captionRevisions.get(snapshot.captionId) ?? 0;
      const revision = snapshot.revision > previousRevision ? snapshot.revision : previousRevision + 1;
      this.captionRevisions.set(snapshot.captionId, revision);
      if (this.captionRevisions.size > 128) {
        const oldestCaptionId = this.captionRevisions.keys().next().value;
        if (oldestCaptionId !== undefined) this.captionRevisions.delete(oldestCaptionId);
      }
      this.scheduler?.onSnapshot({ ...snapshot, revision });
    });

    // Scheduler -> UI & DB pipeline
    this.scheduler.subscribe(async (event: ScheduledTranslationEvent) => {
      if (this.sessionEpoch !== currentEpoch) return;
      await this.handleTranslationEvent(recordingId, event);
    });

    // Audio Recorder
    try {
      this.audioRecorder = new WebAudioRecorder({
        onChunk: async (blob, sequence, timestampMs, mimeType) => {
          if (this.sessionEpoch !== currentEpoch) return;
          await addAudioChunk({
            recordingId,
            sequence,
            mimeType,
            timestamp: timestampMs,
            blob,
          });
        },
        onVolume: (vol) => {
          if (this.sessionEpoch !== currentEpoch) return;
          this.state.audioVolume = vol;
          if (vol >= 0.035) {
            this.clearSilenceTimer();
          } else if (!this.silenceTimer) {
            this.scheduleSilenceClose(currentEpoch);
          }
          this.notify();
        },
        onError: (err) => {
          if (this.sessionEpoch !== currentEpoch) return;
          this.state.error = err;
          this.notify();
        },
      });

      await this.audioRecorder.start(2000);
    } catch (err) {
      console.warn('Could not start audio recorder:', err);
      // Audio recorder failure does not prevent STT
    }

    // Speech Recognizer
    this.speechRecognizer = new WebSpeechRecognizer(
      {
        onTranscript: (text, isFinal, epoch, providerItemId, providerRevision) => {
          if (epoch !== this.sessionEpoch || this.sessionEpoch !== currentEpoch) return;
          const previousSnapshot = this.seenSpeechSnapshots.get(providerItemId);
          if (previousSnapshot && providerRevision <= previousSnapshot.revision) return;
          if (previousSnapshot?.text === text && previousSnapshot.isFinal === isFinal) {
            this.seenSpeechSnapshots.set(providerItemId, { ...previousSnapshot, revision: providerRevision });
            return;
          }
          this.seenSpeechSnapshots.set(providerItemId, { text, isFinal, revision: providerRevision });
          if (this.seenSpeechSnapshots.size > 256) {
            const oldestId = this.seenSpeechSnapshots.keys().next().value;
            if (oldestId) this.seenSpeechSnapshots.delete(oldestId);
          }
          const currentMs = Date.now() - this.startTime;
          const existingLocation = this.speechItemLocations.get(providerItemId);
          const currentCaptionId = this.assembler!.currentCaptionId;
          const captionId = existingLocation?.captionId ?? currentCaptionId;
          const blockId = existingLocation?.blockId ?? this.activeBlockId;
          const isLateResult = captionId < currentCaptionId;
          const startMs = existingLocation?.startMs ?? Math.max(0, currentMs - 2000);
          this.speechItemLocations.delete(providerItemId);
          this.speechItemLocations.set(providerItemId, { captionId, blockId, startMs });
          if (this.speechItemLocations.size > 256) {
            const oldestProviderId = this.speechItemLocations.keys().next().value;
            if (oldestProviderId) this.speechItemLocations.delete(oldestProviderId);
          }
          if (!isLateResult) {
            this.hasPendingTranscript = !isFinal || this.state.mode === 'readingPractice';
            this.clearSilenceTimer();
            if (this.hasPendingTranscript) this.scheduleSilenceClose(currentEpoch);
          }
          this.assembler?.handleSnapshot({
            connectionEpoch: epoch,
            providerItemId,
            blockId,
            captionId,
            revision: providerRevision,
            text,
            isFinal,
            startMs,
            endMs: currentMs,
          });
        },
        onError: (err, epoch) => {
          if (epoch !== this.sessionEpoch) return;
          this.state.error = err;
          this.notify();
        },
        onStateChange: (speechState) => {
          if (currentEpoch !== this.sessionEpoch) return;
          this.state.speechState = speechState;
          this.notify();
        },
      },
      sourceLanguage
    );

    this.speechRecognizer.start(currentEpoch, sourceLanguage);

    return recordingId;
  }

  private captionRevisions = new Map<number, number>();

  private static clampPause(ms: number): number {
    return Math.max(600, Math.min(10_000, Math.round(ms)));
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private scheduleSilenceClose(epoch: number): void {
    if (this.silenceTimer) return;
    const delay = this.state.mode === 'readingPractice' ? this.state.readingPauseMs : this.state.pauseMs;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (epoch !== this.sessionEpoch || this.state.state !== 'recording') return;
      if (!this.hasPendingTranscript) return;
      const closedBlock = this.activeBlockId;
      this.assembler?.handleBlockClosed(closedBlock);
      this.scheduler?.onBlockClosed(closedBlock);
      this.hasPendingTranscript = false;
      this.activeBlockId = closedBlock + 1;
    }, delay);
  }

  private async handleTranslationEvent(
    recordingId: string,
    event: ScheduledTranslationEvent
  ): Promise<void> {
    const existingIndex = this.state.captions.findIndex((c) => c.id === event.captionId);

    const captionItem: CaptionItem = {
      id: event.captionId,
      recordingId,
      blockId: event.blockId,
      startMs: event.startMs,
      endMs: event.endMs,
      source: event.sourceText,
      revision: event.sourceRevision,
      isFinal: existingIndex >= 0
        ? this.state.captions[existingIndex].isFinal || event.isFinal
        : event.isFinal,
      translation: event.targetText || (existingIndex >= 0 ? this.state.captions[existingIndex].translation : ''),
      targetSourceRevision: event.targetText
        ? event.targetSourceRevision
        : existingIndex >= 0
          ? this.state.captions[existingIndex].targetSourceRevision
          : event.targetSourceRevision,
      translationModelKey: this.state.translationModelKey,
      state: event.error
        ? 'failed'
        : event.isFinal && !!event.targetText && event.targetSourceRevision >= event.sourceRevision
          ? 'done'
          : 'streaming',
      error: event.error,
      skipReason: event.skipReason,
    };

    if (existingIndex >= 0) {
      this.state.captions[existingIndex] = captionItem;
    } else {
      this.state.captions.push(captionItem);
    }

    this.notify();
    const write = this.captionWriteChain.then(() => saveCaption(captionItem)).catch((err) => {
      this.state.error = `Không lưu được phụ đề: ${err instanceof Error ? err.message : String(err)}`;
      this.notify();
    });
    this.captionWriteChain = write;
    this.pendingCaptionWrites.add(write);
    void write.finally(() => this.pendingCaptionWrites.delete(write));
  }

  public async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const task = this.stopInternal();
    this.stopping = task;
    try {
      await task;
    } finally {
      if (this.stopping === task) this.stopping = null;
    }
  }

  private async stopInternal(): Promise<void> {
    if (this.starting) await this.starting;
    if (this.state.state !== 'recording') return;

    const stopEpoch = this.sessionEpoch;
    const recordingId = this.state.recordingId;
    const captureEndedAt = Date.now();
    const durationMs = captureEndedAt - this.startTime;
    this.clearSilenceTimer();

    if (this.durationIntervalId) {
      clearInterval(this.durationIntervalId);
      this.durationIntervalId = null;
    }

    if (this.speechRecognizer) {
      await this.speechRecognizer.stop();
      this.speechRecognizer = null;
    }

    if (this.audioRecorder) {
      await this.audioRecorder.stop();
      this.audioRecorder = null;
    }

    if (this.assembler) {
      this.assembler.finalizeCurrentUtterance(true);
      this.assembler.close();
      this.assembler = null;
    }

    if (this.scheduler) {
      await this.scheduler.drain();
      this.scheduler.close();
      this.scheduler = null;
    }

    await Promise.all([...this.pendingCaptionWrites]);
    if (this.sessionEpoch !== stopEpoch) return;
    this.sessionEpoch++; // Drain final browser events, translation, and storage before invalidating.

    this.state = {
      ...this.state,
      state: 'stopped',
      durationMs,
      audioVolume: 0,
      speechState: 'stopped',
    };
    this.notify();

    if (recordingId) {
      await updateRecording(recordingId, {
        state: 'stopped',
        endedAt: new Date(captureEndedAt).toISOString(),
        durationMs,
      });
    }
  }

  public setTranslationModel(modelKey: string): void {
    if (this.state.translationModelKey === modelKey) return;
    this.configRevision++;
    this.state.translationModelKey = modelKey;
    this.notify();
  }

  public setPauseMs(ms: number): void {
    const pauseMs = ClassroomController.clampPause(ms);
    if (this.state.pauseMs === pauseMs) return;
    this.state.pauseMs = pauseMs;
    if (this.state.mode === 'lecture' && this.state.state === 'recording' && this.hasPendingTranscript && this.silenceTimer) {
      this.clearSilenceTimer();
      this.scheduleSilenceClose(this.sessionEpoch);
    }
    this.notify();
  }

  public setReadingPauseMs(ms: number): void {
    const readingPauseMs = ClassroomController.clampPause(ms);
    if (this.state.readingPauseMs === readingPauseMs) return;
    this.state.readingPauseMs = readingPauseMs;
    if (this.state.mode === 'readingPractice' && this.state.state === 'recording' && this.hasPendingTranscript && this.silenceTimer) {
      this.clearSilenceTimer();
      this.scheduleSilenceClose(this.sessionEpoch);
    }
    this.notify();
  }

  public switchMode(mode: ClassroomMode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.assembler?.switchMode(mode);
    this.notify();
  }
}
