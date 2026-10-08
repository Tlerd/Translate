/** Preferences for the full-screen reading mode of a saved recording. */
export type ReadingDisplay = 'both' | 'source' | 'translation';

export const READING_SCALE_MIN = 0.9;
export const READING_SCALE_MAX = 2;
export const READING_SCALE_STEP = 0.1;
export const READING_SCALE_DEFAULT = 1.25;

export const READING_DISPLAYS: ReadonlyArray<{ value: ReadingDisplay; label: string }> = [
  { value: 'both', label: 'Gốc + dịch' },
  { value: 'translation', label: 'Chỉ bản dịch' },
  { value: 'source', label: 'Chỉ bản gốc' },
];

/** Keeps the text scale inside its limits and on a 0.1 grid so repeated steps never drift. */
export function clampReadingScale(value: number): number {
  if (!Number.isFinite(value)) return READING_SCALE_DEFAULT;
  const clamped = Math.min(READING_SCALE_MAX, Math.max(READING_SCALE_MIN, value));
  return Math.round(clamped * 10) / 10;
}

export function stepReadingScale(current: number, direction: 1 | -1): number {
  return clampReadingScale(current + direction * READING_SCALE_STEP);
}

export function parseReadingScale(stored: string | null): number {
  if (stored === null || stored.trim() === '') return READING_SCALE_DEFAULT;
  return clampReadingScale(Number(stored));
}

export function parseReadingDisplay(stored: string | null): ReadingDisplay {
  return READING_DISPLAYS.some((item) => item.value === stored) ? (stored as ReadingDisplay) : 'both';
}
