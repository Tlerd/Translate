import { describe, it, expect } from 'vitest';
import {
  formatClock,
  formatDay,
  formatDuration,
  formatTrashRemaining,
  languageBadge,
  trashDaysLeft,
  viewLabel,
} from '@/features/library/library-format';

describe('library formatting', () => {
  it('formats durations as m:ss or h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(42 * 60_000 + 10_000)).toBe('42:10');
    expect(formatDuration(3_750_000)).toBe('1:02:30');
    expect(formatDuration(59_999)).toBe('0:59');
  });

  it('treats negative or non-finite durations as zero', () => {
    expect(formatDuration(-5_000)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });

  it('shows the clock in Vietnam time regardless of the machine time zone', () => {
    // 07:05 UTC is 14:05 in Vietnam.
    expect(formatClock('2026-10-08T07:05:00Z')).toBe('14:05');
    // 17:30 UTC is 00:30 the next day in Vietnam.
    expect(formatClock('2026-10-08T17:30:00Z')).toBe('00:30');
    expect(formatClock('not a date')).toBe('--:--');
  });

  it('shows the calendar day in Vietnam time', () => {
    // 18:00 UTC on 7 October is 01:00 on 8 October in Vietnam.
    expect(formatDay('2026-10-07T18:00:00Z')).toBe('08/10/2026');
    expect(formatDay('2026-10-08T05:00:00Z')).toBe('08/10/2026');
    expect(formatDay('')).toBe('');
  });

  it('builds language badges from both short and region codes', () => {
    expect(languageBadge('ja-JP', 'vi')).toBe('JA→VI');
    expect(languageBadge('en', 'vi-VN')).toBe('EN→VI');
    expect(languageBadge('auto', 'vi')).toBe('Tự động→VI');
    expect(languageBadge('ja', 'none')).toBe('JA');
  });

  it('labels every library view in Vietnamese', () => {
    expect(viewLabel('all')).toBe('Tất cả');
    expect(viewLabel('recent')).toBe('Gần đây');
    expect(viewLabel('starred')).toBe('Gắn sao');
    expect(viewLabel('unsummarized')).toBe('Chưa tóm tắt');
    expect(viewLabel('unsynced')).toBe('Chưa đồng bộ');
    expect(viewLabel('recording')).toBe('Đang ghi');
    expect(viewLabel('archived')).toBe('Lưu trữ');
    expect(viewLabel('trash')).toBe('Thùng rác');
  });
});

describe('trash days left', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const DELETED = '2026-01-01T00:00:00.000Z';
  const deletedMs = Date.parse(DELETED);

  it('counts whole days left, rounding a partial day up', () => {
    expect(trashDaysLeft(DELETED, deletedMs)).toBe(30);
    expect(trashDaysLeft(DELETED, deletedMs + 1)).toBe(30);
    expect(trashDaysLeft(DELETED, deletedMs + 28 * DAY)).toBe(2);
    expect(trashDaysLeft(DELETED, deletedMs + 29 * DAY)).toBe(1);
    expect(trashDaysLeft(DELETED, deletedMs + 30 * DAY - 1)).toBe(1);
  });

  it('is zero once the retention window has ended', () => {
    expect(trashDaysLeft(DELETED, deletedMs + 30 * DAY)).toBe(0);
    expect(trashDaysLeft(DELETED, deletedMs + 31 * DAY)).toBe(0);
  });

  it('has no countdown for a deletion date it cannot read', () => {
    expect(trashDaysLeft('not a date', deletedMs)).toBe(Number.POSITIVE_INFINITY);
    expect(formatTrashRemaining(trashDaysLeft('not a date', deletedMs))).toBe('Không rõ thời hạn');
  });

  it('formats the remaining days in Vietnamese', () => {
    expect(formatTrashRemaining(30)).toBe('Còn 30 ngày');
    expect(formatTrashRemaining(1)).toBe('Còn 1 ngày');
    expect(formatTrashRemaining(0)).toBe('Hết hạn hôm nay');
  });
});

