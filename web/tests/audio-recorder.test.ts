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

  it('switches segments without stopping microphone tracks and passes segmentIndex with chunks', async () => {
    let instanceCount = 0;
    class NumberedFakeMediaRecorder {
      static isTypeSupported() { return true; }
      id: number;
      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      private listeners = new Map<string, Array<() => void>>();
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        void stream; void options;
        this.id = ++instanceCount;
      }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([`segment-chunk-from-rec-${this.id}`]) } as BlobEvent);
        this.listeners.get('stop')?.forEach((listener) => listener());
      }
      addEventListener(name: string, listener: () => void) {
        this.listeners.set(name, [...(this.listeners.get(name) || []), listener]);
      }
    }

    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) } });
    vi.stubGlobal('window', {});
    vi.stubGlobal('MediaRecorder', NumberedFakeMediaRecorder);

    const receivedChunks: Array<{ text: string; segmentIndex?: number; sequence: number }> = [];
    const completedSegments: number[] = [];

    const recorder = new WebAudioRecorder({
      onChunk: async (blob, seq, _timestamp, _mime, segmentIndex) => {
        receivedChunks.push({ text: await blob.text(), segmentIndex, sequence: seq });
      },
      onVolume: () => {},
      onError: (err) => { throw new Error(err); },
      onSegmentComplete: (segIndex) => {
        completedSegments.push(segIndex);
      },
    });

    await recorder.start();
    expect(recorder.segmentIndex).toBe(1);
    expect(track.stop).not.toHaveBeenCalled();

    // Switch to segment 2 (e.g. user clicked Pause API)
    await recorder.switchSegment(2);
    expect(recorder.segmentIndex).toBe(2);
    // Microphone track MUST NOT be stopped when switching segments!
    expect(track.stop).not.toHaveBeenCalled();
    expect(completedSegments).toEqual([1]);
    expect(receivedChunks.some((c) => c.segmentIndex === 1 && c.text === 'segment-chunk-from-rec-1')).toBe(true);

    // Switch to segment 3 (e.g. user clicked Resume API)
    await recorder.switchSegment(3);
    expect(recorder.segmentIndex).toBe(3);
    expect(track.stop).not.toHaveBeenCalled();
    expect(completedSegments).toEqual([1, 2]);

    // Finally stop the entire session
    await recorder.stop();
    expect(completedSegments).toEqual([1, 2, 3]);
    // Only now should track.stop be called!
    expect(track.stop).toHaveBeenCalledOnce();
  });
});
