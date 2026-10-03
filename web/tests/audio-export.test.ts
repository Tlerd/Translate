import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import { addAudioChunk, createRecording, getAudioBlob, updateRecording } from '@/storage/recordings';
import { exportRecordingData } from '@/storage/export-import';
const { playable } = vi.hoisted(() => ({ playable: vi.fn() }));
vi.mock('@/storage/audio-sync', () => ({ playableAudio: playable }));

let db: AppDatabase;
const file = { mimeType: 'audio/webm' as const, durationMs: 2000, sizeBytes: 8, checksum: 'a'.repeat(64), formatVersion: 1 as const };
beforeEach(async () => {
  db = new AppDatabase(`audio-export-${crypto.randomUUID()}`); resetDbInstance(db);
  vi.stubGlobal('Worker', class {});
  playable.mockReset().mockResolvedValue({ recordingId: 'lesson', blob: new Blob(['verified']), file, status: 'synced' });
  await createRecording({ id: 'lesson', mode: 'lecture', sourceLanguage: 'ja-JP', targetLanguage: 'vi', translationModelKey: 'test' });
  await updateRecording('lesson', { state: 'stopped', audioState: 'present' });
});
afterEach(async () => { await db.delete(); resetDbInstance(); vi.unstubAllGlobals(); });
describe('whole-session audio consumers', () => {
  it('exports the verified file rather than concatenating independent legacy containers', async () => {
    for (const segmentIndex of [1, 2]) await addAudioChunk({ recordingId: 'lesson', segmentIndex, sequence: 0, timestamp: segmentIndex, mimeType: 'audio/webm', blob: new Blob(['original']) });
    const exported = await exportRecordingData('lesson');
    expect(await exported.audioBlob?.text()).toBe('verified');
    expect(await db.audioChunks.count()).toBe(2);
    expect(playable).toHaveBeenCalledWith('lesson');
    expect(JSON.parse(exported.jsonString).hasAudio).toBe(true);
  });
  it('retrieves cloud-only audio for export and returns its actual file duration', async () => {
    await db.audioAssets.put({ recordingId: 'lesson', file, status: 'synced', remote: { recordingId: 'lesson', version: 2, state: 'available', file, pathname: 'recordings/file', updatedAt: new Date().toISOString() } });
    expect(await getAudioBlob('lesson')).toMatchObject({ durationMs: 2000, mimeType: 'audio/webm' });
    expect(playable).toHaveBeenCalledOnce();
  });
  it('does not download oversized cloud files or expose deleted cached audio', async () => {
    await db.audioAssets.put({ recordingId: 'lesson', status: 'synced', remote: { recordingId: 'lesson', version: 2, state: 'available', file, pathname: 'recordings/file', updatedAt: new Date().toISOString() } });
    expect(await getAudioBlob('lesson', 4)).toBeNull();
    await db.audioAssets.put({ recordingId: 'lesson', status: 'deleted', blob: new Blob(['deleted']), file });
    expect(await getAudioBlob('lesson')).toBeNull();
    expect(playable).not.toHaveBeenCalled();
  });
});
