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
  onTranscript: (text: string, isFinal: boolean, epoch: number) => void;
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
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = this.lang;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        if (epoch !== this.currentEpoch) {
          recognition.abort();
          return;
        }
        this.isRunning = true;
        this.callbacks.onStateChange('listening');
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        if (epoch !== this.currentEpoch) return;

        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const transcript = res[0]?.transcript || '';
          if (res.isFinal) {
            this.callbacks.onTranscript(transcript.trim(), true, epoch);
          } else {
            interimText += transcript;
          }
        }
        if (interimText.trim()) {
          this.callbacks.onTranscript(interimText.trim(), false, epoch);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (epoch !== this.currentEpoch) return;
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
        this.isRunning = false;
        if (epoch !== this.currentEpoch || !this.shouldRestart) {
          this.callbacks.onStateChange('stopped');
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

  public stop(): void {
    this.shouldRestart = false;
    this.currentEpoch++; // advance epoch to invalidate any pending callbacks
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        try {
          this.recognition.abort();
        } catch {
          // ignore
        }
      }
      this.recognition = null;
    }
    this.isRunning = false;
    this.callbacks.onStateChange('stopped');
  }
}
