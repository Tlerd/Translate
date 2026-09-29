/**
 * Web Audio and MediaRecorder recorder that records chunks sequentially
 * and measures audio level using Web Audio AnalyserNode.
 */

export interface AudioRecorderCallbacks {
  onChunk: (blob: Blob, sequence: number, timestampMs: number, mimeType: string) => Promise<void> | void;
  onVolume: (volume: number) => void; // 0.0 to 1.0
  onError: (error: string) => void;
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

  constructor(callbacks: AudioRecorderCallbacks) {
    this.callbacks = callbacks;
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
        },
      });
      this.mediaStream = stream;

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

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          this.volumeIntervalId = setInterval(() => {
            if (!this.analyser) return;
            this.analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            const normalized = Math.min(1.0, average / 128.0);
            this.callbacks.onVolume(normalized);
          }, 100);
        }
      } catch {
        // Volume metering is non-fatal
      }

      this.sequence = 0;
      this.startTime = Date.now();
      this.isRecording = true;

      const recorder = new MediaRecorder(stream, { mimeType: this.mimeType });
      recorder.ondataavailable = async (event: BlobEvent) => {
        if (!this.isRecording || event.data.size === 0) return;
        const currentSeq = this.sequence++;
        const timestampMs = Date.now() - this.startTime;
        try {
          await this.callbacks.onChunk(event.data, currentSeq, timestampMs, this.mimeType);
        } catch (err) {
          this.callbacks.onError(`Lỗi ghi chunk âm thanh: ${err instanceof Error ? err.message : String(err)}`);
        }
      };

      recorder.onerror = (e) => {
        this.callbacks.onError(`Lỗi MediaRecorder: ${e}`);
      };

      this.mediaRecorder = recorder;
      recorder.start(timesliceMs);

      return this.mimeType;
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  public stop(): void {
    this.isRecording = false;

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

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
      this.mediaRecorder = null;
    }

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
  }
}
