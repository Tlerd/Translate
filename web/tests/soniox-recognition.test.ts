import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SonioxRecognizer } from '@/features/recording/soniox-recognition';
import { SONIOX_MODEL, SONIOX_WEBSOCKET_URL } from '@/shared/soniox';

class FakeSocket {
  static last: FakeSocket | undefined;
  readyState = 0;
  bufferedAmount = 0;
  sent: Array<string | Uint8Array> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) { FakeSocket.last = this; }
  send(value: string | Uint8Array) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const session = () => Response.json({ token: 'temporary', expiresAt: new Date(Date.now() + 120_000).toISOString(), model: SONIOX_MODEL, websocketUrl: SONIOX_WEBSOCKET_URL });
const recognizers: SonioxRecognizer[] = [];
function create() {
  const callbacks = { onTranscript: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() };
  const recognizer = new SonioxRecognizer(callbacks, 'vi-VN', 'lesson');
  recognizers.push(recognizer);
  return { recognizer, ...callbacks };
}
async function connected() {
  FakeSocket.last = undefined;
  const context = create();
  const starting = context.recognizer.start(7);
  await vi.waitFor(() => expect(FakeSocket.last).toBeDefined());
  FakeSocket.last!.open(); await starting;
  return { ...context, socket: FakeSocket.last! };
}
describe('Soniox WebSocket lifecycle', () => {
  beforeEach(() => {
    FakeSocket.last = undefined;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', vi.fn(async () => session()));
  });
  afterEach(async () => {
    await Promise.all(recognizers.splice(0).map((recognizer) => recognizer.stop(0)));
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
  it.each([44_100, 48_000])('configures before PCM and resamples %i Hz to mono PCM16', async (rate) => {
    const { recognizer, socket, onTranscript } = await connected();
    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({ api_key: 'temporary', model: SONIOX_MODEL, language_hints: ['vi'], sample_rate: 16000, audio_format: 'pcm_s16le', enable_endpoint_detection: false });
    expect(socket.url).toBe(SONIOX_WEBSOCKET_URL);
    recognizer.pushPcm(new Float32Array(rate / 10).fill(0.25), rate, 420_000);
    expect((socket.sent[1] as Uint8Array).byteLength).toBeGreaterThan(3100);
    socket.message({ tokens: [{ text: 'chữ', start_ms: 300, end_ms: 600 }] });
    expect(onTranscript.mock.calls[0][5]).toEqual({ startMs: 420_300, endMs: 420_600 });
  });
  it('finalizes once until marker and drains EOF once while blocking new PCM', async () => {
    const { recognizer, socket, onTranscript } = await connected();
    recognizer.pushPcm(new Float32Array(1600), 16000, 5000);
    recognizer.finalizeUtterance(); recognizer.finalizeUtterance();
    expect(socket.sent.filter((frame) => frame === '{"type":"finalize"}')).toHaveLength(1);
    socket.message({ tokens: [{ text: '一', is_final: true }, { text: '<fin>' }] });
    recognizer.pushPcm(new Float32Array(1600), 16000, 5100);
    recognizer.finalizeUtterance();
    const stopping = recognizer.stop();
    expect(recognizer.stop()).toBe(stopping);
    const count = socket.sent.length;
    recognizer.pushPcm(new Float32Array(1600), 16000);
    expect(socket.sent).toHaveLength(count);
    expect(socket.sent.filter((frame) => frame === '')).toHaveLength(1);
    socket.message({ tokens: [{ text: '最後', is_final: true }], finished: true });
    await stopping;
    expect(onTranscript.mock.calls.at(-1)?.slice(0, 2)).toEqual(['最後', true]);
    const transcriptCount = onTranscript.mock.calls.length;
    socket.message({ tokens: [{ text: 'late' }] });
    expect(onTranscript).toHaveBeenCalledTimes(transcriptCount);
  });
  it('cancels fetch and ignores a late session response', async () => {
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; })));
    const { recognizer } = create();
    const starting = recognizer.start(1);
    const rejected = expect(starting).rejects.toMatchObject({ retryable: false });
    await recognizer.stop(0); respond(session()); await rejected;
    expect(FakeSocket.last).toBeUndefined();
  });
  it('cancels CONNECTING and makes a retained onopen harmless', async () => {
    const { recognizer } = create(); const starting = recognizer.start(1);
    const rejected = expect(starting).rejects.toMatchObject({ retryable: false });
    await vi.waitFor(() => expect(FakeSocket.last).toBeDefined());
    const socket = FakeSocket.last!; const open = socket.onopen;
    await recognizer.stop(0); open?.(); await rejected;
    expect(socket.sent).toEqual([]);
  });
  it('treats error JSON followed by close 1000 as failure, with fatal retry metadata', async () => {
    const { recognizer, socket, onError } = await connected();
    const stopping = recognizer.stop();
    socket.message({ error_type: 'organization_balance_exhausted', error_code: 402 });
    socket.close(); await stopping;
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][2]).toEqual({ retryable: false });
  });
  it('rejects closed streams without finished and bounds socket backpressure', async () => {
    const { recognizer, socket, onError } = await connected();
    socket.bufferedAmount = 512 * 1024;
    recognizer.pushPcm(new Float32Array(1600), 16000);
    expect(onError).toHaveBeenCalledOnce(); expect(socket.readyState).toBe(3);
    const other = await connected();
    const stopping = other.recognizer.stop(); other.socket.close(); await stopping;
    expect(other.onError).toHaveBeenCalledOnce();
  });
  it('times out drain at five seconds', async () => {
    const { recognizer, onError } = await connected(); vi.useFakeTimers();
    const stopping = recognizer.stop(30_000);
    await vi.advanceTimersByTimeAsync(5000); await stopping;
    expect(onError).toHaveBeenCalledOnce();
  });
  it('connection test waits for finished after one second synthetic silence', async () => {
    const { recognizer } = create(); let done = false;
    const testing = recognizer.testConnection().then(() => { done = true; });
    await vi.waitFor(() => expect(FakeSocket.last).toBeDefined());
    const socket = FakeSocket.last!; socket.open();
    await vi.waitFor(() => expect(socket.sent.at(-1)).toBe(''));
    expect(done).toBe(false);
    expect(socket.sent.filter((frame) => frame instanceof Uint8Array).reduce((sum, frame) => sum + (frame as Uint8Array).byteLength, 0)).toBe(32000);
    socket.message({ finished: true }); await testing; expect(done).toBe(true);
  });
});
