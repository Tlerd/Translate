/** Size report of the private Blob store, shared by the storage API and the Settings page. */
export interface AudioStorageReport {
  /** Everything in the Blob store, including files outside `recordings/`. */
  storeTotalBytes: number;
  storeFiles: number;
  /** Audio referenced by a live (pending/available) row of a recording that is not in the Trash. */
  referencedBytes: number;
  referencedFiles: number;
  /** Referenced audio whose recording sits in the Trash. Reported only, never deleted by cleanup. */
  trashBytes: number;
  trashFiles: number;
  /** Unreferenced files under `recordings/` older than the upload grace period. */
  orphanBytes: number;
  orphanFiles: number;
  /** Unreferenced files too recent to judge (uploads that may still be in flight). */
  graceBytes: number;
  graceFiles: number;
  /** Why cleanup is refused on this deployment (e.g. a preview), or null when allowed. */
  cleanupBlockedReason: string | null;
  scannedAt: string;
}

export interface AudioCleanupResult {
  deletedFiles: number;
  freedBytes: number;
  /** Orphans left over because one call deletes at most a bounded number of files. */
  remaining: number;
  report: AudioStorageReport;
}

/** Megabytes (1024 * 1024 bytes) with one decimal, e.g. "802.4 MB". */
export function formatMegabytes(bytes: number): string {
  return `${(Math.max(0, bytes) / 1024 / 1024).toFixed(1)} MB`;
}
