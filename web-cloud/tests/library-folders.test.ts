import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import {
  createRecording,
  updateRecordingFolder,
  batchSoftDelete,
  saveCustomFolders,
  getCustomFolders,
  getLibraryFolders,
  mergeFolderNames,
  LIBRARY_PAGE_LIMIT,
} from '@/storage/recordings';

describe('mergeFolderNames', () => {
  it('merges, trims, drops empty and duplicate names, and sorts without locale data', () => {
    const result = mergeFolderNames(
      ['Đức', ' Anh ', ''],
      ['ba', undefined, null, 'Anh', '   ', 'Đức', 'Đức'],
    );
    expect(result).toEqual(['Anh', 'ba', 'Đức']);
  });

  it('ignores non-string values from corrupt storage', () => {
    const result = mergeFolderNames([42 as unknown as string, 'Lớp A'], []);
    expect(result).toEqual(['Lớp A']);
  });

  it('returns an empty list when there is nothing to merge', () => {
    expect(mergeFolderNames([], [undefined, null, ''])).toEqual([]);
  });

  it('exposes a limit large enough for a personal library', () => {
    expect(LIBRARY_PAGE_LIMIT).toBeGreaterThanOrEqual(100_000);
  });
});

describe('getLibraryFolders', () => {
  beforeEach(async () => {
    const testDb = new AppDatabase(`test_db_library_folders_${Date.now()}_${Math.random()}`);
    resetDbInstance(testDb);
  });

  it('includes folders that exist only on recordings and ignores soft-deleted recordings', async () => {
    await saveCustomFolders(['Toán']);

    await createRecording({
      id: 'rec_synced_folder',
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    await updateRecordingFolder('rec_synced_folder', 'Lớp từ máy khác');

    await createRecording({
      id: 'rec_trashed_folder',
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    await updateRecordingFolder('rec_trashed_folder', 'Thư mục đã xóa');
    await batchSoftDelete(['rec_trashed_folder']);

    const folders = await getLibraryFolders();
    expect(folders).toContain('Lớp từ máy khác');
    expect(folders).toContain('Toán');
    expect(folders).not.toContain('Thư mục đã xóa');
  });

  it('does not write used-only folders into custom_folders', async () => {
    await createRecording({
      id: 'rec_only_used',
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    await updateRecordingFolder('rec_only_used', 'Chỉ có trong buổi ghi');

    expect(await getLibraryFolders()).toEqual(['Chỉ có trong buổi ghi']);
    expect(await getCustomFolders()).toEqual([]);
  });
});
