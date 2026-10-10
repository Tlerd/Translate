import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechRecognitionCallbacks } from '@/features/recording/speech-recognition';

interface Fixture { callbacks: SpeechRecognitionCallbacks; billed?: (ms: number) => void; stopImpl: () => Promise<void> }
const shared = vi.hoisted(() => ({
  transcribers: [] as Fixture[],
  nemotron: [] as Fixture[],
}));

vi.mock('@/features/recording/gemini-transcribe-recognition', () => ({
  GeminiTranscribeRecognizer: class {
    stopImpl: () => Promise<void> = async () => undefined;
    constructor(public callbacks: SpeechRecognitionCallbacks, _l: string, _p: number, _m: string, _s: number, _o: number, public billed?: (ms: number) => void) { shared.transcribers.push(this); }
    start() {}
    pushPcm() {}
    finalizeUtterance() {}
    updateSettings() {}
    async stop() { await this.stopImpl(); }
  },
}));
vi.mock('@/features/recording/nemotron-recognition', () => ({
  NemotronRecognizer: class {
    stopImpl: () => Promise<void> = async () => undefined;
    constructor(public callbacks: SpeechRecognitionCallbacks) { shared.nemotron.push(this); }
    async start() {}
    pushPcm() {}
    finalizeUtterance() {}
    async stop() { await this.stopImpl(); }
  },
}));
vi.mock('@/features/recording/gemini-pcm-capture', () => ({
  GeminiPcmCapture: class {
    state = 'running';
    async prepare() {}
    async start() {}
    async stop() {}
  },
}));
vi.mock('@/features/recording/audio-recorder', () => ({
  WebAudioRecorder: class {
    static getBestSupportedMimeType() { return 'audio/webm'; }
    stream: MediaStream | null = null;
    constructor(public callbacks: { onMicState?: (state: 'live') => void }) {}
    async start() { this.stream = await navigator.mediaDevices.getUserMedia({ audio: true }) as MediaStream; this.callbacks.onMicState?.('live'); return 'audio/webm'; }
    async stop() {}
    async switchSegment() {}
    async resume() {}
  },
}));
vi.mock('@/storage/audio-assets', () => ({ queueAudio: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/storage/recordings', () => ({
  createRecording: vi.fn().mockResolvedValue({
    id: 'usage-recording', title: 'test', createdAt: '2026-10-10T00:00:00Z', mode: 'lecture', sourceLanguage: 'ja-JP', targetLanguage: 'vi',
    state: 'recording', durationMs: 0, audioState: 'present', config: { translationModelKey: 'test-model' },
  }),
  updateRecording: vi.fn().mockResolvedValue(undefined),
  addAudioChunk: vi.fn().mockResolvedValue(undefined),
  saveCaption: vi.fn().mockResolvedValue(undefined),
  getAudioBlob: vi.fn().mockResolvedValue(null),
  createAudioSegment: vi.fn().mockResolvedValue(undefined),
  updateAudioSegment: vi.fn().mockResolvedValue(undefined),
  getAudioSegments: vi.fn().mockResolvedValue([]),
  getAudioSegmentBlob: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/api-client', () => ({ streamTranslate: vi.fn() }));

import { ClassroomController } from '@/features/recording/controller';
import type { SpeechUsageReport } from '@/features/recording/speech-usage-reporter';

describe('ClassroomController billed speech time', () => {
  let reports: Array<{ report: SpeechUsageReport; keepalive: boolean }>;
  let controller: ClassroomController;

  beforeEach(() => {
    shared.transcribers.length = 0; shared.nemotron.length = 0; reports = [];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-10T03:00:00.000Z'));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) }, storage: { persisted: vi.fn().mockResolvedValue(true) } });
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === '/api/usage/speech') reports.push({ report: JSON.parse(String(init?.body)), keepalive: init?.keepalive === true });
      return new Response(null, { status: 204 });
    }));
    controller = new ClassroomController();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const finals = () => reports.filter((r) => r.report.endedAt).map((r) => r.report);

  it('adds open-stream time of a live provider across pause and resume, excluding paused time', async () => {
    await controller.start({ speechProvider: 'nemotron', sourceLanguage: 'ja-JP', targetLanguage: 'vi' });
    await vi.advanceTimersByTimeAsync(10_000);
    await controller.pauseApi();
    await vi.advanceTimersByTimeAsync(20_000); // paused: no stream open, not billed
    await controller.resumeApi();
    await vi.advanceTimersByTimeAsync(5_000);
    await controller.stop();

    expect(shared.nemotron).toHaveLength(2);
    const done = finals();
    expect(done.map((r) => r.audioMs)).toEqual([10_000, 5_000]);
    expect(done[0].sessionId).not.toBe(done[1].sessionId);
    expect(done.every((r) => r.recordingId === 'usage-recording' && r.provider === 'nemotron' && r.translated === false)).toBe(true);
  });

  it('keeps billing a recognizer until its final-result drain completes', async () => {
    await controller.start({ speechProvider: 'nemotron' });
    shared.nemotron[0].stopImpl = () => new Promise<void>((resolve) => setTimeout(resolve, 3_000));
    await vi.advanceTimersByTimeAsync(2_000);
    const stopping = controller.stop();
    await vi.advanceTimersByTimeAsync(3_000);
    await stopping;
    expect(finals().map((r) => r.audioMs)).toEqual([5_000]);
  });

  it('reports every minute while recording', async () => {
    await controller.start({ speechProvider: 'nemotron' });
    await vi.advanceTimersByTimeAsync(125_000);
    expect(reports.filter((r) => !r.report.endedAt).map((r) => r.report.audioMs)).toEqual([60_000, 120_000]);
    expect(new Set(reports.map((r) => r.report.sessionId)).size).toBe(1);
    await controller.stop();
  });

  it('counts a mid-session stream failure up to the error, not afterwards', async () => {
    await controller.start({ speechProvider: 'nemotron' });
    await vi.advanceTimersByTimeAsync(4_000);
    shared.nemotron[0].callbacks.onError('socket lost', 1, { retryable: false });
    await vi.advanceTimersByTimeAsync(30_000);
    await controller.stop();
    expect(finals().map((r) => r.audioMs)).toEqual([4_000]);
  });

  it('sums only the segments google-transcribe actually sent', async () => {
    await controller.start({ speechProvider: 'google-transcribe' });
    shared.transcribers[0].billed!(3_000);
    shared.transcribers[0].billed!(2_500);
    await vi.advanceTimersByTimeAsync(60_000);
    await controller.stop();
    expect(reports.map((r) => r.report.audioMs)).toEqual([5_500, 5_500]);
    expect(finals()[0]).toMatchObject({ provider: 'google-transcribe', model: 'gemini-3.5-transcribe', translated: false });
  });

  it('does not report when no audio was billed', async () => {
    await controller.start({ speechProvider: 'google-transcribe' });
    await vi.advanceTimersByTimeAsync(120_000);
    await controller.stop();
    expect(reports).toEqual([]);
  });

  it('keeps recording when the usage endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await controller.start({ speechProvider: 'nemotron' });
    await vi.advanceTimersByTimeAsync(61_000);
    await expect(controller.stop()).resolves.toBeUndefined();
    expect(controller.snapshot().state).toBe('stopped');
  });
});
