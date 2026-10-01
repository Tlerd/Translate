import { getDb } from './db';
import { cloudPayloadSchema, cloudRecordingIndexPageSchema, cloudRowResponseSchema, type CloudPayload, type CloudRecordingIndexItem, type CloudRow } from '@/shared/cloud-recording';
import type { RecordingItem, RecordingState } from '@/shared/recording';

interface Baseline { version: number; content: string | null }
let running: Promise<void> | null = null;
export const syncEvent = 'recordings-cloud-sync';
export const dataEvent = 'recordings-cloud-updated';
export type SyncState = { state: 'syncing' | 'done' | 'error'; message: string };
function publish(state: SyncState) { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(syncEvent, { detail: state })); }
function signature(payload: CloudPayload | null) { return payload === null ? null : JSON.stringify(payload); }
function cloudRecording(recording: RecordingItem, state: RecordingState = recording.state): RecordingItem {
  const result: RecordingItem = { ...recording, audioState: 'missing', state };
  delete result.audioMimeType;
  delete result.audioDeletedAt;
  return result;
}
async function baseline(id: string): Promise<Baseline | null> {
  const item = await getDb().settings.get(`cloud:${id}`);
  return item ? JSON.parse(item.value) as Baseline : null;
}
async function remember(row: CloudRow) { await getDb().settings.put({ key: `cloud:${row.id}`, value: JSON.stringify({ version: row.version, content: signature(row.payload) }) }); }
async function snapshot(id: string, db = getDb()): Promise<CloudPayload | null> {
  const recording = await db.recordings.get(id);
  if (!recording) return null;
  const captions = await db.captions.where('recordingId').equals(id).sortBy('id');
  const summaries = await db.summaries.where('recordingId').equals(id).sortBy('id');
  // Binary audio/images and app settings never leave this browser.
  return cloudPayloadSchema.parse({ recording: cloudRecording(recording), captions, summaries });
}
type IngestResult = 'imported' | 'local-edited' | 'active';
async function ingest(row: CloudRow, expectedLocalContent: string | null): Promise<IngestResult> {
  const db = getDb();
  if (row.payload && !cloudPayloadSchema.safeParse(row.payload).success) throw new Error('Dữ liệu cloud không hợp lệ.');
  return db.transaction('rw', [db.recordings, db.captions, db.summaries, db.settings], async () => {
    // Re-read inside the write transaction. Edits made since the initial
    // download snapshot must stay local and dirty for the next sync attempt.
    const current = await snapshot(row.id, db);
    if (signature(current) !== expectedLocalContent) return 'local-edited';
    const before = await db.recordings.get(row.id);
    if (before?.state === 'recording') return 'active'; // Live controller remains the owner of its rows.
    if (row.payload) {
      const state = row.payload.recording.state === 'recording' ? 'interrupted' : row.payload.recording.state;
      const recording = cloudRecording(row.payload.recording, state);
      recording.audioState = before?.audioState ?? 'missing';
      if (before?.audioMimeType) recording.audioMimeType = before.audioMimeType;
      if (before?.audioDeletedAt) recording.audioDeletedAt = before.audioDeletedAt;
      await db.recordings.put(recording);
      await db.captions.where('recordingId').equals(row.id).delete();
      await db.summaries.where('recordingId').equals(row.id).delete();
      await db.captions.bulkPut(row.payload.captions);
      await db.summaries.bulkPut(row.payload.summaries);
      // Local audio presence/state intentionally differs by device.
      const baselinePayload = { ...row.payload, recording: cloudRecording(row.payload.recording, state) };
      await db.settings.put({ key: `cloud:${row.id}`, value: JSON.stringify({ version: row.version, content: signature(baselinePayload) }) });
    } else {
      await db.recordings.delete(row.id);
      await db.captions.where('recordingId').equals(row.id).delete();
      await db.summaries.where('recordingId').equals(row.id).delete();
      await remember(row);
    }
    return 'imported';
  });
}
async function upload(id: string, expectedVersion: number, payload: CloudPayload | null) {
  const response = await fetch('/api/recordings/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, expectedVersion, payload }) });
  if (response.status === 409) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || result.error || 'Đồng bộ chưa hoàn tất.');
  return cloudRow(result.row);
}
function cloudRow(value: unknown): CloudRow {
  const parsed = cloudRowResponseSchema.safeParse({ row: value });
  if (!parsed.success) throw new Error('Phản hồi cloud không hợp lệ.');
  if (!parsed.data.row) throw new Error('Phản hồi cloud không có bản ghi.');
  return parsed.data.row;
}
async function fetchIndex(): Promise<Map<string, CloudRecordingIndexItem>> {
  const items = new Map<string, CloudRecordingIndexItem>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  while (true) {
    const query = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`;
    const response = await fetch(`/api/recordings/sync${query}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || body.error || 'Cloud chưa sẵn sàng.');
    const parsed = cloudRecordingIndexPageSchema.safeParse(body);
    if (!parsed.success) throw new Error('Danh sách cloud không hợp lệ.');
    const page = parsed.data;
    for (const item of page.items) {
      if (items.has(item.id)) throw new Error('Danh sách cloud bị lặp.');
      items.set(item.id, item);
    }
    if (!page.nextCursor) return items;
    if (seenCursors.has(page.nextCursor) || page.items.at(-1)?.id !== page.nextCursor) throw new Error('Phân trang cloud không hợp lệ.');
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
async function fetchRemoteRow(id: string): Promise<CloudRow> {
  const response = await fetch(`/api/recordings/sync?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || body.error || 'Không tải được bản ghi cloud.');
  const parsed = cloudRowResponseSchema.safeParse(body);
  if (!parsed.success || !parsed.data.row || parsed.data.row.id !== id) throw new Error('Bản ghi cloud đã đổi trong lúc đồng bộ. Hãy thử lại.');
  return parsed.data.row;
}
async function preserveConflict(payload: CloudPayload) {
  const db = getDb(); const id = `conflict-${crypto.randomUUID()}`;
  const copy: CloudPayload = {
    recording: { ...cloudRecording(payload.recording, 'stopped'), id, title: `${payload.recording.title.slice(0, 1960)} (bản sao khi xung đột)` },
    captions: payload.captions.map(c => ({ ...c, recordingId: id })),
    summaries: payload.summaries.map(s => ({ ...s, id: `summary-${crypto.randomUUID()}`, recordingId: id })),
  };
  await db.transaction('rw', [db.recordings, db.captions, db.summaries], async () => {
    await db.recordings.put(copy.recording); await db.captions.bulkPut(copy.captions); await db.summaries.bulkPut(copy.summaries);
  });
  const row = await upload(id, 0, copy); if (row) await remember(row);
}
async function runSync() {
  publish({ state: 'syncing', message: 'Đang đồng bộ chữ…' });
  const remoteIndex = await fetchIndex();
  const db = getDb(); const local = await db.recordings.toArray();
  const memories = await db.settings.where('key').startsWith('cloud:').toArray();
  const ids = new Set([...remoteIndex.keys(), ...local.map(r => r.id), ...memories.map(m => m.key.slice(6))]);
  let conflicts = 0;
  for (const id of ids) {
    const payload = await snapshot(id); const prev = await baseline(id); const remoteHead = remoteIndex.get(id);
    if (!payload && !remoteHead && !prev) continue;
    const changed = signature(payload) !== (prev?.content ?? null);
    if (remoteHead && (!prev || remoteHead.version !== prev.version)) {
      const remote = await fetchRemoteRow(id);
      if (changed && payload && signature(payload) !== signature(remote.payload)) {
        if (payload.recording.state === 'recording') continue;
        await preserveConflict(payload); conflicts++;
      }
      const imported = await ingest(remote, signature(payload));
      if (imported === 'local-edited') throw new Error('Bản ghi được sửa trên thiết bị này trong lúc tải. Lần đồng bộ kế tiếp sẽ giữ cả hai bản.');
      continue;
    }
    if (changed || (payload && !remoteHead)) {
      const sent = signature(payload); const saved = await upload(id, prev?.version ?? 0, payload);
      if (!saved) throw new Error('Thiết bị khác vừa thay đổi bản ghi. Lần đồng bộ kế tiếp sẽ giữ cả hai bản.');
      // Remember the exact uploaded snapshot, so edits made during fetch remain dirty.
      await db.settings.put({ key: `cloud:${id}`, value: JSON.stringify({ version: saved.version, content: sent }) });
    }
  }
  window.dispatchEvent(new Event(dataEvent));
  publish({ state: 'done', message: conflicts ? `Đã đồng bộ; giữ ${conflicts} bản sao do sửa đồng thời.` : 'Đã đồng bộ chữ · audio trên máy' });
}
export function synchronizeRecordings(): Promise<void> {
  if (running) return running;
  running = runSync().catch(error => publish({ state: 'error', message: error instanceof Error ? error.message : 'Chưa đồng bộ. Dữ liệu trên máy được giữ.' })).finally(() => { running = null; });
  return running;
}
