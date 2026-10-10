/** After this long an open Gemini utterance may be closed at the next quiet moment. */
export const GEMINI_SOFT_MAX_UTTERANCE_MS = 6000;
/** An open Gemini utterance is closed after this long even if the audio never dips. */
export const GEMINI_HARD_MAX_UTTERANCE_MS = 10_000;
/** A chunk quieter than this fraction of the recent speech level counts as a dip. */
export const DIP_RATIO = 0.6;
/** Time constant of the running speech level. */
const LEVEL_TIME_CONSTANT_MS = 1000;
/** A gap this long without voice means the previous utterance is over. */
const VOICE_GAP_RESET_MS = 2000;

/**
 * Decides when to force-close a Gemini Live utterance that never pauses
 * (music, video, meetings with overlapping talk). Gemini only closes on its own
 * VAD, so continuous sound would keep one caption open for 10+ seconds.
 *
 * Dip rule: after the soft maximum, close at the first chunk whose RMS is below
 * 0.6x the exponential moving average of the utterance's RMS (or that is below
 * the voice gate). The average adapts to loud and quiet sources alike, so no
 * absolute level has to be guessed, and a dip is where a cut is least likely to
 * slice through a word. The hard maximum closes regardless of level.
 */
export class UtteranceCutter {
  private openedAt: number | null = null;
  private lastVoiceAt = 0;
  private level = 0;

  /** Feed every chunk while the provider is Gemini Live; returns true when the utterance should be closed now. */
  observe(nowMs: number, rms: number, chunkMs: number, isVoice: boolean): boolean {
    if (this.openedAt !== null && isVoice && nowMs - this.lastVoiceAt > VOICE_GAP_RESET_MS) this.reset();
    if (this.openedAt === null) {
      if (!isVoice) return false;
      this.openedAt = nowMs;
      this.level = rms;
    }
    if (isVoice) this.lastVoiceAt = nowMs;
    const openMs = nowMs - this.openedAt;
    const dip = !isVoice || rms < DIP_RATIO * this.level;
    if (!dip) {
      const alpha = 1 - Math.exp(-Math.max(chunkMs, 1) / LEVEL_TIME_CONSTANT_MS);
      this.level += (rms - this.level) * alpha;
    }
    if (openMs >= GEMINI_HARD_MAX_UTTERANCE_MS || (openMs >= GEMINI_SOFT_MAX_UTTERANCE_MS && dip)) {
      this.reset();
      return true;
    }
    return false;
  }

  /** The utterance ended (silence close, provider final, pause, source change); the next voice chunk opens a new one. */
  reset(): void {
    this.openedAt = null;
    this.level = 0;
    this.lastVoiceAt = 0;
  }

  get isOpen(): boolean {
    return this.openedAt !== null;
  }
}

/** A finalize request not answered within this long is dropped rather than measured. */
export const FINALIZE_LATENCY_STALE_MS = 20_000;

/**
 * Measures request-to-final latency honestly: a measurement only starts when an
 * open utterance has text that no final has covered yet, so a request with
 * nothing pending (Gemini already finalized, source-switch cut on silence)
 * can never be matched with a much later final.
 */
export class FinalizeLatencyTracker {
  private pendingText = false;
  private requestedAt: number | null = null;

  /** A transcript arrived; non-empty interim text means an utterance is open and unfinalized. */
  noteTranscript(text: string, isFinal: boolean): void {
    if (isFinal) this.pendingText = false;
    else if (text.trim()) this.pendingText = true;
  }

  /** Call when a close is sent to the provider. */
  request(nowMs: number): void {
    if (this.requestedAt !== null && nowMs - this.requestedAt > FINALIZE_LATENCY_STALE_MS) this.requestedAt = null;
    if (!this.pendingText || this.requestedAt !== null) return;
    this.requestedAt = nowMs;
  }

  /** Call when a final arrives (after noteTranscript); returns the latency to report, or null. */
  complete(nowMs: number): number | null {
    const requestedAt = this.requestedAt;
    this.requestedAt = null;
    if (requestedAt === null || nowMs - requestedAt > FINALIZE_LATENCY_STALE_MS) return null;
    return nowMs - requestedAt;
  }

  reset(): void {
    this.pendingText = false;
    this.requestedAt = null;
  }
}
