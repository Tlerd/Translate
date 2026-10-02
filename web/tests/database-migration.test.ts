import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { AppDatabase } from '@/storage/db';
import type { CaptionItem } from '@/shared/recording';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});

function caption(recordingId: string, id = 1): CaptionItem {
  return {
    id, recordingId, blockId: 1, startMs: 0, endMs: 1000,
    source: `Nội dung ${recordingId}`, translation: `Dịch ${recordingId}`,
    revision: 1, targetSourceRevision: 1, isFinal: true, state: 'done',
  };
}

describe('Caption identity and legacy migration', () => {
  it('keeps caption #1 in each recording independently', async () => {
    const database = new AppDatabase(`caption_identity_${crypto.randomUUID()}`);
    databases.push(database);
    await database.captions.put(caption('first'));
    await database.captions.put(caption('second'));
    expect(await database.captions.where('recordingId').equals('first').toArray())
      .toEqual([caption('first')]);
    expect(await database.captions.where('recordingId').equals('second').toArray())
      .toEqual([caption('second')]);
    await database.captions.where('recordingId').equals('second').delete();
    expect(await database.captions.count()).toBe(1);
  });

  it('migrates existing v1 captions with their IDs, translations and timing intact', async () => {
    const name = `caption_legacy_${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      recordings: 'id, createdAt, state, mode, audioState',
      audioChunks: '++id, [recordingId+sequence], recordingId, sequence',
      captions: 'id, recordingId, blockId, [recordingId+id], startMs',
      summaries: 'id, recordingId, sourceHash',
      images: 'id, recordingId, summaryId',
      settings: 'key',
    });
    const saved = [caption('first', 1), caption('second', 2)];
    await legacy.table('captions').bulkPut(saved);
    legacy.close();

    const upgraded = new AppDatabase(name);
    databases.push(upgraded);
    expect(await upgraded.captions.orderBy('id').toArray()).toEqual(saved);
    await upgraded.captions.put(caption('second', 1));
    expect(await upgraded.captions.where('recordingId').equals('first').toArray())
      .toEqual([saved[0]]);
    expect(await upgraded.captions.count()).toBe(3);
    upgraded.close();

    const reopened = new AppDatabase(name);
    databases[databases.indexOf(upgraded)] = reopened;
    expect(await reopened.captions.count()).toBe(3);
  });

  it('migrates from v3 database preserving audio chunks and enabling audioSegments table', async () => {
    const name = `audio_segments_migration_${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      recordings: 'id, createdAt, state, mode, audioState',
      audioChunks: '++id, [recordingId+sequence], recordingId, sequence',
      captions: 'id, recordingId, blockId, [recordingId+id], startMs',
      summaries: 'id, recordingId, sourceHash',
      images: 'id, recordingId, summaryId',
      settings: 'key',
    });
    legacy.version(2).stores({
      captionItems: '[recordingId+id], id, recordingId, blockId, startMs',
    }).upgrade(async (tx) => {
      const prev = await tx.table('captions').toArray();
      await tx.table('captionItems').bulkPut(prev);
    });
    legacy.version(3).stores({ captions: null });

    await legacy.table('recordings').put({
      id: 'legacy_rec_1',
      title: 'Buổi cũ trước khi có segment',
      createdAt: new Date().toISOString(),
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      state: 'stopped',
      durationMs: 5000,
      audioState: 'present',
      audioMimeType: 'audio/webm',
      config: { translationModelKey: 'google:gemini-3.1-flash-lite' },
    });

    await legacy.table('audioChunks').put({
      recordingId: 'legacy_rec_1',
      sequence: 0,
      mimeType: 'audio/webm',
      timestamp: 0,
      blob: new Blob(['legacy-audio-data'], { type: 'audio/webm' }),
    });

    legacy.close();

    // Now open with AppDatabase (v4)
    const upgraded = new AppDatabase(name);
    databases.push(upgraded);

    // Verify existing recording and chunk exist
    const rec = await upgraded.recordings.get('legacy_rec_1');
    expect(rec).toBeDefined();
    expect(rec?.title).toBe('Buổi cũ trước khi có segment');

    const chunks = await upgraded.audioChunks.where('recordingId').equals('legacy_rec_1').toArray();
    expect(chunks.length).toBe(1);
    expect(chunks[0].sequence).toBe(0);

    // Verify audioSegments table is created and works
    await upgraded.audioSegments.put({
      recordingId: 'new_rec_2',
      segmentIndex: 1,
      kind: 'translating',
      label: 'Đang dịch',
      startMs: 0,
      endMs: 2000,
      durationMs: 2000,
      status: 'completed',
      mimeType: 'audio/webm',
    });

    const segments = await upgraded.audioSegments.where('recordingId').equals('new_rec_2').toArray();
    expect(segments.length).toBe(1);
    expect(segments[0].segmentIndex).toBe(1);
    expect(segments[0].label).toBe('Đang dịch');
  });
});
