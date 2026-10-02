import type { SpeechRecognitionCallbacks } from './speech-recognition';
import { GeminiLiveRecognizer } from './gemini-live-recognition';
import { GeminiTranscribeRecognizer } from './gemini-transcribe-recognition';
import { GeminiPcmCapture } from './gemini-pcm-capture';
import { WebAudioRecorder } from './audio-recorder';
import { LiveUtteranceAssembler, type TranscriptSnapshot } from './utterance-assembler';
import { LiveTranslationScheduler, type ScheduledTranslationEvent } from './translation-scheduler';
import { streamTranslate } from '@/lib/api-client';
import {
  createRecording,
  updateRecording,
  addAudioChunk,
  saveCaption,
  getAudioBlob,
} from '@/storage/recordings';
import type {
  ClassroomMode,
  RecordingState,
  CaptionItem,
  RecordingItem,
} from '@/shared/recording';
import { isAllowedSpeakerLabel, isSpeakerCount, normalizeTranscriptionMode, segmentedTranscriptionModel, type SpeakerCount, type SpeechProvider, type TranscriptionMode } from '@/shared/transcription';

export interface ControllerState {
  recordingId: string | null;
  state: RecordingState;
  mode: ClassroomMode;
  sourceLanguage: string;
  targetLanguage: string;
  translationModelKey: string;
  translationThinkingLevel: string;
  durationMs: number;
  audioVolume: number;
  speechState: 'idle' | 'listening' | 'reconnecting' | 'stopped';
  captions: CaptionItem[];
  error: string | null;
  epoch: number;
  pauseMs: number;
  readingPauseMs: number;
  speechProvider: SpeechProvider;
  transcriptionMode: TranscriptionMode;
  speakerCount: SpeakerCount;
  micState: 'idle' | 'live' | 'muted' | 'ended' | 'suspended';
  receivedAudioMs: number;
  lastTranscriptAt: number | null;
  transcriptCount: number;
  translationLatencyMs: number | null;
  speakerStatus: 'idle' | 'working' | 'done' | 'error' | 'unavailable';
  speakerMessage: string | null;
  micDeviceLabel: string | null;
}

