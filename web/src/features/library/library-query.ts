import type { RecordingItem } from '@/shared/recording';

// Pure query layer for the library. Nothing in this file reads the database or
// the system clock: callers pass `now` explicitly so results are reproducible.

// 'trash' is the only view that holds soft-deleted recordings; every other view hides them.
export type LibraryView = 'all' | 'recent' | 'starred' | 'unsummarized' | 'unsynced' | 'recording' | 'archived' | 'trash';
export type LibrarySort = 'newest' | 'oldest' | 'longest' | 'title';
export type SyncState = 'synced' | 'pending' | 'error' | 'local';

export interface LibraryEntry {
  recording: RecordingItem;
  hasSummary: boolean;
  sync: SyncState;
}

export interface LibraryFilters {
  /** Exact key `${sourceLanguage}>${targetLanguage}`. */
  languagePair?: string;
  /** Inclusive lower bound, 'YYYY-MM-DD' in Asia/Ho_Chi_Minh. */
  dateFrom?: string;
  /** Inclusive upper bound, 'YYYY-MM-DD' in Asia/Ho_Chi_Minh. */
  dateTo?: string;
  /** true keeps only recordings whose audio is present locally. */
  hasAudio?: boolean;
}

export interface LibraryQuery {
  view: LibraryView;
  /** undefined = every folder; '' or null = only recordings without a folder; otherwise that folder. */
  folder?: string | null;
  q?: string;
  filters?: LibraryFilters;
  sort?: LibrarySort;
}

export interface LibraryResult {
  items: LibraryEntry[];
  counts: Record<LibraryView, number>;
  folderCounts: Record<string, number>;
  uncategorizedCount: number;
}

export interface DayGroup {
  key: 'today' | 'yesterday' | 'week' | 'older';
  label: string;
  items: LibraryEntry[];
}

const VIEWS: readonly LibraryView[] = ['all', 'recent', 'starred', 'unsummarized', 'unsynced', 'recording', 'archived', 'trash'];
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = 7 * DAY_MS;
// Asia/Ho_Chi_Minh has no DST and is a fixed UTC+7 offset.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Lowercases, strips diacritics (NFD), maps đ/Đ to d, and trims. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

function timeOf(entry: LibraryEntry): number {
  const time = Date.parse(entry.recording.createdAt);
  return Number.isFinite(time) ? time : 0;
}

function deletedTimeOf(entry: LibraryEntry): number {
  const time = Date.parse(entry.recording.deletedAt ?? '');
  return Number.isFinite(time) ? time : 0;
}

/** Whole days since the epoch, counted in Vietnam local time. */
function vnDayIndex(timeMs: number): number {
  return Math.floor((timeMs + VN_OFFSET_MS) / DAY_MS);
}

