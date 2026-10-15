import { afterEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  pcm: null as null | ((samples: Float32Array, rate: number) => void),
  volume: null as null | ((volume: number) => void),
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
    constructor(callbacks: { onVolume: (volume: number) => void }) { fixtures.volume = callbacks.onVolume; }
    async start() { return 'audio/webm'; }
    async stop() {}
    async switchSegment() {}
  },
}));
vi.mock('@/storage/audio-assets', () => ({ queueAudio: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/storage/recordings', () => ({
  createRecording: vi.fn().mockResolvedValue({ id: 'translate-session', state: 'recording', audioState: 'present' }),
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
  setup: Record<string, unknown> | null = null;
  constructor() {
    LiveSocket.last = this;
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(raw: string) {
    const message = JSON.parse(raw);
    if (message.setup) { this.setup = message.setup; queueMicrotask(() => this.message({ setupComplete: {} })); }
  }
  message(value: unknown) { this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(value)).buffer }); }
  close(code = 1000, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
}

// Recorded from the real gemini-3.5-live-translate-preview API: input and
// translated output arrive as separate appended deltas about once per second.
const FIRST_SENTENCE = [
  { inputTranscription: { text: '皆さん、こんにちは。', languageCode: 'ja' } },
  { outputTranscription: { text: 'Chào mọi người.', languageCode: 'vi' } },
  { inputTranscription: { text: '今日は', languageCode: 'ja' } },
  { outputTranscription: { text: ' Hôm nay', languageCode: 'vi' } },
  { inputTranscription: { text: '日本の文化に', languageCode: 'ja' } },
  { outputTranscription: { text: ' chúng ta sẽ nói về', languageCode: 'vi' } },
  { inputTranscription: { text: 'ついて勉強し', languageCode: 'ja' } },
  { outputTranscription: { text: ' văn hóa Nhật Bản.', languageCode: 'vi' } },
  { inputTranscription: { text: 'ましょう。', languageCode: 'ja' } },
  { outputTranscription: { languageCode: 'vi' } },
];
const SECOND_SENTENCE = [
  { inputTranscription: { text: 'まず、', languageCode: 'ja' } },
  { outputTranscription: { text: ' Đầu tiên,', languageCode: 'vi' } },
  { inputTranscription: { text: 'お茶の歴史を説明します。', languageCode: 'ja' } },
  { outputTranscription: { text: ' chúng ta tìm hiểu lịch sử trà.', languageCode: 'vi' } },
];

describe('Gemini Live Translate through the controller', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each(['lecture', 'readingPractice'] as const)('shows every source and translation delta live in %s mode without text-model calls', async (mode) => {
    fixtures.translate.mockReset().mockImplementation(async (request, _delta, done) => done(`LLM: ${request.text}`, 'test-model'));
    fixtures.saveCaption.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { storage: { persisted: vi.fn().mockResolvedValue(true) } });
    vi.stubGlobal('WebSocket', LiveSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ token: 'fixture', websocketUrl: 'wss://fixture.test/live' })));
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google', sourceLanguage: 'ja-JP', targetLanguage: 'vi', mode, pauseMs: 900, readingPauseMs: 900 });
    expect((LiveSocket.last.setup as { model: string }).model).toBe('models/gemini-3.5-live-translate-preview');
    vi.useFakeTimers();
    const tick = async (loud: boolean) => {
      fixtures.volume!(loud ? 0.2 : 0);
      fixtures.pcm!(new Float32Array(1600).fill(loud ? 0.2 : 0), 16000);
      await vi.advanceTimersByTimeAsync(100);
    };
    const speak = async (messages: unknown[]) => {
      for (const content of messages) {
        for (let i = 0; i < 5; i++) await tick(true);
        LiveSocket.last.message({ serverContent: content });
      }
    };
    try {
      await speak(FIRST_SENTENCE.slice(0, 2));
      expect(controller.snapshot().captions).toHaveLength(1);
      expect(controller.snapshot().captions[0]).toMatchObject({ source: '皆さん、こんにちは。', translation: 'Chào mọi người.' });
      await speak(FIRST_SENTENCE.slice(2, 8));
      // The speaker pauses; the local boundary closes the caption before Gemini's last words arrive.
      for (let i = 0; i < 12; i++) await tick(false);
      for (const content of FIRST_SENTENCE.slice(8)) LiveSocket.last.message({ serverContent: content });
      expect(controller.snapshot().captions[0]).toMatchObject({
        source: '皆さん、こんにちは。今日は日本の文化について勉強しましょう。',
        translation: 'Chào mọi người. Hôm nay chúng ta sẽ nói về văn hóa Nhật Bản.',
      });
      // Reading practice keeps its sentence open on purpose; a lecture closes it at the pause.
      if (mode === 'lecture') expect(controller.snapshot().captions[0].isFinal).toBe(true);
      // A late tail extends the sentence; it is not a correction worth listing as history.
      expect(controller.snapshot().captions[0].sourceHistory ?? []).toEqual([]);
      for (let i = 0; i < 3; i++) await tick(false);
      // Measured on the real API: text for new speech trails its audio by 1.5-2 s.
      for (let i = 0; i < 10; i++) await tick(true);
      await speak(SECOND_SENTENCE);
      const captions = controller.snapshot().captions;
      expect(captions.at(-1)).toMatchObject({ source: 'まず、お茶の歴史を説明します。', translation: 'Đầu tiên, chúng ta tìm hiểu lịch sử trà.' });
      expect(captions[0]).toMatchObject({ source: '皆さん、こんにちは。今日は日本の文化について勉強しましょう。' });
      expect(fixtures.translate).not.toHaveBeenCalled();
      expect(controller.snapshot().error).toBeNull();
    } finally {
      const stopped = controller.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopped;
    }
  });
});
