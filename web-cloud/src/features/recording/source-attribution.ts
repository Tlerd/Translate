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

export type ActiveSource = 'mic' | 'display';

/** Which source a level sample belongs to. With headphones the microphone only hears the user. */
export function sourceOfTick(mic: number, display: number): ActiveSource | null {
  const micActive = mic >= SOURCE_ACTIVE_LEVEL;
  const displayActive = display >= SOURCE_ACTIVE_LEVEL;
  if (micActive && displayActive) return mic >= display * MIC_OVERLAP_RATIO ? 'mic' : 'display';
  if (micActive) return 'mic';
  if (displayActive) return 'display';
  return null;
}

/** When both are active, the microphone wins unless the shared audio is far louder (speaker echo). */
export const MIC_OVERLAP_RATIO = 0.6;
/** Consecutive 100 ms samples a new source must hold before a caption is cut. */
export const CUT_CONFIRM_TICKS = 3;
/** Minimum samples between two cuts so a noisy overlap cannot shred captions. */
export const CUT_MIN_GAP_TICKS = 15;

/**
 * Decides when the speaker changes between the user (microphone) and the meeting (shared
 * audio) so the current caption can be closed and the next voice starts its own box.
 */
export class SourceCutDetector {
  private confirmed: ActiveSource | null = null;
  private candidate: ActiveSource | null = null;
  private streak = 0;
  private sinceCut = CUT_MIN_GAP_TICKS;

  /** Feed one level sample; returns true when the current caption should be closed now. */
  observe(mic: number, display: number): boolean {
    this.sinceCut++;
    const source = sourceOfTick(mic, display);
    // Silence keeps the last confirmed source so a pause does not look like a change.
    if (source === null) {
      this.candidate = null;
      this.streak = 0;
      return false;
    }
    if (source === this.candidate) this.streak++;
    else {
      this.candidate = source;
      this.streak = 1;
    }
    if (this.streak < CUT_CONFIRM_TICKS || source === this.confirmed) return false;
    const previous = this.confirmed;
    this.confirmed = source;
    if (previous === null || this.sinceCut < CUT_MIN_GAP_TICKS) return false;
    this.sinceCut = 0;
    return true;
  }
}
