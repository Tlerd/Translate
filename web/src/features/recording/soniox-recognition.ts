import { signalWithTimeout } from '@/shared/abort-signal';
import { SONIOX_MODEL, SONIOX_WEBSOCKET_URL, SonioxSpeechError, sonioxErrorRetryable, sonioxLanguage, sonioxTranslationPair } from '@/shared/soniox';
import type { SpeechRecognitionCallbacks } from './speech-recognition';
import { floatToPcm16, Pcm16kResampler } from './pcm-resampler';
import { SonioxTranscript, type SonioxToken } from './soniox-transcript';

let connectionSequence = 0;

export class SonioxRecognizer {
  private socket: WebSocket | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private epoch = 0;
  private status: 'idle' | 'connecting' | 'listening' | 'draining' | 'stopped' = 'idle';
  private transcript = new SonioxTranscript('idle');
  private resampler: Pcm16kResampler | null = null;
  private inputRate = 0;
  private offset: number | null = null;
  private sentMs = 0;
  private pendingFinalize = false;
  private audioSinceFinalize = false;
  private stopPromise: Promise<void> | null = null;
  private finishStop: (() => void) | null = null;
  private cancelStart: (() => void) | null = null;
  private finished = false;
  private failure: SonioxSpeechError | null = null;

  constructor(
    private callbacks: SpeechRecognitionCallbacks,
    private languageCode = 'ja-JP',
    private recordingId?: string,
    private targetLanguageCode?: string,
    private speakerCount = 1
  ) {}

