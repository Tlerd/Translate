import { describe, expect, it } from 'vitest';
import {
  FINALIZE_LATENCY_STALE_MS,
  FinalizeLatencyTracker,
  GEMINI_HARD_MAX_UTTERANCE_MS,
  GEMINI_SOFT_MAX_UTTERANCE_MS,
  UtteranceCutter,
} from '@/features/recording/utterance-cutter';

const CHUNK = 100;

describe('UtteranceCutter', () => {
  it('never closes before the soft maximum, even at a deep dip', () => {
    const cutter = new UtteranceCutter();
    for (let t = 0; t < GEMINI_SOFT_MAX_UTTERANCE_MS; t += CHUNK) {
      expect(cutter.observe(t, t % 1000 === 0 ? 0.001 : 0.1, CHUNK, t % 1000 !== 0)).toBe(false);
    }
  });

  it('keeps going through loud audio after the soft maximum and closes at the next dip', () => {
    const cutter = new UtteranceCutter();
    let t = 0;
    for (; t <= GEMINI_SOFT_MAX_UTTERANCE_MS + 1000; t += CHUNK) expect(cutter.observe(t, 0.1, CHUNK, true)).toBe(false);
    expect(cutter.observe(t, 0.1 * 0.8, CHUNK, true)).toBe(false);
    expect(cutter.observe(t + CHUNK, 0.1 * 0.3, CHUNK, true)).toBe(true);
  });

  it('closes on a chunk below the voice gate once past the soft maximum', () => {
    const cutter = new UtteranceCutter();
    for (let t = 0; t < GEMINI_SOFT_MAX_UTTERANCE_MS; t += CHUNK) cutter.observe(t, 0.1, CHUNK, true);
    expect(cutter.observe(GEMINI_SOFT_MAX_UTTERANCE_MS, 0.001, CHUNK, false)).toBe(true);
  });

  it('closes at the hard cap when the audio never dips', () => {
    const cutter = new UtteranceCutter();
    let closedAt = -1;
    for (let t = 0; t <= GEMINI_HARD_MAX_UTTERANCE_MS + 1000 && closedAt < 0; t += CHUNK) {
      if (cutter.observe(t, 0.1, CHUNK, true)) closedAt = t;
    }
    expect(closedAt).toBe(GEMINI_HARD_MAX_UTTERANCE_MS);
  });

  it('starts a fresh utterance after a close', () => {
    const cutter = new UtteranceCutter();
    let t = 0;
    for (; !cutter.observe(t, 0.1, CHUNK, true); t += CHUNK);
    expect(cutter.isOpen).toBe(false);
    const reopenedAt = t + CHUNK;
    for (let u = reopenedAt; u < reopenedAt + GEMINI_SOFT_MAX_UTTERANCE_MS; u += CHUNK) {
      expect(cutter.observe(u, u % 500 === 0 ? 0.01 : 0.1, CHUNK, true)).toBe(false);
    }
  });

  it('does not close right after a long silence when voice returns', () => {
    const cutter = new UtteranceCutter();
    for (let t = 0; t < 2000; t += CHUNK) cutter.observe(t, 0.1, CHUNK, true);
    cutter.reset();
    for (let t = 2000; t < 120_000; t += CHUNK) expect(cutter.observe(t, 0.001, CHUNK, false)).toBe(false);
    expect(cutter.observe(120_000, 0.1, CHUNK, true)).toBe(false);
    expect(cutter.observe(120_100, 0.01, CHUNK, true)).toBe(false);
  });

  it('treats a long voice gap as a new utterance even without an explicit reset', () => {
    const cutter = new UtteranceCutter();
    for (let t = 0; t < 2000; t += CHUNK) cutter.observe(t, 0.1, CHUNK, true);
    expect(cutter.observe(300_000, 0.1, CHUNK, true)).toBe(false);
    expect(cutter.observe(300_100, 0.001, CHUNK, false)).toBe(false);
  });
});

describe('FinalizeLatencyTracker', () => {
  it('measures a request against the final that answers it', () => {
    const tracker = new FinalizeLatencyTracker();
    tracker.noteTranscript('hello', false);
    tracker.request(1000);
    tracker.noteTranscript('hello world', true);
    expect(tracker.complete(1700)).toBe(700);
    expect(tracker.complete(1800)).toBeNull();
  });

  it('ignores a request when nothing is pending', () => {
    const tracker = new FinalizeLatencyTracker();
    tracker.noteTranscript('hello', false);
    tracker.noteTranscript('hello', true); // provider's own VAD already finalized
    tracker.request(1000);
    tracker.noteTranscript('later', false);
    tracker.noteTranscript('later', true);
    expect(tracker.complete(9000)).toBeNull();
  });

  it('ignores empty interim text', () => {
    const tracker = new FinalizeLatencyTracker();
    tracker.noteTranscript('  ', false);
    tracker.request(1000);
    expect(tracker.complete(1500)).toBeNull();
  });

  it('drops a request that was not answered in time', () => {
    const tracker = new FinalizeLatencyTracker();
    tracker.noteTranscript('hello', false);
    tracker.request(0);
    tracker.noteTranscript('next', false);
    expect(tracker.complete(FINALIZE_LATENCY_STALE_MS + 1)).toBeNull();
    tracker.request(FINALIZE_LATENCY_STALE_MS + 2);
    expect(tracker.complete(FINALIZE_LATENCY_STALE_MS + 502)).toBe(500);
  });

  it('keeps the first request while one is pending', () => {
    const tracker = new FinalizeLatencyTracker();
    tracker.noteTranscript('hello', false);
    tracker.request(1000);
    tracker.request(1600);
    expect(tracker.complete(2000)).toBe(1000);
  });
});
