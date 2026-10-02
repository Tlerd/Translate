/**
 * Web Audio and MediaRecorder recorder that records chunks sequentially
 * and measures audio level using Web Audio AnalyserNode.
 */

export interface AudioRecorderCallbacks {
  onChunk: (blob: Blob, sequence: number, timestampMs: number, mimeType: string) => Promise<void> | void;
  onVolume: (volume: number) => void; // 0.0 to 1.0
  onError: (error: string) => void;
  onMicState?: (state: 'live' | 'muted' | 'ended' | 'suspended') => void;
  onMicInfo?: (label: string) => void;
}

export class WebAudioRecorder {
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private volumeIntervalId: ReturnType<typeof setInterval> | null = null;

  private sequence = 0;
  private startTime = 0;
  private mimeType = 'audio/webm';
  private callbacks: AudioRecorderCallbacks;
  private isRecording = false;
  private isStopping = false;
  private pendingChunkWrites = new Set<Promise<void>>();

  constructor(callbacks: AudioRecorderCallbacks) {
    this.callbacks = callbacks;
  }
  public get stream(): MediaStream | null { return this.mediaStream; }
  public async resume(): Promise<void> {
    if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
  }

  public static getBestSupportedMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return 'audio/webm';

    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/aac',
    ];

    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
    return '';
  }

  public async start(timesliceMs = 2000): Promise<string> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Trình duyệt không hỗ trợ thu âm từ micro.');
    }

    this.mimeType = WebAudioRecorder.getBestSupportedMimeType();
    if (!this.mimeType) {
      throw new Error('Trình duyệt không hỗ trợ định dạng ghi âm nào phù hợp.');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
        },
      });
      this.mediaStream = stream;
      this.callbacks.onMicInfo?.(stream.getAudioTracks?.()[0]?.label || 'Micro mặc định của hệ thống');
      for (const track of stream.getAudioTracks?.() ?? stream.getTracks()) {
        track.addEventListener?.('mute', () => this.callbacks.onMicState?.('muted'));
        track.addEventListener?.('unmute', () => this.callbacks.onMicState?.('live'));
        track.addEventListener?.('ended', () => { if (this.isRecording) this.callbacks.onMicState?.('ended'); });
      }
      this.callbacks.onMicState?.('live');

      // Audio analysis for volume level
      try {
        const AudioContextConstructor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioContextConstructor) {
          const audioCtx = new AudioContextConstructor();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          this.audioContext = audioCtx;
          this.analyser = analyser;
          audioCtx.onstatechange = () => { if (this.isRecording) this.callbacks.onMicState?.(audioCtx.state === 'running' ? 'live' : 'suspended'); };
          await audioCtx.resume();

          const dataArray = new Uint8Array(analyser.fftSize);
          this.volumeIntervalId = setInterval(() => {
            if (!this.analyser) return;
            this.analyser.getByteTimeDomainData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              const amplitude = (dataArray[i] - 128) / 128;
              sum += amplitude * amplitude;
            }
            const normalized = Math.min(1.0, Math.sqrt(sum / dataArray.length));
            this.callbacks.onVolume(normalized);
          }, 100);
        }
      } catch {
        // Volume metering is non-fatal
      }

      this.sequence = 0;
      this.pendingChunkWrites.clear();
      this.startTime = Date.now();
      this.isRecording = true;
      this.isStopping = false;

      const recorder = new MediaRecorder(stream, { mimeType: this.mimeType });
      recorder.ondataavailable = (event: BlobEvent) => {
        // MediaRecorder emits one last dataavailable event as part of stop().
        if ((!this.isRecording && !this.isStopping) || event.data.size === 0) return;
        const currentSeq = this.sequence++;
        const timestampMs = Date.now() - this.startTime;
        const write = Promise.resolve()
          .then(() => this.callbacks.onChunk(event.data, currentSeq, timestampMs, this.mimeType))
          .catch((err) => {
            this.callbacks.onError(`Lỗi ghi chunk âm thanh: ${err instanceof Error ? err.message : String(err)}`);
          });
        this.pendingChunkWrites.add(write);
        void write.finally(() => this.pendingChunkWrites.delete(write));
      };

      recorder.onerror = (e) => {
        this.callbacks.onError(`Lỗi MediaRecorder: ${e}`);
      };

      this.mediaRecorder = recorder;
      recorder.start(timesliceMs);

      return this.mimeType;
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  public async stop(): Promise<void> {
    this.isRecording = false;
    this.isStopping = true;

    if (this.volumeIntervalId) {
      clearInterval(this.volumeIntervalId);
      this.volumeIntervalId = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // ignore
      }
      this.audioContext = null;
    }

    const recorder = this.mediaRecorder;
    const stream = this.mediaStream;
    this.mediaRecorder = null;
    this.mediaStream = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(fallback);
            resolve();
          };
          const fallback = setTimeout(finish, 2000);
          recorder.addEventListener('stop', finish, { once: true });
          try {
            recorder.stop();
          } catch {
            finish();
          }
        });
      } catch {
        // ignore
      }
    }

    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    await Promise.all([...this.pendingChunkWrites]);
    this.isStopping = false;
  }
}
