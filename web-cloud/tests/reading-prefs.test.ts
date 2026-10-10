import { describe, expect, it } from 'vitest';
import {
  clampReadingScale,
  parseReadingDisplay,
  parseReadingScale,
  READING_SCALE_DEFAULT,
  READING_SCALE_MAX,
  READING_SCALE_MIN,
  stepReadingScale,
} from '@/features/recording/reading-prefs';

describe('reading preferences', () => {
  it('clamps the text scale and snaps it to one decimal', () => {
    expect(clampReadingScale(0.2)).toBe(READING_SCALE_MIN);
    expect(clampReadingScale(9)).toBe(READING_SCALE_MAX);
    expect(clampReadingScale(1.2499)).toBe(1.2);
    expect(clampReadingScale(Number.NaN)).toBe(READING_SCALE_DEFAULT);
  });

  it('steps without floating point drift and stops at the limits', () => {
    let scale = READING_SCALE_DEFAULT;
    for (let i = 0; i < 30; i++) scale = stepReadingScale(scale, 1);
    expect(scale).toBe(READING_SCALE_MAX);
    for (let i = 0; i < 30; i++) scale = stepReadingScale(scale, -1);
    expect(scale).toBe(READING_SCALE_MIN);
    expect(stepReadingScale(1.2, 1)).toBe(1.3);
  });

  it('reads saved values defensively', () => {
    expect(parseReadingScale(null)).toBe(READING_SCALE_DEFAULT);
    expect(parseReadingScale('')).toBe(READING_SCALE_DEFAULT);
    expect(parseReadingScale('abc')).toBe(READING_SCALE_DEFAULT);
    expect(parseReadingScale('1.5')).toBe(1.5);
    expect(parseReadingDisplay('translation')).toBe('translation');
    expect(parseReadingDisplay('weird')).toBe('both');
    expect(parseReadingDisplay(null)).toBe('both');
  });
});
