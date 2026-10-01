import type { SpeechRecognitionCallbacks } from './speech-recognition';
import { Pcm16kResampler, floatToPcm16 } from './pcm-resampler';
import { isAllowedSpeakerLabel, type SpeakerCount, type TranscriptionMode, type TranscriptionTurn } from '@/shared/transcription';

/** Unary transcription: ordered WAV segments, never a live WebSocket session. */
export class GeminiTranscribeRecognizer {
  private epoch = 0;
  private sequence = 0;
  private processedSamples = 0;
  private running = false;
  private resampler: Pcm16kResampler | null = null;
  private samples: Float32Array[] = [];
  private sampleCount = 0;
  private silenceSamples = 0;
  private queuedSamples = 0;
  private failed = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private callbacks: SpeechRecognitionCallbacks, private language: string, private pauseMs = 900,
    private transcriptionMode: TranscriptionMode = 'verbatim', private speakerCount: SpeakerCount = 1,
  ) {}

  updateSettings(settings: { pauseMs?: number; transcriptionMode?: TranscriptionMode; speakerCount?: SpeakerCount }): void {
    if ((settings.transcriptionMode !== undefined && settings.transcriptionMode !== this.transcriptionMode) ||
        (settings.speakerCount !== undefined && settings.speakerCount !== this.speakerCount)) this.finalizeUtterance();
    if (settings.pauseMs !== undefined) this.pauseMs = settings.pauseMs;
    if (settings.transcriptionMode !== undefined) this.transcriptionMode = settings.transcriptionMode;
    if (settings.speakerCount !== undefined) this.speakerCount = settings.speakerCount;
  }

  start(epoch: number): void {
    this.epoch = epoch;
    this.running = true;
    this.callbacks.onStateChange('listening');
  }

  pushPcm(input: Float32Array, rate: number): void {
    if (!this.running || this.failed) return;
    this.resampler ??= new Pcm16kResampler(rate);
    const samples = this.resampler.push(input);
    this.append(samples);
    let power = 0;
    for (const sample of samples) power += sample * sample;
    this.silenceSamples = samples.length && Math.sqrt(power / samples.length) < 0.015
      ? this.silenceSamples + samples.length : 0;
    // A maximum of 15 seconds bounds request size and latency during continuous speech.
    if (this.sampleCount >= 15 * 16000 || (this.sampleCount >= 16000 && this.silenceSamples >= this.pauseMs * 16)) this.finalizeUtterance();
  }

  private append(samples: Float32Array): void {
    if (!samples.length) return;
    this.samples.push(samples);
    this.sampleCount += samples.length;
  }

  finalizeUtterance(): void {
    if (!this.sampleCount) return;
    const count = this.sampleCount;
    const pcm = new Float32Array(count);
    let offset = 0;
    for (const samples of this.samples) { pcm.set(samples, offset); offset += samples.length; }
    this.samples = []; this.sampleCount = 0; this.silenceSamples = 0;
    const sequence = ++this.sequence;
    const id = `transcribe_${this.epoch}_${sequence}`;
    const timing = { startMs: this.processedSamples / 16, endMs: (this.processedSamples + count) / 16 };
    const transcriptionMode = this.transcriptionMode;
    const speakerCount = this.speakerCount;
    this.processedSamples += count;
    this.queuedSamples += count;
    if (this.queuedSamples > 120 * 16000) {
      this.failed = true;
      this.callbacks.onError('Nhận giọng theo đoạn chậm hơn thu âm quá 2 phút. Dừng nhận giọng; audio vẫn lưu trên máy để xử lý lại.', this.epoch);
    }
    this.chain = this.chain.then(async () => {
      try {
        const form = new FormData();
        form.set('audio', pcmWav(pcm), `${id}.wav`);
        form.set('durationMs', String(Math.ceil(count / 16)));
        form.set('language', this.language);
        form.set('transcriptionMode', transcriptionMode);
        form.set('speakerCount', String(speakerCount));
        const response = await fetch('/api/speech/transcribe', { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
        const result = await response.json();
        if (!response.ok || typeof result.text !== 'string') throw new Error(result.error?.message ?? `HTTP ${response.status}`);
        const candidates: TranscriptionTurn[] = transcriptionMode === 'verbatim' && Array.isArray(result.turns) ? result.turns : [];
        const turns = candidates.every(turn => turn && typeof turn.text === 'string' && turn.text.trim() && Number.isFinite(turn.startMs) && Number.isFinite(turn.endMs) && turn.startMs >= 0 && turn.startMs <= count / 16 && turn.endMs >= turn.startMs && turn.endMs <= count / 16 + 1000) ? candidates : [];
        if (turns.length) {
          for (const [index, turn] of turns.entries()) {
            this.callbacks.onTranscript(turn.text, true, this.epoch, `${id}_speaker_${index + 1}`, 1, {
              startMs: timing.startMs + turn.startMs,
              endMs: Math.min(timing.endMs, timing.startMs + turn.endMs),
              ...(turn.speakerLabel && isAllowedSpeakerLabel(turn.speakerLabel, speakerCount) ? { speakerLabel: turn.speakerLabel } : {}),
            });
          }
        } else if (result.text.trim()) this.callbacks.onTranscript(result.text, true, this.epoch, id, 1, timing);
      } catch (error) {
        this.callbacks.onError(`Không nhận được chữ cho đoạn ${sequence}: ${error instanceof Error ? error.message : String(error)}. Audio vẫn được lưu trên máy.`, this.epoch);
      } finally { this.queuedSamples -= count; }
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.resampler) this.append(this.resampler.flush());
    this.finalizeUtterance();
    await this.chain;
    this.callbacks.onStateChange('stopped');
  }
}

export function pcmWav(samples: Float32Array): Blob {
  const pcm = floatToPcm16(samples);
  const bytes = new Uint8Array(44 + pcm.length);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, pcm.length, true); bytes.set(pcm, 44);
  return new Blob([bytes], { type: 'audio/wav' });
}