/** 'YYYY-MM-DD' of a timestamp in Vietnam local time. */
function vnDate(timeMs: number): string {
  return new Date(timeMs + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function isArchived(entry: LibraryEntry): boolean {
  return entry.recording.category === 'archive';
}

function isLive(entry: LibraryEntry): boolean {
  return !entry.recording.deletedAt;
}

function isTrashed(entry: LibraryEntry): boolean {
  return !isLive(entry);
}

function matchesView(entry: LibraryEntry, view: LibraryView, nowMs: number): boolean {
  const { recording } = entry;
  switch (view) {
    case 'trash':
      return isTrashed(entry);
    case 'all':
      return !isArchived(entry);
    case 'recent':
      return !isArchived(entry) && timeOf(entry) >= nowMs - RECENT_WINDOW_MS;
    case 'starred':
      return recording.category === 'priority';
    case 'unsummarized':
      return !entry.hasSummary && recording.state !== 'recording' && !isArchived(entry);
    case 'unsynced':
      return entry.sync !== 'synced' && !isArchived(entry);
    case 'recording':
      return recording.state === 'recording';
    case 'archived':
      return isArchived(entry);
  }
}

/** Whether a row belongs to a view. Deleted rows only ever match the trash view. */
function isInView(entry: LibraryEntry, view: LibraryView, nowMs: number): boolean {
  if (view !== 'trash' && isTrashed(entry)) return false;
  return matchesView(entry, view, nowMs);
}

function matchesFolder(entry: LibraryEntry, folder: string | null | undefined): boolean {
  if (folder === undefined) return true;
  if (folder === null || folder === '') return !entry.recording.folder;
  return entry.recording.folder === folder;
}

function matchesFilters(entry: LibraryEntry, filters: LibraryFilters | undefined): boolean {
  if (!filters) return true;
  const { recording } = entry;
  if (filters.hasAudio === true && recording.audioState !== 'present') return false;
  if (filters.languagePair && `${recording.sourceLanguage}>${recording.targetLanguage}` !== filters.languagePair) return false;
  if (filters.dateFrom || filters.dateTo) {
    const day = vnDate(timeOf(entry));
    if (filters.dateFrom && day < filters.dateFrom) return false;
    if (filters.dateTo && day > filters.dateTo) return false;
  }
  return true;
}

function compareEntries(sort: LibrarySort, view: LibraryView): (a: LibraryEntry, b: LibraryEntry) => number {
  switch (sort) {
    case 'newest':
      // In the trash, "newest" means most recently deleted first.
      if (view === 'trash') return (a, b) => deletedTimeOf(b) - deletedTimeOf(a);
      return (a, b) => timeOf(b) - timeOf(a);
    case 'oldest':
      return (a, b) => timeOf(a) - timeOf(b);
    case 'longest':
      return (a, b) => b.recording.durationMs - a.recording.durationMs;
    case 'title': {
      return (a, b) => {
        const left = foldText(a.recording.title);
        const right = foldText(b.recording.title);
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
      };
    }
  }
}

export function queryLibrary(entries: LibraryEntry[], query: LibraryQuery, now: Date): LibraryResult {
  const nowMs = now.getTime();

  const counts = Object.fromEntries(
    VIEWS.map((view) => [view, entries.filter((entry) => isInView(entry, view, nowMs)).length]),
  ) as Record<LibraryView, number>;

  const terms = foldText(query.q ?? '').split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;

  const folderCounts: Record<string, number> = {};
  let uncategorizedCount = 0;
  for (const entry of entries) {
    if (isTrashed(entry) || isArchived(entry)) continue;
    const folder = entry.recording.folder;
    if (folder) folderCounts[folder] = (folderCounts[folder] ?? 0) + 1;
    else uncategorizedCount += 1;
  }

  const items = entries
    .filter((entry) => {
      // Search in the "all" view also reaches archived recordings (never trashed ones).
      const inView = isInView(entry, query.view, nowMs)
        || (searching && query.view === 'all' && isLive(entry) && isArchived(entry));
      if (!inView) return false;
      if (!matchesFolder(entry, query.folder)) return false;
      if (searching) {
        const title = foldText(entry.recording.title);
        if (!terms.every((term) => title.includes(term))) return false;
      }
      return matchesFilters(entry, query.filters);
    })
    .sort(compareEntries(query.sort ?? 'newest', query.view));

  return { items, counts, folderCounts, uncategorizedCount };
}

const DAY_LABELS: Record<DayGroup['key'], string> = {
  today: 'Hôm nay',
  yesterday: 'Hôm qua',
  week: 'Tuần này',
  older: 'Trước đó',
};

/**
 * Buckets rows by Vietnam calendar day. The trash groups by deletion day ('deletedAt');
 * every other view groups by creation day.
 */
export function groupByDay(items: LibraryEntry[], now: Date, field: 'createdAt' | 'deletedAt' = 'createdAt'): DayGroup[] {
  const today = vnDayIndex(now.getTime());
  const buckets: Record<DayGroup['key'], LibraryEntry[]> = { today: [], yesterday: [], week: [], older: [] };
  for (const entry of items) {
    const daysAgo = today - vnDayIndex(field === 'deletedAt' ? deletedTimeOf(entry) : timeOf(entry));
    if (daysAgo <= 0) buckets.today.push(entry);
    else if (daysAgo === 1) buckets.yesterday.push(entry);
    else if (daysAgo <= 6) buckets.week.push(entry);
    else buckets.older.push(entry);
  }
  const order: DayGroup['key'][] = ['today', 'yesterday', 'week', 'older'];
  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: DAY_LABELS[key], items: buckets[key] }));
}

export function listLanguagePairs(
  entries: LibraryEntry[],
): Array<{ key: string; sourceLanguage: string; targetLanguage: string; count: number }> {
  const pairs = new Map<string, { key: string; sourceLanguage: string; targetLanguage: string; count: number }>();
  for (const entry of entries) {
    if (!isLive(entry)) continue;
    const { sourceLanguage, targetLanguage } = entry.recording;
    const key = `${sourceLanguage}>${targetLanguage}`;
    const pair = pairs.get(key) ?? { key, sourceLanguage, targetLanguage, count: 0 };
    pair.count += 1;
    pairs.set(key, pair);
  }
  return [...pairs.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
