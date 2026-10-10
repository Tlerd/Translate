export const RECORDING_LOCK_PREFIX = 'may-dich-recording:';

/**
 * Holds a Web Lock for as long as a recording is live. The browser drops it when the tab
 * closes or crashes, which lets other tabs tell a live recording from an abandoned row.
 */
export function holdRecordingLock(recordingId: string): () => void {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) return () => undefined;
  let release: (() => void) | null = null;
  const held = new Promise<void>((resolve) => { release = resolve; });
  void navigator.locks
    .request(RECORDING_LOCK_PREFIX + recordingId, () => held)
    .catch(() => undefined);
  return () => {
    release?.();
    release = null;
  };
}

/** Ids of recordings some tab is holding a lock for, or null when Web Locks are unavailable. */
export async function liveRecordingIds(): Promise<Set<string> | null> {
  if (typeof navigator === 'undefined' || !navigator.locks?.query) return null;
  try {
    const { held = [], pending = [] } = await navigator.locks.query();
    const ids = new Set<string>();
    for (const lock of [...held, ...pending]) {
      if (lock.name?.startsWith(RECORDING_LOCK_PREFIX)) ids.add(lock.name.slice(RECORDING_LOCK_PREFIX.length));
    }
    return ids;
  } catch {
    return null;
  }
}
