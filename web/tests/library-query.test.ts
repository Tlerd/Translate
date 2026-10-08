import { describe, it, expect } from 'vitest';
import type { RecordingItem } from '@/shared/recording';
import {
  foldText,
  groupByDay,
  listLanguagePairs,
  queryLibrary,
  type LibraryEntry,
  type LibraryQuery,
} from '@/features/library/library-query';

// 2026-01-10 12:00 in Vietnam.
const NOW = new Date('2026-01-10T05:00:00Z');

function rec(id: string, overrides: Partial<RecordingItem> = {}): RecordingItem {
  return {
    id,
    title: id,
    createdAt: '2026-01-09T05:00:00Z',
    mode: 'lecture',
    sourceLanguage: 'ja-JP',
    targetLanguage: 'vi',
    state: 'stopped',
    durationMs: 60_000,
    audioState: 'missing',
    config: { translationModelKey: 'google:test' },
    ...overrides,
  };
}

function entry(
  id: string,
  recording: Partial<RecordingItem> = {},
  extra: Partial<Pick<LibraryEntry, 'hasSummary' | 'sync'>> = {},
): LibraryEntry {
  return { recording: rec(id, recording), hasSummary: false, sync: 'synced', ...extra };
}

function ids(entries: LibraryEntry[]): string[] {
  return entries.map((item) => item.recording.id);
}

function run(entries: LibraryEntry[], query: LibraryQuery) {
  return queryLibrary(entries, query, NOW);
}

describe('library query: views and archive', () => {
  const entries = [
    entry('a', { title: 'Bài giảng thường' }),
    entry('b', { title: 'Tiếng Nhật N2 cũ', category: 'archive' }),
  ];

  it('keeps archived recordings out of "all" but finds them by search in "all"', () => {
    expect(ids(run(entries, { view: 'all' }).items)).toEqual(['a']);
    expect(ids(run(entries, { view: 'all', q: 'nhat' }).items)).toEqual(['b']);
    expect(ids(run(entries, { view: 'archived' }).items)).toEqual(['b']);
  });

  it('does not extend search to other views', () => {
    expect(ids(run(entries, { view: 'recent', q: 'nhat' }).items)).toEqual([]);
  });
});

describe('library query: search', () => {
  const entries = [
    entry('a', { title: 'Tiếng Nhật N2' }),
    entry('b', { title: 'Tiếng Anh B2' }),
    entry('c', { title: 'Đức A1 buổi sáng' }),
  ];

  it('folds diacritics and đ/Đ', () => {
    expect(foldText('Tiếng Nhật')).toBe('tieng nhat');
    expect(foldText('  Đức ')).toBe('duc');
  });

  it('matches accent-free queries against accented titles', () => {
    expect(ids(run(entries, { view: 'all', q: 'tieng nhat' }).items)).toEqual(['a']);
    expect(ids(run(entries, { view: 'all', q: 'duc' }).items)).toEqual(['c']);
    expect(ids(run(entries, { view: 'all', q: 'Tiếng nhật' }).items)).toEqual(['a']);
  });

  it('requires every word to match (AND), in any order', () => {
    expect(ids(run(entries, { view: 'all', q: 'tieng n2' }).items)).toEqual(['a']);
    expect(ids(run(entries, { view: 'all', q: 'nhat b2' }).items)).toEqual([]);
  });
});

describe('library query: counts and folders', () => {
  const entries = [
    entry('r1', { folder: 'Lớp A', category: 'inbox', audioState: 'present' }, { hasSummary: true, sync: 'synced' }),
    entry('r2', { category: 'priority' }, { sync: 'pending' }),
    entry('r3', { category: 'archive', createdAt: '2026-01-01T05:00:00Z' }, { sync: 'error' }),
    entry('r4', { state: 'recording', createdAt: '2026-01-10T04:00:00Z' }, { sync: 'local' }),
    entry('r5', { deletedAt: '2026-01-09T06:00:00Z', category: 'inbox' }, { sync: 'pending' }),
  ];

  it('counts every view over all live entries, independent of the current query', () => {
    const base = run(entries, { view: 'all' });
    expect(base.counts).toEqual({
      all: 3,
      recent: 3,
      starred: 1,
      unsummarized: 1,
      unsynced: 2,
      recording: 1,
      archived: 1,
    });
    expect(run(entries, { view: 'archived', folder: 'Lớp A', q: 'zzz', filters: { hasAudio: true } }).counts)
      .toEqual(base.counts);
    expect(run(entries, { view: 'starred', folder: '' }).counts).toEqual(base.counts);
  });

  it('computes folder counts and uncategorized count over non-archived live recordings', () => {
    const result = run(entries, { view: 'all' });
    expect(result.folderCounts).toEqual({ 'Lớp A': 1 });
    expect(result.uncategorizedCount).toBe(2);
  });

  it('never shows soft-deleted recordings in any view', () => {
    for (const view of ['all', 'recent', 'starred', 'unsummarized', 'unsynced', 'recording', 'archived'] as const) {
      expect(ids(run(entries, { view }).items)).not.toContain('r5');
    }
  });
});

describe('library query: folder filter', () => {
  const entries = [
    entry('x'),
    entry('y', { folder: '' }),
    entry('z', { folder: 'Lớp A' }),
  ];

  it('treats undefined as every folder, and ""/null as uncategorized only', () => {
    expect(ids(run(entries, { view: 'all', folder: undefined }).items).sort()).toEqual(['x', 'y', 'z']);
    expect(ids(run(entries, { view: 'all', folder: '' }).items).sort()).toEqual(['x', 'y']);
    expect(ids(run(entries, { view: 'all', folder: null }).items).sort()).toEqual(['x', 'y']);
    expect(ids(run(entries, { view: 'all', folder: 'Lớp A' }).items)).toEqual(['z']);
  });
});

