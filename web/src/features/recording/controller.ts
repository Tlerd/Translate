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
}

export interface StartOptions {
  mode?: ClassroomMode;
  sourceLanguage?: string;
  targetLanguage?: string;
  translationModelKey?: string;
  context?: string;
  glossary?: string;
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
    if (this.state.state === 'recording') {
      return this.state.recordingId!;
    }

    this.sessionEpoch++;
    const currentEpoch = this.sessionEpoch;

    const mode = options.mode || this.state.mode;
    const sourceLanguage = options.sourceLanguage || this.state.sourceLanguage;
    const targetLanguage = options.targetLanguage || this.state.targetLanguage;
    const translationModelKey = options.translationModelKey || this.state.translationModelKey;

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
    };
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
      runner: async (source, direction, history, signal) => {
        return new Promise<string>((resolve) => {
          let accumulated = '';
          const reqId = `tr_${recordingId}_${Date.now()}`;
          streamTranslate(
            {
              requestId: reqId,
              recordingId,
              captionId: this.assembler?.currentCaptionId || 1,
              sessionEpoch: currentEpoch,
              revision: 1,
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
            },
            (fullText) => {
              resolve(fullText);
            },
            (err) => {
              console.warn('Live translation error:', err);
              resolve(accumulated); // return partial on error
            },
            signal
          );
        });
      },
      sourceLanguage: sourceLanguage.split('-')[0],
      targetLanguage,
      minIntervalMs: 700,
    });

    // Assembler -> Scheduler pipeline
    this.assembler.subscribe((snapshot: TranscriptSnapshot) => {
      if (this.sessionEpoch !== currentEpoch) return;
      this.scheduler?.onSnapshot(snapshot);
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
        onTranscript: (text, isFinal, epoch) => {
          if (epoch !== this.sessionEpoch || this.sessionEpoch !== currentEpoch) return;
          const currentMs = Date.now() - this.startTime;
          this.assembler?.handleSnapshot({
            connectionEpoch: epoch,
            providerItemId: `speech-${Date.now()}`,
            blockId: this.activeBlockId,
            captionId: this.assembler.currentCaptionId,
            revision: 1,
            text,
            isFinal,
            startMs: Math.max(0, currentMs - 2000),
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
      isFinal: event.isFinal,
      translation: event.targetText,
      targetSourceRevision: event.targetSourceRevision,
      translationModelKey: this.state.translationModelKey,
      state: event.error ? 'failed' : event.isFinal ? 'done' : 'streaming',
      error: event.error,
      skipReason: event.skipReason,
    };

    if (existingIndex >= 0) {
      this.state.captions[existingIndex] = captionItem;
    } else {
      this.state.captions.push(captionItem);
    }

    this.notify();
    await saveCaption(captionItem);
  }

  public async stop(): Promise<void> {
    if (this.state.state !== 'recording') return;

    this.sessionEpoch++; // immediately invalidate any subsequent late callbacks!
    const recordingId = this.state.recordingId;

    if (this.durationIntervalId) {
      clearInterval(this.durationIntervalId);
      this.durationIntervalId = null;
    }

    if (this.speechRecognizer) {
      this.speechRecognizer.stop();
      this.speechRecognizer = null;
    }

    if (this.audioRecorder) {
      this.audioRecorder.stop();
      this.audioRecorder = null;
    }

    if (this.assembler) {
      this.assembler.finalizeCurrentUtterance(false);
      this.assembler.close();
      this.assembler = null;
    }

    if (this.scheduler) {
      this.scheduler.close();
      this.scheduler = null;
    }

    const durationMs = Date.now() - this.startTime;
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
        endedAt: new Date().toISOString(),
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

  public switchMode(mode: ClassroomMode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.assembler?.switchMode(mode);
    this.notify();
  }
}
