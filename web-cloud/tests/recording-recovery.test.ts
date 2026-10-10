import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase, getDb, resetDbInstance } from '@/storage/db';
import {
  addAudioChunk,
  createAudioSegment,
  createRecording,
  getAudioSegments,
  getRecording,
  recoverStaleRecordings,
  saveCaption,
  softDeleteRecording,
  updateRecording,
} from '@/storage/recordings';
import { recoverInterruptedRecordings } from '@/features/recording/recover-recordings';
import { RECORDING_LOCK_PREFIX, holdRecordingLock, liveRecordingIds } from '@/features/recording/recording-lock';

const MODEL = 'google:gemini-3.5-flash-lite';
const HOUR = 60 * 60 * 1000;

async function seed(id: string, options: { createdAt?: string; state?: 'recording' | 'stopped' | 'interrupted'; segment?: boolean } = {}) {
  await createRecording({ id, mode: 'lecture', sourceLanguage: 'ja-JP', targetLanguage: 'vi', translationModelKey: MODEL });
  await updateRecording(id, { state: options.state ?? 'recording', ...(options.createdAt ? { createdAt: options.createdAt } : {}) });
  if (options.segment !== false) {
    await createAudioSegment({ recordingId: id, segmentIndex: 1, kind: 'translating', label: 'Toàn buổi', startMs: 0, status: 'recording' });
  }
}

async function addChunk(recordingId: string, sequence: number, timestamp: number) {
  await addAudioChunk({ recordingId, sequence, mimeType: 'audio/webm', timestamp, blob: new Blob(['x']) });
}

async function addCaption(recordingId: string, endMs: number) {
  await saveCaption({
    id: 1, recordingId, blockId: 1, startMs: 0, endMs, source: 'a', revision: 1, isFinal: true,
    translation: 'b', targetSourceRevision: 1, state: 'done',
  });
}

describe('recoverStaleRecordings', () => {
  beforeEach(() => {
    resetDbInstance(new AppDatabase(`test_recovery_${Date.now()}_${Math.random()}`));
  });

  it('closes a stuck recording from its audio and captions, and makes it deletable', async () => {
    await seed('stuck', { createdAt: '2026-03-01T10:00:00.000Z' });
    await addChunk('stuck', 0, 2000);
    await addChunk('stuck', 1, 4000);
    await addCaption('stuck', 5200);
    await expect(softDeleteRecording('stuck')).rejects.toThrow();

    const count = await recoverStaleRecordings({ isLive: () => false });

    expect(count).toBe(1);
    const recording = await getRecording('stuck');
    expect(recording).toMatchObject({
      state: 'interrupted',
      durationMs: 5200,
      audioState: 'present',
      endedAt: new Date(Date.parse('2026-03-01T10:00:00.000Z') + 5200).toISOString(),
    });
    const [segment] = await getAudioSegments('stuck');
    expect(segment).toMatchObject({ status: 'completed', endMs: 5200, durationMs: 5200 });
    await expect(softDeleteRecording('stuck')).resolves.toBeUndefined();
  });

  it('queues recovered audio for upload', async () => {
    await seed('queued');
    await addChunk('queued', 0, 1000);
    await recoverStaleRecordings({ isLive: () => false });
    expect(await getDb().audioJobs.get('queued')).toMatchObject({ action: 'upload' });
  });

  it('fails the segment and keeps zero duration when nothing was captured', async () => {
    await seed('empty', { createdAt: '2026-03-01T10:00:00.000Z' });

    expect(await recoverStaleRecordings({ isLive: () => false })).toBe(1);

    const recording = await getRecording('empty');
    expect(recording).toMatchObject({ state: 'interrupted', durationMs: 0, endedAt: '2026-03-01T10:00:00.000Z' });
    const [segment] = await getAudioSegments('empty');
    expect(segment.status).toBe('failed');
    expect(await getDb().audioJobs.get('empty')).toBeUndefined();
  });

  it('leaves live recordings untouched', async () => {
    await seed('live');
    await seed('dead');

    const count = await recoverStaleRecordings({ isLive: (id) => id === 'live' });

    expect(count).toBe(1);
    expect((await getRecording('live'))?.state).toBe('recording');
    expect((await getRecording('dead'))?.state).toBe('interrupted');
  });

  it('skips rows younger than the minimum age', async () => {
    const now = Date.parse('2026-03-02T00:00:00.000Z');
    await seed('fresh', { createdAt: new Date(now - HOUR).toISOString() });
    await seed('old', { createdAt: new Date(now - 13 * HOUR).toISOString() });

    const count = await recoverStaleRecordings({ isLive: () => false, now, minAgeMs: 12 * HOUR });

    expect(count).toBe(1);
    expect((await getRecording('fresh'))?.state).toBe('recording');
    expect((await getRecording('old'))?.state).toBe('interrupted');
  });

  it('does not touch finished recordings', async () => {
    await seed('stopped', { state: 'stopped' });
    await seed('interrupted', { state: 'interrupted' });
    await updateRecording('stopped', { durationMs: 900 });

    expect(await recoverStaleRecordings({ isLive: () => false })).toBe(0);

    expect(await getRecording('stopped')).toMatchObject({ state: 'stopped', durationMs: 900 });
    expect((await getRecording('interrupted'))?.state).toBe('interrupted');
    expect((await getAudioSegments('stopped'))[0].status).toBe('recording');
  });

  it('keeps a larger stored duration', async () => {
    await seed('long');
    await updateRecording('long', { durationMs: 9000 });
    await addChunk('long', 0, 3000);
    await recoverStaleRecordings({ isLive: () => false });
    expect((await getRecording('long'))?.durationMs).toBe(9000);
  });
});

