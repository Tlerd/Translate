import { getDb } from './db';
import { AUDIO_FORMAT_VERSION, audioChangedEvent, audioWorkEvent, compareAudioChunkOrder, type LocalAudioAsset, type AudioFileMetadata } from '@/shared/audio';
import type { AudioChunk } from '@/shared/recording';
import type { AudioPart, NormalizedAudio } from '@/features/recording/normalize-audio';

const pending = new Map<string, Promise<LocalAudioAsset>>();
export function notifyAudio(work = false) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(audioChangedEvent));
    if (work) window.dispatchEvent(new Event(audioWorkEvent));
  }
}
export async function queueAudio(recordingId: string) {
  const db = getDb();
  let queued = false;
  await db.transaction('rw', [db.recordings, db.audioJobs, db.audioAssets], async () => {
    const recording = await db.recordings.get(recordingId);
    if (!recording || recording.state === 'recording' || recording.audioState !== 'present') return;
    const asset = await db.audioAssets.get(recordingId);
    if (asset?.status === 'deleted' || asset?.remote?.state === 'deleted' || asset?.status === 'synced') return;
    const existing = await db.audioJobs.get(recordingId);
    if (!existing) await db.audioJobs.put({ recordingId, action: 'upload', attempts: 0, nextAttemptAt: 0 });
    queued = true;
  });
  notifyAudio(true);
  if (queued && typeof Worker !== 'undefined') {
    // Normalization also runs offline. Upload waits for text ownership to be
    // synced; closing the tab leaves the original and persistent job intact.
    void ensureNormalizedAudio(recordingId).catch(() => undefined).finally(() => notifyAudio(true));
  }
}
export function audioParts(chunks: AudioChunk[]): AudioPart[] {
  const groups = new Map<number, AudioChunk[]>();
  for (const chunk of chunks) {
    const index = chunk.segmentIndex ?? 1;
    const group = groups.get(index) ?? [];
    group.push(chunk); groups.set(index, group);
  }
  return [...groups].sort(([a], [b]) => a - b).map(([segmentIndex, group]) => {
    group.sort(compareAudioChunkOrder);
    return { segmentIndex, blob: new Blob(group.map(chunk => chunk.blob), { type: group[0].mimeType }) };
  });
}
function normalizeInWorker(parts: AudioPart[]): Promise<NormalizedAudio> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../features/recording/audio-normalizer.worker.ts', import.meta.url));
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Chuẩn hóa audio quá thời gian chờ. Bản gốc vẫn được giữ.')); }, 10 * 60_000);
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    worker.onmessage = (event: MessageEvent<{ result?: NormalizedAudio; error?: string }>) => {
      finish();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error || 'Không chuẩn hóa được audio.'));
    };
    worker.onerror = () => { finish(); reject(new Error('Không khởi chạy được bộ xử lý audio. Hãy tải lại để thử lại.')); };
    worker.postMessage(parts);
  });
}
export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function ensureNormalizedAudio(recordingId: string): Promise<LocalAudioAsset> {
  const existing = pending.get(recordingId);
  if (existing) return existing;
  const task = normalizeLocal(recordingId).finally(() => pending.delete(recordingId));
  pending.set(recordingId, task);
  return task;
}
async function normalizeLocal(recordingId: string): Promise<LocalAudioAsset> {
  const db = getDb();
  const recording = await db.recordings.get(recordingId);
  if (!recording || recording.state === 'recording') throw new Error('Kết thúc buổi thu để nghe hoặc đồng bộ audio.');
  let asset = await db.audioAssets.get(recordingId);
  if (recording.audioState === 'deleted' || asset?.status === 'deleted') throw new Error('Audio đã được xóa.');
  if (asset?.blob && asset.file?.formatVersion === AUDIO_FORMAT_VERSION) return asset;
  asset = { ...asset, recordingId, status: 'normalizing', error: undefined };
  await db.audioAssets.put(asset); notifyAudio();
  try {
    const chunks = await db.audioChunks.where('recordingId').equals(recordingId).toArray();
    const result = await normalizeInWorker(audioParts(chunks));
    const checksum = await sha256(result.blob);
    const file: AudioFileMetadata = { mimeType: result.blob.type as 'audio/webm' | 'audio/mp4', durationMs: result.durationMs, sizeBytes: result.blob.size, checksum, formatVersion: AUDIO_FORMAT_VERSION };
    return await db.transaction('rw', [db.recordings, db.audioAssets], async () => {
      const current = await db.recordings.get(recordingId);
      const latest = await db.audioAssets.get(recordingId);
      if (!current || current.audioState === 'deleted' || latest?.status === 'deleted') throw new Error('Audio đã được xóa trong lúc chuẩn hóa.');
      const completed: LocalAudioAsset = { ...latest, recordingId, blob: result.blob, file, status: latest?.remote?.state === 'available' && latest.remote.file?.checksum === checksum ? 'synced' : 'queued', error: undefined };
      await db.audioAssets.put(completed);
      return completed;
    });
  } catch (error) {
    const latest = await db.audioAssets.get(recordingId);
    if (latest && latest.status !== 'deleted') await db.audioAssets.put({ ...latest, status: 'error', error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally { notifyAudio(); }
}
