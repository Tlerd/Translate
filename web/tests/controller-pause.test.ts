import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassroomController } from '@/features/recording/controller';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import { getAudioSegments } from '@/storage/recordings';

interface PcmInstanceFixture {
  onPcm?: ((samples: Float32Array, rate: number) => void) | null;
}

const pcmInstances: PcmInstanceFixture[] = [];
vi.mock('@/features/recording/gemini-pcm-capture', () => ({
  GeminiPcmCapture: class {
    state = 'running';
    onPcm: ((samples: Float32Array, rate: number) => void) | null = null;
    constructor() { pcmInstances.push(this); }
    async prepare() {}
    async start(_stream: MediaStream, onPcm: (samples: Float32Array, rate: number) => void) {
      this.onPcm = onPcm;
    }
    async stop() {
      this.onPcm = null;
    }
  },
}));

const recognizerPushes: Float32Array[] = [];
let recognizerStartCount = 0;
let recognizerStopCount = 0;
let lastOffsetMs: number | undefined;
let recognizerStopGate: Promise<void> | null = null;
const recognizerCallbacks: Array<{ onStateChange: (state: string) => void }> = [];

vi.mock('@/features/recording/gemini-transcribe-recognition', () => ({
  GeminiTranscribeRecognizer: class {
    constructor(
      callbacks: unknown,
      _language: string,
      public offsetMs?: number
    ) {
      lastOffsetMs = offsetMs;
      recognizerCallbacks.push(callbacks as { onStateChange: (state: string) => void });
    }
    async start() {
      recognizerStartCount++;
    }
    pushPcm(samples: Float32Array) {
      recognizerPushes.push(samples);
    }
    finalizeUtterance() {}
    updateSettings() {}
    async stop() {
      recognizerStopCount++;
      await recognizerStopGate;
    }
  },
}));

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  private listeners = new Map<string, Array<() => void>>();
  static instances: FakeMediaRecorder[] = [];
  constructor(public stream: MediaStream, public options?: MediaRecorderOptions) { FakeMediaRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) } as BlobEvent);
    this.listeners.get('stop')?.forEach((l) => l());
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), listener]);
  }
}

