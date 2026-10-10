import { FOLDER_NONE, LIBRARY_VIEWS, foldText, type LibraryView } from './library-query';

// Pure helpers for the library navigator: URL building, reading the current selection,
// and validating folder names. No React and no storage access, so they are unit-tested directly.

/** Longest folder name the cloud sync schema accepts (`folder: z.string().max(120)`). */
export const FOLDER_NAME_MAX_LENGTH = 120;

export type FolderNameError = 'empty' | 'too_long' | 'duplicate' | 'reserved';

export type FolderNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: FolderNameError };

export interface NavSelection {
  view: LibraryView;
  /** '' when no folder is selected, FOLDER_NONE for recordings without a folder, otherwise a folder name. */
  folder: string;
}

/**
 * Link target for the library. The default view and an empty folder are left out of the URL,
 * and every value is encoded by URLSearchParams so Vietnamese folder names survive the round trip.
 */
export function buildLibraryHref({ view, folder }: { view?: LibraryView; folder?: string } = {}): string {
  const params = new URLSearchParams();
  if (view && view !== 'all') params.set('view', view);
  if (folder) params.set('folder', folder);
  const query = params.toString();
  return query ? `/library?${query}` : '/library';
}

/** Reads the view and folder the way the library screen does: unknown views fall back to 'all'. */
export function parseNavSelection(searchParams: URLSearchParams): NavSelection {
  const view = searchParams.get('view');
  const known = LIBRARY_VIEWS.find((key) => key === view);
  return {
    view: known ?? 'all',
    folder: searchParams.get('folder') ?? '',
  };
}

/**
 * Validates a folder name typed by the user. Names are trimmed; duplicates are compared with
 * foldText, so case and Vietnamese diacritics do not count as different names.
 * `existing` should list every folder that is already known, excluding the one being renamed.
 */
export function normalizeFolderName(raw: string, existing: readonly string[]): FolderNameResult {
  const name = raw.trim();
  if (!name) return { ok: false, reason: 'empty' };
  if (name.length > FOLDER_NAME_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  if (name === FOLDER_NONE) return { ok: false, reason: 'reserved' };
  const key = foldText(name);
  if (existing.some((folder) => foldText(folder) === key)) return { ok: false, reason: 'duplicate' };
  return { ok: true, name };
}
