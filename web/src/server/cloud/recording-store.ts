import 'server-only';
import { neon } from '@neondatabase/serverless';
import type { CloudPayload, CloudRecordingIndexPage, CloudRow } from '@/shared/cloud-recording';
function database() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('CLOUD_NOT_CONFIGURED');
  return neon(url);
}
async function ready() {
  const sql = database();
  await sql`CREATE TABLE IF NOT EXISTS recording_sync (owner_email text NOT NULL, id text NOT NULL, version integer NOT NULL, payload jsonb, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_email,id))`;
  return sql;
}
const INDEX_PAGE_SIZE = 500;
export async function readCloudRecordingIndex(owner: string, cursor: string | null = null): Promise<CloudRecordingIndexPage> {
  const sql = await ready();
  const rows = cursor === null
    ? await sql`SELECT id,version FROM recording_sync WHERE owner_email=${owner} ORDER BY id ASC LIMIT ${INDEX_PAGE_SIZE}`
    : await sql`SELECT id,version FROM recording_sync WHERE owner_email=${owner} AND id>${cursor} ORDER BY id ASC LIMIT ${INDEX_PAGE_SIZE}`;
  const items = rows as CloudRecordingIndexPage['items'];
  return { items, nextCursor: items.length === INDEX_PAGE_SIZE ? items.at(-1)!.id : null };
}
export async function readCloudRecording(owner: string, id: string): Promise<CloudRow | null> {
  const sql = await ready();
  const rows = await sql`SELECT id,version,payload FROM recording_sync WHERE owner_email=${owner} AND id=${id} LIMIT 1`;
  return (rows[0] as CloudRow) || null;
}
/** Compare-and-swap prevents two devices silently replacing one another. */
export async function writeCloudRecording(owner: string, id: string, expectedVersion: number, payload: CloudPayload | null): Promise<CloudRow | null> {
  const sql = await ready();
  const json = payload === null ? null : JSON.stringify(payload);
  const rows = expectedVersion === 0
    ? await sql`INSERT INTO recording_sync(owner_email,id,version,payload) VALUES(${owner},${id},1,${json}::jsonb) ON CONFLICT DO NOTHING RETURNING id,version,payload`
    : await sql`UPDATE recording_sync SET version=version+1,payload=${json}::jsonb,updated_at=now() WHERE owner_email=${owner} AND id=${id} AND version=${expectedVersion} RETURNING id,version,payload`;
  return (rows[0] as CloudRow) || null;
}
