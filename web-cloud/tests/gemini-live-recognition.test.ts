import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiLiveRecognizer } from '@/features/recording/gemini-live-recognition';
import { Pcm16kResampler } from '@/features/recording/pcm-resampler';
import { LIVE_TRANSCRIPTION_MODEL } from '@/shared/transcription';

class FakeWebSocket {
  static last: FakeWebSocket | undefined;
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'blob';
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  url: string;
  constructor(url: string | URL) { this.url = String(url); FakeWebSocket.last = this; }
  send(value: string) { this.sent.push(value); }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  binaryMessage(value: unknown) { this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(value)).buffer }); }
}

describe('Gemini live recognizer', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('requests and sets up only the Transcribe Live model, with text output and no audio reply', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ token: 'token', websocketUrl: 'wss://example.test/live' }));
    vi.stubGlobal('fetch', fetchMock);
    const recognizer = new GeminiLiveRecognizer({ onTranscript: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() }, 'ja-JP', 'smart');
    FakeWebSocket.last = undefined;
    const starting = recognizer.start(17);
    await vi.waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    const socket = FakeWebSocket.last!;
    socket.open(); socket.message({ setupComplete: {} }); await starting;
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(LIVE_TRANSCRIPTION_MODEL);
    const setup = JSON.parse(socket.sent[0]).setup;
    expect(setup).toMatchObject({ model: `models/${LIVE_TRANSCRIPTION_MODEL}`, generationConfig: { responseModalities: ['TEXT'] } });
    await recognizer.stop(0);
  });

  it('uses the same smart mode for token constraints and WebSocket setup', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'token', websocketUrl: 'wss://example.test/live' })));
    vi.stubGlobal('fetch', fetchMock);
    const recognizer = new GeminiLiveRecognizer({ onTranscript: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() }, 'vi-VN', 'smart');
    FakeWebSocket.last = undefined;
    const starting = recognizer.start(1);
    try {
      await vi.waitFor(() => expect(FakeWebSocket.last).toBeDefined());
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ transcriptionMode: 'smart' });
      const socket = FakeWebSocket.last!;
      socket.open(); socket.message({ setupComplete: {} }); await starting;
      expect(JSON.parse(socket.sent[0]).setup.inputAudioTranscription.mode).toBe('SMART');
    } finally { await recognizer.stop(0); }
  });

  it('decodes Google binary setup and UTF-8 transcripts instead of timing out or losing text', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: 'single-use-token', websocketUrl: 'wss://example.test/live', sessionLimitMs: 600_000,
    }), { status: 200 })));
    const onTranscript = vi.fn();
    const recognizer = new GeminiLiveRecognizer({ onTranscript, onError: vi.fn(), onStateChange: vi.fn() });
    FakeWebSocket.last = undefined;
    const starting = recognizer.start(19);
    void starting.catch(() => undefined);
    try {
      await vi.waitFor(() => expect(FakeWebSocket.last).toBeDefined());
      const socket = FakeWebSocket.last!;
      socket.open();
      socket.binaryMessage({ setupComplete: {} });
      await vi.waitFor(() => expect(recognizer.diagnostics.status).toBe('listening'), { timeout: 350 });
      await starting;
      expect(socket.binaryType).toBe('arraybuffer');
      socket.binaryMessage({ serverContent: { interimInputTranscription: { text: 'えっと、日本文化' } } });
      socket.binaryMessage({ serverContent: { inputTranscription: { text: 'えっと、日本文化を勉強する。' } } });
      expect(onTranscript.mock.calls.map((call) => call[0])).toEqual(['えっと、日本文化', 'えっと、日本文化を勉強する。']);
      expect(onTranscript.mock.calls.map((call) => call[1])).toEqual([false, true]);
      expect(onTranscript.mock.calls[0][3]).toBe(onTranscript.mock.calls[1][3]);
    } finally {
      await recognizer.stop(0);
    }
  });

  it('connects with ephemeral auth, sends PCM at 16 kHz, and preserves interim-to-final item identity', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: 'single-use-token',
      websocketUrl: 'wss://generativelanguage.googleapis.com/constrained',
      sessionLimitMs: 600_000,
    }), { status: 200 })));
    const onTranscript = vi.fn();
    const callbacks = { onTranscript, onError: vi.fn(), onStateChange: vi.fn() };
    FakeWebSocket.last = undefined;
    const recognizer = new GeminiLiveRecognizer(callbacks, 'ja-JP');
    const starting = recognizer.start(7);
    await vi.waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    const socket = FakeWebSocket.last!;
    socket.open();
    expect(JSON.parse(socket.sent[0])).toMatchObject({ setup: {
      model: 'models/gemini-3.5-transcribe-live',
      generationConfig: { responseModalities: ['TEXT'] },
      inputAudioTranscription: { mode: 'VERBATIM', languageCodes: ['ja-JP'] },
    } });
    socket.message({ setupComplete: {} });
    await starting;
    expect(socket.url).toContain('access_token=single-use-token');

    recognizer.pushPcm(new Float32Array(480).fill(0.25), 48_000);
    const audioFrame = JSON.parse(socket.sent[1]);
    expect(audioFrame.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(atob(audioFrame.realtimeInput.audio.data).length).toBeGreaterThan(0);
    recognizer.finalizeUtterance();
    expect(JSON.parse(socket.sent[2])).toEqual({ realtimeInput: { audioStreamEnd: true } });

    socket.message({ serverContent: { interimInputTranscription: { text: 'えっと、こんにちは' } } });
    socket.message({ serverContent: { interimInputTranscription: { text: 'えっと、こんにちは。' } } });
    socket.message({ serverContent: { inputTranscription: { text: 'えっと、こんにちは。' } } });
    expect(onTranscript.mock.calls.map((call) => call[0])).toEqual([
      'えっと、こんにちは', 'えっと、こんにちは。', 'えっと、こんにちは。',
    ]);
    expect(onTranscript.mock.calls.map((call) => call[1])).toEqual([false, false, true]);
    const utteranceIds = onTranscript.mock.calls.map((call) => call[3] as string);
    expect(new Set(utteranceIds).size).toBe(1);
    expect(utteranceIds[0]).toMatch(/^gemini-7-.+-1$/);
    expect(onTranscript.mock.calls.map((call) => call[4])).toEqual([1, 2, 3]);
    expect(recognizer.diagnostics.transcriptEvents).toBe(3);
    await recognizer.stop(0);
    expect(socket.sent.some((message) => message.includes('audioStreamEnd'))).toBe(true);
  });

  it('uses a unique utterance ID after a recognizer/session renewal with the same epoch', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      token: 'single-use-token', websocketUrl: 'wss://example.test/live', sessionLimitMs: 600_000,
    }), { status: 200 }))));
    const onTranscript = vi.fn();
    const callbacks = { onTranscript, onError: vi.fn(), onStateChange: vi.fn() };

    FakeWebSocket.last = undefined;
    const first = new GeminiLiveRecognizer(callbacks);
    const firstStarting = first.start(11);
    await vi.waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    const firstSocket = FakeWebSocket.last!;
    firstSocket.open();
    firstSocket.message({ setupComplete: {} });
    await firstStarting;
    firstSocket.message({ serverContent: { inputTranscription: { text: 'first' } } });
    await first.stop(0);

    const renewed = new GeminiLiveRecognizer(callbacks);
    FakeWebSocket.last = undefined;
    const renewedStarting = renewed.start(11);
    await vi.waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    const renewedSocket = FakeWebSocket.last!;
    renewedSocket.open();
    renewedSocket.message({ setupComplete: {} });
    await renewedStarting;
    firstSocket.message({ serverContent: { inputTranscription: { text: 'stale first session' } } });
    expect(onTranscript).toHaveBeenCalledTimes(1);
    renewedSocket.message({ serverContent: { inputTranscription: { text: 'second' } } });

    expect(onTranscript.mock.calls[0][3]).not.toBe(onTranscript.mock.calls[1][3]);
    await renewed.stop(0);
  });

  it('cancels token/setup work when stop wins and ignores callbacks from stale sessions', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    let resolveToken!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveToken = resolve; })));
    const callbacks = { onTranscript: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() };
    FakeWebSocket.last = undefined;
    const recognizer = new GeminiLiveRecognizer(callbacks);
    const starting = recognizer.start(13);
    await recognizer.stop(0);
    resolveToken(new Response(JSON.stringify({
      token: 'single-use-token', websocketUrl: 'wss://example.test/live', sessionLimitMs: 600_000,
    }), { status: 200 }));
    await expect(starting).rejects.toThrow('superseded');
    expect(FakeWebSocket.last).toBeUndefined();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });

  it('waits for a late final after stop and keeps the interim ID for the final update', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: 'single-use-token', websocketUrl: 'wss://example.test/live', sessionLimitMs: 600_000,
    }), { status: 200 })));
    const onTranscript = vi.fn();
    const callbacks = { onTranscript, onError: vi.fn(), onStateChange: vi.fn() };
    FakeWebSocket.last = undefined;
    const recognizer = new GeminiLiveRecognizer(callbacks);
    const starting = recognizer.start(12);
    await vi.waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    const socket = FakeWebSocket.last!;
    socket.open();
    socket.message({ setupComplete: {} });
    await starting;
    socket.message({ serverContent: { interimInputTranscription: { text: 'finalizing words' } } });

    const stopped = recognizer.stop(4000);
    await vi.waitFor(() => expect(socket.sent.some((value) => value.includes('audioStreamEnd'))).toBe(true));
    await new Promise<void>((resolve) => setTimeout(resolve, 1700));
    socket.message({ serverContent: { inputTranscription: { text: 'finalizing words, complete.' } } });
    await stopped;

    expect(onTranscript.mock.calls.map((call) => call[1])).toEqual([false, true]);
    expect(onTranscript.mock.calls[1][3]).toBe(onTranscript.mock.calls[0][3]);
    expect(onTranscript.mock.calls[1][0]).toBe('finalizing words, complete.');
  });

  it('passes translation text from outputTranscription to onTranscript', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ token: 'token', websocketUrl: 'wss://example.test/live' }));
    vi.stubGlobal('fetch', fetchMock);
    const onTranscript = vi.fn();
    const recognizer = new GeminiLiveRecognizer(
      { onTranscript, onError: vi.fn(), onStateChange: vi.fn() },
      'ja-JP',
      'verbatim',
      'vi-VN'
    );
    FakeWebSocket.last = undefined;
    const starting = recognizer.start(25);
    await vi.waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    const socket = FakeWebSocket.last!;
    socket.open();
    socket.message({ setupComplete: {} });
    await starting;

    expect(JSON.parse(socket.sent[0]).setup.generationConfig.translationConfig).toMatchObject({
      targetLanguageCode: 'vi-VN',
      echoTargetLanguage: true,
    });

    socket.message({
      serverContent: {
        inputTranscription: { text: 'こんにちは' },
        outputTranscription: { text: 'Xin chào' },
      },
    });
    expect(onTranscript).toHaveBeenCalledWith(
      'こんにちは',
      true,
      25,
      expect.any(String),
      1,
      undefined,
      'Xin chào'
    );
  });
});

