import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ClassroomController, type StartOptions } from '@/features/recording/controller';
import { AudioInput, DisplayCaptureError, requestDisplayAudio } from '@/features/recording/audio-input';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import { getRecording, listRecordings } from '@/storage/recordings';

vi.mock('@/features/recording/audio-input', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/recording/audio-input')>()),
  requestDisplayAudio: vi.fn(),
}));

vi.mock('@/features/recording/gemini-pcm-capture', () => ({
  GeminiPcmCapture: class {
    state = 'running';
    async prepare() {}
    async start() {}
    async stop() {}
  },
}));

vi.mock('@/features/recording/gemini-transcribe-recognition', () => ({
  GeminiTranscribeRecognizer: class {
    async start() {}
    pushPcm() {}
    finalizeUtterance() {}
    updateSettings() {}
    async stop() {}
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

// Node has no Web Audio. AudioInput only needs these nodes to exist and accept connections.
class FakeAudioContext {
  state = 'running';
  createMediaStreamDestination() { return { stream: { getTracks: () => [] }, disconnect() {} }; }
  createDynamicsCompressor() { return { connect() {}, disconnect() {} }; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createAnalyser() { return { fftSize: 0, connect() {}, disconnect() {}, getByteTimeDomainData() {} }; }
  async resume() {}
  close() { return Promise.resolve(); }
}

interface FakeTrack {
  kind: 'audio' | 'video';
  stop: Mock;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: () => void;
  fire: (type: string) => void;
}

function fakeTrack(kind: 'audio' | 'video'): FakeTrack {
  const listeners = new Map<string, Array<() => void>>();
  return {
    kind,
    stop: vi.fn(),
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener() {},
    fire(type) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
}

interface FakeCapture {
  stream: MediaStream;
  audio: FakeTrack;
  tracks: FakeTrack[];
}

function fakeCapture(withVideo: boolean): FakeCapture {
  const audio = fakeTrack('audio');
  const tracks = withVideo ? [audio, fakeTrack('video')] : [audio];
  const stream = {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
  } as unknown as MediaStream;
  return { stream, audio, tracks };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const requestDisplayAudioMock = vi.mocked(requestDisplayAudio);
const baseOptions: StartOptions = {
  mode: 'lecture',
  sourceLanguage: 'ja-JP',
  targetLanguage: 'vi',
  translationModelKey: 'test-model',
};

describe('ClassroomController display audio source', () => {
  let controller: ClassroomController;
  let db: AppDatabase;

  beforeEach(() => {
    FakeMediaRecorder.instances.length = 0;
    requestDisplayAudioMock.mockReset();

    db = new AppDatabase(`display_source_test_${Date.now()}_${Math.random()}`);
    resetDbInstance(db);

    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockImplementation(async () => fakeCapture(false).stream),
      },
    });

    controller = new ClassroomController();
  });

  afterEach(async () => {
    try { await controller.stop(); } catch {}
    resetDbInstance();
    await db.delete();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps microphone sessions unchanged: no display prompt and no audioSource stored', async () => {
    await controller.start(baseOptions);

    expect(requestDisplayAudioMock).not.toHaveBeenCalled();
    expect(controller.snapshot().audioSource).toBe('mic');
    expect(controller.snapshot().displayState).toBe('none');
    const recording = await getRecording(controller.snapshot().recordingId!);
    expect(recording?.config).not.toHaveProperty('audioSource');
  });

  it('requests display audio before any recording row exists, then stores the source', async () => {
    const display = fakeCapture(true);
    let grant!: (stream: MediaStream) => void;
    requestDisplayAudioMock.mockReturnValueOnce(new Promise<MediaStream>((resolve) => { grant = resolve; }));

    const started = controller.start({ ...baseOptions, audioSource: 'display' });
    await flush();

    // The gesture-bound prompt is raised synchronously, and nothing is written while the user chooses a tab.
    expect(requestDisplayAudioMock).toHaveBeenCalledTimes(1);
    expect(await listRecordings()).toHaveLength(0);

    grant(display.stream);
    const recordingId = await started;

    const recording = await getRecording(recordingId);
    expect(recording?.config.audioSource).toBe('display');
    expect(controller.snapshot().audioSource).toBe('display');
    expect(controller.snapshot().displayState).toBe('live');
  });

  it('rejects start and creates no recording when the user cancels the prompt', async () => {
    requestDisplayAudioMock.mockRejectedValueOnce(new DisplayCaptureError('cancelled', 'Bạn đã hủy chia sẻ màn hình.'));

    await expect(controller.start({ ...baseOptions, audioSource: 'display' })).rejects.toBeInstanceOf(DisplayCaptureError);

    expect(await listRecordings()).toHaveLength(0);
    expect(controller.snapshot().state).toBe('stopped');
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('display-only: ending the share pauses API input but keeps the session recording', async () => {
    const display = fakeCapture(true);
    requestDisplayAudioMock.mockResolvedValueOnce(display.stream);
    await controller.start({ ...baseOptions, audioSource: 'display' });

    display.audio.fire('ended');
    await flush();

    expect(controller.snapshot().displayState).toBe('ended');
    expect(controller.snapshot().apiState).toBe('paused');
    expect(controller.snapshot().state).toBe('recording');
    expect(FakeMediaRecorder.instances[0].state).toBe('recording');
  });

  it('mixed: ending the share keeps the microphone API running', async () => {
    const display = fakeCapture(true);
    requestDisplayAudioMock.mockResolvedValueOnce(display.stream);
    await controller.start({ ...baseOptions, audioSource: 'mixed' });

    display.audio.fire('ended');
    await flush();

    expect(controller.snapshot().displayState).toBe('ended');
    expect(controller.snapshot().apiState).toBe('active');
    expect(controller.snapshot().state).toBe('recording');
  });

  it('reshareDisplay swaps the display capture once and resumes display-only API input', async () => {
    const first = fakeCapture(true);
    const second = fakeCapture(true);
    requestDisplayAudioMock
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    await controller.start({ ...baseOptions, audioSource: 'display' });
    const replaceSpy = vi.spyOn(AudioInput.prototype, 'replaceDisplay');

    first.audio.fire('ended');
    await flush();
    expect(controller.snapshot().apiState).toBe('paused');

    await controller.reshareDisplay();

    expect(requestDisplayAudioMock).toHaveBeenCalledTimes(2);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith(second.stream);
    expect(controller.snapshot().displayState).toBe('live');
    expect(controller.snapshot().apiState).toBe('active');
  });

  it('stop clears the display state and stops every display track, including a reshared one', async () => {
    const first = fakeCapture(true);
    const second = fakeCapture(true);
    requestDisplayAudioMock
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    await controller.start({ ...baseOptions, audioSource: 'display' });
    first.audio.fire('ended');
    await flush();
    await controller.reshareDisplay();

    await controller.stop();

    expect(controller.snapshot().state).toBe('stopped');
    expect(controller.snapshot().displayState).toBe('none');
    for (const track of [...first.tracks, ...second.tracks]) {
      expect(track.stop).toHaveBeenCalled();
    }
  });
});
