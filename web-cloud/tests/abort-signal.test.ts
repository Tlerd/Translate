import { afterEach, describe, expect, it, vi } from 'vitest';
import { signalWithTimeout } from '@/shared/abort-signal';

describe('signalWithTimeout fallback (iOS WebKit < 17.4)', () => {
  const original = (AbortSignal as unknown as { any?: unknown }).any;
  afterEach(() => {
    (AbortSignal as unknown as { any?: unknown }).any = original;
    vi.useRealTimers();
  });

  it('works without AbortSignal.any and aborts on timeout', () => {
    (AbortSignal as unknown as { any?: unknown }).any = undefined;
    vi.useFakeTimers();
    const signal = signalWithTimeout(new AbortController().signal, 1000);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(signal.aborted).toBe(true);
  });

  it('follows the caller signal without AbortSignal.any', () => {
    (AbortSignal as unknown as { any?: unknown }).any = undefined;
    const caller = new AbortController();
    const signal = signalWithTimeout(caller.signal, 60_000);
    caller.abort('stop');
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('stop');
  });

  it('is already aborted when the caller signal is aborted', () => {
    (AbortSignal as unknown as { any?: unknown }).any = undefined;
    const caller = new AbortController(); caller.abort();
    expect(signalWithTimeout(caller.signal, 60_000).aborted).toBe(true);
  });
});
