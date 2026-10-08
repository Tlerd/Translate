import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import {
  batchSoftDelete,
  batchUpdateCategory,
  batchUpdateFolder,
  createRecording,
  deleteRecordingsPermanently,
  getRecording,
  restoreRecordingFields,
  restoreRecordings,
  updateRecording,
} from '@/storage/recordings';

const MODEL = 'google:gemini-3.1-flash-lite';

async function seed(id: string) {
  return createRecording({
    id,
    title: `Buổi ${id}`,
    mode: 'lecture',
    sourceLanguage: 'ja-JP',
    targetLanguage: 'vi',
    translationModelKey: MODEL,
  });
}

describe('library bulk actions and undo', () => {
  beforeEach(() => {
    const testDb = new AppDatabase(`test_db_library_actions_${Date.now()}_${Math.random()}`);
    resetDbInstance(testDb);
  });

  it('restores the empty deletedAt after a soft delete is undone', async () => {
    await seed('rec_del_1');
    await seed('rec_del_2');
    const before = [await getRecording('rec_del_1'), await getRecording('rec_del_2')];
    const snapshots = before.map((rec) => ({
      id: rec!.id,
      folder: rec!.folder,
      category: rec!.category,
      deletedAt: rec!.deletedAt,
    }));

    await batchSoftDelete(['rec_del_1', 'rec_del_2']);
    expect((await getRecording('rec_del_1'))?.deletedAt).toBeTruthy();
    expect((await getRecording('rec_del_2'))?.deletedAt).toBeTruthy();

    await restoreRecordingFields(snapshots);
    expect((await getRecording('rec_del_1'))?.deletedAt).toBeUndefined();
    expect((await getRecording('rec_del_2'))?.deletedAt).toBeUndefined();
  });

  it('restores the previous folder and category, including values that were undefined', async () => {
    await seed('rec_mv_1');
    await seed('rec_mv_2');
    await batchUpdateFolder(['rec_mv_2'], 'Ôn thi');
    await batchUpdateCategory(['rec_mv_2'], 'priority');

    const snapshots = [
      { id: 'rec_mv_1', folder: undefined, category: 'inbox' as const, deletedAt: undefined },
      { id: 'rec_mv_2', folder: 'Ôn thi', category: 'priority' as const, deletedAt: undefined },
    ];

    await batchUpdateFolder(['rec_mv_1', 'rec_mv_2'], 'Thư mục mới');
    await batchUpdateCategory(['rec_mv_1', 'rec_mv_2'], 'archive');
    expect((await getRecording('rec_mv_1'))?.folder).toBe('Thư mục mới');
    expect((await getRecording('rec_mv_1'))?.category).toBe('archive');

    await restoreRecordingFields(snapshots);

    const first = await getRecording('rec_mv_1');
    const second = await getRecording('rec_mv_2');
    expect(first?.folder).toBeUndefined();
    expect(first?.category).toBe('inbox');
    expect(second?.folder).toBe('Ôn thi');
    expect(second?.category).toBe('priority');
  });

  it('clears deletedAt that was set after the snapshot when undoing a trash action', async () => {
    await seed('rec_clear_1');
    const snapshot = { id: 'rec_clear_1', folder: undefined, category: 'inbox' as const, deletedAt: undefined };
    await batchSoftDelete(['rec_clear_1']);

    await restoreRecordingFields([snapshot]);
    const restored = await getRecording('rec_clear_1');
    expect(restored?.deletedAt).toBeUndefined();
    expect(restored?.category).toBe('inbox');
  });
});

describe('trash batch actions', () => {
  beforeEach(() => {
    resetDbInstance(new AppDatabase(`test_db_trash_actions_${Date.now()}_${Math.random()}`));
  });

  async function seedStopped(id: string, state: 'stopped' | 'recording' = 'stopped') {
    await seed(id);
    await updateRecording(id, { state });
  }

  it('restores only the listed recordings in one update and ignores unknown ids', async () => {
    await seedStopped('rec_rs_1');
    await seedStopped('rec_rs_2');
    await seedStopped('rec_rs_3');
    await batchSoftDelete(['rec_rs_1', 'rec_rs_2', 'rec_rs_3']);

    await restoreRecordings(['rec_rs_1', 'rec_rs_2', 'missing_id']);

    expect((await getRecording('rec_rs_1'))?.deletedAt).toBeUndefined();
    expect((await getRecording('rec_rs_2'))?.deletedAt).toBeUndefined();
    expect((await getRecording('rec_rs_3'))?.deletedAt).toBeTruthy();
    expect(await getRecording('missing_id')).toBeUndefined();
  });

  it('does nothing when asked to restore no recordings', async () => {
    await seedStopped('rec_rs_empty');
    await batchSoftDelete(['rec_rs_empty']);
    await restoreRecordings([]);
    expect((await getRecording('rec_rs_empty'))?.deletedAt).toBeTruthy();
  });

  it('permanently deletes the listed recordings and tolerates a missing id', async () => {
    await seedStopped('rec_pd_1');
    await seedStopped('rec_pd_2');

    await expect(deleteRecordingsPermanently(['rec_pd_1', 'missing_id', 'rec_pd_2'])).resolves.toBeUndefined();

    expect(await getRecording('rec_pd_1')).toBeUndefined();
    expect(await getRecording('rec_pd_2')).toBeUndefined();
  });

  it('keeps deleting after one recording fails, then reports the failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await seedStopped('rec_pf_live', 'recording');
    await seedStopped('rec_pf_done');

    await expect(deleteRecordingsPermanently(['rec_pf_live', 'rec_pf_done'])).rejects.toThrow('1 mục');

    expect(await getRecording('rec_pf_live')).toBeDefined();
    expect(await getRecording('rec_pf_done')).toBeUndefined();
    vi.restoreAllMocks();
  });
});

