import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechRecognitionCallbacks } from '@/features/recording/speech-recognition';

type GoogleCallbacks = SpeechRecognitionCallbacks;
interface PcmCaptureFixture {
  state: string;
  stream: MediaStream | null;
  onPcm: ((samples: Float32Array, rate: number) => void) | null;
  stopImpl: () => Promise<void>;
  emit: (samples?: Float32Array, rate?: number) => void;
}
interface GoogleRecognizerFixture {
  mode?: string;
  model?: string;
  callbacks: GoogleCallbacks;
  epoch: number;
  pushes: Array<{ samples: Float32Array; rate: number; startMs?: number }>;
  stopImpl: () => Promise<void>;
  finalOnStop: (() => void) | null;
  updateSettings: (settings: unknown) => void;
  emit: (text: string, isFinal: boolean, itemId?: string, revision?: number) => void;
}
interface RecorderFixture {
  callbacks: { onMicState?: (state: 'live' | 'muted' | 'ended' | 'suspended') => void };
  stream: MediaStream | null;
  stopImpl: () => Promise<void>;
}

const shared = vi.hoisted(() => ({
  events: [] as string[],
  recognizers: [] as GoogleRecognizerFixture[],
  liveRecognizers: [] as GoogleRecognizerFixture[],
  captures: [] as PcmCaptureFixture[],
  recorders: [] as RecorderFixture[],
  createRecording: vi.fn(),
  updateRecording: vi.fn(),
  addAudioChunk: vi.fn(),
  saveCaption: vi.fn(),
  getAudioBlob: vi.fn(),
  queueAudio: vi.fn(),
  streamTranslate: vi.fn(),
  createAudioSegment: vi.fn().mockResolvedValue(undefined),
  updateAudioSegment: vi.fn().mockResolvedValue(undefined),
  getAudioSegments: vi.fn().mockResolvedValue([]),
  getAudioSegmentBlob: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/features/recording/gemini-transcribe-recognition', () => ({
  GeminiTranscribeRecognizer: class {
    callbacks: GoogleCallbacks;
    epoch = 0;
    pushes: Array<{ samples: Float32Array; rate: number; startMs?: number }> = [];
    stopImpl: () => Promise<void> = async () => undefined;
    finalOnStop: (() => void) | null = null;
    constructor(callbacks: GoogleCallbacks) { this.callbacks = callbacks; shared.recognizers.push(this); }
    async start(epoch: number) { this.epoch = epoch; shared.events.push('recognizer.start'); }
    pushPcm(samples: Float32Array, rate: number, startMs?: number) { this.pushes.push({ samples, rate, startMs }); }
    finalizeUtterance() {}
    updateSettings = vi.fn();
    async stop() {
      shared.events.push('recognizer.stop');
      this.finalOnStop?.();
      await this.stopImpl();
    }
    emit(text: string, isFinal: boolean, itemId = 'gemini-item-1', revision = 1) {
      this.callbacks.onTranscript(text, isFinal, this.epoch, itemId, revision);
    }
  },
}));

vi.mock('@/features/recording/gemini-live-recognition', () => ({
  GeminiLiveRecognizer: class {
    callbacks: GoogleCallbacks;
    epoch = 0;
    pushes: Array<{ samples: Float32Array; rate: number }> = [];
    stopImpl: () => Promise<void> = async () => undefined;
    finalOnStop: (() => void) | null = null;
    constructor(callbacks: GoogleCallbacks, _language: string, public mode: string, public model: string) { this.callbacks = callbacks; shared.liveRecognizers.push(this); }
    async start(epoch: number) { this.epoch = epoch; shared.events.push('recognizer.start'); }
    pushPcm(samples: Float32Array, rate: number) { this.pushes.push({ samples, rate }); }
    finalizeUtterance() {}
    updateSettings = vi.fn();
    async stop() {
      shared.events.push('recognizer.stop');
      this.finalOnStop?.();
      await this.stopImpl();
    }
    emit(text: string, isFinal: boolean, itemId = 'gemini-item-1', revision = 1) {
      this.callbacks.onTranscript(text, isFinal, this.epoch, itemId, revision);
    }
  },
}));

