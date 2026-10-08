/**
 * Display/tab audio capture (getDisplayMedia) and optional mixing with the microphone.
 *
 * AudioInput is the single owner of the raw capture tracks. Its `stream` is the only
 * stream that may feed MediaRecorder, PCM capture or speech recognition.
 */

import type { AudioSource } from '@/shared/recording';

export type { AudioSource };
export type DisplayCaptureErrorCode = 'unsupported' | 'cancelled' | 'no-audio' | 'failed';

const UNSUPPORTED_MESSAGE = 'Trình duyệt hoặc thiết bị này không hỗ trợ ghi âm thanh màn hình. Hãy dùng Chrome hoặc Edge trên máy tính.';
const CANCELLED_MESSAGE = 'Bạn đã hủy chia sẻ màn hình.';
const NO_AUDIO_MESSAGE = "Chưa bật chia sẻ âm thanh. Hãy chọn lại tab Meet/Discord và bật công tắc 'Chia sẻ âm thanh của thẻ' (hoặc chia sẻ cả màn hình kèm âm thanh hệ thống trên Windows).";
const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod/i;
const DEFAULT_MIC_GAIN = 1;
const DEFAULT_DISPLAY_GAIN = 0.8;
const ANALYSER_FFT_SIZE = 512;

export class DisplayCaptureError extends Error {
  constructor(public readonly code: DisplayCaptureErrorCode, message: string) {
    super(message);
    this.name = 'DisplayCaptureError';
  }
}

export function canCaptureDisplayAudio(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') return false;
  return !MOBILE_USER_AGENT.test(navigator.userAgent ?? '');
}

function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string' ? err.name : '';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stopAllTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export async function requestDisplayAudio(): Promise<MediaStream> {
  if (!canCaptureDisplayAudio()) {
    throw new DisplayCaptureError('unsupported', UNSUPPORTED_MESSAGE);
  }

  // Must stay the first call in the click handler: nothing is awaited before getDisplayMedia.
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    } as unknown as DisplayMediaStreamOptions);
  } catch (err) {
    const name = errorName(err);
    if (name === 'NotAllowedError' || name === 'AbortError') {
      throw new DisplayCaptureError('cancelled', CANCELLED_MESSAGE);
    }
    throw new DisplayCaptureError('failed', errorMessage(err));
  }

  if (stream.getAudioTracks().length === 0) {
    stopAllTracks(stream);
    throw new DisplayCaptureError('no-audio', NO_AUDIO_MESSAGE);
  }

  // The video track stays alive at 1 fps on purpose: stopping it can end the whole capture
  // session in some Chrome versions. It is never mixed in, and AudioInput.dispose() stops it.
  return stream;
}

export interface AudioInputOptions {
  micStream?: MediaStream;
  displayStream?: MediaStream;
  micGain?: number;
  displayGain?: number;
}

