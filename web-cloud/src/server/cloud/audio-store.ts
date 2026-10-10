import 'server-only';
import { createHash } from 'node:crypto';
import { database } from './recording-store';
import { ensureAudioTable } from './audio-table';
import { remoteAudioSchema, type AudioFileMetadata, type RemoteAudio } from '@/shared/audio';

async function ready() {
  const sql = database();
  await ensureAudioTable(sql);
  return sql;
}
function parse(row: Record<string, unknown>): RemoteAudio {
  return remoteAudioSchema.parse({ recordingId: row.recording_id, version: row.version, state: row.state,
    file: row.file, pathname: row.pathname, updatedAt: new Date(String(row.updated_at)).toISOString() });
}
export async function readAudio(owner: string, id: string): Promise<RemoteAudio | null> {
  const sql = await ready();
  const rows = await sql`SELECT * FROM recording_audio WHERE owner_email=${owner} AND recording_id=${id}`;
  return rows[0] ? parse(rows[0]) : null;
}
export async function listAudio(owner: string, cursor: string | null) {
  const sql = await ready();
  const rows = cursor === null
    ? await sql`SELECT * FROM recording_audio WHERE owner_email=${owner} ORDER BY recording_id LIMIT 501`
    : await sql`SELECT * FROM recording_audio WHERE owner_email=${owner} AND recording_id>${cursor} ORDER BY recording_id LIMIT 501`;
  const items = rows.slice(0, 500).map(parse);
  return { items, nextCursor: rows.length > 500 ? items.at(-1)!.recordingId : null };
}
export function audioPath(owner: string, id: string, file: AudioFileMetadata): string {
  const namespace = createHash('sha256').update(owner).digest('hex').slice(0, 32);
  const recording = createHash('sha256').update(id).digest('hex');
  const extension = file.mimeType === 'audio/mp4' ? 'mp4' : file.mimeType === 'audio/wav' ? 'wav' : 'webm';
  return `recordings/${namespace}/${recording}/v${file.formatVersion}-${file.checksum}.${extension}`;
}
export async function reserveAudio(owner: string, id: string, file: AudioFileMetadata): Promise<RemoteAudio | null> {
  const sql = await ready();
  const pathname = audioPath(owner, id, file);
  // An audio tombstone is permanent for this recording ID. Old devices must
  // never re-create a deleted file, even when they still have the original.
  await sql`INSERT INTO recording_audio(owner_email,recording_id,version,state,file,pathname)
    SELECT ${owner},${id},1,'pending',${JSON.stringify(file)}::jsonb,${pathname}
    WHERE EXISTS (SELECT 1 FROM recording_sync WHERE owner_email=${owner} AND id=${id} AND payload IS NOT NULL AND payload->'recording'->>'state'<>'recording')
    ON CONFLICT(owner_email,recording_id) DO NOTHING`;
  const row = await readAudio(owner, id);
  return row?.state !== 'deleted' && row?.file?.checksum === file.checksum && row.file.sizeBytes === file.sizeBytes && row.file.mimeType === file.mimeType ? row : null;
}
export async function completeAudio(owner: string, id: string, version: number): Promise<RemoteAudio | null> {
  const sql = await ready();
  const rows = await sql`UPDATE recording_audio SET version=version+1,state='available',updated_at=now()
    WHERE owner_email=${owner} AND recording_id=${id} AND version=${version} AND state='pending'
    AND EXISTS (SELECT 1 FROM recording_sync WHERE owner_email=${owner} AND id=${id} AND payload IS NOT NULL)
    RETURNING *`;
  return rows[0] ? parse(rows[0]) : null;
}
export async function extendUploadLease(owner: string, id: string, version: number, validUntil: number): Promise<boolean> {
  const sql = await ready();
  const rows = await sql`UPDATE recording_audio SET cleanup_after=GREATEST(cleanup_after,${new Date(validUntil).toISOString()}::timestamptz)
    WHERE owner_email=${owner} AND recording_id=${id} AND version=${version} AND state='pending' RETURNING recording_id`;
  return rows.length > 0;
}
export async function tombstoneAudio(owner: string, id: string): Promise<RemoteAudio> {
  const sql = await ready();
  const rows = await sql`INSERT INTO recording_audio(owner_email,recording_id,version,state,file,pathname)
    VALUES(${owner},${id},1,'deleted',NULL,NULL)
    ON CONFLICT(owner_email,recording_id) DO UPDATE SET
      state='deleted', version=CASE WHEN recording_audio.state='deleted' THEN recording_audio.version ELSE recording_audio.version+1 END,
      updated_at=CASE WHEN recording_audio.state='deleted' THEN recording_audio.updated_at ELSE now() END
    RETURNING *`;
  return parse(rows[0]);
}
export async function cleanupDeletedAudio(owner: string, remove: (pathname: string) => Promise<void>) {
  const sql = await ready();
  const rows = await sql`SELECT recording_id,pathname,version FROM recording_audio WHERE owner_email=${owner} AND state='deleted' AND pathname IS NOT NULL AND cleanup_after<now() LIMIT 20`;
  for (const row of rows) {
    await remove(String(row.pathname));
    await sql`UPDATE recording_audio SET pathname=NULL WHERE owner_email=${owner} AND recording_id=${row.recording_id} AND version=${row.version} AND state='deleted'`;
  }
}
