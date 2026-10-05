import { queueAudio } from '@/storage/audio-assets';
import { canonicalLanguage, inputLanguage } from '@/shared/languages';
import type { SpeechRecognitionCallbacks } from './speech-recognition';
import { GeminiLiveRecognizer } from './gemini-live-recognition';
import { NemotronRecognizer } from './nemotron-recognition';
import { SonioxRecognizer } from './soniox-recognition';
import { canRetrySpeech, SONIOX_RENEW_AFTER_MS } from '@/shared/soniox';
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
  createAudioSegment,
  updateAudioSegment,
} from '@/storage/recordings';
import type {
  ClassroomMode,
  RecordingState,
  CaptionItem,
  RecordingItem,
  AudioSegmentKind,
} from '@/shared/recording';
import { isAllowedSpeakerLabel, isSpeakerCount, normalizeTranscriptionMode, isLiveSpeechProvider, liveTranscriptionModel, type SpeakerCount, type SpeechProvider, type TranscriptionMode } from '@/shared/transcription';

export interface ControllerState {
  recordingId: string | null;
  state: RecordingState;
  apiState: 'active' | 'pausing' | 'paused' | 'resuming';
  activeSegmentIndex: number;
  activeSegmentKind: AudioSegmentKind;
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
  translationHistoryTurns: number;
  earlySegmentTranslation: boolean;
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
  pauseMs?: number;
  readingPauseMs?: number;
  translationHistoryTurns?: number;
  earlySegmentTranslation?: boolean;
}

interface CapturedPcm { samples: Float32Array; rate: number; startMs: number }

export class ClassroomController {
  private state: ControllerState = {
    recordingId: null,
    state: 'stopped',
    apiState: 'active',
    activeSegmentIndex: 1,
    activeSegmentKind: 'translating',
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
    translationHistoryTurns: 6,
    earlySegmentTranslation: false,
    speechProvider: 'google-transcribe', transcriptionMode: 'verbatim', speakerCount: 1,
    micState: 'idle', receivedAudioMs: 0,
    lastTranscriptAt: null, transcriptCount: 0, translationLatencyMs: null,
    speakerStatus: 'idle', speakerMessage: null,
    micDeviceLabel: null,
  };

  private listeners: Set<(state: ControllerState) => void> = new Set();

  private speechRecognizer: GeminiTranscribeRecognizer | GeminiLiveRecognizer | NemotronRecognizer | SonioxRecognizer | null = null;
  private pcmCapture: GeminiPcmCapture | null = null;
  private pcmPreparation: Promise<void> | null = null;
  private pcmAttached = false;
  private pcmInputCallback: ((samples: Float32Array, rate: number) => void) | null = null;
  private pcmReady = false;
  private pcmQueue: CapturedPcm[] = [];
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

  private currentSegmentIndex = 1;
  private activeSegmentKind: AudioSegmentKind = 'translating';
  private apiState: 'active' | 'pausing' | 'paused' | 'resuming' = 'active';
  private segmentStartTimes = new Map<number, number>();
  private apiActionChain: Promise<void> = Promise.resolve();
  private pendingRecognizerDrains = new Set<Promise<void>>();

  private startTime = 0;
  private durationIntervalId: ReturnType<typeof setInterval> | null = null;
  private sessionEpoch = 0;
  private configRevision = 1;
  private activeBlockId = 1;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private pcmVoiceActive = false;
  private pcmLastVoiceTime = 0;
  private pcmPreRollBuffer: CapturedPcm[] = [];
  private pcmPreRollMs = 0;
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
    const transcriptionMode = ['nemotron', 'soniox'].includes(options.speechProvider ?? this.state.speechProvider) ? 'verbatim' : options.transcriptionMode ?? this.state.transcriptionMode;
    const speakerCount = options.speakerCount ?? this.state.speakerCount;
    const speechProvider = options.speechProvider ?? this.state.speechProvider;
    const sourceLanguage = inputLanguage(options.sourceLanguage || this.state.sourceLanguage, speechProvider);
    const targetLanguage = canonicalLanguage(options.targetLanguage || this.state.targetLanguage);
    if (!sourceLanguage || !targetLanguage) throw new Error('Chọn ngôn ngữ hợp lệ cho bộ nhận giọng trước khi thu.');
    const translationModelKey = options.translationModelKey || this.state.translationModelKey;
    const pauseMs = ClassroomController.clampPause(options.pauseMs ?? this.state.pauseMs);
    const readingPauseMs = ClassroomController.clampPause(options.readingPauseMs ?? this.state.readingPauseMs);
    const translationHistoryTurns = options.translationHistoryTurns !== undefined
      ? Math.max(0, Math.min(6, Math.floor(options.translationHistoryTurns)))
      : this.state.translationHistoryTurns;
    const earlySegmentTranslation = options.earlySegmentTranslation ?? this.state.earlySegmentTranslation;

