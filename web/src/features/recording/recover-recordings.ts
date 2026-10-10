import { listStuckRecordingIds, recoverStaleRecordings } from '@/storage/recordings';
import { liveRecordingIds } from './recording-lock';

// Without Web Locks another tab's live recording looks the same as an abandoned one.
const UNLOCKED_MIN_AGE_MS = 12 * 60 * 60 * 1000;

/** Closes recordings left in the 'recording' state by a tab that was closed or killed. */
export async function recoverInterruptedRecordings(activeId: () => string | null): Promise<number> {
  // Candidates are read before the lock query: a recording takes its lock before its row
  // exists, so any row started after this point is skipped rather than misjudged as abandoned.
  const candidates = new Set(await listStuckRecordingIds());
  if (candidates.size === 0) return 0;
  const live = await liveRecordingIds();
  return recoverStaleRecordings({
    isLive: (id) => !candidates.has(id) || id === activeId() || (live?.has(id) ?? false),
    minAgeMs: live === null ? UNLOCKED_MIN_AGE_MS : 0,
  });
}