interface SourceChain {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
}

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export class AudioInput {
  private readonly audioCtx: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly micGain: number;
  private readonly displayGain: number;
  private readonly micConfigured: boolean;
  private displayConfigured: boolean;
  private readonly ownedTracks = new Set<MediaStreamTrack>();
  private readonly displayEndedListeners = new Set<() => void>();
  private mic: SourceChain | null = null;
  private display: SourceChain | null = null;
  private disposed = false;

  constructor(options: AudioInputOptions) {
    const { micStream, displayStream } = options;
    if (!micStream && !displayStream) {
      throw new Error('Cần ít nhất một luồng âm thanh (micro hoặc màn hình).');
    }

    this.micGain = options.micGain ?? DEFAULT_MIC_GAIN;
    this.displayGain = options.displayGain ?? DEFAULT_DISPLAY_GAIN;
    this.micConfigured = !!micStream;
    this.displayConfigured = !!displayStream;

    // Ownership starts here so that a failure below releases the raw tracks.
    if (micStream) this.own(micStream);
    if (displayStream) this.own(displayStream);

    try {
      const AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) throw new Error('Trình duyệt không hỗ trợ Web Audio.');

      this.audioCtx = new AudioContextCtor();
      this.destination = this.audioCtx.createMediaStreamDestination();
      this.compressor = this.audioCtx.createDynamicsCompressor();
      this.compressor.connect(this.destination);

      if (micStream) this.mic = this.attach(micStream, this.micGain);
      if (displayStream) {
        const chain = this.attach(displayStream, this.displayGain);
        this.display = chain;
        this.watchDisplayEnd(chain);
      }
    } catch (err) {
      this.releaseOwnedTracks();
      throw err;
    }
  }

  /** The only stream that downstream recorders and PCM capture may consume. */
  get stream(): MediaStream {
    return this.destination.stream;
  }

  get context(): AudioContext {
    return this.audioCtx;
  }

  get displayActive(): boolean {
    return this.display !== null;
  }

  get label(): string {
    if (this.micConfigured && this.displayConfigured) return 'Micro + âm thanh màn hình';
    return this.micConfigured ? 'Micro' : 'Âm thanh màn hình';
  }

  levels(): { mic: number; display: number } {
    return { mic: this.measure(this.mic), display: this.measure(this.display) };
  }

  onDisplayEnded(callback: () => void): () => void {
    this.displayEndedListeners.add(callback);
    return () => {
      this.displayEndedListeners.delete(callback);
    };
  }

  replaceDisplay(stream: MediaStream): void {
    if (this.disposed) {
      stopAllTracks(stream);
      throw new Error('AudioInput đã được giải phóng.');
    }
    if (stream.getAudioTracks().length === 0) {
      stopAllTracks(stream);
      throw new Error('Luồng chia sẻ mới không có âm thanh.');
    }

    const previous = this.display;
    if (previous) {
      this.display = null;
      this.disconnect(previous);
      this.releaseStream(previous.stream);
    }

    this.displayConfigured = true;
    this.own(stream);
    const chain = this.attach(stream, this.displayGain);
    this.display = chain;
    this.watchDisplayEnd(chain);
  }

  async resume(): Promise<void> {
    if (!this.disposed && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const chain of [this.mic, this.display]) {
      if (chain) this.disconnect(chain);
    }
    this.mic = null;
    this.display = null;
    this.displayEndedListeners.clear();

    this.releaseOwnedTracks();
    for (const track of this.destination.stream.getTracks()) track.stop();

    try {
      this.compressor.disconnect();
      this.destination.disconnect();
    } catch {
      // ignore
    }
    try {
      this.audioCtx.close().catch(() => undefined);
    } catch {
      // ignore
    }
  }

  private own(stream: MediaStream): void {
    for (const track of stream.getTracks()) this.ownedTracks.add(track);
  }

  private releaseTrack(track: MediaStreamTrack): void {
    if (this.ownedTracks.delete(track)) track.stop();
  }

  private releaseStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) this.releaseTrack(track);
  }

  private releaseOwnedTracks(): void {
    for (const track of [...this.ownedTracks]) this.releaseTrack(track);
  }

  private attach(stream: MediaStream, gainValue: number): SourceChain {
    const source = this.audioCtx.createMediaStreamSource(stream);
    const gain = this.audioCtx.createGain();
    gain.gain.value = gainValue;
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    source.connect(gain);
    gain.connect(this.compressor);
    source.connect(analyser);
    return { stream, source, gain, analyser };
  }

  private disconnect(chain: SourceChain): void {
    chain.source.disconnect();
    chain.gain.disconnect();
    chain.analyser.disconnect();
  }

  private watchDisplayEnd(chain: SourceChain): void {
    const tracks = chain.stream.getAudioTracks();
    const ended = new Set<MediaStreamTrack>();
    for (const track of tracks) {
      track.addEventListener('ended', () => {
        ended.add(track);
        if (ended.size === tracks.length) this.handleDisplayEnded(chain);
      });
    }
  }

  private handleDisplayEnded(chain: SourceChain): void {
    // Ignore events from a display stream that has already been replaced or released.
    if (this.display !== chain) return;
    this.display = null;
    this.disconnect(chain);
    this.releaseStream(chain.stream);
    for (const callback of [...this.displayEndedListeners]) callback();
  }

  private measure(chain: SourceChain | null): number {
    if (!chain) return 0;
    const data = new Uint8Array(chain.analyser.fftSize);
    chain.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const amplitude = (data[i] - 128) / 128;
      sum += amplitude * amplitude;
    }
    return Math.min(1.0, Math.sqrt(sum / data.length));
  }
}
