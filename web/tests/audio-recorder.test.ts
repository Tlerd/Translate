import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAudioRecorder } from '@/features/recording/audio-recorder';

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Array<() => void>>();
  constructor(stream: MediaStream, options?: MediaRecorderOptions) { void stream; void options; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['last chunk']) } as BlobEvent);
    this.listeners.get('stop')?.forEach((listener) => listener());
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), listener]);
  }
}

describe('WebAudioRecorder', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts the final dataavailable chunk from MediaRecorder.stop and waits for its write', async () => {
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    vi.stubGlobal('window', {});
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const chunks: string[] = [];
    let finishWrite!: () => void;
    const recorder = new WebAudioRecorder({
      onChunk: async (blob) => {
        chunks.push(await blob.text());
        await new Promise<void>((resolve) => { finishWrite = resolve; });
      },
      onVolume: () => {},
      onError: (error) => { throw new Error(error); },
    });
    await recorder.start();
    const stopped = recorder.stop();
    await vi.waitFor(() => expect(chunks).toEqual(['last chunk']));
    expect(track.stop).toHaveBeenCalledOnce(); // Release the mic while disk writes are still pending.
    finishWrite();
    await stopped;
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('keeps a single recorder and monotonically ordered chunks until the final stop', async () => {
    const instances: FakeMediaRecorder[] = [];
    const options: Array<MediaRecorderOptions | undefined> = [];
    class ContinuousRecorder extends FakeMediaRecorder {
      constructor(stream: MediaStream, recorderOptions?: MediaRecorderOptions) { super(stream, recorderOptions); instances.push(this); options.push(recorderOptions); }
    }
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    vi.stubGlobal('window', {}); vi.stubGlobal('MediaRecorder', ContinuousRecorder);
    const chunks: Array<{ text: string; sequence: number; segmentIndex?: number }> = [];
    const completed: number[] = [];
    const recorder = new WebAudioRecorder({
      onChunk: async (blob, sequence, _time, _mime, segmentIndex) => { chunks.push({ text: await blob.text(), sequence, segmentIndex }); },
      onVolume: () => {}, onError: error => { throw new Error(error); }, onSegmentComplete: index => { completed.push(index); },
    });
    await recorder.start();
    for (const text of ['before API pause', 'while API paused', 'after API resume']) {
      instances[0].ondataavailable?.({ data: new Blob([text]) } as BlobEvent);
    }
    expect(track.stop).not.toHaveBeenCalled(); expect(completed).toEqual([]);
    await recorder.stop();
    expect(instances).toHaveLength(1);
    // Speech bitrate, not the browser's ~128 kbps default, keeps cloud audio small.
    expect(options[0]?.audioBitsPerSecond).toBe(32_000);
    expect(chunks.map(chunk => chunk.sequence)).toEqual([0, 1, 2, 3]);
    expect(chunks.map(chunk => chunk.text)).toEqual(['before API pause', 'while API paused', 'after API resume', 'last chunk']);
    expect(chunks.every(chunk => chunk.segmentIndex === 1)).toBe(true);
    expect(completed).toEqual([1]); expect(track.stop).toHaveBeenCalledOnce();
  });
});

class SourceTrack {
  readonly stop = vi.fn();
  readonly kind = 'audio';
  addEventListener() {}
}

function sourceStream(tracks: SourceTrack[]): MediaStream {
  return { getTracks: () => [...tracks], getAudioTracks: () => [...tracks] } as unknown as MediaStream;
}

class SourceAudioContext {
  state: AudioContextState = 'running';
  private readonly destinationTrack = new SourceTrack();
  private readonly destinationStream = sourceStream([this.destinationTrack]);
  close() { return Promise.resolve(); }
  resume() { return Promise.resolve(); }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createAnalyser() { return { fftSize: 256, connect() {}, disconnect() {}, getByteTimeDomainData() {} }; }
  createDynamicsCompressor() { return { connect() {}, disconnect() {} }; }
  createMediaStreamDestination() { return { stream: this.destinationStream, connect() {}, disconnect() {} }; }
}

describe('WebAudioRecorder audio sources', () => {
  afterEach(() => vi.unstubAllGlobals());

  const callbacks = () => ({
    onChunk: () => {},
    onVolume: () => {},
    onError: (error: string) => { throw new Error(error); },
  });

  it('display source records the display stream and never requests the microphone', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('window', {});
    vi.stubGlobal('AudioContext', SourceAudioContext);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const displayTrack = new SourceTrack();
    const recorder = new WebAudioRecorder(callbacks());

    await recorder.start(2000, { source: 'display', displayStream: sourceStream([displayTrack]) });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(recorder.audioInput).not.toBeNull();

    await recorder.stop();
    expect(displayTrack.stop).toHaveBeenCalledOnce();
    expect(recorder.audioInput).toBeNull();
  });

  it('display source without a display stream fails before touching the microphone', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('window', {});
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = new WebAudioRecorder(callbacks());

    await expect(recorder.start(2000, { source: 'display' })).rejects.toThrow('Thiếu luồng âm thanh màn hình.');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('mixed source makes one microphone request and records only the mixed stream', async () => {
    const micTrack = new SourceTrack();
    const getUserMedia = vi.fn().mockResolvedValue(sourceStream([micTrack]));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('window', {});
    vi.stubGlobal('AudioContext', SourceAudioContext);
    const recorded: MediaStream[] = [];
    class RecordingRecorder extends FakeMediaRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        recorded.push(stream);
      }
    }
    vi.stubGlobal('MediaRecorder', RecordingRecorder);
    const displayTrack = new SourceTrack();
    const recorder = new WebAudioRecorder(callbacks());

    await recorder.start(2000, { source: 'mixed', displayStream: sourceStream([displayTrack]) });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toBe(recorder.audioInput?.stream);
    expect(recorder.stream).toBe(recorded[0]);

    await recorder.stop();
    expect(micTrack.stop).toHaveBeenCalledOnce();
    expect(displayTrack.stop).toHaveBeenCalledOnce();
  });
});
