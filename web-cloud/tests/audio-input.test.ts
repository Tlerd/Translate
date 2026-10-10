import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioInput,
  DisplayCaptureError,
  canCaptureDisplayAudio,
  requestDisplayAudio,
} from '@/features/recording/audio-input';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

class FakeTrack {
  readonly stop = vi.fn();
  private readonly listeners = new Map<string, Array<() => void>>();
  constructor(readonly kind: 'audio' | 'video' = 'audio') {}
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class FakeStream {
  constructor(private tracks: FakeTrack[]) {}
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  removeTrack(track: FakeTrack) { this.tracks = this.tracks.filter(item => item !== track); }
}

function asMediaStream(stream: FakeStream): MediaStream {
  return stream as unknown as MediaStream;
}

class FakeNode {
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class FakeSource extends FakeNode {
  constructor(readonly stream: MediaStream) { super(); }
}

class FakeGain extends FakeNode {
  gain = { value: 1 };
}

class FakeAnalyser extends FakeNode {
  fftSize = 256;
  sample = 128;
  getByteTimeDomainData(data: Uint8Array) { data.fill(this.sample); }
}

class FakeAudioContext {
  static last: FakeAudioContext | undefined;
  state: AudioContextState = 'running';
  closeCalls = 0;
  destinationCount = 0;
  readonly destinationTrack = new FakeTrack();
  readonly destinationStream = new FakeStream([this.destinationTrack]);
  readonly sources: FakeSource[] = [];
  readonly analysers: FakeAnalyser[] = [];
  readonly compressor = new FakeNode();

  constructor() { FakeAudioContext.last = this; }

  createMediaStreamSource(stream: MediaStream) {
    const source = new FakeSource(stream);
    this.sources.push(source);
    return source as unknown as MediaStreamAudioSourceNode;
  }
  createGain() { return new FakeGain() as unknown as GainNode; }
  createAnalyser() {
    const analyser = new FakeAnalyser();
    this.analysers.push(analyser);
    return analyser as unknown as AnalyserNode;
  }
  createDynamicsCompressor() { return this.compressor as unknown as DynamicsCompressorNode; }
  createMediaStreamDestination() {
    this.destinationCount++;
    return {
      stream: asMediaStream(this.destinationStream),
      connect() {},
      disconnect() {},
    } as unknown as MediaStreamAudioDestinationNode;
  }
  close() {
    this.closeCalls++;
    this.state = 'closed';
    return Promise.resolve();
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

function stubNavigator(userAgent: string, mediaDevices: Record<string, unknown> = { getDisplayMedia: vi.fn() }) {
  vi.stubGlobal('navigator', { userAgent, mediaDevices });
}

function lastContext(): FakeAudioContext {
  if (!FakeAudioContext.last) throw new Error('AudioContext was not created');
  return FakeAudioContext.last;
}

describe('canCaptureDisplayAudio', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is false on phones even when getDisplayMedia exists', () => {
    stubNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(canCaptureDisplayAudio()).toBe(false);
    stubNavigator('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36');
    expect(canCaptureDisplayAudio()).toBe(false);
  });

  it('is false when getDisplayMedia is missing', () => {
    stubNavigator(DESKTOP_UA, {});
    expect(canCaptureDisplayAudio()).toBe(false);
  });

  it('is false without a navigator', () => {
    vi.stubGlobal('navigator', undefined);
    expect(canCaptureDisplayAudio()).toBe(false);
  });