describe('Pcm16kResampler', () => {
  it('keeps interpolation continuous across chunk boundaries and yields the expected sample count', () => {
    const source = Float32Array.from({ length: 480 }, (_, index) => Math.sin(index / 17));
    const resampler = new Pcm16kResampler(48_000);
    const chunks = [resampler.push(source.slice(0, 100)), resampler.push(source.slice(100, 333)),
      resampler.push(source.slice(333)), resampler.flush()];
    const output = Float32Array.from(chunks.flatMap((chunk) => [...chunk]));
    expect(output.length).toBe(160);
    expect(output.every(Number.isFinite)).toBe(true);
    expect(output[1]).toBeCloseTo(source[3], 5);
  });

  async function openRecognizer(epoch: number, onTranscript: ReturnType<typeof vi.fn>, target?: string) {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ token: 'token', websocketUrl: 'wss://example.test/live' })));
    const recognizer = new GeminiLiveRecognizer({ onTranscript, onError: vi.fn(), onStateChange: vi.fn() }, 'ja-JP', 'verbatim', target);
    FakeWebSocket.last = undefined;
    const starting = recognizer.start(epoch);
    await vi.waitFor(() => expect(FakeWebSocket.last).toBeDefined());
    const socket = FakeWebSocket.last!;
    socket.open(); socket.message({ setupComplete: {} }); await starting;
    return { recognizer, socket };
  }

  it('shows translated text immediately when it arrives before the source transcript', async () => {
    const onTranscript = vi.fn();
    const { recognizer, socket } = await openRecognizer(32, onTranscript, 'vi');
    try {
      socket.message({ serverContent: { outputTranscription: { text: 'Xin chào' } } });
      expect(onTranscript.mock.calls.at(-1)?.slice(0, 2)).toEqual(['Xin chào', false]);
      expect(onTranscript.mock.calls.at(-1)?.[6]).toBe('Xin chào');
      socket.message({ serverContent: { interimInputTranscription: { text: 'こんにちは' } } });
      expect(onTranscript.mock.calls.at(-1)?.slice(0, 2)).toEqual(['こんにちは', false]);
      expect(new Set(onTranscript.mock.calls.map((call) => call[3])).size).toBe(1);
    } finally { await recognizer.stop(0); }
  });

  it('sends translationConfig inside setup.generationConfig, never at the top of setup', async () => {
    const { recognizer, socket } = await openRecognizer(33, vi.fn(), 'vi');
    try {
      const setup = JSON.parse(socket.sent[0]).setup;
      expect(setup.generationConfig).toMatchObject({ responseModalities: ['TEXT'], translationConfig: { targetLanguageCode: 'vi' } });
      expect(setup).not.toHaveProperty('translationConfig');
    } finally { await recognizer.stop(0); }
  });
});
