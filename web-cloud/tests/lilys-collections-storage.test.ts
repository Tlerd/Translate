import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import {
  createRecording,
  listRecordings,
  updateRecordingCategory,
  batchUpdateCategory,
  batchUpdateFolder,
  batchSoftDelete,
  pushRecentLanguage,
  loadSettings,
  saveSettings,
} from '@/storage/recordings';

describe('LilysAI Collections & Recent Languages Storage', () => {
  beforeEach(async () => {
    const testDb = new AppDatabase(`test_db_lilys_${Date.now()}_${Math.random()}`);
    resetDbInstance(testDb);
  });

  it('updates category for single and batch recordings', async () => {
    const r1 = await createRecording({
      id: 'rec_inbox_1',
      title: 'Bài giảng A',
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    const r2 = await createRecording({
      id: 'rec_inbox_2',
      title: 'Bài giảng B',
      mode: 'lecture',
      sourceLanguage: 'en-US',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });

    // Default category is inbox
    expect(r1.category).toBe('inbox');
    expect(r2.category).toBe('inbox');

    // Update single recording to priority
    await updateRecordingCategory('rec_inbox_1', 'priority');
    let list = await listRecordings();
    expect(list.find((r) => r.id === 'rec_inbox_1')?.category).toBe('priority');

    // Batch update to archive
    await batchUpdateCategory(['rec_inbox_1', 'rec_inbox_2'], 'archive');
    list = await listRecordings();
    expect(list.find((r) => r.id === 'rec_inbox_1')?.category).toBe('archive');
    expect(list.find((r) => r.id === 'rec_inbox_2')?.category).toBe('archive');
  });

  it('batch updates folder and batch soft deletes recordings', async () => {
    await createRecording({
      id: 'rec_f1',
      title: 'Hội thảo 1',
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    await createRecording({
      id: 'rec_f2',
      title: 'Hội thảo 2',
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });

    // Batch move to folder 'AI Study'
    await batchUpdateFolder(['rec_f1', 'rec_f2'], 'AI Study');
    let list = await listRecordings();
    expect(list.find((r) => r.id === 'rec_f1')?.folder).toBe('AI Study');
    expect(list.find((r) => r.id === 'rec_f2')?.folder).toBe('AI Study');

    // Batch soft delete
    await batchSoftDelete(['rec_f1', 'rec_f2']);
    list = await listRecordings(50, 0, true);
    expect(list.find((r) => r.id === 'rec_f1')?.deletedAt).toBeTruthy();
    expect(list.find((r) => r.id === 'rec_f2')?.deletedAt).toBeTruthy();
  });

  it('manages recent source and target languages and keeps top 3', async () => {
    await saveSettings({
      recentSourceLanguages: ['en', 'vi', 'ja'],
      recentTargetLanguages: ['vi', 'en', 'ko'],
    });

    let s = await loadSettings();
    expect(s.recentSourceLanguages).toEqual(['en', 'vi', 'ja']);
    expect(s.recentTargetLanguages).toEqual(['vi', 'en', 'ko']);

    // Push new source language 'fr'
    await pushRecentLanguage('source', 'fr');
    s = await loadSettings();
    expect(s.recentSourceLanguages).toEqual(['fr', 'en', 'vi']);

    // Push existing language 'en' moves to front
    await pushRecentLanguage('source', 'en');
    s = await loadSettings();
    expect(s.recentSourceLanguages).toEqual(['en', 'fr', 'vi']);

    // Target language push
    await pushRecentLanguage('target', 'zh');
    s = await loadSettings();
    expect(s.recentTargetLanguages).toEqual(['zh', 'vi', 'en']);
  });
});
