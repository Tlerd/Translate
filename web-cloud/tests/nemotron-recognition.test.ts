import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NemotronRecognizer } from '@/features/recording/nemotron-recognition';

class FakeSocket {
  static last: FakeSocket | undefined;
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  sent: Array<string | Uint8Array> = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  url: string;
  constructor(url: string | URL) { this.url = String(url); FakeSocket.last = this; }
  send(value: string | Uint8Array) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

const recognizers: NemotronRecognizer[] = [];
async function connected(language = 'ja-JP', pauseMs = 900) {
  const callbacks = { onTranscript: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() };
  const recognizer = new NemotronRecognizer(callbacks, language, pauseMs);
  recognizers.push(recognizer);
  const starting = recognizer.start(7);
  await vi.waitFor(() => expect(FakeSocket.last).toBeDefined());
  const socket = FakeSocket.last!;
  socket.readyState = 1;
  socket.message({ type: 'session.created' });
  expect(callbacks.onStateChange).not.toHaveBeenCalledWith('listening');
  socket.message({ type: 'session.updated' });
  await starting;
  return { recognizer, socket, ...callbacks };
}

describe('Nemotron streaming recognition', () => {
  beforeEach(() => {
    FakeSocket.last = undefined;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ token: 'one-use-ticket', websocketUrl: 'ws://127.0.0.1:8081/speech' })));
  });
  afterEach(async () => {
    await Promise.all(recognizers.splice(0).map(recognizer => recognizer.stop(0)));
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it('requests the selected locale, waits for setup, and streams binary PCM16 at 16 kHz', async () => {
    const { recognizer, socket } = await connected('vi-VN', 1200);
    expect(fetch).toHaveBeenCalledWith('/api/speech/nemotron/session', expect.objectContaining({ body: JSON.stringify({ languageCode: 'vi-VN', pauseMs: 1200 }) }));
    expect(new URL(socket.url).searchParams.get('ticket')).toBe('one-use-ticket');
    recognizer.pushPcm(new Float32Array(4800).fill(0.25), 48_000);
    expect(socket.sent[0]).toBeInstanceOf(Uint8Array);
    expect((socket.sent[0] as Uint8Array).byteLength).toBeGreaterThan(3000);
    expect((socket.sent[0] as Uint8Array).byteLength).toBeLessThanOrEqual(3200);
  });

  it('preserves item identity and revisions from deltas to the corrected final transcript', async () => {
    const { socket, onTranscript } = await connected();
    socket.message({ type: 'conversation.item.input_audio_transcription.delta', delta: '日本語を' });
    socket.message({ type: 'conversation.item.input_audio_transcription.delta', delta: '勉強' });
    socket.message({ type: 'conversation.item.input_audio_transcription.completed', transcript: '日本語を勉強します。' });
    expect(onTranscript.mock.calls.map(call => call.slice(0, 3))).toEqual([
      ['日本語を', false, 7], ['日本語を勉強', false, 7], ['日本語を勉強します。', true, 7],
    ]);
    expect(new Set(onTranscript.mock.calls.map(call => call[3])).size).toBe(1);
    expect(onTranscript.mock.calls.map(call => call[4])).toEqual([1, 2, 3]);
    socket.message({ type: 'conversation.item.input_audio_transcription.completed', transcript: '次の文。' });
    expect(onTranscript.mock.calls[3][3]).not.toBe(onTranscript.mock.calls[0][3]);
  });

  it('retains the final callback until commit acknowledgement while Stop blocks further PCM', async () => {
    const { recognizer, socket, onTranscript } = await connected();
    recognizer.pushPcm(new Float32Array(1600).fill(0.2), 16_000);
    let stopped = false;
    const stopping = recognizer.stop(500).then(() => { stopped = true; });
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    const sent = socket.sent.length;
    recognizer.pushPcm(new Float32Array(1600).fill(0.2), 16_000);
    expect(socket.sent).toHaveLength(sent);
    socket.message({ type: 'conversation.item.input_audio_transcription.completed', transcript: '最後の言葉。' });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(onTranscript.mock.calls.at(-1)?.slice(0, 2)).toEqual(['最後の言葉。', true]);
    socket.message({ type: 'input_audio_buffer.committed' });
    await stopping;
    expect(socket.readyState).toBe(3);
    socket.message({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'late' });
    expect(onTranscript).toHaveBeenCalledOnce();
  });

  it('cancels an in-flight ticket request without opening a late socket', async () => {
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
    const recognizer = new NemotronRecognizer({ onTranscript: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() });
    recognizers.push(recognizer);
    const starting = recognizer.start(1);
    const rejected = expect(starting).rejects.toThrow('hủy');
    await recognizer.stop();
    respond(Response.json({ token: 'late', websocketUrl: 'ws://127.0.0.1:8081/speech' }));
    await rejected;
    expect(FakeSocket.last).toBeUndefined();
  });

  it('reports backpressure and closes rather than silently losing audio', async () => {
    const { recognizer, socket, onError } = await connected();
    socket.bufferedAmount = 512 * 1024;
    recognizer.pushPcm(new Float32Array(1600).fill(0.2), 16_000);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('chậm'), 7);
    expect(socket.readyState).toBe(3);
    expect(socket.sent).toHaveLength(0);
  });

  it('reports disconnection while draining instead of silently discarding the last words', async () => {
    const { recognizer, socket, onError } = await connected();
    recognizer.pushPcm(new Float32Array(1600).fill(0.2), 16_000);
    const stopping = recognizer.stop(500);
    socket.close();
    await stopping;
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('chữ cuối câu'), 7);
  });
});
