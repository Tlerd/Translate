import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassroomController } from '@/features/recording/controller';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import { getAudioBlob } from '@/storage/recordings';
import { SONIOX_MODEL, SONIOX_WEBSOCKET_URL } from '@/shared/soniox';

const fixture = vi.hoisted(() => ({ pcm: null as null | ((samples: Float32Array, rate: number) => void), translate: vi.fn() }));
vi.mock('@/features/recording/gemini-pcm-capture', () => ({ GeminiPcmCapture: class {
  state = 'running'; async prepare() {}
  async start(_stream: unknown, callback: typeof fixture.pcm) { fixture.pcm = callback; }
  async stop() { fixture.pcm = null; }
} }));
vi.mock('@/lib/api-client', () => ({ streamTranslate: fixture.translate }));
vi.mock('@/storage/audio-assets', () => ({ queueAudio: vi.fn().mockResolvedValue(undefined) }));

class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported() { return true; }
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  listeners = new Map<string, (() => void)[]>();
  constructor() { Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['whole lesson including pause']) }); this.listeners.get('stop')?.forEach((callback) => callback()); }
}
class Socket {
  static instances: Socket[] = [];
  readyState = 0; bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: (string | Uint8Array)[] = [];
  constructor() { Socket.instances.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
  send(frame: string | Uint8Array) { this.sent.push(frame); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
/** Soniox token requests only; speech-usage reports share the mocked fetch. */
const tokenFetches = () => vi.mocked(fetch).mock.calls.filter(([url]) => !String(url).startsWith('/api/usage/'));

describe('Soniox whole-lesson controller', () => {
  let controller: ClassroomController;
  let db: AppDatabase;
  beforeEach(() => {
    Recorder.instances = []; Socket.instances = [];
    db = new AppDatabase(`soniox-${Date.now()}-${Math.random()}`); resetDbInstance(db);
    fixture.translate.mockReset().mockImplementation(async (request, _delta, done) => done(`DÃ¡Â»â€¹ch ${request.text}`, 'fixture'));
    vi.stubGlobal('window', {}); vi.stubGlobal('MediaRecorder', Recorder); vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }] }) } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ token: 'fixture-only', expiresAt: new Date(Date.now() + 120000).toISOString(), model: SONIOX_MODEL, websocketUrl: SONIOX_WEBSOCKET_URL })));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    controller = new ClassroomController();
  });
  afterEach(async () => {
    const stopping = controller.stop();
    await Promise.resolve(); await Promise.resolve();
    Socket.instances.forEach((socket) => socket.message({ finished: true }));
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(6000);
    await stopping; resetDbInstance(); await db.delete(); vi.useRealTimers(); vi.unstubAllGlobals();
  });
  it.each(['lecture', 'readingPractice'] as const)('in %s shows eight changing ASR hypotheses and spends one translation request after commitment', async (mode) => {
    await controller.start({ speechProvider: 'soniox', mode, sourceLanguage: 'ja-JP', targetLanguage: 'vi', translationModelKey: 'fixture' });
    const socket = Socket.instances[0];
    for (let revision = 1; revision <= 8; revision++) {
      socket.message({ tokens: [{ text: `unfinished ${revision}` }] });
      expect(controller.snapshot().captions[0]).toMatchObject({ source: `unfinished ${revision}`, translation: '', isFinal: false });
      await vi.advanceTimersByTimeAsync(800);
    }
    expect(fixture.translate).not.toHaveBeenCalled();
    socket.message({ tokens: [{ text: 'finished sentence', is_final: true, start_ms: 0, end_ms: 6500 }, { text: '<fin>' }] });
    await vi.advanceTimersByTimeAsync(1100);
    expect(fixture.translate).toHaveBeenCalledOnce();
    expect(fixture.translate.mock.calls[0][0]).toMatchObject({ captionId: 1, text: 'finished sentence' });
    expect(controller.snapshot().captions[0]).toMatchObject({ source: 'finished sentence', state: 'done', isFinal: true });
  });
  it.each([
    ['vi', true, 7000],
    ['none', false, 7000],
    ['ja-JP', false, 7000],
  ])('bills Soniox open-stream time for target %s with translated=%s', async (targetLanguage, translated, audioMs) => {
    await controller.start({ speechProvider: 'soniox', sourceLanguage: 'ja-JP', targetLanguage });
    await vi.advanceTimersByTimeAsync(7000);
    const stopping = controller.stop();
    await vi.advanceTimersByTimeAsync(0);
    Socket.instances[0].message({ finished: true });
    await vi.advanceTimersByTimeAsync(10);
    await stopping;
    const reports = vi.mocked(fetch).mock.calls
      .filter(([url]) => String(url) === '/api/usage/speech')
      .map(([, init]) => JSON.parse(String(init?.body)));
    const final = reports.find((report) => report.endedAt);
    expect(final).toMatchObject({ provider: 'soniox', model: 'stt-rt-v5', translated });
    expect(final.audioMs).toBeGreaterThanOrEqual(audioMs);
    expect(final.audioMs).toBeLessThanOrEqual(audioMs + 100); // includes draining the final result
  });
  it('pause commits and translates remaining words while the microphone recorder continues', async () => {
    await controller.start({ speechProvider: 'soniox' });
    const socket = Socket.instances[0];
    socket.message({ tokens: [{ text: 'last unfinished words' }] });
    expect(fixture.translate).not.toHaveBeenCalled();
    await controller.pauseApi();
    socket.message({ finished: true });
    await vi.advanceTimersByTimeAsync(800);
    expect(fixture.translate).toHaveBeenCalledOnce();
    expect(controller.snapshot().captions[0]).toMatchObject({ source: 'last unfinished words', state: 'done', isFinal: true });
    expect(Recorder.instances[0].state).toBe('recording');
  });
  it.each(['lecture', 'readingPractice'] as const)('uses one mic/recorder in %s; quick resume preserves old finals and timestamps', async (mode) => {
    await controller.start({ speechProvider: 'soniox', mode, sourceLanguage: 'ja-JP', targetLanguage: 'vi', translationModelKey: 'fixture' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const first = Socket.instances[0];
    fixture.pcm!(new Float32Array(1600), 16000);
    expect(first.sent[1]).toBeInstanceOf(Uint8Array); // even silence is sent
    first.message({ tokens: [{ text: 'Ã¦â€”Â§Ã¦â€“â€¡' }] });
    await controller.pauseApi();
    const count = first.sent.length;
    fixture.pcm!(new Float32Array(1600).fill(0.3), 16000);
    await vi.advanceTimersByTimeAsync(10);
    expect(first.sent.length).toBe(count);
    expect(Recorder.instances[0].state).toBe('recording');
    vi.setSystemTime(Date.now() + 420000);
    await controller.resumeApi();
    const second = Socket.instances[1];
    fixture.pcm!(new Float32Array(1600).fill(0.3), 16000);
    second.message({ tokens: [{ text: 'Ã¦â€“Â°Ã¦â€“â€¡', is_final: true, start_ms: 300, end_ms: 600 }, { text: '<fin>' }] });
    first.message({ tokens: [{ text: 'Ã¦â€”Â§Ã¦â€“â€¡Ã£â‚¬â€š', is_final: true }, { text: '<fin>' }], finished: true });
    await vi.advanceTimersByTimeAsync(1600);
    const captions = controller.snapshot().captions;
    expect(captions).toHaveLength(2);
    expect(captions[0].source).toBe('Ã¦â€”Â§Ã¦â€“â€¡Ã£â‚¬â€š');
    expect(captions[1].source).toBe('Ã¦â€“Â°Ã¦â€“â€¡');
    expect(captions[1].startMs).toBeGreaterThan(420000);
    expect(controller.snapshot().speechState).toBe('listening');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    expect(Recorder.instances).toHaveLength(1);
    expect(tokenFetches()).toHaveLength(2);
    const recordingId = controller.snapshot().recordingId!;
    const stopping = controller.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(Recorder.instances[0].state).toBe('inactive');
    second.message({ finished: true });
    await vi.advanceTimersByTimeAsync(6000); await stopping;
    expect((await getAudioBlob(recordingId))?.blob.size).toBeGreaterThan(0);
  });
  it('renews at 55 minutes, preserving stream offset and skipping the Google timer', async () => {
    await controller.start({ speechProvider: 'soniox' }); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await vi.advanceTimersByTimeAsync(8.5 * 60000);
    expect(Socket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync((55 - 8.5) * 60000);
    expect(Socket.instances[0].sent.at(-1)).toBe('');
    Socket.instances[0].message({ finished: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(Socket.instances).toHaveLength(2);
    fixture.pcm!(new Float32Array(1600), 16000);
    Socket.instances[1].message({ tokens: [{ text: 'gia hÃ¡ÂºÂ¡n', is_final: true, start_ms: 100, end_ms: 300 }, { text: '<fin>' }] });
    expect(controller.snapshot().captions[0].startMs).toBeGreaterThanOrEqual(55 * 60000);
    await controller.pauseApi(); Socket.instances[1].message({ finished: true });
    await vi.advanceTimersByTimeAsync(60 * 60000);
    expect(tokenFetches()).toHaveLength(2);
  });
  it('timestamps queued PCM from capture rather than the later socket open', async () => {
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; })));
    const starting = controller.start({ speechProvider: 'soniox' });
    await vi.waitFor(() => expect(tokenFetches()).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(1000);
    fixture.pcm!(new Float32Array(1600), 16000);
    const capturedAt = controller.snapshot().durationMs;
    await vi.advanceTimersByTimeAsync(3000);
    respond(Response.json({ token: 'fixture', expiresAt: new Date(Date.now() + 120000).toISOString(), model: SONIOX_MODEL, websocketUrl: SONIOX_WEBSOCKET_URL }));
    await starting;
    Socket.instances[0].message({ tokens: [{ text: 'queued', is_final: true, start_ms: 300, end_ms: 500 }, { text: '<fin>' }] });
    expect(controller.snapshot().captions[0].startMs).toBeLessThan(2000);
    expect(controller.snapshot().captions[0].startMs).toBeGreaterThanOrEqual(capturedAt);
  });
  it('does not retry fatal errors in callbacks or initial start catch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'missing key', retryable: false } }, { status: 503 })));
    await controller.start({ speechProvider: 'soniox' }); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await vi.advanceTimersByTimeAsync(10000); expect(tokenFetches()).toHaveLength(1);
    await controller.pauseApi();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ token: 'fixture', expiresAt: new Date(Date.now() + 120000).toISOString(), model: SONIOX_MODEL, websocketUrl: SONIOX_WEBSOCKET_URL })));
    await controller.resumeApi();
    Socket.instances[0].message({ error_type: 'permission_denied', error_code: 403 });
    await vi.advanceTimersByTimeAsync(10000); expect(tokenFetches()).toHaveLength(1);
  });
  it('cancels a pending resume immediately when paused again', async () => {
    await controller.start({ speechProvider: 'soniox' });
    await controller.pauseApi(); Socket.instances[0].message({ finished: true });
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; })));
    const resuming = controller.resumeApi();
    await vi.advanceTimersByTimeAsync(0);
    await controller.pauseApi();
    expect(controller.snapshot().apiState).toBe('paused');
    fixture.pcm!(new Float32Array(1600).fill(0.2), 16000);
    respond(Response.json({ token: 'late', expiresAt: new Date(Date.now() + 120000).toISOString(), model: SONIOX_MODEL, websocketUrl: SONIOX_WEBSOCKET_URL }));
    await resuming;
    expect(Socket.instances).toHaveLength(1);
    expect(controller.snapshot().speechState).toBe('stopped');
  });
  it('never retries a fatal renewal rejection', async () => {
    await controller.start({ speechProvider: 'soniox' });
    vi.mocked(fetch).mockImplementation(async () => Response.json({ error: { message: 'quota', retryable: false } }, { status: 502 }));
    await vi.advanceTimersByTimeAsync(55 * 60000);
    Socket.instances[0].message({ finished: true });
    await vi.advanceTimersByTimeAsync(10000);
    expect(tokenFetches()).toHaveLength(2);
    expect(Socket.instances).toHaveLength(1);
  });
  it('retries network errors at most three times and cancels retries on pause', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'network', retryable: true } }, { status: 502 })));
    await controller.start({ speechProvider: 'soniox' });
    await vi.advanceTimersByTimeAsync(30000);
    expect(tokenFetches()).toHaveLength(4);
    await controller.pauseApi();
    await vi.advanceTimersByTimeAsync(60000);
    expect(tokenFetches()).toHaveLength(4);
  });
});