  async start(epoch: number, languageCode = this.languageCode, targetLanguageCode = this.targetLanguageCode): Promise<void> {
    if (this.socket || this.status === 'connecting') throw new SonioxSpeechError('Soniox đang kết nối.', false);
    const language = languageCode === 'auto' ? null : sonioxLanguage(languageCode);
    if (languageCode !== 'auto' && !language) throw new SonioxSpeechError('Soniox chưa hỗ trợ ngôn ngữ đầu vào này. Hãy chọn ngôn ngữ khác hoặc bộ nhận giọng khác.', false);
    const generation = ++this.generation;
    this.epoch = epoch; this.languageCode = languageCode; this.targetLanguageCode = targetLanguageCode;
    this.transcript = new SonioxTranscript(`soniox-${Date.now().toString(36)}-${++connectionSequence}`, this.speakerCount);
    this.stopPromise = null; this.failure = null; this.finished = false;
    this.offset = null; this.sentMs = 0; this.pendingFinalize = false; this.audioSinceFinalize = false;
    this.status = 'connecting'; this.callbacks.onStateChange('reconnecting');
    const request = new AbortController(); this.request = request;
    try {
      const response = await fetch('/api/speech/soniox/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ languageCode, recordingId: this.recordingId }),
        signal: signalWithTimeout(request.signal, 12_000),
      });
      const session = await response.json();
      if (!response.ok) throw new SonioxSpeechError(session?.error?.message ?? 'Không cấp được phiên Soniox.', session?.error?.retryable === true, session?.error?.providerErrorType);
      if (generation !== this.generation) throw new SonioxSpeechError('Phiên Soniox đã bị hủy.', false);
      if (!session.token || session.model !== SONIOX_MODEL || session.websocketUrl !== SONIOX_WEBSOCKET_URL || Date.parse(session.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(session.expiresAt))) {
        throw new SonioxSpeechError('Phiên Soniox không hợp lệ.', false);
      }
      const socket = new WebSocket(SONIOX_WEBSOCKET_URL); this.socket = socket;
      socket.binaryType = 'arraybuffer';
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true; clearTimeout(timer); this.cancelStart = null;
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new SonioxSpeechError('Soniox không mở kết nối kịp thời.', true)), 12_000);
        this.cancelStart = () => finish(new SonioxSpeechError('Phiên Soniox đã bị hủy.', false));
        socket.onopen = () => {
          if (generation !== this.generation) return;
          try {
            const translationPair = sonioxTranslationPair(languageCode, targetLanguageCode);
            const hints = translationPair?.type === 'two_way'
              ? [translationPair.language_a, translationPair.language_b]
              : language ? [language] : [];
            const configPayload: Record<string, unknown> = {
              api_key: session.token,
              model: SONIOX_MODEL,
              audio_format: 'pcm_s16le',
              sample_rate: 16_000,
              num_channels: 1,
              ...(hints.length ? { language_hints: hints } : {}),
              enable_endpoint_detection: false,
              enable_speaker_diarization: this.speakerCount > 1,
              enable_language_identification: true,
            };
            if (translationPair) configPayload.translation = translationPair;
            socket.send(JSON.stringify(configPayload));
            this.status = 'listening'; this.callbacks.onStateChange('listening'); finish();
          } catch { finish(new SonioxSpeechError('Không gửi được cấu hình Soniox.', true)); }
        };
        socket.onmessage = (event) => {
          if (generation !== this.generation) return;
          let message: { tokens?: SonioxToken[]; finished?: boolean; error_type?: string; error_code?: number };
          try { message = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)); }
          catch { this.fail(new SonioxSpeechError('Soniox trả dữ liệu không hợp lệ.', true)); return; }
          if (!message || (message.tokens !== undefined && (!Array.isArray(message.tokens) || message.tokens.some((token) => !token || typeof token.text !== 'string')))) {
            this.fail(new SonioxSpeechError('Soniox trả token không hợp lệ.', true)); return;
          }
          if (message.error_type || message.error_code) {
            const error = new SonioxSpeechError('Soniox từ chối phiên nhận giọng. Kiểm tra key, quyền và số dư.', sonioxErrorRetryable(message.error_type ?? '', message.error_code ?? 0), message.error_type);
            finish(error); this.fail(error); return;
          }
          if (message.tokens?.some((token) => token.text === '<fin>' || token.text === '<end>')) this.pendingFinalize = false;
          for (const snapshot of this.transcript.process(message)) {
            const offset = this.offset ?? 0;
            this.callbacks.onTranscript(
              snapshot.text,
              snapshot.isFinal,
              this.epoch,
              snapshot.providerItemId,
              snapshot.revision,
              { startMs: offset + (snapshot.startMs ?? this.sentMs), endMs: offset + (snapshot.endMs ?? this.sentMs), speakerLabel: snapshot.speakerLabel },
              snapshot.translation
            );
          }
          if (message.finished) {
            this.finished = true;
            if (this.finishStop) this.finishStop(); else this.close();
          }
        };
        socket.onerror = () => {
          if (generation !== this.generation) return;
          const error = new SonioxSpeechError('Kết nối Soniox bị lỗi. Audio vẫn được lưu.', true);
          finish(error); this.fail(error);
        };
        socket.onclose = () => {
          if (generation !== this.generation) return;
          const error = new SonioxSpeechError('Soniox đóng kết nối trước khi trả đủ chữ cuối. Audio vẫn được lưu.', true);
          finish(error); if (!this.finished) this.fail(error);
        };
      });
    } catch (error) {
      if (generation === this.generation) this.close();
      if (error instanceof SonioxSpeechError) throw error;
      throw new SonioxSpeechError('Không kết nối được Soniox.', !request.signal.aborted);
    } finally { if (this.request === request) this.request = null; }
  }

  pushPcm(samples: Float32Array, inputRate: number, lessonStartMs = 0): void {
    if (this.status !== 'listening') return;
    if (!this.resampler || this.inputRate !== inputRate) { this.resampler = new Pcm16kResampler(inputRate); this.inputRate = inputRate; }
    this.sendPcm(this.resampler.push(samples), lessonStartMs);
  }

  private sendPcm(samples: Float32Array, lessonStartMs?: number): void {
    if (!samples.length || this.socket?.readyState !== 1) return;
    const bytes = floatToPcm16(samples);
    if (this.socket.bufferedAmount + bytes.byteLength > 512 * 1024) {
      this.fail(new SonioxSpeechError('Soniox nhận audio chậm; cần kết nối lại.', true)); return;
    }
    try {
      this.socket.send(bytes);
      if (this.offset === null) this.offset = lessonStartMs ?? 0;
      this.sentMs += samples.length / 16;
      this.audioSinceFinalize = true;
    } catch { this.fail(new SonioxSpeechError('Không gửi được audio Soniox.', true)); }
  }

  finalizeUtterance(): void {
    if (this.status !== 'listening' || this.socket?.readyState !== 1 || this.pendingFinalize || !this.audioSinceFinalize) return;
    this.pendingFinalize = true; this.audioSinceFinalize = false;
    try { this.socket.send(JSON.stringify({ type: 'finalize' })); }
    catch { this.fail(new SonioxSpeechError('Không chốt được câu Soniox.', true)); }
  }

  stop(timeoutMs = 5000): Promise<void> {
    if (timeoutMs <= 0) { this.finishStop?.(); this.close(); return Promise.resolve(); }
    if (this.stopPromise) return this.stopPromise;
    if (this.status !== 'listening' || this.socket?.readyState !== 1) { this.close(); return Promise.resolve(); }
    if (this.resampler) this.sendPcm(this.resampler.flush());
    if (this.socket?.readyState !== 1) return Promise.resolve();
    this.status = 'draining';
    this.stopPromise = new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.fail(new SonioxSpeechError('Soniox chưa trả đủ chữ cuối trong 5 giây. Audio đã được giữ lại.', true)), Math.min(timeoutMs, 5000));
      this.finishStop = () => { clearTimeout(timer); this.finishStop = null; this.close(); resolve(); };
      try { this.socket!.send(''); }
      catch { this.fail(new SonioxSpeechError('Không kết thúc được stream Soniox.', true)); }
    });
    return this.stopPromise;
  }

  async testConnection(): Promise<void> {
    try {
      await this.start(0);
      this.pushPcm(new Float32Array(16_000), 16_000, 0);
      await this.stop();
      if (this.failure) throw this.failure;
      if (!this.finished) throw new SonioxSpeechError('Soniox chưa xác nhận hoàn thành lượt kiểm tra.', true);
    } finally { await this.stop(0); }
  }

  private fail(error: SonioxSpeechError): void {
    if (this.status === 'stopped') return;
    this.failure = error;
    this.callbacks.onError(error.message, this.epoch, { retryable: error.retryable });
    if (this.finishStop) this.finishStop(); else this.close();
  }

  private close(): void {
    this.generation++; this.request?.abort(); this.request = null;
    this.cancelStart?.(); this.cancelStart = null;
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close(); }
    this.resampler = null; this.status = 'stopped'; this.callbacks.onStateChange('stopped');
  }
}
