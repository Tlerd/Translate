import 'server-only';
import { createHash } from 'node:crypto';
import { deleteObject, getObjectStream, headObject, isObjectStorageConfigured, presignGetUrl } from './object-storage';
import { readCloudRecording } from './recording-store';
import { cleanupDeletedAudio, completeAudio, readAudio, tombstoneAudio } from './audio-store';

export class AudioRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function requireAudioStorage() {
  if (!isObjectStorageConfigured()) throw new AudioRequestError(503, 'Chưa kết nối kho audio private. Chữ vẫn được đồng bộ, audio gốc vẫn trên máy.');
}
export async function requireRecordingOwner(owner: string, id: string, allowDeleted = false) {
  const row = await readCloudRecording(owner, id);
  if (!row || (!allowDeleted && !row.payload)) throw new AudioRequestError(404, 'Không tìm thấy bản ghi của tài khoản này.');
  return row;
}
export async function playbackPermission(owner: string, id: string) {
  await requireRecordingOwner(owner, id);
  const audio = await readAudio(owner, id);
  if (!audio || audio.state !== 'available' || !audio.pathname) throw new AudioRequestError(404, 'Audio chưa đồng bộ hoặc đã xóa.');
  const ttlSeconds = 15 * 60;
  const validUntil = Date.now() + ttlSeconds * 1000;
  return { audio, url: await presignGetUrl(audio.pathname, ttlSeconds), expiresAt: validUntil };
}
export async function verifyUploadedAudio(owner: string, id: string, version: number) {
  await requireRecordingOwner(owner, id);
  const audio = await readAudio(owner, id);
  if (audio?.state === 'available' && audio.version === version + 1) return audio;
  if (!audio || audio.state !== 'pending' || audio.version !== version || !audio.file || !audio.pathname) {
    if (audio?.state === 'deleted' && audio.pathname) await deleteObject(audio.pathname);
    throw new AudioRequestError(409, 'Audio đã thay đổi hoặc đã xóa trên thiết bị khác.');
  }
  const info = await headObject(audio.pathname);
  // 404, not 409: the client treats 409 as a conflict, but a missing object just means the upload hasn't happened yet.
  if (!info) throw new AudioRequestError(404, 'Chưa thấy file audio đã upload.');
  if (info.size !== audio.file.sizeBytes || info.contentType.split(';')[0] !== audio.file.mimeType) throw new AudioRequestError(400, 'File upload không khớp dung lượng hoặc định dạng đã đăng ký.');
  // Verify the bytes, not a client assertion. Read as a stream so confirmation
  // doesn't buffer a large lesson in the server process or proxy its upload.
  const stream = await getObjectStream(audio.pathname);
  if (!stream) throw new AudioRequestError(409, 'Không kiểm chứng được file đã upload.');
  const reader = stream.getReader();
  const hash = createHash('sha256'); let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > audio.file.sizeBytes) { await reader.cancel(); throw new AudioRequestError(400, 'Dung lượng audio không khớp.'); }
      hash.update(value);
    }
  } finally { reader.releaseLock(); }
  if (bytes !== audio.file.sizeBytes || hash.digest('hex') !== audio.file.checksum) throw new AudioRequestError(400, 'Checksum audio không khớp. Bản gốc trên máy vẫn được giữ.');
  const completed = await completeAudio(owner, id, version);
  if (!completed) {
    const latest = await readAudio(owner, id);
    if (latest?.state === 'deleted') await deleteObject(audio.pathname);
    if (latest?.state === 'available' && latest.file?.checksum === audio.file.checksum) return latest;
    throw new AudioRequestError(409, 'Audio đã thay đổi trong lúc xác nhận.');
  }
  return completed;
}
export async function deleteOwnedAudio(owner: string, id: string) {
  await requireRecordingOwner(owner, id, true);
  const audio = await tombstoneAudio(owner, id);
  if (audio.pathname) { requireAudioStorage(); await deleteObject(audio.pathname); }
  return audio;
}
export async function cleanupAudio(owner: string) {
  if (isObjectStorageConfigured()) await cleanupDeletedAudio(owner, deleteObject);
}
