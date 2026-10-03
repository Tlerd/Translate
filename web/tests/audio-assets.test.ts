import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import { createRecording, addAudioChunk, deleteAudioOnly, deleteRecording, updateRecording } from '@/storage/recordings';
import { audioParts, ensureNormalizedAudio, queueAudio } from '@/storage/audio-assets';
import { applyRemoteAudio } from '@/storage/audio-sync';
import { opusPacketDuration } from '@/features/recording/normalize-audio';

let db: AppDatabase;
beforeEach(async () => {
  db = new AppDatabase(`audio-assets-${crypto.randomUUID()}`); resetDbInstance(db);
  await createRecording({ id: 'lesson', mode: 'lecture', sourceLanguage: 'ja-JP', targetLanguage: 'vi', translationModelKey: 'test' });
});
afterEach(async () => { await db.delete(); resetDbInstance(); vi.unstubAllGlobals(); });
describe('audio persistence', () => {
  it('orders each legacy recorder by sequence even when its final write arrives late', async () => {
    const chunks = [
      { recordingId: 'lesson', segmentIndex: 2, sequence: 0, timestamp: 10, mimeType: 'audio/webm', blob: new Blob(['new-header']) },
      { recordingId: 'lesson', segmentIndex: 1, sequence: 1, timestamp: 20, mimeType: 'audio/webm', blob: new Blob(['old-tail']) },
      { recordingId: 'lesson', segmentIndex: 1, sequence: 0, timestamp: 0, mimeType: 'audio/webm', blob: new Blob(['old-header']) },
    ];
    expect(await Promise.all(audioParts(chunks).map(part => part.blob.text()))).toEqual(['old-headerold-tail', 'new-header']);
  });
  it('queues stopped local audio and preserves deletion intent after removing a recording', async () => {
    await addAudioChunk({ recordingId: 'lesson', segmentIndex: 1, sequence: 0, timestamp: 0, mimeType: 'audio/webm', blob: new Blob(['original']) });
    await queueAudio('lesson'); expect(await db.audioJobs.get('lesson')).toBeUndefined();
    await updateRecording('lesson', { state: 'stopped' }); await queueAudio('lesson');
    expect((await db.audioJobs.get('lesson'))?.action).toBe('upload');
    await deleteRecording('lesson');
    expect(await db.recordings.get('lesson')).toBeUndefined();
    expect(await db.audioJobs.get('lesson')).toMatchObject({ action: 'delete' });
    expect(await db.audioAssets.get('lesson')).toMatchObject({ status: 'deleted' });
  });
  it('clears old-device chunks on a cloud tombstone and does not resurrect them', async () => {
    await updateRecording('lesson', { state: 'stopped' });
    await addAudioChunk({ recordingId: 'lesson', sequence: 0, timestamp: 0, mimeType: 'audio/webm', blob: new Blob(['old-device-original']) });
    await queueAudio('lesson');
    await applyRemoteAudio({ recordingId: 'lesson', version: 3, state: 'deleted', file: null, pathname: null, updatedAt: new Date().toISOString() });
    expect(await db.audioChunks.count()).toBe(0); expect(await db.audioJobs.count()).toBe(0);
    await queueAudio('lesson'); expect(await db.audioJobs.count()).toBe(0);
    await expect(ensureNormalizedAudio('lesson')).rejects.toThrow('xóa');
  });
  it('keeps a local delete when an older upload confirmation arrives', async () => {
    await updateRecording('lesson', { state: 'stopped' }); await deleteAudioOnly('lesson');
    await applyRemoteAudio({ recordingId: 'lesson', version: 2, state: 'available', file: { checksum: 'a'.repeat(64), durationMs: 1000, sizeBytes: 10, mimeType: 'audio/webm', formatVersion: 1 }, pathname: 'recordings/file', updatedAt: new Date().toISOString() });
    expect(await db.audioAssets.get('lesson')).toMatchObject({ status: 'deleted' });
    expect(await db.audioJobs.get('lesson')).toMatchObject({ action: 'delete' });
  });
  it('reads actual Opus sample durations when container packets omit duration', () => {
    expect(opusPacketDuration(Uint8Array.of(255, 3))).toBe(.06);
    expect(opusPacketDuration(Uint8Array.of(152))).toBe(.02);
    expect(() => opusPacketDuration(Uint8Array.of(255, 63))).toThrow();
  });
});