vi.mock('@/features/recording/gemini-pcm-capture', () => ({
  GeminiPcmCapture: class {
    state = 'running';
    stream: MediaStream | null = null;
    onPcm: ((samples: Float32Array, rate: number) => void) | null = null;
    stopImpl: () => Promise<void> = async () => undefined;
    constructor() { shared.captures.push(this); shared.events.push('pcm.construct'); }
    async prepare() { this.state = 'running'; shared.events.push('pcm.prepare'); }
    async start(stream: MediaStream, onPcm: (samples: Float32Array, rate: number) => void) {
      this.stream = stream; this.onPcm = onPcm; shared.events.push('pcm.start');
    }
    async stop() { shared.events.push('pcm.stop'); await this.stopImpl(); }
    emit(samples: Float32Array = new Float32Array([0.1, 0.2]), rate = 48_000) { this.onPcm?.(samples, rate); }
  },
}));

vi.mock('@/features/recording/audio-recorder', () => ({
  WebAudioRecorder: class {
    static getBestSupportedMimeType() { return 'audio/webm'; }
    callbacks: RecorderFixture['callbacks'];
    stream: MediaStream | null = null;
    stopImpl: () => Promise<void> = async () => undefined;
    constructor(callbacks: RecorderFixture['callbacks']) { this.callbacks = callbacks; shared.recorders.push(this); }
    async start() {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true }) as MediaStream;
      shared.events.push('recorder.start'); this.callbacks.onMicState?.('live'); return 'audio/webm';
    }
    async stop() { shared.events.push('recorder.stop'); await this.stopImpl(); }
    async switchSegment() {}
    async resume() {}
  },
}));

vi.mock('@/storage/audio-assets', () => ({ queueAudio: shared.queueAudio }));
vi.mock('@/storage/recordings', () => ({
  createRecording: shared.createRecording,
  updateRecording: shared.updateRecording,
  addAudioChunk: shared.addAudioChunk,
  saveCaption: shared.saveCaption,
  getAudioBlob: shared.getAudioBlob,
  createAudioSegment: shared.createAudioSegment,
  updateAudioSegment: shared.updateAudioSegment,
  getAudioSegments: shared.getAudioSegments,
  getAudioSegmentBlob: shared.getAudioSegmentBlob,
}));
vi.mock('@/lib/api-client', () => ({ streamTranslate: shared.streamTranslate }));

import { ClassroomController } from '@/features/recording/controller';

const recording = {
  id: 'google-recording', title: 'test', createdAt: '2026-10-01T00:00:00Z', mode: 'lecture' as const,
  sourceLanguage: 'ja-JP', targetLanguage: 'vi', state: 'recording' as const, durationMs: 0,
  audioState: 'present' as const, config: { translationModelKey: 'test-model' },
};

