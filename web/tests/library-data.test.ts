import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { AppDatabase, getDb, resetDbInstance } from '@/storage/db';
import type { LocalAudioAsset } from '@/shared/audio';
import type { RecordingItem, SummaryItem } from '@/shared/recording';
import { loadLibraryEntries } from '@/features/library/library-data';
import { queryLibrary } from '@/features/library/library-query';

function rec(id: string, overrides: Partial<RecordingItem> = {}): RecordingItem {
  return {
    id,
    title: id,
    createdAt: '2026-01-09T05:00:00Z',
    mode: 'lecture',
    sourceLanguage: 'ja-JP',
    targetLanguage: 'vi',
    state: 'stopped',
    durationMs: 60_000,
    audioState: 'missing',
    config: { translationModelKey: 'google:test' },
    ...overrides,
  };
}

function summary(id: string, recordingId: string): SummaryItem {
  return {
    id,
    recordingId,
    sourceHash: 'hash',
    preset: 'default',
    modelKey: 'google:test',
    title: 'Tóm tắt',
    overview: '',
    sections: [],
    generatedAt: '2026-01-09T06:00:00Z',
  };
}

function asset(recordingId: string, status: LocalAudioAsset['status']): LocalAudioAsset {
  return { recordingId, status };
}

function cloudKey(recordingId: string) {
  return { key: `cloud:${recordingId}`, value: JSON.stringify({ version: 1, content: '{}' }) };
}

describe('loadLibraryEntries', () => {
  beforeEach(() => {
    resetDbInstance(new AppDatabase(`test_library_data_${Date.now()}_${Math.random()}`));
  });

  it('derives summary presence and sync state from recordings, summaries, cloud keys and audio assets', async () => {
    const db = getDb();
    await db.recordings.bulkPut([
      // Summarized, text and audio both synced.
      rec('a', { audioState: 'present' }),
      // Text not yet on the cloud.
      rec('b', { audioState: 'present' }),
      // Audio upload failed.
      rec('c', { audioState: 'present' }),
      // Still recording.
      rec('d', { state: 'recording' }),
      // Audio still uploading.
      rec('e', { audioState: 'present' }),
      // No local audio, so only the text baseline matters.
      rec('f', { audioState: 'missing' }),
      // Soft-deleted: loaded, but only the trash view shows it.
      rec('g', { deletedAt: '2026-01-10T00:00:00Z' }),
      // Audio synced.
      rec('h', { audioState: 'present' }),
      // No local audio and an in-flight asset: nothing to wait for.
      rec('i', { audioState: 'missing' }),
    ]);
    await db.summaries.bulkPut([summary('s1', 'a'), summary('s2', 'a'), summary('s3', 'g')]);
    await db.settings.bulkPut([cloudKey('a'), cloudKey('c'), cloudKey('e'), cloudKey('f'), cloudKey('g'), cloudKey('h'), cloudKey('i')]);
    await db.audioAssets.bulkPut([
      asset('a', 'synced'),
      asset('c', 'error'),
      asset('e', 'uploading'),
      asset('h', 'synced'),
      asset('i', 'queued'),
    ]);

    const entries = await loadLibraryEntries();
    const byId = new Map(entries.map((entry) => [entry.recording.id, entry]));

    expect([...byId.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(byId.get('a')).toMatchObject({ hasSummary: true, sync: 'synced' });
    expect(byId.get('b')).toMatchObject({ hasSummary: false, sync: 'pending' });
    expect(byId.get('c')).toMatchObject({ sync: 'error' });
    expect(byId.get('d')).toMatchObject({ sync: 'local' });
    expect(byId.get('e')).toMatchObject({ sync: 'pending' });
    expect(byId.get('f')).toMatchObject({ sync: 'synced' });
    expect(byId.get('h')).toMatchObject({ sync: 'synced' });
    expect(byId.get('i')).toMatchObject({ sync: 'synced' });
    expect(byId.get('g')).toMatchObject({ hasSummary: true, sync: 'synced' });
  });

  it('leaves soft-deleted rows to the query layer: hidden everywhere except the trash', async () => {
    const db = getDb();
    await db.recordings.bulkPut([rec('live'), rec('gone', { deletedAt: '2026-01-10T00:00:00Z' })]);

    const entries = await loadLibraryEntries();
    const now = new Date('2026-01-10T05:00:00Z');
    expect(queryLibrary(entries, { view: 'all' }, now).items.map((item) => item.recording.id)).toEqual(['live']);
    expect(queryLibrary(entries, { view: 'trash' }, now).items.map((item) => item.recording.id)).toEqual(['gone']);
  });

  it('returns an empty list for an empty database', async () => {
    expect(await loadLibraryEntries()).toEqual([]);
  });
});
