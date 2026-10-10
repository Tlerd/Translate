import { LIVE_TRANSCRIPTION_MODEL, type TranscriptionMode } from '@/shared/transcription';
import { liveSpeechConfig } from '@/shared/live-speech-config';
import type { SpeechRecognitionCallbacks } from './speech-recognition';
import { floatToPcm16, Pcm16kResampler } from './pcm-resampler';

const SESSION_LIMIT_MS = 10 * 60 * 1000;
const SOCKET_OPEN = 1;
const MAX_DRAIN_MS = 5000;
let connectionSequence = 0;

interface TokenResponse {
  token: string;
  websocketUrl: string;
  expiresAt: string;
  sessionLimitMs: number;
}

export interface GeminiRecognitionDiagnostics {
  status: 'idle' | 'connecting' | 'listening' | 'draining' | 'stopped' | 'error';
  connectedAt: number | null;
  sessionDeadline: number | null;
  audioBytesSent: number;
  transcriptEvents: number;
  maxBufferedBytes: number;
  lastError: string | null;
}

/**
 * Gemini Live API verbatim streaming recognizer. Interim text is upserted by
 * utterance ID; final text reuses that ID so consumers replace the hypothesis.
 */
export class GeminiLiveRecognizer {
  private socket: WebSocket | null = null;
  private callbacks: SpeechRecognitionCallbacks;
  private epoch = 0;
  private connectionGeneration = 0;
  private connectionId = '';
  private languageCode: string;
  private resampler: Pcm16kResampler | null = null;
  private utteranceCounter = 0;
  private activeUtteranceId: string | null = null;
  private revision = 0;
  private currentTranslation: string | undefined = undefined;
  private lastSourceText = '';
  private stopPromise: Promise<void> | null = null;
  private drainResolver: (() => void) | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private diagnosticsValue: GeminiRecognitionDiagnostics = {
    status: 'idle', connectedAt: null, sessionDeadline: null, audioBytesSent: 0,
    transcriptEvents: 0, maxBufferedBytes: 0, lastError: null,
  };

  constructor(
    callbacks: SpeechRecognitionCallbacks,
    languageCode = 'ja-JP',
    private transcriptionMode: TranscriptionMode = 'verbatim',
    private targetLanguageCode?: string
  ) {
    this.callbacks = callbacks;
    this.languageCode = languageCode;
  }

  public get diagnostics(): Readonly<GeminiRecognitionDiagnostics> {
    return { ...this.diagnosticsValue };
  }

  /** Resolves only after Gemini acknowledges the constrained session setup. */
  public async start(epoch: number, languageCode = this.languageCode, targetLanguageCode = this.targetLanguageCode): Promise<void> {
    if (this.socket || this.diagnosticsValue.status === 'connecting' || this.diagnosticsValue.status === 'listening' || this.diagnosticsValue.status === 'draining') {
      throw new Error('Gemini recognizer is already active.');
    }
    this.stopPromise = null;
    const generation = ++this.connectionGeneration;
    this.connectionId = `${Date.now().toString(36)}-${(++connectionSequence).toString(36)}`;
    this.epoch = epoch;
    this.languageCode = languageCode;
    this.targetLanguageCode = targetLanguageCode;
    this.utteranceCounter = 0;
    this.activeUtteranceId = null;
    this.revision = 0;
    this.currentTranslation = undefined;
    this.lastSourceText = '';
    this.resampler = null;
    this.diagnosticsValue = {
      status: 'connecting', connectedAt: null, sessionDeadline: null, audioBytesSent: 0,
      transcriptEvents: 0, maxBufferedBytes: 0, lastError: null,
    };
    this.callbacks.onStateChange('reconnecting');

    const response = await fetch('/api/speech/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        languageCode,
        transcriptionMode: this.transcriptionMode,
        model: LIVE_TRANSCRIPTION_MODEL,
        ...(this.targetLanguageCode ? { targetLanguageCode: this.targetLanguageCode } : {}),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message || `Gemini token request failed (${response.status}).`);
    }
    const tokenData = await response.json() as TokenResponse;
    if (!tokenData.token || !tokenData.websocketUrl) throw new Error('Invalid Gemini token response.');
    if (generation !== this.connectionGeneration) throw new Error('Gemini session was superseded.');

