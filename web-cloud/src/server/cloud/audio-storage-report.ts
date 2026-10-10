import 'server-only';
import { deleteObjects, listObjects } from './object-storage';
import { database } from './recording-store';
import { ensureAudioTable } from './audio-table';
import { AudioRequestError } from './audio-service';
import type { AudioCleanupResult, AudioStorageReport } from '@/shared/audio-storage';

/** Only this prefix is ever inspected for deletion; the rest of the store is counted, never touched. */
export const AUDIO_PREFIX = 'recordings/';
/** An unreferenced upload may simply not have been confirmed yet. */
export const ORPHAN_GRACE_MS = 2 * 60 * 60_000;
export const MAX_DELETIONS_PER_CALL = 1000;
const DELETE_BATCH = 100;
const LIST_PAGE = 1000;
const MAX_PAGES = 500;

interface ObjectInfo { pathname: string; size: number; uploadedAt: number }
interface Analysis { report: AudioStorageReport; orphans: ObjectInfo[]; referencedRows: number }

/**
 * Staging or preview deployments can point at a database that lacks the newest recordings while sharing
 * the production bucket, so their recordings' audio would look orphaned. Only production (or a
 * local run, where APP_ENV is unset) may delete.
 */
export function cleanupBlockedReason(env: string | undefined = process.env.APP_ENV): string | null {
  return env && env !== 'production'
    ? 'Chỉ dọn được trên bản chính (production). Bản xem trước có thể dùng database khác nên dễ xóa nhầm audio đang dùng.'
    : null;
}

async function listAll(prefix: string | undefined): Promise<ObjectInfo[]> {
  const blobs: ObjectInfo[] = []; const seen = new Set<string>(); let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listObjects(prefix, cursor, LIST_PAGE);
    for (const blob of result.objects) {
      blobs.push({ pathname: blob.pathname, size: Number(blob.size) || 0, uploadedAt: new Date(blob.uploadedAt).getTime() });
    }
    if (!result.hasMore || !result.cursor) return blobs;
    if (seen.has(result.cursor)) throw new Error('STORAGE_LIST_CURSOR_LOOP');
    seen.add(result.cursor); cursor = result.cursor;
  }
  throw new Error('STORAGE_LIST_TOO_LARGE');
}

async function referencedPathnames(): Promise<Map<string, boolean>> {
  const sql = database();
  await ensureAudioTable(sql);
  const rows = await sql`SELECT a.pathname, (s.payload->'recording'->>'deletedAt') IS NOT NULL AS in_trash
    FROM recording_audio a
    LEFT JOIN recording_sync s ON s.owner_email=a.owner_email AND s.id=a.recording_id
    WHERE a.state IN ('pending','available') AND a.pathname IS NOT NULL`;
  const referenced = new Map<string, boolean>();
  for (const row of rows) {
    const pathname = String(row.pathname); const inTrash = row.in_trash === true;
    // A path counts as Trash only when every row that references it is trashed.
    referenced.set(pathname, (referenced.get(pathname) ?? true) && inTrash);
  }
  return referenced;
}

async function analyze(now = Date.now()): Promise<Analysis> {
  // Blobs are listed before the database is read: a reservation row is written before its upload
  // starts, so every blob seen here already has its row when the references are loaded.
  const audio = (await listAll(AUDIO_PREFIX)).filter(blob => blob.pathname.startsWith(AUDIO_PREFIX));
  const everything = await listAll(undefined);
  const referenced = await referencedPathnames();
  const totals = { referencedBytes: 0, referencedFiles: 0, trashBytes: 0, trashFiles: 0, orphanBytes: 0, orphanFiles: 0, graceBytes: 0, graceFiles: 0 };
  const orphans: ObjectInfo[] = [];
  for (const blob of audio) {
    const inTrash = referenced.get(blob.pathname);
    if (inTrash === undefined) {
      // An unparseable date is treated as "recent" so it can never be deleted by mistake.
      const old = Number.isFinite(blob.uploadedAt) && now - blob.uploadedAt > ORPHAN_GRACE_MS;
      if (old) { orphans.push(blob); totals.orphanBytes += blob.size; totals.orphanFiles++; }
      else { totals.graceBytes += blob.size; totals.graceFiles++; }
    } else if (inTrash) { totals.trashBytes += blob.size; totals.trashFiles++; }
    else { totals.referencedBytes += blob.size; totals.referencedFiles++; }
  }
  return { orphans, referencedRows: referenced.size, report: {
    storeTotalBytes: everything.reduce((sum, blob) => sum + blob.size, 0), storeFiles: everything.length,
    ...totals, cleanupBlockedReason: cleanupBlockedReason(), scannedAt: new Date(now).toISOString(),
  } };
}

export async function scanAudioStorage(): Promise<AudioStorageReport> {
  return (await analyze()).report;
}

/**
 * Deletes unreferenced audio. The orphan list always comes from a fresh scan, never from the client.
 * Referenced files (including those in the Trash), recent uploads and anything outside `recordings/`
 * are never deleted.
 */
export async function cleanupOrphanAudio(): Promise<AudioCleanupResult> {
  const blocked = cleanupBlockedReason();
  if (blocked) throw new AudioRequestError(409, blocked);
  const { orphans, referencedRows, report } = await analyze();
  // No live audio rows at all while audio files exist means this server reads the wrong (or an empty)
  // database: everything would look orphaned. Refuse instead of wiping the store.
  if (referencedRows === 0 && report.orphanFiles + report.graceFiles > 0) {
    throw new AudioRequestError(409, 'Database không có buổi ghi nào có audio, nên không thể xác định file mồ côi. Không xóa gì.');
  }
  const targets = orphans.filter(blob => blob.pathname.startsWith(AUDIO_PREFIX)).slice(0, MAX_DELETIONS_PER_CALL);
  const sql = database();
  let deletedFiles = 0; let freedBytes = 0;
  for (let index = 0; index < targets.length; index += DELETE_BATCH) {
    const batch = targets.slice(index, index + DELETE_BATCH);
    const pathnames = batch.map(blob => blob.pathname);
    await deleteObjects(pathnames);
    deletedFiles += batch.length; freedBytes += batch.reduce((sum, blob) => sum + blob.size, 0);
    // Tombstoned rows keep their pathname until the blob is gone; the blob is gone now.
    await sql`UPDATE recording_audio SET pathname=NULL WHERE state='deleted' AND pathname = ANY(${pathnames})`;
  }
  return { deletedFiles, freedBytes, remaining: Math.max(0, orphans.length - deletedFiles), report: await scanAudioStorage() };
}
