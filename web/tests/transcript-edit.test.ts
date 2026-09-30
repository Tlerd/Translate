import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import { createRecording, getCaptions, saveCaption, updateCaptionSources, updateRecording } from '@/storage/recordings';
import type { CaptionItem } from '@/shared/recording';

const dbs: AppDatabase[] = [];
afterEach(async () => {
  resetDbInstance();
  for (const db of dbs.splice(0)) await db.delete();
});

async function seedRecording(id: string, state: 'recording' | 'stopped' = 'stopped') {
  const db = new AppDatabase(`transcript_edit_${id}_${crypto.randomUUID()}`);
  dbs.push(db);
  resetDbInstance(db);
  await createRecording({ id, mode: 'lecture', sourceLanguage: 'ja-JP', targetLanguage: 'vi', translationModelKey: 'test:model' });
  await updateRecording(id, { state });
  const captions: CaptionItem[] = [
    { id: 1, recordingId: id, blockId: 7, startMs: 100, endMs: 900, source: 'Một câu gốc.', translation: 'Bản dịch cũ.', revision: 2, targetSourceRevision: 2, isFinal: true, state: 'done' },
    { id: 2, recordingId: id, blockId: 8, startMs: 1000, endMs: 1800, source: 'Câu thứ hai.', translation: 'Dịch câu hai.', revision: 1, targetSourceRevision: 1, isFinal: true, state: 'done' },
  ];
  for (const caption of captions) await saveCaption(caption);
  return captions;
}

describe('editing original transcript sources', () => {
  it('retains rows, timing, IDs and translations while revising changed source lines', async () => {
    const original = await seedRecording('edit-stopped');
    const updated = await updateCaptionSources('edit-stopped', [
      { id: 1, source: 'Câu đã sửa.' },
      { id: 2, source: 'Câu thứ hai.' },
    ]);

    expect(updated).toHaveLength(original.length);
    expect(updated[0]).toMatchObject({
      id: 1, blockId: 7, startMs: 100, endMs: 900, source: 'Câu đã sửa.',
      translation: 'Bản dịch cũ.', revision: 3, targetSourceRevision: 2,
    });
    expect(updated[1]).toEqual(original[1]);
    expect(await getCaptions('edit-stopped')).toEqual(updated);
  });

  it('rejects edits during recording without changing stored captions', async () => {
    const original = await seedRecording('edit-live', 'recording');
    await expect(updateCaptionSources('edit-live', [{ id: 1, source: 'Changed' }, { id: 2, source: 'Other' }]))
      .rejects.toThrow('kết thúc buổi thu');
    expect(await getCaptions('edit-live')).toEqual(original);
  });

  it('rejects blank lines and incomplete row sets instead of dropping source rows', async () => {
    const original = await seedRecording('edit-invalid');
    await expect(updateCaptionSources('edit-invalid', [{ id: 1, source: ' ' }, { id: 2, source: 'Câu thứ hai.' }]))
      .rejects.toThrow('đang để trống');
    await expect(updateCaptionSources('edit-invalid', [{ id: 1, source: 'Chỉ một câu.' }]))
      .rejects.toThrow('Danh sách câu');
    expect(await getCaptions('edit-invalid')).toEqual(original);
  });
});
