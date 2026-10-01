import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface GoogleCallbacks {
  onTranscript: (text: string, isFinal: boolean, epoch: number, providerItemId: string, revision: number) => void;
  onError: (error: string, epoch: number) => void;
  onStateChange: (state: 'idle' | 'listening' | 'reconnecting' | 'stopped') => void;
}
interface PcmCaptureFixture {
  state: string;
  stream: MediaStream | null;
  onPcm: ((samples: Float32Array, rate: number) => void) | null;
  stopImpl: () => Promise<void>;
  emit: (samples?: Float32Array, rate?: number) => void;
}
interface GoogleRecognizerFixture {
  callbacks: GoogleCallbacks;
  epoch: number;
  pushes: Array<{ samples: Float32Array; rate: number }>;
  stopImpl: () => Promise<void>;
  finalOnStop: (() => void) | null;
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
  captures: [] as PcmCaptureFixture[],
  recorders: [] as RecorderFixture[],
  createRecording: vi.fn(),
  updateRecording: vi.fn(),
  addAudioChunk: vi.fn(),
  saveCaption: vi.fn(),
  getAudioBlob: vi.fn(),
  streamTranslate: vi.fn(),
}));

vi.mock('@/features/recording/gemini-live-recognition', () => ({
  GeminiLiveRecognizer: class {
    callbacks: GoogleCallbacks;
    epoch = 0;
    pushes: Array<{ samples: Float32Array; rate: number }> = [];
    stopImpl: () => Promise<void> = async () => undefined;
    finalOnStop: (() => void) | null = null;
    constructor(callbacks: GoogleCallbacks) { this.callbacks = callbacks; shared.recognizers.push(this); }
    async start(epoch: number) { this.epoch = epoch; shared.events.push('recognizer.start'); }
    pushPcm(samples: Float32Array, rate: number) { this.pushes.push({ samples, rate }); }
    finalizeUtterance() {}
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
    callbacks: RecorderFixture['callbacks'];
    stream: MediaStream | null = null;
    stopImpl: () => Promise<void> = async () => undefined;
    constructor(callbacks: RecorderFixture['callbacks']) { this.callbacks = callbacks; shared.recorders.push(this); }
    async start() {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true }) as MediaStream;
      shared.events.push('recorder.start'); this.callbacks.onMicState?.('live'); return 'audio/webm';
    }
    async stop() { shared.events.push('recorder.stop'); await this.stopImpl(); }
    async resume() {}
  },
}));

vi.mock('@/storage/recordings', () => ({
  createRecording: shared.createRecording,
  updateRecording: shared.updateRecording,
  addAudioChunk: shared.addAudioChunk,
  saveCaption: shared.saveCaption,
  getAudioBlob: shared.getAudioBlob,
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
    shared.events.length = 0; shared.recognizers.length = 0; shared.captures.length = 0; shared.recorders.length = 0;
    shared.createRecording.mockReset().mockResolvedValue(recording);
    shared.updateRecording.mockReset().mockResolvedValue(undefined);
    shared.addAudioChunk.mockReset().mockResolvedValue(undefined);
    shared.saveCaption.mockReset().mockResolvedValue(undefined);
    shared.getAudioBlob.mockReset().mockResolvedValue(null);
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

  it('uses unary input without a live socket and drains its last words into saved translations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ text: '最後の言葉' })));
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google-transcribe' });
    expect(shared.recognizers).toHaveLength(0);
    shared.captures[0].emit(new Float32Array(8000).fill(0.2), 16000);
    await controller.stop();
    expect(controller.snapshot().state).toBe('stopped');
    expect(controller.snapshot().captions).toEqual([expect.objectContaining({ source: '最後の言葉', translation: 'translated', isFinal: true, startMs: 0, endMs: 500 })]);
    expect(shared.saveCaption).toHaveBeenCalled();
  });

  it('initializes PCM in the gesture, acquires one microphone stream, and shares it with the recorder', async () => {
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google' });

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(shared.events.indexOf('pcm.prepare')).toBeLessThan(shared.events.indexOf('recorder.start'));
    expect(shared.captures[0].stream).toBe(shared.recorders[0].stream);
    expect(controller.snapshot().micState).toBe('live');
    const samples = new Float32Array([0.25, -0.25]);
    (shared.captures[0] as PcmCaptureFixture).emit(samples, 48_000);
    expect((shared.recognizers[0] as GoogleRecognizerFixture).pushes).toEqual([{ samples, rate: 48_000 }]);
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
    await controller.start({ speechProvider: 'google' });
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
    await controller.start({ speechProvider: 'google' });
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

  it('keeps audio capture alive and reports a failed recognizer renewal', async () => {
    vi.useFakeTimers();
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google' });
    const recognizer = shared.recognizers[0] as GoogleRecognizerFixture;
    recognizer.stopImpl = async () => { throw new Error('renewal close failed'); };

    await vi.advanceTimersByTimeAsync(8.5 * 60_000);

    expect(controller.snapshot().state).toBe('recording');
    expect(controller.snapshot().error).toContain('renewal close failed');
    expect(shared.captures[0].stream).toBe(stream);
    recognizer.stopImpl = async () => undefined;
    await controller.stop();
  });

  it('exposes a suspended PCM context and resumes it from a new tap without erasing captions', async () => {
    vi.useFakeTimers();
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google' });
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

  it('buffers PCM during a broken connection and forwards it after a bounded reconnect', async () => {
    vi.useFakeTimers();
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google' });
    shared.recognizers[0].callbacks.onError('connection closed', controller.snapshot().epoch);
    const samples = new Float32Array([0.25, 0.5]);
    shared.captures[0].emit(samples, 48_000);
    expect(shared.recognizers[0].pushes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(shared.recognizers).toHaveLength(2);
    expect(shared.recognizers[1].pushes).toEqual([{ samples, rate: 48_000 }]);
    await controller.stop();
  });

  it('labels speakers without changing corrected source text or its history', async () => {
    shared.getAudioBlob.mockResolvedValue({ blob: new Blob(['audio']), mimeType: 'audio/webm' });
    const controller = new ClassroomController();
    await controller.start({ speechProvider: 'google' });
    const recognizer = shared.recognizers[0];
    await new Promise((resolve) => setTimeout(resolve, 25));
    recognizer.emit('original wording', true, 'speaker-test', 1);
    await vi.waitFor(() => expect(controller.snapshot().captions[0]?.isFinal).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 25));
    recognizer.emit('corrected wording', true, 'speaker-test', 2);
    await vi.waitFor(() => expect(controller.snapshot().captions[0]?.source).toBe('corrected wording'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ segments: [
      { speakerLabel: 'speaker-1', startMs: 0, endMs: 10_000 },
    ] }), { status: 200 })));

    await controller.stop();
    await controller.assignSpeakers();

    expect(controller.snapshot().captions[0]).toMatchObject({
      source: 'corrected wording', speakerLabel: 'speaker-1',
      sourceHistory: [{ text: 'original wording' }],
    });
    expect(shared.saveCaption.mock.calls.at(-1)?.[0].source).toBe('corrected wording');
  });
});