type LockInfo = { name: string };

function stubLocks(snapshot: { held?: LockInfo[]; pending?: LockInfo[] } = {}) {
  const requests: Array<{ name: string; settled: boolean }> = [];
  const locks = {
    request: vi.fn((name: string, callback: () => Promise<void>) => {
      const entry = { name, settled: false };
      requests.push(entry);
      return callback().then(() => { entry.settled = true; });
    }),
    query: vi.fn(async () => snapshot),
  };
  vi.stubGlobal('navigator', { locks });
  return { locks, requests };
}

describe('recording lock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('holds the prefixed lock until released, and release is idempotent', async () => {
    const { locks, requests } = stubLocks();
    const release = holdRecordingLock('abc');
    expect(locks.request).toHaveBeenCalledWith(`${RECORDING_LOCK_PREFIX}abc`, expect.any(Function));
    await Promise.resolve();
    expect(requests[0].settled).toBe(false);

    release();
    release();
    await vi.waitFor(() => expect(requests[0].settled).toBe(true));
  });

  it('swallows lock request failures', async () => {
    vi.stubGlobal('navigator', { locks: { request: vi.fn(() => Promise.reject(new Error('denied'))) } });
    const release = holdRecordingLock('abc');
    await Promise.resolve();
    expect(() => release()).not.toThrow();
  });

  it('is a no-op without Web Locks', async () => {
    vi.stubGlobal('navigator', {});
    expect(() => holdRecordingLock('abc')()).not.toThrow();
    expect(await liveRecordingIds()).toBeNull();
  });

  it('lists held and pending recording ids and ignores other locks', async () => {
    stubLocks({
      held: [{ name: `${RECORDING_LOCK_PREFIX}one` }, { name: 'other-lock' }],
      pending: [{ name: `${RECORDING_LOCK_PREFIX}two` }],
    });
    expect(await liveRecordingIds()).toEqual(new Set(['one', 'two']));
  });

  it('returns null when the query fails', async () => {
    vi.stubGlobal('navigator', { locks: { query: vi.fn().mockRejectedValue(new Error('boom')) } });
    expect(await liveRecordingIds()).toBeNull();
  });
});

describe('recoverInterruptedRecordings', () => {
  beforeEach(() => {
    resetDbInstance(new AppDatabase(`test_recover_wiring_${Date.now()}_${Math.random()}`));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('spares recordings that hold a lock or are active in this tab', async () => {
    stubLocks({ held: [{ name: `${RECORDING_LOCK_PREFIX}other-tab` }] });
    await seed('other-tab');
    await seed('mine');
    await seed('abandoned');

    const count = await recoverInterruptedRecordings(() => 'mine');

    expect(count).toBe(1);
    expect((await getRecording('other-tab'))?.state).toBe('recording');
    expect((await getRecording('mine'))?.state).toBe('recording');
    expect((await getRecording('abandoned'))?.state).toBe('interrupted');
  });

  it('only recovers clearly abandoned rows when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await seed('recent');
    await seed('ancient', { createdAt: new Date(Date.now() - 13 * HOUR).toISOString() });

    const count = await recoverInterruptedRecordings(() => null);

    expect(count).toBe(1);
    expect((await getRecording('recent'))?.state).toBe('recording');
    expect((await getRecording('ancient'))?.state).toBe('interrupted');
  });
});
