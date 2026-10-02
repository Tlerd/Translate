import { afterEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  pcm: null as null | ((samples: Float32Array, rate: number) => void),
  translate: vi.fn(),
  saveCaption: vi.fn(),
}));

vi.mock('@/features/recording/gemini-pcm-capture', () => ({
  GeminiPcmCapture: class {
    state = 'running';
    async prepare() {}
    async start(_stream: MediaStream, onPcm: (samples: Float32Array, rate: number) => void) { fixtures.pcm = onPcm; }
    async stop() { fixtures.pcm = null; }
  },
}));
vi.mock('@/features/recording/audio-recorder', () => ({
  WebAudioRecorder: class {
    static getBestSupportedMimeType() { return 'audio/webm'; }
    stream = { getTracks: () => [] };
    async start() { return 'audio/webm'; }
    async stop() {}
    async switchSegment() {}
  },
}));
vi.mock('@/storage/recordings', () => ({
  createRecording: vi.fn().mockResolvedValue({ id: 'flash-session', state: 'recording', audioState: 'present' }),
  updateRecording: vi.fn().mockResolvedValue(undefined),
  addAudioChunk: vi.fn().mockResolvedValue(undefined),
  getAudioBlob: vi.fn().mockResolvedValue(null),
  saveCaption: fixtures.saveCaption,
  createAudioSegment: vi.fn().mockResolvedValue(undefined),
  updateAudioSegment: vi.fn().mockResolvedValue(undefined),
  getAudioSegments: vi.fn().mockResolvedValue([]),
  getAudioSegmentBlob: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/api-client', () => ({ streamTranslate: fixtures.translate }));

import { ClassroomController } from '@/features/recording/controller';

class LiveSocket {
  static last: LiveSocket;
  readyState = 0;
  bufferedAmount = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  audioFrames = 0;
  constructor() {
    LiveSocket.last = this;
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(raw: string) {
    const message = JSON.parse(raw);
    if (message.setup) queueMicrotask(() => this.message({ setupComplete: {} }));
    if (message.realtimeInput?.audio) this.audioFrames++;
    // With "Remain silent" the dialogue model need not send turnComplete.
  }
  message(value: unknown) { this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(value)).buffer }); }
  close(code = 1000, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
}

describe('Flash Live across classroom sentence boundaries', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each(['readingPractice', 'lecture'] as const)('opens and translates ten successive sentences in %s without input finished or model turnComplete', async (mode) => {
    fixtures.translate.mockReset().mockImplementation(async (request, _delta, done) => done(`Dịch: ${request.text}`, 'test-model'));
    fixtures.saveCaption.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { storage: { persisted: vi.fn().mockResolvedValue(true) } });
    vi.stubGlobal('WebSocket', LiveSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ token: 'fixture', websocketUrl: 'wss://fixture.test/live' })));
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google-flash-live', mode, pauseMs: 900, readingPauseMs: 900 });
    vi.useFakeTimers();
    try {
      fixtures.pcm!(new Float32Array(1600).fill(0.2), 16000);
      LiveSocket.last.message({ serverContent: { inputTranscription: { text: '私は音楽が好きです。' } } });
      LiveSocket.last.message({ serverContent: { waitingForInput: true } });
      await vi.advanceTimersByTimeAsync(1600);
      expect(controller.snapshot().captions).toHaveLength(1);
      expect(controller.snapshot().captions[0]).toMatchObject({ source: '私は音楽が好きです。', isFinal: true, translation: 'Dịch: 私は音楽が好きです。' });

      fixtures.pcm!(new Float32Array(1600).fill(0.2), 16000);
      LiveSocket.last.message({ serverContent: { inputTranscription: { text: '次の文です。' } } });
      await vi.advanceTimersByTimeAsync(1600);
      expect(controller.snapshot().captions).toHaveLength(2);
      expect(controller.snapshot().captions[1]).toMatchObject({ source: '次の文です。', translation: 'Dịch: 次の文です。', isFinal: true });
      expect(controller.snapshot().captions[0].source).toBe('私は音楽が好きです。');
      for (let sentence = 3; sentence <= 10; sentence++) {
        fixtures.pcm!(new Float32Array(1600).fill(0.2), 16000);
        const text = `第${sentence}の文です。`;
        LiveSocket.last.message({ serverContent: { inputTranscription: { text }, waitingForInput: true } });
        await vi.advanceTimersByTimeAsync(1600);
        expect(controller.snapshot().captions).toHaveLength(sentence);
        expect(controller.snapshot().captions[sentence - 1]).toMatchObject({ source: text, translation: `Dịch: ${text}`, isFinal: true });
      }
      expect(controller.snapshot()).toMatchObject({ state: 'recording', speechState: 'listening', error: null });
      expect(LiveSocket.last.audioFrames).toBeGreaterThanOrEqual(10);
      expect(fixtures.saveCaption).toHaveBeenCalledWith(expect.objectContaining({ source: '第10の文です。', translation: 'Dịch: 第10の文です。' }));
    } finally {
      const stopped = controller.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopped;
    }
  });
});
