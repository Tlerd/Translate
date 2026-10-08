import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLongPress } from '@/features/library/long-press';

describe('createLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires after the default delay of 450 ms', () => {
    const onLongPress = vi.fn();
    const press = createLongPress({ onLongPress });

    press.start(100, 100);
    vi.advanceTimersByTime(449);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('respects a custom delay', () => {
    const onLongPress = vi.fn();
    const press = createLongPress({ delayMs: 200, onLongPress });

    press.start(0, 0);
    vi.advanceTimersByTime(200);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('is cancelled by a move beyond the tolerance', () => {
    const onLongPress = vi.fn();
    const press = createLongPress({ onLongPress });

    press.start(100, 100);
    press.move(100, 111);
    vi.advanceTimersByTime(1000);

    expect(onLongPress).not.toHaveBeenCalled();
    expect(press.end()).toBe(false);
  });

  it('still fires when the move stays within the tolerance', () => {
    const onLongPress = vi.fn();
    const press = createLongPress({ onLongPress });

    press.start(100, 100);
    press.move(106, 106);
    press.move(100, 108);
    vi.advanceTimersByTime(450);

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('end() before the delay cancels the press and returns false', () => {
    const onLongPress = vi.fn();
    const press = createLongPress({ onLongPress });

    press.start(0, 0);
    vi.advanceTimersByTime(300);
    expect(press.end()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('end() after the press fired returns true, then false on the next call', () => {
    const onLongPress = vi.fn();
    const press = createLongPress({ onLongPress });

    press.start(0, 0);
    vi.advanceTimersByTime(450);
    expect(press.end()).toBe(true);
    expect(press.end()).toBe(false);
  });

  it('fires only once per press', () => {
    const onLongPress = vi.fn();
    const press = createLongPress({ onLongPress });

    press.start(0, 0);
    vi.advanceTimersByTime(450);
    vi.advanceTimersByTime(5000);
    press.move(50, 50);
    press.end();

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('a new start() discards the previous timer and resets the fired state', () => {
    const onLongPress = vi.fn();
    const press = createLongPress({ onLongPress });

    press.start(0, 0);
    vi.advanceTimersByTime(450);
    press.start(0, 0);
    expect(press.end()).toBe(false);

    press.start(0, 0);
    vi.advanceTimersByTime(450);
    expect(onLongPress).toHaveBeenCalledTimes(2);
  });

  it('measures movement from the start point, not from the previous move', () => {
    const onLongPress = vi.fn();
    const press = createLongPress({ onLongPress });

    press.start(0, 0);
    press.move(8, 0);
    press.move(16, 0);
    vi.advanceTimersByTime(450);

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
