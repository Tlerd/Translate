import { uploadPresigned } from '@vercel/blob/client';
import { z } from 'zod';
import { getDb } from './db';
import { ensureNormalizedAudio, notifyAudio, sha256 } from './audio-assets';
import { audioMetadataResponseSchema, remoteAudioSchema, type RemoteAudio, type AudioSyncJob, type LocalAudioAsset } from '@/shared/audio';

const endpoint = '/api/recordings/audio';
const pageSchema = z.object({ items: z.array(remoteAudioSchema).max(500), nextCursor: z.string().nullable() }).strict();
export class AudioSyncError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}
async function jsonRequest(url: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json();
  if (!response.ok) throw new AudioSyncError(typeof body.error === 'string' ? body.error : body.error?.message || 'Không đồng bộ được audio.', response.status);
  return body;
}
function audioResponse(body: unknown): RemoteAudio | null { return audioMetadataResponseSchema.parse(body).audio; }
async function metadata(id: string) { return audioResponse(await jsonRequest(`${endpoint}?id=${encodeURIComponent(id)}`)); }

export async function applyRemoteAudio(remote: RemoteAudio): Promise<void> {
  const db = getDb(); const id = remote.recordingId;
  await db.transaction('rw', [db.recordings, db.audioAssets, db.audioJobs, db.audioChunks, db.audioSegments], async () => {
    const recording = await db.recordings.get(id);
    const asset = await db.audioAssets.get(id);
    if (asset?.remote && asset.remote.version > remote.version) return;
    if (remote.state === 'deleted') {
      if (recording?.state === 'recording') return;
      await db.audioAssets.put({ recordingId: id, status: 'deleted', remote });
      await db.audioChunks.where('recordingId').equals(id).delete();
      await db.audioSegments.where('recordingId').equals(id).delete();
      await db.audioJobs.delete(id);
      if (recording) await db.recordings.update(id, { audioState: 'deleted', audioDeletedAt: remote.updatedAt });
    } else {
      if (asset?.status === 'deleted' || recording?.audioState === 'deleted') return;
      if (!recording) return;
      const conflict = remote.state === 'available' && asset?.blob && asset.file?.checksum !== remote.file?.checksum;
      const status = conflict ? 'error' : remote.state === 'available' ? 'synced' : asset?.status ?? 'queued';
      await db.audioAssets.put({ ...asset, recordingId: id, remote, status, file: asset?.blob ? asset.file : remote.file ?? undefined,
        error: conflict ? 'Audio cloud có nội dung khác. Bản gốc trên thiết bị được giữ.' : asset?.error });
      if (remote.state === 'available') {
        await db.recordings.update(id, { audioState: 'present', audioMimeType: remote.file?.mimeType });
        if (!conflict) await db.audioJobs.delete(id);
      }
    }
  });
  notifyAudio();
}
async function remoteIndex() {
  let cursor: string | null = null; const seen = new Set<string>();
  do {
    const page = pageSchema.parse(await jsonRequest(`${endpoint}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`));
    for (const item of page.items) await applyRemoteAudio(item);
    if (page.nextCursor && (seen.has(page.nextCursor) || page.items.at(-1)?.recordingId !== page.nextCursor)) throw new Error('Phân trang audio không hợp lệ.');
    if (page.nextCursor) seen.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);
}
async function setStatus(id: string, status: LocalAudioAsset['status'], error?: string) {
  const db = getDb();
  await db.transaction('rw', db.audioAssets, async () => {
    const asset = await db.audioAssets.get(id);
    if (asset && asset.status !== 'deleted') await db.audioAssets.put({ ...asset, status, error });
  });
  notifyAudio();
}
async function uploadJob(job: AudioSyncJob) {
  const db = getDb(); const id = job.recordingId;
  const remote = await metadata(id);
  if (remote) { await applyRemoteAudio(remote); if (remote.state !== 'pending') return; }
  const file = await ensureNormalizedAudio(id);
  if (!file.blob || !file.file) throw new Error('Chưa chuẩn hóa được audio.');
  const currentJob = await db.audioJobs.get(id);
  if (currentJob?.action !== 'upload') return;
  const reserved = audioResponse(await jsonRequest(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, file: file.file }) }));
  if (!reserved?.pathname || !reserved.file) throw new Error('Không cấp được quyền upload audio.');
  if (reserved.state === 'available') { await applyRemoteAudio(reserved); return; }
  await setStatus(id, 'uploading');
  // Retry confirmation before uploading: a tab may have closed after the
  // multipart upload finished but before the application confirmed it.
  let completed: RemoteAudio | null = null;
  try {
    completed = audioResponse(await jsonRequest(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, version: reserved.version }) }));
  } catch (error) {
    if (error instanceof AudioSyncError && (error.status === 401 || error.status === 409)) throw error;
  }
  if (!completed) {
    await uploadPresigned(reserved.pathname, file.blob, { access: 'private', contentType: file.file.mimeType,
      multipart: true, handleUploadUrl: `${endpoint}/upload`, clientPayload: JSON.stringify({ id, version: reserved.version }) });
    completed = audioResponse(await jsonRequest(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, version: reserved.version }) }));
  }
  if (!completed) throw new Error('Upload chưa được xác nhận.');
  // Local delete wins even if an upload response arrives afterwards.
  const latestJob = await db.audioJobs.get(id);
  if (latestJob?.action === 'delete') return;
  await applyRemoteAudio(completed);
}
async function deleteJob(job: AudioSyncJob) {
  try {
    const remote = audioResponse(await jsonRequest(`${endpoint}?id=${encodeURIComponent(job.recordingId)}`, { method: 'DELETE' }));
    if (remote) await applyRemoteAudio(remote);
  } catch (error) {
    if (!(error instanceof AudioSyncError) || error.status !== 404) throw error;
    await getDb().audioJobs.delete(job.recordingId); // Never uploaded or synced.
  }
}
export async function synchronizeAudio(retry = false): Promise<{ pending: number; errors: number }> {
  const db = getDb();
  await remoteIndex(); // Apply tombstones before considering any local upload.
  const recordings = await db.recordings.toArray();
  for (const recording of recordings) {
    if (recording.state === 'recording' || recording.audioState !== 'present') continue;
    const asset = await db.audioAssets.get(recording.id);
    if (asset?.status === 'synced' || asset?.status === 'deleted' || await db.audioJobs.get(recording.id)) continue;
    if (await db.audioChunks.where('recordingId').equals(recording.id).count()) await db.audioJobs.put({ recordingId: recording.id, action: 'upload', attempts: 0, nextAttemptAt: 0 });
  }
  const jobs = await db.audioJobs.toArray();
  jobs.sort((a, b) => (a.action === 'delete' ? 0 : 1) - (b.action === 'delete' ? 0 : 1));
  for (const job of jobs) {
    if (!retry && job.nextAttemptAt > Date.now()) continue;
    try { if (job.action === 'delete') await deleteJob(job); else await uploadJob(job); }
    catch (error) {
      const latest = await db.audioJobs.get(job.recordingId);
      if (!latest || latest.action !== job.action) continue;
      const message = error instanceof Error ? error.message : 'Audio chưa đồng bộ.';
      await db.audioJobs.put({ ...job, attempts: job.attempts + 1, nextAttemptAt: Date.now() + Math.min(5 * 60_000, 5000 * 2 ** Math.min(job.attempts, 6)), error: message });
      await setStatus(job.recordingId, 'error', message);
    }
  }
  const remaining = await db.audioJobs.toArray();
  return { pending: remaining.length, errors: remaining.filter(job => job.error).length };
}
export async function playableAudio(id: string, signal?: AbortSignal): Promise<LocalAudioAsset> {
  const db = getDb(); const local = await db.audioAssets.get(id);
  if (local?.status === 'deleted') throw new Error('Audio đã được xóa.');
  if (local?.blob && local.file) return local;
  if (await db.audioChunks.where('recordingId').equals(id).count()) return ensureNormalizedAudio(id);
  const permissionSchema = z.object({ audio: remoteAudioSchema, url: z.string().url(), expiresAt: z.number() }).strict();
  let permission = permissionSchema.parse(await jsonRequest(`${endpoint}?id=${encodeURIComponent(id)}&play=1`, { signal }));
  let response = await fetch(permission.url, { signal, cache: 'no-store' });
  if (response.status === 401 || response.status === 403) {
    permission = permissionSchema.parse(await jsonRequest(`${endpoint}?id=${encodeURIComponent(id)}&play=1`, { signal }));
    response = await fetch(permission.url, { signal, cache: 'no-store' });
  }
  if (!response.ok || !permission.audio.file) throw new Error('Không tải được audio. Thử lại để lấy quyền nghe mới.');
  const blob = new Blob([await response.blob()], { type: permission.audio.file.mimeType });
  if (blob.size !== permission.audio.file.sizeBytes || await sha256(blob) !== permission.audio.file.checksum) throw new Error('Audio tải về không khớp checksum. Hãy thử lại.');
  const currentRemote = await metadata(id);
  if (currentRemote?.state !== 'available' || currentRemote.version !== permission.audio.version) {
    if (currentRemote) await applyRemoteAudio(currentRemote);
    throw new Error('Audio đã thay đổi hoặc đã xóa trên thiết bị khác.');
  }
  return db.transaction('rw', [db.audioAssets, db.recordings], async () => {
    const latest = await db.audioAssets.get(id);
    const recording = await db.recordings.get(id);
    if (!recording || latest?.status === 'deleted' || recording.audioState === 'deleted') throw new Error('Audio đã được xóa trong lúc tải.');
    const asset: LocalAudioAsset = { recordingId: id, blob, file: permission.audio.file!, remote: permission.audio, status: 'synced' };
    await db.audioAssets.put(asset); notifyAudio(); return asset;
  });
}
