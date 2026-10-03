import type { SpeechRecognitionCallbacks } from './speech-recognition';
import { floatToPcm16, Pcm16kResampler } from './pcm-resampler';

let connectionSequence = 0;

/** NeMo's transcription WebSocket protocol, using short-lived gateway tickets. */
export class NemotronRecognizer {
  private socket: WebSocket | null = null;
  private epoch = 0;
  private generation = 0;
  private connectionId = '';
  private utterance = 0;
  private revision = 0;
  private partial = '';
  private inputRate = 0;
  private resampler: Pcm16kResampler | null = null;
  private audioSinceCommit = false;
  private pendingCommits = 0;
  private status: 'idle' | 'connecting' | 'listening' | 'draining' | 'stopped' = 'idle';
  private request: AbortController | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private stopPromise: Promise<void> | null = null;
  private finishStop: (() => void) | null = null;
  private cancelStart: (() => void) | null = null;

  constructor(private callbacks: SpeechRecognitionCallbacks, private languageCode = 'ja-JP', private pauseMs = 900) {}

  public async start(epoch: number, languageCode = this.languageCode): Promise<void> {
    if (this.status === 'connecting' || this.socket) throw new Error('Nemotron đang nhận giọng.');
    const generation = ++this.generation;
    this.epoch = epoch;
    this.languageCode = languageCode;
    this.connectionId = `nemotron-${Date.now().toString(36)}-${++connectionSequence}`;
    this.utterance = 0; this.revision = 0; this.partial = '';
    this.pendingCommits = 0; this.audioSinceCommit = false; this.resampler = null;
    this.stopPromise = null;
    this.status = 'connecting';
    this.callbacks.onStateChange('reconnecting');
    const request = new AbortController();
    this.request = request;
    let session: { token: string; websocketUrl: string; sessionLimitMs?: number };
    try {
      const response = await fetch('/api/speech/nemotron/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languageCode, pauseMs: this.pauseMs }), cache: 'no-store',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Không kết nối được máy chủ Nemotron.');
      session = payload;
      if (!session.token || !session.websocketUrl) throw new Error('Máy chủ Nemotron trả về phiên không hợp lệ.');
    } catch (error) {
      if (generation === this.generation) this.status = 'stopped';
      throw error;
    } finally { if (this.request === request) this.request = null; }
    if (generation !== this.generation) throw new Error('Phiên Nemotron đã bị hủy.');
    const url = new URL(session.websocketUrl);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Địa chỉ Nemotron không hợp lệ.');
    url.searchParams.set('ticket', session.token);
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => finish(new Error('Máy chủ Nemotron không phản hồi cấu hình phiên.')), 12_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); this.cancelStart = null;
        if (error) reject(error); else resolve();
      };
      this.cancelStart = () => finish(new Error('Phiên Nemotron đã bị hủy.'));
      socket.onmessage = (event) => {
        if (generation !== this.generation) return;
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        let message: Record<string, unknown>;
        try { message = JSON.parse(raw); } catch { return; }
        if (message.type === 'session.updated') { finish(); return; }
        if (message.type === 'error') {
          const error = message.error as { message?: string } | undefined;
          const detail = error?.message ?? 'Nemotron không xử lý được âm thanh.';
          finish(new Error(detail)); this.fail(detail); return;
        }
        this.handleMessage(message);
      };
      socket.onerror = () => { finish(new Error('Kết nối Nemotron bị lỗi.')); this.fail('Kết nối Nemotron bị lỗi.'); };
      socket.onclose = () => {
        if (generation !== this.generation) return;
        finish(new Error('Máy chủ Nemotron đã đóng kết nối.'));
        if (this.status === 'draining') this.fail('Kết nối Nemotron đóng trước khi nhận đủ chữ cuối câu. Audio đã được giữ lại.');
        else this.fail('Máy chủ Nemotron đã đóng kết nối. Audio vẫn được lưu.');
      };
    }).catch((error: unknown) => {
      if (generation === this.generation) this.close();
      throw error;
    });
    if (generation !== this.generation || this.socket !== socket) return;
    this.status = 'listening';
    this.callbacks.onStateChange('listening');
    this.sessionTimer = setTimeout(() => this.fail('Phiên nhận giọng Nemotron cần được kết nối lại.'), Math.min(session.sessionLimitMs ?? 600_000, 600_000));
  }

  public pushPcm(samples: Float32Array, rate: number): void {
    if (this.status !== 'listening') return;
    if (!this.resampler || this.inputRate !== rate) { this.resampler = new Pcm16kResampler(rate); this.inputRate = rate; }
    this.sendPcm(this.resampler.push(samples));
  }

  private sendPcm(samples: Float32Array): void {
    if (!samples.length || this.socket?.readyState !== 1) return;
    const bytes = floatToPcm16(samples);
    if (this.socket.bufferedAmount + bytes.byteLength > 512 * 1024) { this.fail('Nemotron nhận âm thanh chậm; kết nối cần được khởi động lại.'); return; }
    this.socket.send(bytes);
    this.audioSinceCommit = true;
  }

  public finalizeUtterance(): void {
    if (this.status !== 'listening' || this.socket?.readyState !== 1 || !this.audioSinceCommit) return;
    if (this.resampler) this.sendPcm(this.resampler.flush());
    if (this.socket?.readyState !== 1) return;
    this.pendingCommits++;
    this.audioSinceCommit = false;
    this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (message.type === 'conversation.item.input_audio_transcription.delta' && typeof message.delta === 'string') {
      this.partial += message.delta;
      this.emit(this.partial, false);
    } else if (message.type === 'conversation.item.input_audio_transcription.completed' && typeof message.transcript === 'string') {
      this.emit(message.transcript, true);
      this.partial = ''; this.revision = 0; this.utterance++;
    } else if (message.type === 'input_audio_buffer.committed') {
      this.pendingCommits = Math.max(0, this.pendingCommits - 1);
      // NeMo emits the final transcript before this acknowledgement. Keep
      // callbacks attached through every outstanding commit when stopping.
      if (this.status === 'draining' && this.pendingCommits === 0) this.finishStop?.();
    }
  }

  private emit(text: string, final: boolean): void {
    if (!text.trim()) return;
    this.callbacks.onTranscript(text.trim(), final, this.epoch, `${this.connectionId}-${this.utterance}`, ++this.revision);
  }

  public stop(timeoutMs = 5000): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.status !== 'listening' || this.socket?.readyState !== 1) {
      this.close(); return Promise.resolve();
    }
    this.finalizeUtterance();
    if (this.status !== 'listening' || this.socket?.readyState !== 1) return Promise.resolve();
    if (!this.pendingCommits || timeoutMs <= 0) { this.close(); return Promise.resolve(); }
    this.status = 'draining';
    this.stopPromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.callbacks.onError('Nemotron chưa trả đủ chữ cuối câu trước khi hết thời gian chờ. Audio đã được giữ lại.', this.epoch);
        finish();
      }, Math.min(timeoutMs, 5000));
      const finish = () => { clearTimeout(timeout); this.finishStop = null; this.close(); resolve(); };
      this.finishStop = finish;
    });
    return this.stopPromise;
  }

  private fail(message: string): void {
    if (this.status === 'stopped') return;
    this.callbacks.onError(message, this.epoch);
    if (this.finishStop) this.finishStop(); else this.close();
  }

  private close(): void {
    this.generation++;
    this.request?.abort(); this.request = null;
    this.cancelStart?.(); this.cancelStart = null;
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close(); }
    this.status = 'stopped'; this.resampler = null;
    this.callbacks.onStateChange('stopped');
  }
}