    const url = new URL(tokenData.websocketUrl);
    url.searchParams.set('access_token', tokenData.token);
    const socket = new WebSocket(url);
    // Google sends JSON in binary WebSocket frames. Decode synchronously in
    // arrival order instead of leaving the browser's default Blob payloads.
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const setupTimeout = setTimeout(() => finish(new Error('Timed out waiting for Gemini session setup.')), 12_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(setupTimeout);
        if (error) reject(error);
        else resolve();
      };
      socket.onopen = () => {
        if (generation !== this.connectionGeneration) return finish(new Error('Gemini session was superseded.'));
        const { responseModalities, translationConfig, ...config } = liveSpeechConfig(
          this.transcriptionMode,
          languageCode,
          this.targetLanguageCode
        );
        socket.send(JSON.stringify({
          setup: {
            model: `models/${LIVE_TRANSCRIPTION_MODEL}`,
            // The Live API rejects translationConfig at the top of setup; it belongs in generationConfig.
            generationConfig: { responseModalities, ...(translationConfig ? { translationConfig } : {}) },
            ...config,
          },
        }));
      };
      socket.onmessage = (event) => {
        if (generation !== this.connectionGeneration) return;
        this.handleMessage(event.data, finish, generation);
      };
      socket.onerror = () => {
        this.fail('Kết nối Gemini nhận giọng bị lỗi.', epoch, generation);
        finish(new Error('Gemini WebSocket connection failed.'));
      };
      socket.onclose = (event) => {
        if (generation === this.connectionGeneration && this.diagnosticsValue.status === 'draining') {
          this.finishDrain();
        } else if (generation === this.connectionGeneration && this.diagnosticsValue.status !== 'stopped') {
          this.fail(`Gemini đã đóng kết nối (${event.code}).`, epoch, generation);
        }
        finish(new Error(event.reason || 'Gemini WebSocket closed before setup completed.'));
      };
    }).catch((error: unknown) => {
      socket.close();
      if (this.socket === socket) this.socket = null;
      if (generation === this.connectionGeneration) this.diagnosticsValue.status = 'error';
      throw error;
    });

    if (generation !== this.connectionGeneration || this.socket !== socket) return;
    const connectedAt = Date.now();
    const sessionDeadline = connectedAt + Math.min(SESSION_LIMIT_MS, tokenData.sessionLimitMs || SESSION_LIMIT_MS);
    this.diagnosticsValue.status = 'listening';
    this.diagnosticsValue.connectedAt = connectedAt;
    this.diagnosticsValue.sessionDeadline = sessionDeadline;
    this.callbacks.onStateChange('listening');
    this.sessionTimer = setTimeout(() => {
      this.fail('Đã đạt giới hạn phiên Gemini 10 phút. Hãy bắt đầu phiên nhận giọng mới.', epoch, generation);
      socket.close();
    }, Math.max(0, sessionDeadline - Date.now()));
  }

  /** Push raw Web Audio Float32 PCM at its native AudioContext sample rate. */
  public pushPcm(samples: Float32Array, inputRate: number): void {
    if (!this.socket || this.diagnosticsValue.status !== 'listening') return;
    if (!this.resampler || this.resamplerInputRate !== inputRate) {
      this.resampler = new Pcm16kResampler(inputRate);
      this.resamplerInputRate = inputRate;
    }
    this.sendSamples(this.resampler.push(samples));
  }

  /** Ask Gemini to finalize the current utterance after client-detected silence. */
  public finalizeUtterance(): void {
    if (this.diagnosticsValue.status !== 'listening' || this.socket?.readyState !== SOCKET_OPEN) return;
    this.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  }

  private resamplerInputRate = 0;

  private sendSamples(samples: Float32Array): void {
    if (!samples.length) return;
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    const bytes = floatToPcm16(samples);
    const buffered = socket.bufferedAmount;
    this.diagnosticsValue.maxBufferedBytes = Math.max(this.diagnosticsValue.maxBufferedBytes, buffered);
    // Fail visibly rather than accumulating unbounded audio or silently dropping speech.
    if (buffered + bytes.byteLength > 512 * 1024) {
      this.fail('Gemini nhận âm thanh chậm; dữ liệu chờ đã vượt giới hạn an toàn.', this.epoch, this.connectionGeneration);
      socket.close();
      return;
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    socket.send(JSON.stringify({
      realtimeInput: {
        audio: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' },
      },
    }));
    this.diagnosticsValue.audioBytesSent += bytes.byteLength;
  }

  private handleMessage(raw: unknown, setupDone: (error?: Error) => void, generation: number): void {
    const json = typeof raw === 'string'
      ? raw
      : raw instanceof ArrayBuffer
        ? new TextDecoder().decode(raw)
        : ArrayBuffer.isView(raw)
          ? new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))
          : null;
    if (json === null) return;
    let message: Record<string, unknown>;
    try { message = JSON.parse(json) as Record<string, unknown>; } catch { return; }
    if ('setupComplete' in message && message.setupComplete) {
      setupDone();
      return;
    }
    if (message.error && typeof message.error === 'object') {
      const detail = 'message' in message.error && typeof message.error.message === 'string'
        ? message.error.message
        : 'Gemini Live API error.';
      this.fail(detail, this.epoch, generation);
      setupDone(new Error(detail));
      return;
    }
    const content = message.serverContent && typeof message.serverContent === 'object'
      ? message.serverContent as Record<string, unknown>
      : undefined;
    const interim = content?.interimInputTranscription;
    const final = content?.inputTranscription;
    const interimText = interim && typeof interim === 'object' && 'text' in interim ? interim.text : undefined;
    const finalText = final && typeof final === 'object' && 'text' in final ? final.text : undefined;

    const outputInterim = content?.interimOutputTranscription;
    const outputFinal = content?.outputTranscription;
    const modelParts = content?.modelTurn && typeof content.modelTurn === 'object' && 'parts' in content.modelTurn && Array.isArray((content.modelTurn as { parts?: unknown }).parts)
      ? (content.modelTurn as { parts: Array<{ text?: string }> }).parts
      : undefined;
    const modelText = modelParts ? modelParts.map((p) => p.text || '').join('').trim() : undefined;
    const interimTrans = (outputInterim && typeof outputInterim === 'object' && 'text' in outputInterim && typeof outputInterim.text === 'string' ? outputInterim.text : undefined) || undefined;
    const finalTrans = (outputFinal && typeof outputFinal === 'object' && 'text' in outputFinal && typeof outputFinal.text === 'string' ? outputFinal.text : undefined) || (modelText && modelText.length ? modelText : undefined);

    if (interimTrans) this.currentTranslation = interimTrans;
    if (finalTrans) this.currentTranslation = finalTrans;

    if (typeof interimText === 'string' && interimText.length) {
      this.lastSourceText = interimText;
      this.emitTranscript(interimText, false, this.currentTranslation);
    }
    if (typeof finalText === 'string' && finalText.length) {
      this.lastSourceText = finalText;
      this.emitTranscript(finalText, true, this.currentTranslation);
      this.activeUtteranceId = null;
      this.revision = 0;
      this.currentTranslation = undefined;
      this.lastSourceText = '';
      if (this.diagnosticsValue.status === 'draining') this.finishDrain();
    }
    if (!finalText && !interimText && (finalTrans || interimTrans)) {
      // Translation can precede (or replace) the source transcript. Show it
      // right away; the source text takes over this row when it arrives.
      this.emitTranscript(this.lastSourceText || this.currentTranslation || '', false, this.currentTranslation);
    }
    if (content && 'turnComplete' in content && content.turnComplete && this.diagnosticsValue.status === 'draining') {
      this.finishDrain();
    }
  }

  private emitTranscript(text: string, isFinal: boolean, translation?: string): void {
    if (!this.activeUtteranceId) {
      this.activeUtteranceId = `gemini-${this.epoch}-${this.connectionId}-${++this.utteranceCounter}`;
      this.revision = 0;
    }
    this.revision++;
    this.diagnosticsValue.transcriptEvents++;
    this.callbacks.onTranscript(text, isFinal, this.epoch, this.activeUtteranceId, this.revision, undefined, translation);
  }

  /** Stop microphone input first, flush PCM, signal end-of-audio, and drain finals. */
  public stop(drainMs = MAX_DRAIN_MS): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = (async () => {
      const socket = this.socket;
      const epoch = this.epoch;
      if (this.sessionTimer) clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
      if (socket?.readyState === SOCKET_OPEN) {
        this.diagnosticsValue.status = 'draining';
        this.callbacks.onStateChange('stopped');
        if (this.resampler) this.sendSamples(this.resampler.flush());
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(drainTimeout);
            if (this.drainResolver === finish) this.drainResolver = null;
            resolve();
          };
          const drainTimeout = setTimeout(finish, Math.max(0, Math.min(drainMs, MAX_DRAIN_MS)));
          this.drainResolver = finish;
          socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
        });
      }
      if (this.socket === socket) this.socket = null;
      try { socket?.close(1000, 'client stopped'); } catch { /* already closed */ }
      this.resampler = null;
      this.resamplerInputRate = 0;
      this.diagnosticsValue.status = 'stopped';
      this.callbacks.onStateChange('stopped');
      if (epoch === this.epoch) this.connectionGeneration++;
    })();
    return this.stopPromise;
  }

  private finishDrain(): void {
    this.drainResolver?.();
  }

  private fail(message: string, epoch: number, generation: number): void {
    if (generation !== this.connectionGeneration || epoch !== this.epoch || this.diagnosticsValue.status === 'stopped' || this.diagnosticsValue.status === 'error') return;
    this.diagnosticsValue.status = 'error';
    this.diagnosticsValue.lastError = message;
    this.callbacks.onError(message, epoch);
    this.callbacks.onStateChange('stopped');
  }
}
