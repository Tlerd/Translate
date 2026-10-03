import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase, resetDbInstance, getDb } from '@/storage/db';
import { addAudioChunk, createRecording, deleteAudioOnly, updateRecording } from '@/storage/recordings';
import { sha256 } from '@/storage/audio-assets';
import { playableAudio, synchronizeAudio } from '@/storage/audio-sync';
import type { AudioFileMetadata, RemoteAudio } from '@/shared/audio';

const upload = vi.hoisted(() => vi.fn());
vi.mock('@vercel/blob/client', () => ({ uploadPresigned: upload }));
vi.mock('@/storage/audio-assets', async importOriginal => {
  const actual = await importOriginal<typeof import('@/storage/audio-assets')>();
  return { ...actual, ensureNormalizedAudio: vi.fn(async (id: string) => {
    const blob = new Blob(['normalized audio fixture'], { type: 'audio/webm' });
    const file: AudioFileMetadata = { checksum: await actual.sha256(blob), sizeBytes: blob.size, durationMs: 1000, mimeType: 'audio/webm', formatVersion: 1 };
    const asset = { recordingId: id, blob, file, status: 'queued' as const };
    await getDb().audioAssets.put(asset); return asset;
  }) };
});
let remote: RemoteAudio | null;
let cloudBlob: Blob | null;
let offline: boolean;
let loseConfirmation: boolean;
let expiredRead: boolean;
let readPermissions: number;
let databases: AppDatabase[];
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
async function device(name: string, withOriginal: boolean) {
  const db = new AppDatabase(`audio-sync-${name}-${crypto.randomUUID()}`); databases.push(db); resetDbInstance(db);
  await createRecording({ id: 'lesson', mode: 'lecture', sourceLanguage: 'ja-JP', targetLanguage: 'vi', translationModelKey: 'test' });
  await updateRecording('lesson', { state: 'stopped' });
  if (withOriginal) await addAudioChunk({ recordingId: 'lesson', segmentIndex: 1, sequence: 0, timestamp: 0, mimeType: 'audio/webm', blob: new Blob(['original audio']) });
  return db;
}
beforeEach(() => {
  databases = []; remote = null; cloudBlob = null; offline = false; loseConfirmation = false; expiredRead = false; readPermissions = 0;
  upload.mockReset().mockImplementation(async (_path: string, blob: Blob) => { cloudBlob = blob; return {}; });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (offline) throw new TypeError('offline');
    if (url.startsWith('https://storage.local/')) {
      if (expiredRead) { expiredRead = false; return new Response(null, { status: 403 }); }
      return new Response(cloudBlob);
    }
    const method = options?.method ?? 'GET';
    const query = new URL(url, 'https://app.local').searchParams;
    if (method === 'GET' && query.get('play')) { readPermissions++; return json({ audio: remote, url: `https://storage.local/audio?grant=${readPermissions}`, expiresAt: Date.now() + 1000 }); }
    if (method === 'GET') return query.has('id') ? json({ audio: remote }) : json({ items: remote ? [remote] : [], nextCursor: null });
    if (method === 'PUT') {
      const body = JSON.parse(String(options?.body));
      if (remote?.state === 'deleted') return json({ error: 'deleted' }, 409);
      remote ??= { recordingId: body.id, version: 1, state: 'pending', file: body.file, pathname: 'recordings/owner/file.webm', updatedAt: new Date().toISOString() };
      return json({ audio: remote });
    }
    if (method === 'POST') {
      if (!cloudBlob) return json({ error: 'upload missing' }, 503);
      if (loseConfirmation) { loseConfirmation = false; throw new TypeError('tab closed before confirmation'); }
      if (remote!.state === 'deleted') return json({ error: 'deleted' }, 409);
      if (remote!.state === 'pending') remote = { ...remote!, version: remote!.version + 1, state: 'available' };
      return json({ audio: remote });
    }
    if (method === 'DELETE') { remote = { ...remote!, recordingId: 'lesson', version: (remote?.version ?? 0) + 1, state: 'deleted', file: null, pathname: null, updatedAt: new Date().toISOString() }; cloudBlob = null; return json({ audio: remote }); }
    throw new Error(`Unexpected ${method}`);
  }));
});
afterEach(async () => { for (const db of databases) await db.delete(); resetDbInstance(); vi.unstubAllGlobals(); });
describe('persistent audio sync across devices', () => {
  it('uploads from A, verifies and caches playback on B, renewing an expired URL', async () => {
    const a = await device('a', true);
    expect(await synchronizeAudio()).toEqual({ pending: 0, errors: 0 });
    expect(upload).toHaveBeenCalledOnce(); expect(await a.audioChunks.count()).toBe(1);
    const b = await device('b', false);
    await synchronizeAudio();
    expect((await b.audioAssets.get('lesson'))?.blob).toBeUndefined();
    expiredRead = true; const audio = await playableAudio('lesson');
    expect(await audio.blob!.text()).toBe('normalized audio fixture'); expect(readPermissions).toBe(2);
    expect(await b.audioChunks.count()).toBe(0); expect(await sha256(audio.blob!)).toBe(audio.file!.checksum);
    offline = true; expect((await playableAudio('lesson')).blob).toBeDefined();
  });
  it('persists jobs through offline and app restart, and confirms an already uploaded object without uploading twice', async () => {
    const a = await device('restart', true);
    // Discovery fails while offline; the local file and explicitly queued job survive.
    await a.audioJobs.put({ recordingId: 'lesson', action: 'upload', attempts: 0, nextAttemptAt: 0 });
    offline = true; await expect(synchronizeAudio()).rejects.toThrow('offline');
    expect(await a.audioJobs.count()).toBe(1);
    offline = false; loseConfirmation = true;
    expect((await synchronizeAudio(true)).errors).toBe(1);
    expect(upload).toHaveBeenCalledOnce();
    const reopened = new AppDatabase(a.name); resetDbInstance(reopened);
    await reopened.open();
    expect(await reopened.audioJobs.count()).toBe(1);
    expect(await synchronizeAudio(true)).toEqual({ pending: 0, errors: 0 });
    expect(upload).toHaveBeenCalledOnce(); expect((await reopened.audioAssets.get('lesson'))?.status).toBe('synced');
    reopened.close();
  });
  it('applies deletion to another device before backfilling its old local audio', async () => {
    await device('a', true); await synchronizeAudio();
    const b = await device('b', true);
    await deleteAudioOnly('lesson'); await synchronizeAudio(true);
    const old = await device('old', true);
    await synchronizeAudio(true);
    expect(await old.audioChunks.count()).toBe(0); expect((await old.recordings.get('lesson'))?.audioState).toBe('deleted');
    expect(await old.audioJobs.count()).toBe(0); expect(upload).toHaveBeenCalledOnce();
    await b.open(); expect((await b.audioAssets.get('lesson'))?.status).toBe('deleted'); b.close();
  });
  it('preserves a delete queued while upload is still running', async () => {
    const a = await device('race', true);
    let release!: () => void;
    upload.mockImplementationOnce(async (_path: string, blob: Blob) => { await new Promise<void>(resolve => { release = resolve; }); cloudBlob = blob; return {}; });
    const syncing = synchronizeAudio();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    await deleteAudioOnly('lesson'); release(); await syncing;
    expect((await a.audioJobs.get('lesson'))?.action).toBe('delete');
    expect((await a.audioAssets.get('lesson'))?.status).toBe('deleted');
    await synchronizeAudio(true);
    expect(remote?.state).toBe('deleted'); expect(await a.audioJobs.count()).toBe(0);
  });
});
