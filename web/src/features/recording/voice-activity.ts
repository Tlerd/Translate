/** Fixed RMS above which audio is always treated as speech (noisy rooms). */
export const MAX_VOICE_RMS = 0.015;
/** Lowest RMS ever treated as speech; below this is electrical/room noise. */
export const MIN_VOICE_RMS = 0.004;

export function chunkRms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let power = 0;
  for (let i = 0; i < samples.length; i++) power += samples[i] * samples[i];
  return Math.sqrt(power / samples.length);
}

/**
 * Speech gate that follows the microphone's noise floor. A fixed 0.015 gate
 * silently drops quiet laptop/phone microphones, so nothing reaches the
 * recognizer and no text ever appears. The threshold here only ever sits at or
 * below that old value: three times the learned noise floor, clamped.
 */
export class AdaptiveVoiceDetector {
  private noiseFloor = 0.002;

  get threshold(): number {
    return Math.min(MAX_VOICE_RMS, Math.max(MIN_VOICE_RMS, this.noiseFloor * 3));
  }

  /** Classifies one chunk and learns the noise floor from non-speech chunks. */
  isVoice(rms: number): boolean {
    const voice = rms >= this.threshold;
    if (!voice) {
      // Fall fast toward quieter noise, rise slowly so speech never becomes "noise".
      this.noiseFloor += (rms - this.noiseFloor) * (rms < this.noiseFloor ? 0.2 : 0.01);
    }
    return voice;
  }

  reset(): void {
    this.noiseFloor = 0.002;
  }
}
