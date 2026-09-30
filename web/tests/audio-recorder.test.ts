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
    finishWrite();
    await stopped;
    expect(track.stop).toHaveBeenCalledOnce();
  });
});