export interface StartOptions {
  speechProvider?: SpeechProvider;
  transcriptionMode?: TranscriptionMode;
  speakerCount?: SpeakerCount;
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
    translationModelKey: 'google:gemini-3.1-flash-lite',
    translationThinkingLevel: 'auto',
    durationMs: 0,
    audioVolume: 0,
    speechState: 'idle',
    captions: [],
    error: null,
    epoch: 0,
    pauseMs: 900,
    readingPauseMs: 900,
    speechProvider: 'google-transcribe', transcriptionMode: 'verbatim', speakerCount: 1,
    micState: 'idle', receivedAudioMs: 0,
    lastTranscriptAt: null, transcriptCount: 0, translationLatencyMs: null,
    speakerStatus: 'idle', speakerMessage: null,
    micDeviceLabel: null,
  };

  private listeners: Set<(state: ControllerState) => void> = new Set();

  private speechRecognizer: GeminiTranscribeRecognizer | GeminiLiveRecognizer | null = null;
  private pcmCapture: GeminiPcmCapture | null = null;
  private pcmPreparation: Promise<void> | null = null;
  private pcmAttached = false;
  private pcmInputCallback: ((samples: Float32Array, rate: number) => void) | null = null;
  private pcmReady = false;
  private pcmQueue: Array<{samples: Float32Array; rate: number}> = [];
  private pcmQueueMs = 0;
  private renewalTimer: ReturnType<typeof setTimeout> | null = null;
  private speechRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private speechRetries = 0;
  private googleConnecting = false;
  private googleConnection: Promise<void> | null = null;
  private recognizerChange: Promise<void> = Promise.resolve();
  private speechCallbacks: SpeechRecognitionCallbacks | null = null;
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
  private providerSpeechEnded = false;
  private seenSpeechSnapshots = new Map<string, { text: string; isFinal: boolean; revision: number }>();
  private speechItemLocations = new Map<string, { captionId: number; blockId: number; startMs: number }>();
  private captionSpeakers = new Map<number, string>();
  private pendingCaptionWrites = new Set<Promise<void>>();
  private captionWriteChain: Promise<void> = Promise.resolve();
  private starting: Promise<string> | null = null;
  private stopping: Promise<void> | null = null;
  private speakerTask: Promise<void> | null = null;
  private speakerAbort: AbortController | null = null;
  private recordingConfig: RecordingItem['config'] | null = null;

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
    if (this.state.state === 'recording' && this.state.recordingId) return this.state.recordingId;
    this.speakerAbort?.abort();
    if (!isSpeakerCount(options.speakerCount ?? this.state.speakerCount)) throw new Error('Bắt buộc chọn số người nói từ 1 đến 8.');
    // Unlock Web Audio inside the record-button activation on iOS, before
    // IndexedDB or microphone permissions can yield.
    this.pcmCapture = new GeminiPcmCapture();
    this.pcmAttached = false;
    this.pcmPreparation = this.pcmCapture.prepare();
    void this.pcmPreparation.catch(() => undefined); // handled with start below
    const task = this.startInternal(options);
    this.starting = task;
    try {
      return await task;
    } catch (error) {
      await this.pcmCapture?.stop();
      this.pcmCapture = null;
      throw error;
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
    const transcriptionMode = options.transcriptionMode ?? this.state.transcriptionMode;
    const speakerCount = options.speakerCount ?? this.state.speakerCount;
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
      transcriptionMode,
      speakerCount,
    });

    const recordingId = recording.id;
    this.recordingConfig = { ...recording.config, transcriptionMode, speakerCount };
    this.startTime = Date.now();
    this.activeBlockId = 1;

    this.state = {
      recordingId,
      state: 'recording',
      mode,
      sourceLanguage,
      targetLanguage,
      translationModelKey,
      translationThinkingLevel: this.state.translationThinkingLevel,
      durationMs: 0,
      audioVolume: 0,
      speechState: 'listening',
      captions: [],
      error: null,
      epoch: currentEpoch,
      pauseMs,
      readingPauseMs,
      speechProvider: options.speechProvider ?? this.state.speechProvider, transcriptionMode, speakerCount,
      micState: 'idle', receivedAudioMs: 0,
      lastTranscriptAt: null, transcriptCount: 0, translationLatencyMs: null,
      speakerStatus: 'idle', speakerMessage: null,
      micDeviceLabel: null,
    };
    this.hasPendingTranscript = false;
    this.providerSpeechEnded = false;
    this.speechRetries = 0;
    this.captionRevisions.clear();
    this.seenSpeechSnapshots.clear();
    this.speechItemLocations.clear();
    this.captionSpeakers.clear();
    this.notify();

    // Duration timer
    this.durationIntervalId = setInterval(() => {
      if (this.state.state !== 'recording' || this.sessionEpoch !== currentEpoch) return;
      const durationMs = Date.now() - this.startTime;
      this.state.durationMs = durationMs;
      if (this.pcmCapture?.state === 'suspended') this.state.micState = 'suspended';
      this.notify();
    }, 500);

    // Live Utterance Assembler
    this.assembler = new LiveUtteranceAssembler(mode);

    // Live Translation Scheduler
    this.scheduler = new LiveTranslationScheduler({
      runner: async (source, direction, history, signal, requestSnapshot, onDelta) => {
        const requestedAt = Date.now();
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
              thinkingLevel: this.state.translationThinkingLevel === 'auto' ? undefined : this.state.translationThinkingLevel as 'minimal' | 'low' | 'medium' | 'high',
              sourceLanguage: direction.sourceCode,
              targetLanguage: direction.targetCode,
              text: source,
              context: options.context,
              glossary: options.glossary,
              previousTurns: history,
            },
            (delta) => {
              if (!accumulated && this.sessionEpoch === currentEpoch) this.state.translationLatencyMs = Date.now() - requestedAt;
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
          if (vol >= 0.015 && !this.providerSpeechEnded) {
            this.clearSilenceTimer();
          } else if (!this.silenceTimer) {
            this.scheduleSilenceClose(currentEpoch);
          }
          this.notify();
        },
        onMicState: (micState) => { if (this.sessionEpoch === currentEpoch) { this.state.micState = micState; this.notify(); } },
        onMicInfo: (label) => { if (this.sessionEpoch === currentEpoch) { this.state.micDeviceLabel = label; this.notify(); } },
        onError: (err) => {
          if (this.sessionEpoch !== currentEpoch) return;
          this.state.error = err;
          this.notify();
        },
      });

      await this.audioRecorder.start(2000);
    } catch (err) {
      this.state.error = `Không thu được micro: ${err instanceof Error ? err.message : String(err)}`;
      this.state.state = 'stopped';
      if (this.durationIntervalId) clearInterval(this.durationIntervalId);
      this.durationIntervalId = null;
      this.assembler?.close(); this.assembler = null;
      this.scheduler?.close(); this.scheduler = null;
      await updateRecording(recordingId, { state: 'interrupted', audioState: 'missing' });
      this.notify();
      throw err;
    }

    // Speech Recognizer
    const callbacks: SpeechRecognitionCallbacks = {
        onTranscript: (text, isFinal, epoch, providerItemId, providerRevision, timing) => {
          if (epoch !== this.sessionEpoch || this.sessionEpoch !== currentEpoch) return;
          this.state.lastTranscriptAt = Date.now();
          this.state.transcriptCount++;
          this.speechRetries = 0;
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
          const currentMs = timing?.endMs ?? Date.now() - this.startTime;
          const existingLocation = this.speechItemLocations.get(providerItemId);
          if (!existingLocation && this.state.mode === 'readingPractice' && this.hasPendingTranscript &&
              timing?.speakerLabel !== this.captionSpeakers.get(this.assembler!.currentCaptionId)) {
            this.clearSilenceTimer();
            this.assembler!.finalizeCurrentUtterance(true);
            this.scheduler?.onBlockClosed(this.activeBlockId++);
            this.hasPendingTranscript = false;
          }
          if (!existingLocation && this.state.mode === 'lecture' && this.hasPendingTranscript) {
            // Independent provider turns keep their caption identities even
            // when a later correction arrives after the row has closed.
            this.clearSilenceTimer();
            this.assembler!.finalizeCurrentUtterance(true);
          }
          const captionId = existingLocation?.captionId ?? this.assembler!.currentCaptionId;
          if (timing?.speakerLabel) this.captionSpeakers.set(captionId, timing.speakerLabel);
          const currentCaptionId = this.assembler!.currentCaptionId;
          const blockId = existingLocation?.blockId ?? this.activeBlockId;
          const isLateResult = captionId < currentCaptionId;
          const startMs = existingLocation?.startMs ?? timing?.startMs ?? Math.max(0, currentMs - 2000);
          this.speechItemLocations.delete(providerItemId);
          this.speechItemLocations.set(providerItemId, { captionId, blockId, startMs });
          if (this.speechItemLocations.size > 256) {
            const oldestProviderId = this.speechItemLocations.keys().next().value;
            if (oldestProviderId) this.speechItemLocations.delete(oldestProviderId);
          }
          if (!isLateResult) {
            this.providerSpeechEnded = isFinal;
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
          if (this.state.speechProvider === 'google') { this.pcmReady = false; this.scheduleGoogleRetry(epoch, sourceLanguage); }
          this.notify();
        },
        onStateChange: (speechState) => {
          if (currentEpoch !== this.sessionEpoch) return;
          this.state.speechState = speechState;
          this.notify();
        },
      };
    this.speechCallbacks = callbacks;
    {
      this.pcmCapture ??= new GeminiPcmCapture();
      this.pcmReady = false; this.pcmQueue = []; this.pcmQueueMs = 0;
      this.pcmInputCallback = (samples, rate) => {
        if (this.sessionEpoch !== currentEpoch || this.state.state !== 'recording') return;
        this.state.receivedAudioMs += samples.length / rate * 1000;
        if (this.pcmReady && this.speechRecognizer) this.speechRecognizer.pushPcm(samples, rate);
        else if (this.pcmQueueMs < 10_000) { this.pcmQueue.push({ samples, rate }); this.pcmQueueMs += samples.length / rate * 1000; }
        else {
          const message = 'Nhận giọng chưa sẵn sàng quá 10 giây. Audio vẫn được lưu trên máy; hãy kiểm tra micro.';
          if (this.state.error !== message) { this.state.error = message; this.notify(); }
        }
      };
      try {
        await this.pcmPreparation;
        await this.pcmCapture.start(this.audioRecorder!.stream!, this.pcmInputCallback);
        this.pcmAttached = true;
        await this.startTranscriber(currentEpoch);
      }
      catch (err) {
        this.state.error = `Nhận giọng Gemini chưa hoạt động: ${err instanceof Error ? err.message : String(err)}. Audio đang được lưu trên máy.`;
        this.state.speechState = 'stopped'; this.notify();
        if (this.pcmAttached && this.state.speechProvider === 'google') this.scheduleGoogleRetry(currentEpoch, this.state.sourceLanguage);
        else { this.state.micState = 'suspended'; this.notify(); }
      }
    }

    return recordingId;
  }

  private captionRevisions = new Map<number, number>();
  private async startTranscriber(epoch: number): Promise<void> {
    if (epoch !== this.sessionEpoch || !this.speechCallbacks || this.stopping) return;
    if (this.state.speechProvider === 'google') { await this.connectGoogleSpeech(epoch, this.state.sourceLanguage); return; }
    const recognizer = new GeminiTranscribeRecognizer(
      this.speechCallbacks, this.state.sourceLanguage,
      this.state.mode === 'readingPractice' ? this.state.readingPauseMs : this.state.pauseMs,
      this.state.transcriptionMode, this.state.speakerCount, segmentedTranscriptionModel(this.state.speechProvider),
    );
    this.speechRecognizer = recognizer;
    recognizer.start(epoch);
    this.pcmReady = true;
    for (const item of this.pcmQueue) recognizer.pushPcm(item.samples, item.rate);
    this.pcmQueue = []; this.pcmQueueMs = 0;
  }

  private async connectGoogleSpeech(epoch: number, language: string): Promise<void> {
    if (this.googleConnection) return this.googleConnection;
    const connection = this.openGoogleSpeech(epoch, language);
    this.googleConnection = connection;
    try { await connection; }
    finally { if (this.googleConnection === connection) this.googleConnection = null; }
  }

  private async openGoogleSpeech(epoch: number, language: string): Promise<void> {
    if (this.state.speechProvider !== 'google' || epoch !== this.sessionEpoch || !this.speechCallbacks || this.stopping || this.googleConnecting) return;
    this.googleConnecting = true;
    try {
    this.state.speechState = 'reconnecting'; this.notify();
    const recognizer = new GeminiLiveRecognizer(this.speechCallbacks, language, this.state.transcriptionMode);
    this.speechRecognizer = recognizer;
    await recognizer.start(epoch, language);
    if (epoch !== this.sessionEpoch || this.stopping) { await recognizer.stop(0); return; }
    this.pcmReady = true;
    for (const item of this.pcmQueue) recognizer.pushPcm(item.samples, item.rate);
    this.pcmQueue = []; this.pcmQueueMs = 0;
    this.renewalTimer = setTimeout(() => {
      this.renewalTimer = null;
      if (this.state.state !== 'recording' || epoch !== this.sessionEpoch || this.stopping) return;
      this.pcmReady = false;
      void recognizer.stop().then(() => this.connectGoogleSpeech(epoch, language)).catch(error => {
        this.state.error = `Không nối lại được nhận giọng: ${error instanceof Error ? error.message : String(error)}. Audio vẫn được lưu.`;
        this.notify();
        this.scheduleGoogleRetry(epoch, language);
      });
    }, 8.5 * 60_000);
    } finally { this.googleConnecting = false; }
  }
  private scheduleGoogleRetry(epoch: number, language: string): void {
    if (this.speechRetryTimer || this.stopping || this.state.state !== 'recording' || epoch !== this.sessionEpoch || this.speechRetries >= 3) return;
    this.speechRetryTimer = setTimeout(() => {
      this.speechRetryTimer = null;
      if (this.stopping || this.state.state !== 'recording' || epoch !== this.sessionEpoch) return;
      if (this.googleConnecting) { this.scheduleGoogleRetry(epoch, language); return; }
      this.speechRetries++;
      if (this.renewalTimer) clearTimeout(this.renewalTimer);
      this.renewalTimer = null;
      const old = this.speechRecognizer;
      void Promise.resolve(old?.stop(0)).then(() => this.connectGoogleSpeech(epoch, language)).catch(error => {
        this.state.error = `Chưa nối lại được nhận giọng (${this.speechRetries}/3): ${error instanceof Error ? error.message : String(error)}. Audio vẫn lưu trên máy.`;
        this.notify(); this.scheduleGoogleRetry(epoch, language);
      });
    }, Math.min(1000 * 2 ** this.speechRetries, 4000));
  }
  private clearSpeechTimers(): void {
    if (this.renewalTimer) clearTimeout(this.renewalTimer);
    if (this.speechRetryTimer) clearTimeout(this.speechRetryTimer);
    this.renewalTimer = null; this.speechRetryTimer = null;
  }

  public setSpeechProvider(provider: SpeechProvider): void {
    if (provider === this.state.speechProvider) return;
    this.state.speechProvider = provider;
    this.restartRecognizer();
    this.notify();
  }

  private restartRecognizer(): void {
    if (this.state.state !== 'recording' || this.stopping) return;
    const epoch = this.sessionEpoch;
    this.pcmReady = false;
    this.clearSpeechTimers();
    this.recognizerChange = this.recognizerChange.then(async () => {
      if (epoch !== this.sessionEpoch || this.stopping || this.state.state !== 'recording') return;
      await this.googleConnection?.catch(() => undefined);
      await this.speechRecognizer?.stop();
      this.speechRecognizer = null;
      this.clearSpeechTimers();
      await this.startTranscriber(epoch);
    }).catch(error => {
      this.state.error = `Không đổi được nhận giọng: ${String(error)}. Audio vẫn được lưu.`;
      this.notify();
    });
  }

  public setTranscriptionSettings(settings: { transcriptionMode?: TranscriptionMode; speakerCount?: SpeakerCount }): void {
    const transcriptionMode = normalizeTranscriptionMode(settings.transcriptionMode ?? this.state.transcriptionMode);
    const speakerCount = settings.speakerCount ?? this.state.speakerCount;
    if (!isSpeakerCount(speakerCount)) throw new Error('Bắt buộc chọn số người nói từ 1 đến 8.');
    const modeChanged = transcriptionMode !== this.state.transcriptionMode;
    if (this.speechRecognizer instanceof GeminiTranscribeRecognizer) this.speechRecognizer.updateSettings({ transcriptionMode, speakerCount });
    this.state.transcriptionMode = transcriptionMode;
    this.state.speakerCount = speakerCount;
    if (modeChanged && this.state.speechProvider === 'google') this.restartRecognizer();
    if (this.state.state === 'recording' && this.recordingConfig) {
      this.recordingConfig = { ...this.recordingConfig, transcriptionMode, speakerCount };
    }
    this.notify();
  }

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
      if (this.speechRecognizer instanceof GeminiLiveRecognizer) this.speechRecognizer.finalizeUtterance();
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
    const previous = existingIndex >= 0 ? this.state.captions[existingIndex] : undefined;
    let sourceHistory = previous?.sourceHistory;
    if (previous?.isFinal && previous.source !== event.sourceText) {
      const history = [...(sourceHistory ?? []), { text: previous.source, revision: previous.revision }];
      sourceHistory = history.length > 20 ? [history[0], ...history.slice(-19)] : history;
    }

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
      speakerLabel: previous?.speakerLabel ?? this.captionSpeakers.get(event.captionId),
      sourceHistory,
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
    this.pcmReady = false;
    this.clearSpeechTimers();
    await this.recognizerChange;
    this.clearSpeechTimers();
    const stopErrors: string[] = [];
    if (this.pcmCapture) {
      try { await this.pcmCapture.stop(); } catch (error) { stopErrors.push(String(error)); }
      this.pcmCapture = null;
      this.pcmAttached = false;
      this.pcmInputCallback = null;
    }
    this.pcmQueue = []; this.pcmQueueMs = 0;

    if (this.durationIntervalId) {
      clearInterval(this.durationIntervalId);
      this.durationIntervalId = null;
    }

    if (this.audioRecorder) {
      try { await this.audioRecorder.stop(); } catch (error) { stopErrors.push(String(error)); }
      this.audioRecorder = null;
    }

    if (this.speechRecognizer) {
      try { await this.speechRecognizer.stop(); } catch (error) { stopErrors.push(String(error)); }
      this.speechRecognizer = null;
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
    this.sessionEpoch++; // Drain final transcription, translation, and storage before invalidating.

    this.state = {
      ...this.state,
      state: 'stopped',
      durationMs,
      audioVolume: 0,
      speechState: 'stopped',
      micState: 'idle',
      error: stopErrors.length ? `Đã dừng thu, nhưng nhận kết quả cuối gặp lỗi: ${stopErrors.join('; ')}` : this.state.error,
    };
    this.notify();

    if (recordingId) {
      await updateRecording(recordingId, {
        state: 'stopped',
        endedAt: new Date(captureEndedAt).toISOString(),
        durationMs,
        ...(this.recordingConfig ? { config: this.recordingConfig } : {}),
      });
      // Native verbatim diarization already ran within each transcription request.
    }
  }

  public assignSpeakers(): Promise<void> {
    if (this.speakerTask) return this.speakerTask;
    const task = this.assignSpeakersInternal();
    this.speakerTask = task;
    void task.finally(() => { if (this.speakerTask === task) this.speakerTask = null; });
    return task;
  }

  public async resumeMicrophone(): Promise<void> {
    try {
      // Both resume calls start in the user's tap, without a preceding await.
      await Promise.all([this.audioRecorder?.resume(), this.pcmCapture?.prepare()]);
      if (this.state.state === 'recording') {
        if (this.pcmCapture && !this.pcmAttached && this.audioRecorder?.stream && this.pcmInputCallback) {
          await this.pcmCapture.start(this.audioRecorder.stream, this.pcmInputCallback);
          this.pcmAttached = true;
        }
        this.state.micState = 'live'; this.notify();
        if (!this.pcmReady) await this.startTranscriber(this.sessionEpoch);
      }
    } catch (error) {
      this.state.error = `Không bật lại được micro: ${error instanceof Error ? error.message : String(error)}`;
      this.notify();
    }
  }

  private async assignSpeakersInternal(): Promise<void> {
    const recordingId = this.state.recordingId;
    if (!recordingId || this.state.state === 'recording') return;
    if (this.state.transcriptionMode === 'smart') {
      this.state.speakerStatus = 'unavailable';
      this.state.speakerMessage = 'Smart không hỗ trợ diarization. Gán Speaker cho từng câu bên dưới.';
      this.notify(); return;
    }
    this.state.speakerStatus = 'working'; this.state.speakerMessage = 'Đang phân biệt người nói từ audio…'; this.notify();
    try {
      const audio = this.state.durationMs <= 30 * 60_000 ? await getAudioBlob(recordingId, 4 * 1024 * 1024) : null;
      if (!audio || audio.blob.size > 4 * 1024 * 1024 || this.state.durationMs > 30 * 60_000) {
        this.state.speakerStatus = 'unavailable';
        this.state.speakerMessage = 'Phân biệt người nói cần audio trên máy, tối đa 4 MB và 30 phút.';
        this.notify(); return;
      }
      const abort = new AbortController(); this.speakerAbort = abort;
      const timeout = setTimeout(() => abort.abort(), 4 * 60_000);
      let response: Response;
      try {
        const form = new FormData();
        form.set('audio', audio.blob, audio.mimeType.startsWith('audio/mp4') ? 'recording.m4a' : 'recording.webm');
        form.set('durationMs', String(Math.max(1, Math.round(this.state.durationMs))));
        form.set('speakerCount', String(this.state.speakerCount));
        response = await fetch('/api/speech/diarize', { method: 'POST', body: form, signal: abort.signal });
      } finally { clearTimeout(timeout); }
      const payload = await response.json() as { segments?: Array<{speakerLabel: string; startMs: number; endMs: number}>; error?: {message?: string} };
      if (!response.ok || !payload.segments?.length) throw new Error(payload.error?.message ?? 'Không có nhãn người nói từ API.');
      if (this.state.recordingId !== recordingId || this.snapshot().state === 'recording') return;
      for (const caption of this.state.captions) {
        const overlaps = new Map<string, number>();
        for (const segment of payload.segments) {
          const overlap = Math.max(0, Math.min(caption.endMs, segment.endMs) - Math.max(caption.startMs, segment.startMs));
          if (overlap) overlaps.set(segment.speakerLabel, (overlaps.get(segment.speakerLabel) ?? 0) + overlap);
        }
        const labels = [...overlaps].sort((a, b) => b[1] - a[1]);
        const total = labels.reduce((sum, [, ms]) => sum + ms, 0);
        // An ambiguous row is left unlabelled instead of inventing a speaker.
        caption.speakerLabel = labels[0] && labels[0][1] / total >= 0.65 && isAllowedSpeakerLabel(labels[0][0], this.state.speakerCount) ? labels[0][0] : undefined;
      }
      await Promise.all(this.state.captions.map(caption => saveCaption({ ...caption })));
      if (this.state.recordingId !== recordingId) return;
      this.state.speakerStatus = 'done'; this.state.speakerMessage = 'Đã phân tích người nói; câu có giọng chồng nhau được giữ chưa gán nhãn.';
      this.notify();
    } catch (error) {
      if (this.state.recordingId !== recordingId || this.snapshot().state === 'recording') return;
      this.state.speakerStatus = 'error'; this.state.speakerMessage = `Chưa phân biệt được người nói: ${error instanceof Error ? error.message : String(error)}`;
      this.notify();
    }
  }

  public async setCaptionSpeaker(captionId: number, speakerLabel: string | undefined): Promise<void> {
    if (this.state.state === 'recording' || this.stopping) throw new Error('Kết thúc buổi thu trước khi gán người nói.');
    if (this.speakerTask) throw new Error('Đợi phân biệt người nói hoàn tất trước khi sửa nhãn.');
    if (speakerLabel !== undefined && !isAllowedSpeakerLabel(speakerLabel, this.state.speakerCount)) throw new Error('Người nói phải nằm trong danh sách Speaker đã cấu hình.');
    const caption = this.state.captions.find(item => item.id === captionId);
    if (!caption) throw new Error('Không tìm thấy câu cần gán người nói.');
    const updated = { ...caption, speakerLabel };
    await saveCaption(updated);
    if (this.state.recordingId !== caption.recordingId) return;
    this.state.captions = this.state.captions.map(item => item.id === captionId ? updated : item);
    this.notify();
  }

  public setTranslationModel(modelKey: string): void {
    if (this.state.translationModelKey === modelKey) return;
    this.configRevision++;
    this.state.translationModelKey = modelKey;
    this.notify();
  }

  public setTranslationThinkingLevel(level: string): void {
    if (this.state.translationThinkingLevel === level) return;
    this.configRevision++;
    this.state.translationThinkingLevel = level;
    this.notify();
  }

  public setPauseMs(ms: number): void {
    const pauseMs = ClassroomController.clampPause(ms);
    if (this.state.pauseMs === pauseMs) return;
    this.state.pauseMs = pauseMs;
    if (this.state.mode === 'lecture') (this.speechRecognizer instanceof GeminiTranscribeRecognizer ? this.speechRecognizer : null)?.updateSettings({ pauseMs });
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
    if (this.state.mode === 'readingPractice') (this.speechRecognizer instanceof GeminiTranscribeRecognizer ? this.speechRecognizer : null)?.updateSettings({ pauseMs: readingPauseMs });
    if (this.state.mode === 'readingPractice' && this.state.state === 'recording' && this.hasPendingTranscript && this.silenceTimer) {
      this.clearSilenceTimer();
      this.scheduleSilenceClose(this.sessionEpoch);
    }
    this.notify();
  }

  public switchMode(mode: ClassroomMode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    (this.speechRecognizer instanceof GeminiTranscribeRecognizer ? this.speechRecognizer : null)?.updateSettings({ pauseMs: mode === 'readingPractice' ? this.state.readingPauseMs : this.state.pauseMs });
    this.assembler?.switchMode(mode);
    this.notify();
  }
}