describe('ClassroomController API pause with continuous audio', () => {
  let controller: ClassroomController;
  let db: AppDatabase;

  beforeEach(() => {
    FakeMediaRecorder.instances.length = 0;
    recognizerPushes.length = 0;
    recognizerStartCount = 0;
    recognizerStopCount = 0;
    recognizerStopGate = null;
    recognizerCallbacks.length = 0;
    lastOffsetMs = undefined;
    pcmInstances.length = 0;

    db = new AppDatabase(`pause_test_${Date.now()}_${Math.random()}`);
    resetDbInstance(db);

    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }],
          clone: () => ({ getTracks: () => [] }),
        }),
      },
    });

    controller = new ClassroomController();
  });

  afterEach(async () => {
    try { await controller.stop(); } catch {}
    resetDbInstance();
    await db.delete();
    vi.unstubAllGlobals();
  });

  it('pauses only API input, keeping the recorder alive and one full-session file', async () => {
    await controller.start({
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'test-model',
    });

    const recordingId = controller.snapshot().recordingId!;
    expect(controller.snapshot().state).toBe('recording');
    expect(controller.snapshot().apiState).toBe('active');
    expect(controller.snapshot().activeSegmentIndex).toBe(1);
    expect(controller.snapshot().activeSegmentKind).toBe('translating');
    expect(recognizerStartCount).toBe(1);

    // Push PCM while active -> recognizer receives it
    const activePcm = pcmInstances[0];
    const testSamples = new Float32Array([0.1, 0.2]);
    activePcm?.onPcm?.(testSamples, 16000);
    expect(recognizerPushes.length).toBe(1);

    // Now Pause API
    await controller.pauseApi();

    expect(controller.snapshot().apiState).toBe('paused');
    expect(controller.snapshot().activeSegmentIndex).toBe(1);
    expect(controller.snapshot().activeSegmentKind).toBe('translating');
    expect(recognizerStopCount).toBe(1);

    // Push PCM while paused -> recognizer MUST NOT receive it
    activePcm?.onPcm?.(new Float32Array([0.3, 0.4]), 16000);
    expect(recognizerPushes.length).toBe(1); // Still 1

    const segments = await getAudioSegments(recordingId);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ segmentIndex: 1, status: 'recording' });
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0].state).toBe('recording');

  });

  it('resumes API with whole-session offset without restarting audio capture', async () => {
    await controller.start({
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'test-model',
    });

    const recordingId = controller.snapshot().recordingId!;

    // Push PCM before pause
    const activePcm = pcmInstances[0];
    activePcm?.onPcm?.(new Float32Array([0.1, 0.2]), 16000);
    expect(recognizerPushes.length).toBe(1);

    await controller.pauseApi();
    expect(controller.snapshot().apiState).toBe('paused');

    // Push PCM during pause -> ignored
    activePcm?.onPcm?.(new Float32Array([0.3, 0.4]), 16000);
    expect(recognizerPushes.length).toBe(1);

    // Resume API
    await controller.resumeApi();

    expect(controller.snapshot().apiState).toBe('active');
    expect(controller.snapshot().activeSegmentIndex).toBe(1);
    expect(controller.snapshot().activeSegmentKind).toBe('translating');
    expect(recognizerStartCount).toBe(2);
    expect(typeof lastOffsetMs).toBe('number');

    // Push PCM while resumed -> recognizer receives it again
    activePcm?.onPcm?.(new Float32Array([0.5, 0.6]), 16000);
    expect(recognizerPushes.length).toBe(2);

    const segments = await getAudioSegments(recordingId);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ segmentIndex: 1, status: 'recording' });
    expect(FakeMediaRecorder.instances).toHaveLength(1);

  });

  it('pauses and resumes while the previous recognizer is still draining', async () => {
    await controller.start({ mode: 'lecture', sourceLanguage: 'ja-JP', targetLanguage: 'vi', translationModelKey: 'test-model' });
    let finishDrain!: () => void;
    recognizerStopGate = new Promise<void>((resolve) => { finishDrain = resolve; });

    await controller.pauseApi();
    expect(controller.snapshot().apiState).toBe('paused');
    expect(recognizerStopCount).toBe(1);

    await controller.resumeApi();
    expect(controller.snapshot().apiState).toBe('active');
    recognizerCallbacks[0]?.onStateChange('stopped');
    expect(controller.snapshot().speechState).toBe('listening');

    finishDrain();
  });

  it('stops while API paused: persists the last audio chunk and queues a full-session upload', async () => {
    await controller.start({
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'test-model',
    });

    const recordingId = controller.snapshot().recordingId!;
    await controller.pauseApi();
    expect(controller.snapshot().activeSegmentIndex).toBe(1);

    await controller.stop();

    expect(controller.snapshot().state).toBe('stopped');

    const segments = await getAudioSegments(recordingId);
    expect(segments).toHaveLength(1);
    expect(segments[0].status).toBe('completed');
    expect(await db.audioChunks.where('recordingId').equals(recordingId).count()).toBe(1);
    expect((await db.audioJobs.get(recordingId))?.action).toBe('upload');
  });

  it('sound threshold: suppresses low-energy silence and flushes pre-roll when voice is detected', async () => {
    await controller.start({
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'test-model',
    });

    const activePcm = pcmInstances[0];
    expect(recognizerPushes.length).toBe(0);

    // 1. Send silence (RMS < 0.015)
    const silenceSamples = new Float32Array([0.001, 0.002, 0.001]);
    activePcm?.onPcm?.(silenceSamples, 16000);
    // Gate is closed, silence held in pre-roll buffer, nothing sent to recognizer yet
    expect(recognizerPushes.length).toBe(0);

    // 2. Send loud voice (RMS >= 0.015)
    const voiceSamples = new Float32Array([0.1, 0.2]);
    activePcm?.onPcm?.(voiceSamples, 16000);
    // Gate opens! Pre-roll buffer (silenceSamples) flushed first, then voiceSamples
    expect(recognizerPushes.length).toBe(2);
    expect(recognizerPushes[0]).toBe(silenceSamples);
    expect(recognizerPushes[1]).toBe(voiceSamples);

    // 3. Pause API -> manual pause immediately disables forwarding even if loud voice continues
    await controller.pauseApi();
    activePcm?.onPcm?.(new Float32Array([0.8, 0.9]), 16000);
    // Still 2! Manual pause overrides any sound
    expect(recognizerPushes.length).toBe(2);
  });
});