  it('is true on desktop when the API exists', () => {
    stubNavigator(DESKTOP_UA);
    expect(canCaptureDisplayAudio()).toBe(true);
  });
});

describe('requestDisplayAudio', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects as unsupported when display capture is unavailable', async () => {
    stubNavigator(DESKTOP_UA, {});
    await expect(requestDisplayAudio()).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('stops every track and reports no-audio when the stream has no audio', async () => {
    const video = new FakeTrack('video');
    const other = new FakeTrack('video');
    const getDisplayMedia = vi.fn().mockResolvedValue(asMediaStream(new FakeStream([video, other])));
    stubNavigator(DESKTOP_UA, { getDisplayMedia });

    const error = await requestDisplayAudio().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(DisplayCaptureError);
    expect(error).toMatchObject({ code: 'no-audio' });
    expect(video.stop).toHaveBeenCalledOnce();
    expect(other.stop).toHaveBeenCalledOnce();
  });

  it('reports cancelled when the user denies or aborts the share', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    stubNavigator(DESKTOP_UA, { getDisplayMedia: vi.fn().mockRejectedValue(denied) });
    await expect(requestDisplayAudio()).rejects.toMatchObject({ code: 'cancelled' });

    const aborted = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    stubNavigator(DESKTOP_UA, { getDisplayMedia: vi.fn().mockRejectedValue(aborted) });
    await expect(requestDisplayAudio()).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('reports failed with the original message for other errors', async () => {
    stubNavigator(DESKTOP_UA, { getDisplayMedia: vi.fn().mockRejectedValue(new Error('Capture broke')) });
    await expect(requestDisplayAudio()).rejects.toMatchObject({ code: 'failed', message: 'Capture broke' });
  });

  it('keeps the video track alive (it is stopped later by AudioInput) and returns the same stream', async () => {
    const audio = new FakeTrack('audio');
    const video = new FakeTrack('video');
    const stream = new FakeStream([video, audio]);
    stubNavigator(DESKTOP_UA, { getDisplayMedia: vi.fn().mockResolvedValue(asMediaStream(stream)) });

    const result = await requestDisplayAudio();
    expect(result).toBe(asMediaStream(stream));
    expect(video.stop).not.toHaveBeenCalled();
    expect(result.getVideoTracks()).toHaveLength(1);
    expect(result.getAudioTracks()).toHaveLength(1);
    expect(audio.stop).not.toHaveBeenCalled();
  });

  it('asks for system audio without echo cancellation', async () => {
    const getDisplayMedia = vi.fn().mockResolvedValue(asMediaStream(new FakeStream([new FakeTrack('audio')])));
    stubNavigator(DESKTOP_UA, { getDisplayMedia });

    await requestDisplayAudio();
    expect(getDisplayMedia).toHaveBeenCalledOnce();
    const options = getDisplayMedia.mock.calls[0][0] as {
      systemAudio: string;
      audio: { echoCancellation: boolean };
    };
    expect(options.systemAudio).toBe('include');
    expect(options.audio.echoCancellation).toBe(false);
  });
});

describe('AudioInput', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates exactly one destination in mixed mode and exposes its stream', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const input = new AudioInput({
      micStream: asMediaStream(new FakeStream([new FakeTrack()])),
      displayStream: asMediaStream(new FakeStream([new FakeTrack()])),
    });

    const ctx = lastContext();
    expect(ctx.destinationCount).toBe(1);
    expect(input.stream).toBe(asMediaStream(ctx.destinationStream));
    expect(input.label).toBe('Micro + âm thanh màn hình');
  });

  it('fires onDisplayEnded once when every display track ends, without closing the context', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const first = new FakeTrack();
    const second = new FakeTrack();
    const input = new AudioInput({ displayStream: asMediaStream(new FakeStream([first, second])) });
    const onEnded = vi.fn();
    input.onDisplayEnded(onEnded);

    first.dispatch('ended');
    expect(onEnded).not.toHaveBeenCalled();
    expect(input.displayActive).toBe(true);

    second.dispatch('ended');
    expect(onEnded).toHaveBeenCalledOnce();
    expect(input.displayActive).toBe(false);
    expect(lastContext().closeCalls).toBe(0);
    expect(lastContext().sources[0].disconnect).toHaveBeenCalled();

    second.dispatch('ended');
    expect(onEnded).toHaveBeenCalledOnce();
  });

  it('stops notifying a callback after its unsubscribe function runs', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const track = new FakeTrack();
    const input = new AudioInput({ displayStream: asMediaStream(new FakeStream([track])) });
    const onEnded = vi.fn();
    const unsubscribe = input.onDisplayEnded(onEnded);
    unsubscribe();

    track.dispatch('ended');
    expect(onEnded).not.toHaveBeenCalled();
    expect(input.displayActive).toBe(false);
  });

  it('replaceDisplay attaches a new display source and releases the old tracks', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const oldTrack = new FakeTrack();
    const input = new AudioInput({ displayStream: asMediaStream(new FakeStream([oldTrack])) });
    oldTrack.dispatch('ended');
    expect(input.displayActive).toBe(false);

    const newTrack = new FakeTrack();
    const newStream = new FakeStream([newTrack]);
    const onEnded = vi.fn();
    input.onDisplayEnded(onEnded);
    input.replaceDisplay(asMediaStream(newStream));

    expect(input.displayActive).toBe(true);
    const ctx = lastContext();
    expect(ctx.sources.at(-1)?.stream).toBe(asMediaStream(newStream));

    newTrack.dispatch('ended');
    expect(onEnded).toHaveBeenCalledOnce();
    expect(input.displayActive).toBe(false);
  });

  it('replaceDisplay releases the previous display tracks that are still live', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const oldTrack = new FakeTrack();
    const input = new AudioInput({ displayStream: asMediaStream(new FakeStream([oldTrack])) });

    input.replaceDisplay(asMediaStream(new FakeStream([new FakeTrack()])));
    expect(oldTrack.stop).toHaveBeenCalledOnce();
    expect(input.displayActive).toBe(true);
  });

  it('dispose also stops the kept-alive video track of a display capture', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const audio = new FakeTrack('audio');
    const video = new FakeTrack('video');
    const input = new AudioInput({ displayStream: asMediaStream(new FakeStream([video, audio])) });

    input.dispose();
    expect(video.stop).toHaveBeenCalledOnce();
    expect(audio.stop).toHaveBeenCalledOnce();
  });

  it('dispose stops each raw track exactly once and is idempotent', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const mic = new FakeTrack();
    const display = new FakeTrack();
    const input = new AudioInput({
      micStream: asMediaStream(new FakeStream([mic])),
      displayStream: asMediaStream(new FakeStream([display])),
    });
    const ctx = lastContext();

    input.dispose();
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(display.stop).toHaveBeenCalledOnce();
    expect(ctx.destinationTrack.stop).toHaveBeenCalledOnce();
    expect(ctx.closeCalls).toBe(1);

    input.dispose();
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(display.stop).toHaveBeenCalledOnce();
    expect(ctx.destinationTrack.stop).toHaveBeenCalledOnce();
    expect(ctx.closeCalls).toBe(1);
  });

  it('levels reports the live display level and drops to 0 once the display ends', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const track = new FakeTrack();
    const input = new AudioInput({ displayStream: asMediaStream(new FakeStream([track])) });
    lastContext().analysers[0].sample = 255;

    expect(input.levels().display).toBeGreaterThan(0.9);
    expect(input.levels().mic).toBe(0);

    track.dispatch('ended');
    expect(input.levels()).toEqual({ mic: 0, display: 0 });
  });
});
