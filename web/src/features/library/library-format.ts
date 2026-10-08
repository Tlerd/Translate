import type { LibraryView } from './library-query';

// Pure formatting helpers for the library screen. They never read the system
// time zone: Vietnam time is UTC+7 with no DST, so offsets are applied by hand.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const VIEW_LABELS: Record<LibraryView, string> = {
  all: 'Tất cả',
  recent: 'Gần đây',
  starred: 'Gắn sao',
  unsummarized: 'Chưa tóm tắt',
  unsynced: 'Chưa đồng bộ',
  recording: 'Đang ghi',
  archived: 'Lưu trữ',
};

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Duration as 'm:ss' or 'h:mm:ss'. Negative or non-finite input is shown as 0. */
export function formatDuration(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${minutes}:${pad2(seconds)}`;
}

/** Vietnam wall-clock time 'HH:mm' of an ISO timestamp, or '--:--' if it cannot be parsed. */
export function formatClock(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '--:--';
  const local = new Date(time + VN_OFFSET_MS);
  return `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;
}

/** Vietnam calendar date 'DD/MM/YYYY' of an ISO timestamp, or '' if it cannot be parsed. */
export function formatDay(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const local = new Date(time + VN_OFFSET_MS);
  return `${pad2(local.getUTCDate())}/${pad2(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`;
}

function languageCode(code: string): string {
  if (code === 'auto') return 'Tự động';
  // Accepts both 'ja' and 'ja-JP' style codes.
  return code.split('-')[0].toUpperCase();
}

/** Badge such as 'JA→VI'. A target of 'none' (no translation) shows only the source. */
export function languageBadge(source: string, target: string): string {
  const from = languageCode(source);
  if (!target || target === 'none') return from;
  return `${from}→${languageCode(target)}`;
}

export function viewLabel(view: LibraryView): string {
  return VIEW_LABELS[view];
}
