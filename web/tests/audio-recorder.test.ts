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
    class ContinuousRecorder extends FakeMediaRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) { super(stream, options); instances.push(this); }
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
    expect(chunks.map(chunk => chunk.sequence)).toEqual([0, 1, 2, 3]);
    expect(chunks.map(chunk => chunk.text)).toEqual(['before API pause', 'while API paused', 'after API resume', 'last chunk']);
    expect(chunks.every(chunk => chunk.segmentIndex === 1)).toBe(true);
    expect(completed).toEqual([1]); expect(track.stop).toHaveBeenCalledOnce();
  });
});
