import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { AppDatabase, getDb, resetDbInstance } from '@/storage/db';
import {
  TRASH_RETENTION_DAYS,
  createRecording,
  getRecording,
  purgeExpiredTrash,
  trashExpiresAt,
  updateRecording,
} from '@/storage/recordings';

const MODEL = 'google:gemini-3.5-flash-lite';
const DAY = 24 * 60 * 60 * 1000;

// 'now' for every purge below; deletion times are measured back from it.
const NOW = Date.parse('2026-02-01T00:00:00.000Z');

async function seed(id: string, options: { deletedAt?: string; state?: 'stopped' | 'recording' } = {}) {
  await createRecording({
    id,
    title: id,
    mode: 'lecture',
    sourceLanguage: 'ja-JP',
    targetLanguage: 'vi',
    translationModelKey: MODEL,
  });
  await updateRecording(id, { state: options.state ?? 'stopped', deletedAt: options.deletedAt });
}

function isoBefore(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe('trash expiry', () => {
  it('keeps the retention period at 30 days', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
  });

  it('expires 30 days after the deletion time', () => {
    const deletedAt = '2026-01-01T00:00:00.000Z';
    expect(trashExpiresAt(deletedAt)).toBe(Date.parse(deletedAt) + 30 * DAY);
  });

  it('never expires a deletion time it cannot read', () => {
    expect(trashExpiresAt('not a date')).toBe(Number.POSITIVE_INFINITY);
    expect(trashExpiresAt('')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('purgeExpiredTrash', () => {
  beforeEach(() => {
    resetDbInstance(new AppDatabase(`test_trash_retention_${Date.now()}_${Math.random()}`));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('purges only trash older than the retention window, at the exact boundary and beyond', async () => {
    await seed('exactly_30_days', { deletedAt: isoBefore(30 * DAY) });
    await seed('30_days_minus_1ms', { deletedAt: isoBefore(30 * DAY - 1) });
    await seed('29_days', { deletedAt: isoBefore(29 * DAY) });
    await seed('31_days', { deletedAt: isoBefore(31 * DAY) });
    await seed('live');
    await seed('unreadable', { deletedAt: 'not a date' });
    await seed('recording_in_progress', { deletedAt: isoBefore(31 * DAY), state: 'recording' });

    const purged = await purgeExpiredTrash(NOW);

    expect(purged).toBe(2);
    expect(await getRecording('exactly_30_days')).toBeUndefined();
    expect(await getRecording('31_days')).toBeUndefined();
    expect(await getRecording('30_days_minus_1ms')).toBeDefined();
    expect(await getRecording('29_days')).toBeDefined();
    expect(await getRecording('live')).toBeDefined();
    expect(await getRecording('unreadable')).toBeDefined();
    expect(await getRecording('recording_in_progress')).toBeDefined();
  });

  it('queues a cloud delete job and removes the local row for each purged recording', async () => {
    await seed('purge_me', { deletedAt: isoBefore(31 * DAY) });

    await purgeExpiredTrash(NOW);

    const db = getDb();
    expect(await db.recordings.get('purge_me')).toBeUndefined();
    expect(await db.audioJobs.get('purge_me')).toMatchObject({ action: 'delete' });
  });

  it('returns zero and changes nothing when nothing has expired', async () => {
    await seed('recent', { deletedAt: isoBefore(DAY) });
    expect(await purgeExpiredTrash(NOW)).toBe(0);
    expect(await getRecording('recent')).toBeDefined();
  });

  it('keeps purging the other items when one item fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await seed('expired_a', { deletedAt: isoBefore(31 * DAY) });
    await seed('expired_b', { deletedAt: isoBefore(31 * DAY) });

    const db = getDb();
    const failing = vi.spyOn(db.audioAssets, 'put').mockRejectedValueOnce(new Error('disk full'));

    const purged = await purgeExpiredTrash(NOW);

    expect(failing).toHaveBeenCalledTimes(2);
    expect(purged).toBe(1);
    const remaining = await db.recordings.toArray();
    expect(remaining).toHaveLength(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