describe('ClassroomController Google speech integration', () => {
  let stream: MediaStream;
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    shared.liveRecognizers.length = 0;
    shared.events.length = 0; shared.recognizers.length = 0; shared.captures.length = 0; shared.recorders.length = 0;
    shared.createRecording.mockReset().mockResolvedValue(recording);
    shared.updateRecording.mockReset().mockResolvedValue(undefined);
    shared.addAudioChunk.mockReset().mockResolvedValue(undefined);
    shared.saveCaption.mockReset().mockResolvedValue(undefined);
    shared.getAudioBlob.mockReset().mockResolvedValue(null);
    shared.queueAudio.mockReset().mockResolvedValue(undefined);
    shared.streamTranslate.mockReset().mockImplementation(async (_request: unknown, onDelta: (text: string) => void, onDone: (text: string, model: string) => void) => {
      onDelta('translated'); onDone('translated', 'test-model');
    });
    stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia }, storage: { persisted: vi.fn().mockResolvedValue(true) } });
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
  });

  it('routes Flash through Live and releases capture while a previous recognizer change is draining', async () => {
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google-flash-live' });
    expect(shared.liveRecognizers[0].model).toBe('gemini-3.1-flash-live-preview');
    expect(shared.recognizers).toHaveLength(0);
    let release!: () => void;
    shared.liveRecognizers[0].stopImpl = () => new Promise<void>(resolve => { release = resolve; });
    controller.setSpeechProvider('google-transcribe');
    await vi.waitFor(() => expect(release).toBeDefined());
    const stopping = controller.stop();
    await vi.waitFor(() => expect(shared.events).toContain('recorder.stop'), { timeout: 200 });
    const receivedBefore = controller.snapshot().receivedAudioMs;
    shared.captures[0].emit(new Float32Array(16000), 16000);
    expect(controller.snapshot().receivedAudioMs).toBe(receivedBefore);
    expect(shared.updateRecording).toHaveBeenCalledWith('google-recording', expect.objectContaining({ state: 'stopped', endedAt: expect.any(String) }));
    shared.liveRecognizers[0].stopImpl = async () => undefined;
    release();
    await stopping;
    expect(controller.snapshot().state).toBe('stopped');
    expect(shared.recognizers).toHaveLength(0);
  });

  it('switches between Live and chunks while sharing one microphone and draining old text', async () => {
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google', speakerCount: 8 });
    expect(shared.liveRecognizers).toHaveLength(1);
    const live = shared.liveRecognizers[0];
    live.finalOnStop = () => live.emit('Live final words', true);
    controller.setSpeechProvider('google-transcribe');
    await vi.waitFor(() => expect(shared.recognizers).toHaveLength(1));
    shared.captures[0].emit();
    expect(shared.recognizers[0].pushes).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledOnce();
    await controller.stop();
    expect(controller.snapshot().captions[0].source).toBe('Live final words');
    expect(shared.getAudioBlob).not.toHaveBeenCalled();
  });

  it('keeps capture languages locked when a new provider cannot recognize the selected language', async () => {
    const controller = new ClassroomController();
    controller.setLanguages('yue-Hant-HK', 'vi');
    await controller.start({ speechProvider: 'google-transcribe' });
    controller.setSpeechProvider('google-flash-live');
    expect(controller.snapshot()).toMatchObject({ sourceLanguage: 'yue-Hant-HK', speechProvider: 'google-transcribe' });
    expect(controller.snapshot().error).toContain('không hỗ trợ ngôn ngữ');
    controller.setLanguages('es-419', 'ja-JP');
    expect(controller.snapshot().sourceLanguage).toBe('yue-Hant-HK');
    await controller.stop();
    controller.setSpeechProvider('google-flash-live');
    expect(controller.snapshot().sourceLanguage).toBe('ja');
  });

  it('rejects unsupported language options before creating a lesson or acquiring the microphone', async () => {
    const controller = new ClassroomController();
    await expect(controller.start({ sourceLanguage: 'invalid-language', speechProvider: 'google-transcribe' })).rejects.toThrow('ngôn ngữ hợp lệ');
    expect(shared.createRecording).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('starts the lesson audio timeline after microphone permission rather than before the prompt', async () => {
    let now = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    getUserMedia.mockImplementation(async () => { now += 7000; return stream; });
    const controller = new ClassroomController();
    await controller.start();
    now += 2000;
    await controller.stop();
    expect(controller.snapshot().durationMs).toBe(2000);
  });

  it('passes the full-session timestamp after VAD omits several seconds of silence', async () => {
    let now = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const controller = new ClassroomController();
    await controller.start();
    now += 1000;
    shared.captures[0].emit(new Float32Array(1600).fill(.2), 16000);
    now += 1000;
    shared.captures[0].emit(new Float32Array(1600), 16000);
    now += 5000;
    shared.captures[0].emit(new Float32Array(1600), 16000);
    now += 100;
    shared.captures[0].emit(new Float32Array(1600).fill(.2), 16000);
    expect(shared.recognizers[0].pushes.at(-1)?.startMs).toBe(7000);
    await controller.stop();
  });

  it('reconnects Live with smart mode and keeps the required speaker roster', async () => {
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google' });
    controller.setTranscriptionSettings({ transcriptionMode: 'smart', speakerCount: 8 });
    await vi.waitFor(() => expect(shared.liveRecognizers).toHaveLength(2));
    expect(shared.liveRecognizers[1].mode).toBe('smart');
    shared.captures[0].emit();
    expect(shared.liveRecognizers[1].pushes).toHaveLength(1);
    await controller.stop();
    expect(controller.snapshot()).toMatchObject({ speechProvider: 'google', transcriptionMode: 'smart', speakerCount: 8 });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(shared.getAudioBlob).not.toHaveBeenCalled();
  });

  it('drains the last words from the chunk transcriber into saved translations', async () => {
    const controller = new ClassroomController();
    await controller.start();
    expect(shared.recognizers).toHaveLength(1);
    const recognizer = shared.recognizers[0];
    recognizer.finalOnStop = () => recognizer.emit('最後の言葉', true);
    const samples = new Float32Array(8000).fill(0.2);
    shared.captures[0].emit(samples, 16000);
    expect(recognizer.pushes).toEqual([{ samples, rate: 16000, startMs: expect.any(Number) }]);
    await controller.stop();
    expect(controller.snapshot()).toMatchObject({ state: 'stopped', speechProvider: 'google-transcribe' });
    expect(controller.snapshot().captions).toEqual([expect.objectContaining({ source: '最後の言葉', translation: 'translated', isFinal: true })]);
    expect(shared.saveCaption).toHaveBeenCalled();
  });

  it('initializes PCM in the gesture, acquires one microphone stream, and shares it with the recorder', async () => {
    const controller = new ClassroomController();
    await controller.start({  });

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(shared.events.indexOf('pcm.prepare')).toBeLessThan(shared.events.indexOf('recorder.start'));
    expect(shared.captures[0].stream).toBe(shared.recorders[0].stream);
    expect(controller.snapshot().micState).toBe('live');
    const samples = new Float32Array([0.25, -0.25]);
    (shared.captures[0] as PcmCaptureFixture).emit(samples, 48_000);
    expect((shared.recognizers[0] as GoogleRecognizerFixture).pushes).toEqual([{ samples, rate: 48_000, startMs: expect.any(Number) }]);
    await controller.stop();
    expect(shared.events.indexOf('pcm.stop')).toBeLessThan(shared.events.indexOf('recorder.stop'));
  });

  it('drains the final transcript and translation before completing stop', async () => {
    let finishTranslation!: () => void;
    shared.streamTranslate.mockImplementation((_request: unknown, onDelta: (text: string) => void, onDone: (text: string, model: string) => void) => new Promise<void>((resolve) => {
      onDelta('partial');
      finishTranslation = () => { onDone('complete', 'test-model'); resolve(); };
    }));
    const controller = new ClassroomController();
    await controller.start({  });
    const recognizer = shared.recognizers[0] as GoogleRecognizerFixture;
    recognizer.finalOnStop = () => recognizer.emit('drained final words', true);

    let stopped = false;
    const stopping = controller.stop().then(() => { stopped = true; });
    await vi.waitFor(() => expect(finishTranslation).toBeDefined());
    expect(stopped).toBe(false);
    expect(controller.snapshot().captions[0]?.source).toBe('drained final words');
    finishTranslation();
    await stopping;
    expect(controller.snapshot().state).toBe('stopped');
    expect(shared.events.indexOf('pcm.stop')).toBeLessThan(shared.events.indexOf('recognizer.stop'));
  });

  it('finishes archival stop and retains captions when capture and recognizer cleanup reject', async () => {
    const controller = new ClassroomController();
    await controller.start({  });
    (shared.captures[0] as PcmCaptureFixture).stopImpl = async () => { throw new Error('PCM close failed'); };
    (shared.recorders[0] as RecorderFixture).stopImpl = async () => { throw new Error('audio close failed'); };
    const recognizer = shared.recognizers[0] as GoogleRecognizerFixture;
    recognizer.stopImpl = async () => { throw new Error('recognizer close failed'); };
    recognizer.emit('kept transcript', true);

    await expect(controller.stop()).resolves.toBeUndefined();

    expect(controller.snapshot()).toMatchObject({ state: 'stopped', error: expect.stringContaining('recognizer close failed') });
    expect(controller.snapshot().captions[0]?.source).toBe('kept transcript');
    expect(shared.updateRecording).toHaveBeenCalledWith('google-recording', expect.objectContaining({ state: 'stopped' }));
    expect(shared.events).toContain('recognizer.stop');
  });

  it('retains microphone input and earlier captions when a unary request fails', async () => {
    const controller = new ClassroomController();
    await controller.start();
    const recognizer = shared.recognizers[0];
    recognizer.emit('saved before quota', true);
    recognizer.callbacks.onError('quota exceeded for a segment', controller.snapshot().epoch);
    shared.captures[0].emit(new Float32Array([0.2]), 16000);
    expect(controller.snapshot().state).toBe('recording');
    expect(controller.snapshot().error).toContain('quota exceeded');
    expect(controller.snapshot().captions[0].source).toBe('saved before quota');
    expect(recognizer.pushes).toHaveLength(1);
    expect(shared.recognizers).toHaveLength(1);
    await controller.stop();
  });

  it('exposes a suspended PCM context and resumes it from a new tap without erasing captions', async () => {
    vi.useFakeTimers();
    const controller = new ClassroomController();
    await controller.start({  });
    shared.recognizers[0].emit('words before suspension', true);
    shared.captures[0].state = 'suspended';
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.snapshot().micState).toBe('suspended');
    await controller.resumeMicrophone();
    expect(controller.snapshot().micState).toBe('live');
    expect(shared.captures[0].state).toBe('running');
    expect(controller.snapshot().captions[0].source).toBe('words before suspension');
    await controller.stop();
  });

  it('labels speakers without changing corrected source text or its history', async () => {
    shared.getAudioBlob.mockResolvedValue({ blob: new Blob(['audio']), mimeType: 'audio/webm' });
    const controller = new ClassroomController();
    await controller.start({  });
    const recognizer = shared.recognizers[0];
    await new Promise((resolve) => setTimeout(resolve, 25));
    recognizer.emit('original wording', true, 'speaker-test', 1);
    await vi.waitFor(() => expect(controller.snapshot().captions[0]?.isFinal).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 25));
    recognizer.emit('corrected wording', true, 'speaker-test', 2);
    await vi.waitFor(() => expect(controller.snapshot().captions[0]?.source).toBe('corrected wording'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ segments: [
      { speakerLabel: 'spk_1', startMs: 0, endMs: 10_000 },
    ] }), { status: 200 })));

    await controller.stop();
    await controller.assignSpeakers();

    expect(controller.snapshot().captions[0]).toMatchObject({
      source: 'corrected wording', speakerLabel: 'spk_1',
      sourceHistory: [{ text: 'original wording' }],
    });
    expect(shared.saveCaption.mock.calls.at(-1)?.[0].source).toBe('corrected wording');
  });

  it('applies saved mode, roster, and pause settings to subsequent audio without restarting capture', async () => {
    const controller = new ClassroomController();
    await controller.start();
    const recognizer = shared.recognizers[0];
    controller.setTranscriptionSettings({ transcriptionMode: 'smart', speakerCount: 8 });
    controller.setReadingPauseMs(6000);
    controller.switchMode('readingPractice');
    expect(controller.snapshot()).toMatchObject({ transcriptionMode: 'smart', speakerCount: 8, readingPauseMs: 6000 });
    expect(recognizer.updateSettings).toHaveBeenCalledWith({ transcriptionMode: 'smart', speakerCount: 8 });
    expect(recognizer.updateSettings).toHaveBeenCalledWith({ pauseMs: 6000 });
    expect(shared.recognizers).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledOnce();
    await controller.stop();
    expect(shared.updateRecording).toHaveBeenLastCalledWith('google-recording', expect.objectContaining({ config: expect.objectContaining({ transcriptionMode: 'smart', speakerCount: 8 }) }));
  });

  it('saves and clears manual smart speaker labels without another audio API call', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const controller = new ClassroomController();
    await controller.start({ transcriptionMode: 'smart', speakerCount: 8 });
    shared.recognizers[0].emit('clean smart text', true);
    await expect(controller.setCaptionSpeaker(1, 'spk_8')).rejects.toThrow('Kết thúc');
    await controller.stop();
    await controller.assignSpeakers();
    expect(fetcher).not.toHaveBeenCalled();
    expect(shared.getAudioBlob).not.toHaveBeenCalled();
    await controller.setCaptionSpeaker(1, 'spk_8');
    expect(controller.snapshot().captions[0]).toMatchObject({ source: 'clean smart text', translation: 'translated', speakerLabel: 'spk_8' });
    expect(shared.saveCaption).toHaveBeenLastCalledWith(expect.objectContaining({ speakerLabel: 'spk_8', source: 'clean smart text' }));
    await expect(controller.setCaptionSpeaker(1, 'spk_9')).rejects.toThrow('danh sách');
    await controller.setCaptionSpeaker(1, undefined);
    expect(controller.snapshot().captions[0].speakerLabel).toBeUndefined();
  });

  it('keeps different native speakers in separate reading captions', async () => {
    const controller = new ClassroomController();
    await controller.start({ mode: 'readingPractice', speakerCount: 2 });
    const recognizer = shared.recognizers[0];
    recognizer.callbacks.onTranscript('first speaker', true, recognizer.epoch, 'turn_1', 1, { startMs: 0, endMs: 500, speakerLabel: 'spk_1' });
    recognizer.callbacks.onTranscript('second speaker', true, recognizer.epoch, 'turn_2', 1, { startMs: 600, endMs: 1000, speakerLabel: 'spk_2' });
    await controller.stop();
    expect(controller.snapshot().captions).toEqual([
      expect.objectContaining({ source: 'first speaker', speakerLabel: 'spk_1' }),
      expect.objectContaining({ source: 'second speaker', speakerLabel: 'spk_2' }),
    ]);
  });
});
