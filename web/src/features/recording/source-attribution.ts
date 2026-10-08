import { isSourceSpeakerLabel, SOURCE_SPEAKER_LABELS, type SourceSpeakerLabel } from '@/shared/transcription';

/** Analyser level (0..1 RMS) above which a source counts as carrying speech. */
export const SOURCE_ACTIVE_LEVEL = 0.02;
/** One source must account for at least this share of the active time to own a caption. */
export const SOURCE_DOMINANCE = 0.65;
const MAX_TICKS = 120_000;

/**
 * Remembers which audio source (microphone or shared screen) was loud when, so a caption
 * covering a time range can be labelled "Tôi" or "Cuộc họp" without any diarization.
 */
export class SourceActivityTracker {
  private times: number[] = [];
  private micActive: boolean[] = [];
  private displayActive: boolean[] = [];

  /** Records one level sample; `ms` is milliseconds since the recording started and must not decrease. */
  record(ms: number, mic: number, display: number): void {
    this.times.push(ms);
    this.micActive.push(mic >= SOURCE_ACTIVE_LEVEL);
    this.displayActive.push(display >= SOURCE_ACTIVE_LEVEL);
    if (this.times.length > MAX_TICKS) {
      const drop = this.times.length - MAX_TICKS;
      this.times.splice(0, drop);
      this.micActive.splice(0, drop);
      this.displayActive.splice(0, drop);
    }
  }

  /** The dominant source over [startMs, endMs], or undefined when it is unclear or silent. */
  attribute(startMs: number, endMs: number): SourceSpeakerLabel | undefined {
    if (!(endMs > startMs) || this.times.length === 0) return undefined;
    let mic = 0;
    let display = 0;
    for (let index = this.firstAtOrAfter(startMs); index < this.times.length && this.times[index] <= endMs; index++) {
      if (this.micActive[index]) mic++;
      if (this.displayActive[index]) display++;
    }
    const total = mic + display;
    if (total === 0) return undefined;
    if (mic / total >= SOURCE_DOMINANCE) return SOURCE_SPEAKER_LABELS.mic;
    if (display / total >= SOURCE_DOMINANCE) return SOURCE_SPEAKER_LABELS.display;
    return undefined;
  }

  private firstAtOrAfter(ms: number): number {
    let low = 0;
    let high = this.times.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.times[mid] < ms) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}

/**
 * Provider diarization labels win for meeting participants; the microphone always means the user.
 * A caption with no clear source keeps whatever the provider said.
 */
export function chooseSpeakerLabel(providerLabel: string | undefined, source: SourceSpeakerLabel | undefined): string | undefined {
  if (source === SOURCE_SPEAKER_LABELS.mic) return source;
  if (providerLabel && !isSourceSpeakerLabel(providerLabel)) return providerLabel;
  return source ?? providerLabel;
}