    const recording = await createRecording({
      mode,
      sourceLanguage,
      targetLanguage,
      translationModelKey,
      transcriptionMode,
      speakerCount,
    });

    const recordingId = recording.id;
    this.recordingConfig = { ...recording.config, transcriptionMode, speakerCount };
    this.startTime = Date.now();
    this.activeBlockId = 1;
    this.currentSegmentIndex = 1;
    this.activeSegmentKind = 'translating';
    this.apiState = 'active';
    this.segmentStartTimes.clear();
    this.segmentStartTimes.set(1, 0);
    this.pcmVoiceActive = false;
    this.pcmLastVoiceTime = 0;
    this.pcmPreRollBuffer = [];
    this.pcmPreRollMs = 0;

    await createAudioSegment({
      recordingId,
      segmentIndex: 1,
      kind: 'translating',
      label: 'Toàn buổi',
      startMs: 0,
      status: 'recording',
      mimeType: WebAudioRecorder.getBestSupportedMimeType() || 'audio/webm',
    });

    this.state = {
      recordingId,
      state: 'recording',
      apiState: 'active',
      activeSegmentIndex: 1,
      activeSegmentKind: 'translating',
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
      translationHistoryTurns,
      earlySegmentTranslation,
      speechProvider, transcriptionMode, speakerCount,
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

    // Live Utterance Assembler
    this.assembler = new LiveUtteranceAssembler(mode);

    // Live Translation Scheduler
    this.scheduler = new LiveTranslationScheduler({
      runner: async (source, direction, history, signal, requestSnapshot, onDelta, requestKind = 'final') => {
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
              requestKind,
              thinkingLevel: this.state.translationThinkingLevel === 'auto' ? undefined : this.state.translationThinkingLevel as 'minimal' | 'low' | 'medium' | 'high',
              sourceLanguage: direction.sourceCode,
              targetLanguage: direction.targetCode,
              text: source,
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
      sourceLanguage,
      targetLanguage,
      minIntervalMs: 700,
      historyTurns: translationHistoryTurns,
      earlySegments: earlySegmentTranslation,
      pauseMs,
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
        onChunk: async (blob, sequence, timestampMs, mimeType, segmentIndex = this.currentSegmentIndex) => {
          if (this.sessionEpoch !== currentEpoch) return;
          await addAudioChunk({
            recordingId,
            segmentIndex,
            sequence,
            mimeType,
            timestamp: timestampMs,
            blob,
          });
        },
        onSegmentComplete: async (segIndex, endMs) => {
          if (this.sessionEpoch !== currentEpoch) return;
          const segmentEndMs = endMs ?? Date.now() - this.startTime;
          const startMs = this.segmentStartTimes.get(segIndex) ?? 0;
          await updateAudioSegment(recordingId, segIndex, {
            endMs: segmentEndMs,
            durationMs: Math.max(0, segmentEndMs - startMs),
            status: 'completed',
          }).catch(() => undefined);
        },
        onVolume: (vol) => {
          if (this.sessionEpoch !== currentEpoch) return;
          this.state.audioVolume = vol;
          if (this.apiState !== 'paused' && this.apiState !== 'pausing') {
            if (vol >= 0.015 && !this.providerSpeechEnded) {
              this.clearSilenceTimer();
            } else if (!this.silenceTimer) {
              this.scheduleSilenceClose(currentEpoch);
            }
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
      // Permission prompts and audio initialization are outside the file's
      // timeline. Use the recorder's actual start for captions and lesson time.
      this.startTime = this.audioRecorder.startedAt || Date.now();
      this.state.durationMs = 0;
      this.durationIntervalId = setInterval(() => {
        if (this.state.state !== 'recording' || this.sessionEpoch !== currentEpoch) return;
        this.state.durationMs = Date.now() - this.startTime;
        if (this.pcmCapture?.state === 'suspended') this.state.micState = 'suspended';
        this.notify();
      }, 500);
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
        onError: (err, epoch, details) => {
          if (epoch !== this.sessionEpoch) return;
          this.state.error = err;
          if (isLiveSpeechProvider(this.state.speechProvider)) {
            this.pcmReady = false;
            if (details?.retryable === false) this.clearSpeechTimers();
            else this.scheduleGoogleRetry(epoch, sourceLanguage);
          }
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
        if (this.sessionEpoch !== currentEpoch || this.state.state !== 'recording' || this.stopping) return;
        if (this.apiState === 'paused' || this.apiState === 'pausing') {
          this.pcmVoiceActive = false;
          this.pcmPreRollBuffer = [];
          this.pcmPreRollMs = 0;
          return;
        }

        const chunkMs = (samples.length / rate) * 1000;
        this.state.receivedAudioMs += chunkMs;

        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          sum += samples[i] * samples[i];
        }
        const rms = Math.sqrt(sum / samples.length);
        const now = Date.now();
        const startMs = Math.max(0, now - this.startTime - chunkMs);
        const isVoice = rms >= 0.015;

        const forwardPcm = (item: CapturedPcm) => {
          if (this.pcmReady && this.speechRecognizer) {
            this.pushRecognitionAudio(item);
          } else if (this.pcmQueueMs < 10_000) {
            this.pcmQueue.push(item);
            this.pcmQueueMs += (item.samples.length / item.rate) * 1000;
          } else {
            const message = 'Nhận giọng chưa sẵn sàng quá 10 giây. Audio vẫn được lưu trên máy; hãy kiểm tra micro.';
            if (this.state.error !== message) { this.state.error = message; this.notify(); }
          }
        };

        if (this.state.speechProvider === 'soniox') {
          forwardPcm({ samples, rate, startMs });
          if (isVoice) { this.pcmLastVoiceTime = now; this.pcmVoiceActive = true; }
          else if (this.pcmVoiceActive && now - this.pcmLastVoiceTime > (this.state.mode === 'readingPractice' ? this.state.readingPauseMs : this.state.pauseMs)) {
            this.pcmVoiceActive = false;
            this.speechRecognizer?.finalizeUtterance();
          }
          return;
        }

        if (isVoice) {
          this.pcmLastVoiceTime = now;
          if (!this.pcmVoiceActive) {
            this.pcmVoiceActive = true;
            for (const item of this.pcmPreRollBuffer) {
              forwardPcm(item);
            }
            this.pcmPreRollBuffer = [];
            this.pcmPreRollMs = 0;
          }
          forwardPcm({ samples, rate, startMs });
        } else {
          // Below threshold
          if (this.pcmVoiceActive) {
            const silenceMs = this.state.speechProvider === 'nemotron'
              ? (this.state.mode === 'readingPractice' ? this.state.readingPauseMs : this.state.pauseMs)
              : 900;
            if (now - this.pcmLastVoiceTime <= silenceMs) {
              forwardPcm({ samples, rate, startMs });
            } else {
              this.pcmVoiceActive = false;
              if (this.pcmReady && this.speechRecognizer) {
                this.speechRecognizer.finalizeUtterance();
              }
            }
          }

          // Buffer up to 300ms pre-roll during silence
          this.pcmPreRollBuffer.push({ samples, rate, startMs });
          this.pcmPreRollMs += chunkMs;
          while (this.pcmPreRollMs > 300 && this.pcmPreRollBuffer.length > 1) {
            const removed = this.pcmPreRollBuffer.shift()!;
            this.pcmPreRollMs -= (removed.samples.length / removed.rate) * 1000;
          }
        }
      };
      try {
        await this.pcmPreparation;
        await this.pcmCapture.start(this.audioRecorder!.stream!, this.pcmInputCallback);
        this.pcmAttached = true;
        await this.startTranscriber(currentEpoch);
      }
      catch (err) {
        this.state.error = `Nhận giọng chưa hoạt động: ${err instanceof Error ? err.message : String(err)}. Audio đang được lưu trên máy.`;
        this.state.speechState = 'stopped'; this.notify();
        if (this.pcmAttached && isLiveSpeechProvider(this.state.speechProvider) && canRetrySpeech(err)) this.scheduleGoogleRetry(currentEpoch, this.state.sourceLanguage);
        else if (!this.pcmAttached) { this.state.micState = 'suspended'; this.notify(); }
      }
    }

    return recordingId;
  }

  private captionRevisions = new Map<number, number>();
  private pushRecognitionAudio(item: CapturedPcm) {
    if (this.speechRecognizer instanceof GeminiTranscribeRecognizer || this.speechRecognizer instanceof SonioxRecognizer) this.speechRecognizer.pushPcm(item.samples, item.rate, item.startMs);
    else this.speechRecognizer?.pushPcm(item.samples, item.rate);
  }
  private callbacksForRecognizer(isCurrent: () => boolean): SpeechRecognitionCallbacks {
    const callbacks = this.speechCallbacks!;
    return {
      ...callbacks,
      onError: (message, epoch, details) => {
        if (isCurrent()) callbacks.onError(message, epoch, details);
      },
      onStateChange: (speechState) => {
        if (isCurrent()) callbacks.onStateChange(speechState);
      },
    };
  }

  private async startTranscriber(epoch: number, offsetMs = 0): Promise<void> {
    if (epoch !== this.sessionEpoch || !this.speechCallbacks || this.stopping || this.apiState === 'paused' || this.apiState === 'pausing') return;
    if (isLiveSpeechProvider(this.state.speechProvider)) { await this.connectGoogleSpeech(epoch, this.state.sourceLanguage); return; }
    // The callback closes over the instance so only that instance can update UI state.
    let recognizer!: GeminiTranscribeRecognizer;
    // eslint-disable-next-line prefer-const
    recognizer = new GeminiTranscribeRecognizer(
      this.callbacksForRecognizer(() => this.speechRecognizer === recognizer), this.state.sourceLanguage,
      this.state.mode === 'readingPractice' ? this.state.readingPauseMs : this.state.pauseMs,
      this.state.transcriptionMode, this.state.speakerCount,
      offsetMs,
    );
    this.speechRecognizer = recognizer;
    recognizer.start(epoch);
    this.pcmReady = true;
    for (const item of this.pcmQueue) this.pushRecognitionAudio(item);
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
    if (!isLiveSpeechProvider(this.state.speechProvider) || epoch !== this.sessionEpoch || !this.speechCallbacks || this.stopping || this.googleConnecting || this.apiState === 'paused' || this.apiState === 'pausing') return;
    this.googleConnecting = true;
    try {
    this.state.speechState = 'reconnecting'; this.notify();
    // The callback closes over the instance so only that instance can update UI state.
    // eslint-disable-next-line prefer-const
    let recognizer!: GeminiLiveRecognizer | NemotronRecognizer | SonioxRecognizer;
    const callbacks = this.callbacksForRecognizer(() => this.speechRecognizer === recognizer);
    recognizer = this.state.speechProvider === 'soniox'
      ? new SonioxRecognizer(callbacks, language, this.state.recordingId ?? undefined)
      : this.state.speechProvider === 'nemotron'
      ? new NemotronRecognizer(callbacks, language, this.state.mode === 'readingPractice' ? this.state.readingPauseMs : this.state.pauseMs)
      : new GeminiLiveRecognizer(callbacks, language, this.state.transcriptionMode, liveTranscriptionModel(this.state.speechProvider));
    this.speechRecognizer = recognizer;
    await recognizer.start(epoch, language);
    if (epoch !== this.sessionEpoch || this.stopping || (this.apiState as string) === 'paused' || (this.apiState as string) === 'pausing') { await recognizer.stop(0); return; }
    this.pcmReady = true;
    for (const item of this.pcmQueue) this.pushRecognitionAudio(item);
    this.pcmQueue = []; this.pcmQueueMs = 0;
    this.renewalTimer = setTimeout(() => {
      this.renewalTimer = null;
      if (this.state.state !== 'recording' || epoch !== this.sessionEpoch || this.stopping || (this.apiState as string) === 'paused' || (this.apiState as string) === 'pausing') return;
      this.pcmReady = false;
      void recognizer.stop().then(() => this.connectGoogleSpeech(epoch, language)).catch(error => {
        this.state.error = `Không nối lại được nhận giọng: ${error instanceof Error ? error.message : String(error)}. Audio vẫn được lưu.`;
        this.notify();
        if (canRetrySpeech(error)) this.scheduleGoogleRetry(epoch, language);
      });
    }, this.state.speechProvider === 'soniox' ? SONIOX_RENEW_AFTER_MS : 8.5 * 60_000);
    } finally { this.googleConnecting = false; }
  }
  private scheduleGoogleRetry(epoch: number, language: string): void {
    if (this.speechRetryTimer || this.stopping || this.state.state !== 'recording' || epoch !== this.sessionEpoch || this.speechRetries >= 3 || this.apiState === 'paused' || this.apiState === 'pausing') return;
    this.speechRetryTimer = setTimeout(() => {
      this.speechRetryTimer = null;
      if (this.stopping || this.state.state !== 'recording' || epoch !== this.sessionEpoch || this.apiState === 'paused' || this.apiState === 'pausing') return;
      if (this.googleConnecting) { this.scheduleGoogleRetry(epoch, language); return; }
      this.speechRetries++;
      if (this.renewalTimer) clearTimeout(this.renewalTimer);
      this.renewalTimer = null;
      const old = this.speechRecognizer;
      void Promise.resolve(old?.stop(0)).then(() => this.connectGoogleSpeech(epoch, language)).catch(error => {
        this.state.error = `Chưa nối lại được nhận giọng (${this.speechRetries}/3): ${error instanceof Error ? error.message : String(error)}. Audio vẫn lưu trên máy.`;
        this.notify(); if (canRetrySpeech(error)) this.scheduleGoogleRetry(epoch, language);
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
    const sourceLanguage = inputLanguage(this.state.sourceLanguage, provider);
    if (!sourceLanguage && this.state.state === 'recording') {
      this.state.error = 'Bộ nhận giọng đã chọn không hỗ trợ ngôn ngữ đầu vào của buổi này. Kết thúc buổi để đổi ngôn ngữ hoặc bộ nhận giọng.';
      this.notify();
      return;
    }
    this.state.speechProvider = provider;
    if (provider === 'nemotron' || provider === 'soniox') this.state.transcriptionMode = 'verbatim';
    if (this.state.state !== 'recording') this.state.sourceLanguage = sourceLanguage ?? inputLanguage('ja-JP', provider)!;
    if (this.apiState !== 'paused' && this.apiState !== 'pausing') {
      this.restartRecognizer();
    }
    this.notify();
  }

  private restartRecognizer(): void {
    if (this.state.state !== 'recording' || this.stopping || this.apiState === 'paused' || this.apiState === 'pausing') return;
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
    const transcriptionMode = ['nemotron', 'soniox'].includes(this.state.speechProvider) ? 'verbatim' : normalizeTranscriptionMode(settings.transcriptionMode ?? this.state.transcriptionMode);
    const speakerCount = settings.speakerCount ?? this.state.speakerCount;
    if (!isSpeakerCount(speakerCount)) throw new Error('Bắt buộc chọn số người nói từ 1 đến 8.');
    const modeChanged = transcriptionMode !== this.state.transcriptionMode;
    if (this.speechRecognizer instanceof GeminiTranscribeRecognizer) this.speechRecognizer.updateSettings({ transcriptionMode, speakerCount });
    this.state.transcriptionMode = transcriptionMode;
    this.state.speakerCount = speakerCount;
    if (modeChanged && isLiveSpeechProvider(this.state.speechProvider)) this.restartRecognizer();
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
      if (this.speechRecognizer instanceof GeminiLiveRecognizer || this.speechRecognizer instanceof NemotronRecognizer || this.speechRecognizer instanceof SonioxRecognizer) this.speechRecognizer.finalizeUtterance();
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
      const nextCaptions = [...this.state.captions];
      nextCaptions[existingIndex] = captionItem;
      this.state.captions = nextCaptions;
    } else {
      this.state.captions = [...this.state.captions, captionItem];
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

  public async pauseApi(): Promise<void> {
    // Cut input now, including while a resume is awaiting its socket handshake.
    const task = this.pauseApiInternal();
    this.apiActionChain = Promise.all([this.apiActionChain, task]).then(() => undefined).catch(() => undefined);
    return task;
  }

  private async pauseApiInternal(): Promise<void> {
    if (this.state.state !== 'recording' || this.stopping || this.apiState !== 'active') return;

    this.apiState = 'pausing';
    this.state.apiState = 'pausing';
    this.notify();

    // 1. Cut off API audio immediately
    this.pcmReady = false;
    this.pcmQueue = [];
    this.pcmQueueMs = 0;
    this.pcmVoiceActive = false;
    this.pcmPreRollBuffer = [];
    this.pcmPreRollMs = 0;
    this.clearSilenceTimer();
    this.clearSpeechTimers();

    // Pause is an explicit utterance boundary, even if the provider never
    // supplies its last final. Late finals still correct this same caption.
    if (this.hasPendingTranscript) {
      this.assembler?.handleBlockClosed(this.activeBlockId);
      this.scheduler?.onBlockClosed(this.activeBlockId++);
      this.hasPendingTranscript = false;
    }

    // 2. Finalize utterance for speech spoken prior to pause
    const oldRecognizer = this.speechRecognizer;
    if (oldRecognizer) {
      try {
        if (this.speechRecognizer instanceof GeminiTranscribeRecognizer || this.speechRecognizer instanceof GeminiLiveRecognizer || this.speechRecognizer instanceof NemotronRecognizer || this.speechRecognizer instanceof SonioxRecognizer) {
          this.speechRecognizer.finalizeUtterance();
        }
      } catch (err) {
        console.warn('Lỗi dừng speech recognizer khi pause:', err);
      }
      this.speechRecognizer = null;
      const drain = Promise.resolve().then(() => oldRecognizer.stop()).catch((err) => { console.warn('Recognizer drain failed after pause:', err); });
      this.pendingRecognizerDrains.add(drain);
      void drain.finally(() => this.pendingRecognizerDrains.delete(drain));
    }

    // Only API input pauses. The same MediaRecorder keeps all session audio.
    this.apiState = 'paused';
    this.state.apiState = 'paused';
    this.state.activeSegmentKind = 'translating';
    this.state.speechState = 'stopped';
    this.notify();
  }

  public async resumeApi(): Promise<void> {
    const task = this.apiActionChain.then(() => this.resumeApiInternal());
    this.apiActionChain = task.catch(() => undefined);
    return task;
  }

  private async resumeApiInternal(): Promise<void> {
    if (this.state.state !== 'recording' || this.stopping || this.apiState !== 'paused') return;

    this.apiState = 'resuming';
    this.state.apiState = 'resuming';
    this.notify();

    const resumeTimeMs = Date.now() - this.startTime;
    // 2. Discard any PCM received while paused (no replay!)
    this.pcmQueue = [];
    this.pcmQueueMs = 0;
    this.pcmVoiceActive = false;
    this.pcmLastVoiceTime = 0;
    this.pcmPreRollBuffer = [];
    this.pcmPreRollMs = 0;

    // 3. Start recognizer with whole-session offset
    this.apiState = 'active';
    this.state.apiState = 'active';
    this.state.activeSegmentKind = 'translating';
    this.state.speechState = 'listening';
    this.notify();

    try {
      await this.startTranscriber(this.sessionEpoch, resumeTimeMs);
    } catch (err) {
      if ((this.apiState as string) === 'paused' || (this.apiState as string) === 'pausing' || this.stopping) return;
      this.state.error = `Không nối lại được nhận giọng: ${err instanceof Error ? err.message : String(err)}`;
      this.state.speechState = 'stopped';
      this.notify();
      if (canRetrySpeech(err) && isLiveSpeechProvider(this.state.speechProvider)) this.scheduleGoogleRetry(this.sessionEpoch, this.state.sourceLanguage);
    }
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
    const stopErrors: string[] = [];
    if (this.pcmCapture) {
      try { await this.pcmCapture.stop(); } catch (error) { stopErrors.push(String(error)); }
      this.pcmCapture = null;
      this.pcmAttached = false;
      this.pcmInputCallback = null;
    }
    this.pcmQueue = []; this.pcmQueueMs = 0;
    this.pcmVoiceActive = false;
    this.pcmPreRollBuffer = [];
    this.pcmPreRollMs = 0;

    if (this.durationIntervalId) {
      clearInterval(this.durationIntervalId);
      this.durationIntervalId = null;
    }

    if (this.audioRecorder) {
      try { await this.audioRecorder.stop(); } catch (error) { stopErrors.push(String(error)); }
      this.audioRecorder = null;
    }

    // Capture has ended even if the network still owes a final transcript.
    // Persist that fact now so reloading cannot restore a phantom recording.
    this.state.durationMs = durationMs;
    this.state.audioVolume = 0;
    this.state.micState = 'idle';
    this.notify();
    if (recordingId) {
      const activeSegIndex = this.currentSegmentIndex;
      const startMs = this.segmentStartTimes.get(activeSegIndex) ?? 0;
      try {
        await updateAudioSegment(recordingId, activeSegIndex, {
          endMs: durationMs,
          durationMs: Math.max(0, durationMs - startMs),
          status: 'completed',
        });
      } catch {
        // Audio segment metadata update failed; non-fatal
      }
      try { await updateRecording(recordingId, { state: 'stopped', endedAt: new Date(captureEndedAt).toISOString(), durationMs }); }
      catch (error) { stopErrors.push(`Lưu thời điểm dừng: ${String(error)}`); }
    }
    await this.recognizerChange;
    this.clearSpeechTimers();

    if (this.speechRecognizer) {
      try { await this.speechRecognizer.stop(); } catch (error) { stopErrors.push(String(error)); }
      this.speechRecognizer = null;
    }
    await Promise.all([...this.pendingRecognizerDrains]);

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

    this.apiState = 'active';
    this.state = {
      ...this.state,
      state: 'stopped',
      apiState: 'active',
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
      await queueAudio(recordingId).catch(error => console.warn('Audio đang chờ đồng bộ:', error));
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
      const audio = await getAudioBlob(recordingId, 4 * 1024 * 1024);
      const audioDurationMs = audio?.durationMs ?? this.state.durationMs;
      if (!audio || audio.blob.size > 4 * 1024 * 1024 || audioDurationMs > 30 * 60_000) {
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
        form.set('durationMs', String(Math.max(1, Math.round(audioDurationMs))));
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

  public setLanguages(source: string, target: string): void {
    if (this.state.state === 'recording' || this.starting || this.stopping) return;
    const sourceLanguage = inputLanguage(source, this.state.speechProvider);
    const targetLanguage = canonicalLanguage(target);
    if (!sourceLanguage || !targetLanguage) return;
    this.state.sourceLanguage = sourceLanguage;
    this.state.targetLanguage = targetLanguage;
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
    this.scheduler?.setPauseMs(pauseMs);
    if (this.state.mode === 'lecture') (this.speechRecognizer instanceof GeminiTranscribeRecognizer ? this.speechRecognizer : null)?.updateSettings({ pauseMs });
    if (this.state.mode === 'lecture' && this.state.speechProvider === 'nemotron') this.restartRecognizer();
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
    if (this.state.mode === 'readingPractice' && this.state.speechProvider === 'nemotron') this.restartRecognizer();
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
    if (this.state.speechProvider === 'nemotron') this.restartRecognizer();
    this.assembler?.switchMode(mode);
    this.notify();
  }

  public setTranslationHistoryTurns(turns: number): void {
    const clamped = Math.max(0, Math.min(6, Math.floor(turns)));
    if (this.state.translationHistoryTurns === clamped) return;
    this.state.translationHistoryTurns = clamped;
    this.scheduler?.setHistoryTurns(clamped);
    this.notify();
  }

  public setEarlySegmentTranslation(enabled: boolean): void {
    if (this.state.earlySegmentTranslation === enabled) return;
    this.state.earlySegmentTranslation = enabled;
    this.scheduler?.setEarlySegments(enabled);
    this.notify();
  }
}
