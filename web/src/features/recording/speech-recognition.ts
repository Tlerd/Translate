/**
 * Browser Speech Recognition wrapper using Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 * Strictly guards against late callbacks using sessionEpoch.
 */

// Define SpeechRecognition types for TypeScript
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface SpeechRecognitionCallbacks {
  onTranscript: (text: string, isFinal: boolean, epoch: number, providerItemId: string, revision: number, timing?: { startMs: number; endMs: number }) => void;
  onError: (error: string, epoch: number) => void;
  onStateChange: (state: 'idle' | 'listening' | 'reconnecting' | 'stopped') => void;
}

export class WebSpeechRecognizer {
  private recognition: SpeechRecognitionLike | null = null;
  private currentEpoch = 0;
  private isRunning = false;
  private shouldRestart = false;
  private lang = 'ja-JP';
  private callbacks: SpeechRecognitionCallbacks;
  private revisionsByResult = new Map<number, number>();
  private stopWaiter: (() => void) | null = null;
  private recognitionCounter = 0;
  private activeRecognitionId: number | null = null;

  constructor(callbacks: SpeechRecognitionCallbacks, lang = 'ja-JP') {
    this.callbacks = callbacks;
    this.lang = lang;
  }

  public static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  public start(epoch: number, lang?: string): void {
    if (lang) this.lang = lang;
    this.currentEpoch = epoch;
    this.revisionsByResult.clear();
    this.activeRecognitionId = null;
    this.shouldRestart = true;
    this.initAndStart(epoch);
  }

  private initAndStart(epoch: number): void {
    if (!WebSpeechRecognizer.isSupported()) {
      this.callbacks.onError('Trình duyệt không hỗ trợ Web Speech API.', epoch);
      return;
    }

    if (epoch !== this.currentEpoch) return;

    try {
      const RecognitionConstructor =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!RecognitionConstructor) return;

      const recognition = new RecognitionConstructor();
      const recognitionId = ++this.recognitionCounter;
      this.activeRecognitionId = recognitionId;
      this.revisionsByResult.clear();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = this.lang;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (epoch !== this.currentEpoch || recognitionId !== this.activeRecognitionId) {
          recognition.abort();
          return;
        }
        this.isRunning = true;
        this.callbacks.onStateChange('listening');
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        if (epoch !== this.currentEpoch || recognitionId !== this.activeRecognitionId) return;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const transcript = res[0]?.transcript || '';
          const revision = (this.revisionsByResult.get(i) || 0) + 1;
          this.revisionsByResult.set(i, revision);
          if (res.isFinal) {
            this.callbacks.onTranscript(transcript.trim(), true, epoch, `speech-${epoch}-${recognitionId}-${i}`, revision);
          } else {
            if (transcript.trim()) {
              this.callbacks.onTranscript(
                transcript.trim(),
                false,
                epoch,
                `speech-${epoch}-${recognitionId}-${i}`,
                revision
              );
            }
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (epoch !== this.currentEpoch || recognitionId !== this.activeRecognitionId) return;
        // Ignore aborted error if triggered by user stop
        if (event.error === 'aborted' && !this.shouldRestart) return;

        if (event.error === 'not-allowed') {
          this.shouldRestart = false;
          this.callbacks.onError('Quyền micro bị từ chối.', epoch);
        } else if (event.error === 'network') {
          this.callbacks.onError('Lỗi mạng nhận giọng.', epoch);
        } else {
          this.callbacks.onError(`Lỗi nhận giọng: ${event.error}`, epoch);
        }
      };

      recognition.onend = () => {
        if (recognitionId !== this.activeRecognitionId) return;
        this.activeRecognitionId = null;
        this.isRunning = false;
        if (epoch !== this.currentEpoch || !this.shouldRestart) {
          this.callbacks.onStateChange('stopped');
          if (epoch === this.currentEpoch) {
            this.currentEpoch++;
            this.stopWaiter?.();
            this.stopWaiter = null;
          }
          return;
        }

        // Auto-restart if session is still active
        this.callbacks.onStateChange('reconnecting');
        setTimeout(() => {
          if (this.shouldRestart && epoch === this.currentEpoch) {
            this.initAndStart(epoch);
          } else {
            this.callbacks.onStateChange('stopped');
          }
        }, 300);
      };

      this.recognition = recognition;
      recognition.start();
    } catch (err: unknown) {
      if (epoch === this.currentEpoch) {
        this.callbacks.onError(
          `Không thể khởi động nhận giọng: ${err instanceof Error ? err.message : String(err)}`,
          epoch
        );
      }
    }
  }

  public async stop(timeoutMs = 900): Promise<void> {
    this.shouldRestart = false;
    const recognition = this.recognition;
    if (!recognition) {
      this.currentEpoch++;
      this.recognition = null;
      this.isRunning = false;
      this.callbacks.onStateChange('stopped');
      return;
    }
    this.callbacks.onStateChange('stopped');
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.currentEpoch++;
        this.recognition = null;
        this.isRunning = false;
        this.stopWaiter = null;
        resolve();
      };
      const timeout = setTimeout(finish, timeoutMs);
      this.stopWaiter = finish;
      try {
        recognition.stop();
      } catch {
        try { recognition.abort(); } catch { /* ignore */ }
        finish();
      }
    });
  }
}
