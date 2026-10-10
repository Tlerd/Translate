import { describe, expect, it } from 'vitest';
import {
  formatTokens,
  formatUsd,
  rangePreset,
  formatSaigonDate,
} from '@/features/usage/usage-format';

describe('usage-format helpers', () => {
  describe('formatTokens', () => {
    it('formats numbers with Vietnamese thousand separators', () => {
      expect(formatTokens(0)).toBe('0');
      expect(formatTokens(1234)).toBe('1.234');
      expect(formatTokens(1000000)).toBe('1.000.000');
      expect(formatTokens(null)).toBe('0');
      expect(formatTokens(undefined)).toBe('0');
    });
  });

  describe('formatUsd', () => {
    it('handles null, zero, sub-cent, and standard values', () => {
      expect(formatUsd(null)).toBe('Chưa rõ');
      expect(formatUsd(undefined)).toBe('Chưa rõ');
      expect(formatUsd(0)).toBe('$0.00');
      expect(formatUsd(0.0003)).toBe('$0.0003');
      expect(formatUsd(0.0035)).toBe('$0.0035');
      expect(formatUsd(0.8)).toBe('$0.80');
      expect(formatUsd(1.234)).toBe('$1.23');
    });
  });

  describe('rangePreset', () => {
    const fixedNow = new Date('2026-10-05T07:00:00Z'); // 14:00 on 2026-10-05 in Saigon

    it('formats today as same start and end day in Asia/Ho_Chi_Minh', () => {
      const res = rangePreset('today', fixedNow);
      expect(res).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    });

    it('formats 7days as 7 calendar days inclusive', () => {
      const res = rangePreset('7days', fixedNow);
      expect(res).toEqual({ from: '2026-09-29', to: '2026-10-05' });
    });

    it('formats 30days as 30 calendar days inclusive', () => {
      const res = rangePreset('30days', fixedNow);
      expect(res).toEqual({ from: '2026-09-06', to: '2026-10-05' });
    });

    it('formats arbitrary dates in Saigon timezone correctly', () => {
      // 23:30 UTC on Oct 4 is 06:30 on Oct 5 in Saigon
      const lateUtc = new Date('2026-10-04T23:30:00Z');
      expect(formatSaigonDate(lateUtc)).toBe('2026-10-05');
    });
  });
});

import { combineEstimatedUsd, formatClock, formatDurationVi, formatUsdPerMinute, recordingCostText } from '@/features/usage/usage-format';

describe('speech usage formatting', () => {
  it('formats clocks and Vietnamese durations', () => {
    expect(formatClock(754_000)).toBe('12:34');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(754_000, true)).toBe('0:12:34');
    expect(formatClock(0)).toBe('0:00');
    expect(formatDurationVi(750_000)).toBe('12 phút 30 giây');
    expect(formatDurationVi(3_723_000)).toBe('1 giờ 2 phút 3 giây');
    expect(formatDurationVi(45_000)).toBe('45 giây');
    expect(formatUsdPerMinute(0.005)).toBe('$0.0050');
    expect(formatUsdPerMinute(0)).toBe('$0.00');
  });

  it('combines translation and speech cost, flagging unknown translation cost', () => {
    expect(combineEstimatedUsd(0.02, 0.11)).toEqual({ usd: 0.13, partial: false });
    expect(combineEstimatedUsd(null, 0.11)).toEqual({ usd: 0.11, partial: true });
  });

  it('builds the recording cost line from whichever sources have data', () => {
    const translation = { totals: { requests: 40, estimatedUsd: 0.02 } } as never;
    const speech = { totals: { sessions: 2, audioMs: 754_000, estimatedUsd: 0.11 } } as never;
    expect(recordingCostText(translation, speech)).toBe('Nhận giọng 12:34 · ~$0.11 · Dịch 40 request · ~$0.02');
    expect(recordingCostText(translation, null)).toBe('Dịch 40 request · ~$0.02');
    expect(recordingCostText(null, speech)).toBe('Nhận giọng 12:34 · ~$0.11');
    expect(recordingCostText({ totals: { requests: 0, estimatedUsd: 0 } } as never, { totals: { sessions: 0, audioMs: 0, estimatedUsd: 0 } } as never)).toBeNull();
  });
});