describe('library query: filters', () => {
  it('filters dates by Vietnam local day, not by the machine time zone', () => {
    const entries = [
      entry('late', { createdAt: '2026-01-01T17:30:00Z' }), // 2026-01-02 00:30 in Vietnam
      entry('early', { createdAt: '2026-01-01T16:30:00Z' }), // 2026-01-01 23:30 in Vietnam
    ];
    expect(ids(run(entries, { view: 'all', filters: { dateFrom: '2026-01-02', dateTo: '2026-01-02' } }).items))
      .toEqual(['late']);
    expect(ids(run(entries, { view: 'all', filters: { dateFrom: '2026-01-01', dateTo: '2026-01-01' } }).items))
      .toEqual(['early']);
  });

  it('filters by language pair and by audio presence', () => {
    const entries = [
      entry('ja', { sourceLanguage: 'ja-JP', targetLanguage: 'vi', audioState: 'present' }),
      entry('en', { sourceLanguage: 'en-US', targetLanguage: 'vi', audioState: 'missing' }),
    ];
    expect(ids(run(entries, { view: 'all', filters: { languagePair: 'en-US>vi' } }).items)).toEqual(['en']);
    expect(ids(run(entries, { view: 'all', filters: { hasAudio: true } }).items)).toEqual(['ja']);
    expect(listLanguagePairs(entries)).toEqual([
      { key: 'en-US>vi', sourceLanguage: 'en-US', targetLanguage: 'vi', count: 1 },
      { key: 'ja-JP>vi', sourceLanguage: 'ja-JP', targetLanguage: 'vi', count: 1 },
    ]);
  });
});

describe('library query: sorting', () => {
  const entries = [
    entry('p', { title: 'Bình', createdAt: '2026-01-05T05:00:00Z', durationMs: 30_000 }),
    entry('q', { title: 'an', createdAt: '2026-01-07T05:00:00Z', durationMs: 90_000 }),
    entry('s', { title: 'Đức', createdAt: '2026-01-01T05:00:00Z', durationMs: 60_000 }),
  ];

  it('sorts newest (default), oldest, longest, and title', () => {
    expect(ids(run(entries, { view: 'all' }).items)).toEqual(['q', 'p', 's']);
    expect(ids(run(entries, { view: 'all', sort: 'newest' }).items)).toEqual(['q', 'p', 's']);
    expect(ids(run(entries, { view: 'all', sort: 'oldest' }).items)).toEqual(['s', 'p', 'q']);
    expect(ids(run(entries, { view: 'all', sort: 'longest' }).items)).toEqual(['q', 's', 'p']);
    expect(ids(run(entries, { view: 'all', sort: 'title' }).items)).toEqual(['q', 'p', 's']);
  });
});

describe('library query: recent window', () => {
  it('includes exactly 7 days back and excludes anything older', () => {
    const entries = [
      entry('edge', { createdAt: '2026-01-03T05:00:00Z' }),
      entry('old', { createdAt: '2026-01-03T04:59:59.999Z' }),
    ];
    expect(ids(run(entries, { view: 'recent' }).items)).toEqual(['edge']);
  });
});

describe('library query: unsummarized and unsynced rules', () => {
  const entries = [
    entry('u1', {}, { hasSummary: false, sync: 'pending' }),
    entry('u2', { state: 'recording' }, { hasSummary: false, sync: 'local' }),
    entry('u3', { category: 'archive' }, { hasSummary: false, sync: 'error' }),
    entry('u4', {}, { hasSummary: true, sync: 'synced' }),
  ];

  it('excludes recordings in progress and archived recordings from "unsummarized"', () => {
    expect(ids(run(entries, { view: 'unsummarized' }).items)).toEqual(['u1']);
  });

  it('excludes archived and fully synced recordings from "unsynced"', () => {
    expect(ids(run(entries, { view: 'unsynced' }).items).sort()).toEqual(['u1', 'u2']);
    expect(ids(run(entries, { view: 'recording' }).items)).toEqual(['u2']);
  });
});

describe('groupByDay', () => {
  // 2026-01-02 00:30 in Vietnam.
  const now = new Date('2026-01-01T17:30:00Z');
  const today1 = entry('today-midnight', { createdAt: '2026-01-01T17:00:00Z' }); // 00:00 Jan 2
  const yesterday = entry('yesterday-late', { createdAt: '2026-01-01T16:59:59Z' }); // 23:59:59 Jan 1
  const week = entry('week-start', { createdAt: '2025-12-26T17:00:00Z' }); // 00:00 Dec 27
  const older = entry('older-end', { createdAt: '2025-12-26T16:59:59Z' }); // 23:59:59 Dec 26
  const today2 = entry('today-late', { createdAt: '2026-01-01T18:00:00Z' }); // 01:00 Jan 2

  it('splits items at Vietnam midnight and keeps input order inside each group', () => {
    const groups = groupByDay([today1, yesterday, week, older, today2], now);
    expect(groups.map((group) => [group.key, group.label, ids(group.items)])).toEqual([
      ['today', 'Hôm nay', ['today-midnight', 'today-late']],
      ['yesterday', 'Hôm qua', ['yesterday-late']],
      ['week', 'Tuần này', ['week-start']],
      ['older', 'Trước đó', ['older-end']],
    ]);
  });

  it('omits empty groups', () => {
    expect(groupByDay([today1], now).map((group) => group.key)).toEqual(['today']);
    expect(groupByDay([], now)).toEqual([]);
  });
});
