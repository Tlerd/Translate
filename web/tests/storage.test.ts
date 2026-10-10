import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import {
  createRecording,
  getRecording,
  listRecordings,
  renameRecording,
  deleteAudioOnly,
  deleteRecording,
  addAudioChunk,
  getAudioChunks,
  getAudioBlob,
  saveCaption,
  getCaptions,
  saveSummary,
  getSummary,
  loadSettings,
  saveSettings,
  updateRecordingFolder,
  getCustomFolders,
  saveCustomFolders,
} from '@/storage/recordings';

describe('Storage Layer', () => {
  beforeEach(async () => {
    // Create fresh test database for each test
    const testDb = new AppDatabase(`test_db_${Date.now()}_${Math.random()}`);
    resetDbInstance(testDb);
  });

  it('creates and lists recordings', async () => {
    const rec1 = await createRecording({
      id: 'rec_1',
      title: 'Buổi học tiếng Nhật 1',
      mode: 'lecture',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });

    const rec2 = await createRecording({
      id: 'rec_2',
      title: 'Buổi đọc luyện phát âm',
      mode: 'readingPractice',
      sourceLanguage: 'ja-JP',
      targetLanguage: 'vi',
      translationModelKey: 'openai:gpt-4o-mini',
    });

    const list = await listRecordings();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(rec2.id); // reverse chronological
    expect(list[1].id).toBe(rec1.id);

    const fetched = await getRecording('rec_1');
    expect(fetched?.title).toBe('Buổi học tiếng Nhật 1');
    expect(fetched?.mode).toBe('lecture');
  });

  it('renames a recording', async () => {
    await createRecording({
      id: 'rec_rename',
      title: 'Tên cũ',
      mode: 'lecture',
      sourceLanguage: 'ja',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });

    await renameRecording('rec_rename', 'Tên mới đã sửa');
    const updated = await getRecording('rec_rename');
    expect(updated?.title).toBe('Tên mới đã sửa');
  });

  it('manages custom folders and moves recordings into folders', async () => {
    await saveCustomFolders(['Tiếng Nhật N3', 'Tiếng Anh Giao Tiếp']);
    const folders = await getCustomFolders();
    expect(folders).toEqual(['Tiếng Nhật N3', 'Tiếng Anh Giao Tiếp']);

    const rec = await createRecording({
      id: 'rec_folder_test',
      title: 'Bài 1',
      mode: 'lecture',
      sourceLanguage: 'ja',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    expect(rec.folder).toBeUndefined();

    await updateRecordingFolder('rec_folder_test', 'Tiếng Nhật N3');
    const updated = await getRecording('rec_folder_test');
    expect(updated?.folder).toBe('Tiếng Nhật N3');

    await updateRecordingFolder('rec_folder_test', undefined);
    const cleared = await getRecording('rec_folder_test');
    expect(cleared?.folder).toBeUndefined();
  });

  it('stores and retrieves audio chunks and stitches blob', async () => {
    const chunk1Blob = new Blob(['chunk-one'], { type: 'audio/webm' });
    const chunk2Blob = new Blob(['chunk-two'], { type: 'audio/webm' });

    await addAudioChunk({
      recordingId: 'rec_audio',
      sequence: 0,
      mimeType: 'audio/webm',
      timestamp: 0,
      blob: chunk1Blob,
    });

    await addAudioChunk({
      recordingId: 'rec_audio',
      sequence: 1,
      mimeType: 'audio/webm',
      timestamp: 1000,
      blob: chunk2Blob,
    });

    const chunks = await getAudioChunks('rec_audio');
    expect(chunks.length).toBe(2);
    expect(chunks[0].sequence).toBe(0);
    expect(chunks[1].sequence).toBe(1);

    const stitched = await getAudioBlob('rec_audio');
    expect(stitched).not.toBeNull();
    expect(stitched?.mimeType).toBe('audio/webm');
    expect(stitched?.blob.size).toBe(chunk1Blob.size + chunk2Blob.size);
  });

  it('stitches legacy chunks by capture time when recorder sequence values are out of order', async () => {
    await addAudioChunk({ recordingId: 'rec_legacy_order', sequence: 1, mimeType: 'audio/webm', timestamp: 10, blob: new Blob(['header']) });
    await addAudioChunk({ recordingId: 'rec_legacy_order', sequence: 0, mimeType: 'audio/webm', timestamp: 20, blob: new Blob(['tail']) });

    const chunks = await getAudioChunks('rec_legacy_order');
    expect(chunks.map((chunk) => chunk.sequence)).toEqual([1, 0]);
    const stitched = await getAudioBlob('rec_legacy_order');
    expect(await stitched?.blob.text()).toBe('headertail');
  });

  it('deletes audio only while preserving captions and summaries', async () => {
    await createRecording({
      id: 'rec_del_audio',
      title: 'Buổi kiểm tra xóa audio',
      mode: 'lecture',
      sourceLanguage: 'ja',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });

    // Mark as stopped first so delete is allowed
    const { updateRecording } = await import('@/storage/recordings');
    await updateRecording('rec_del_audio', { state: 'stopped' });

    await addAudioChunk({
      recordingId: 'rec_del_audio',
      sequence: 0,
      mimeType: 'audio/webm',
      timestamp: 0,
      blob: new Blob(['audio-data']),
    });

    await saveCaption({
      id: 1,
      recordingId: 'rec_del_audio',
      blockId: 1,
      startMs: 0,
      endMs: 2000,
      source: 'こんにちは',
      revision: 1,
      isFinal: true,
      translation: 'Xin chào',
      targetSourceRevision: 1,
      state: 'done',
    });

    await deleteAudioOnly('rec_del_audio');

    const rec = await getRecording('rec_del_audio');
    expect(rec?.audioState).toBe('deleted');
    expect(rec?.audioDeletedAt).toBeDefined();

    const chunks = await getAudioChunks('rec_del_audio');
    expect(chunks.length).toBe(0);

    const captions = await getCaptions('rec_del_audio');
    expect(captions.length).toBe(1);
    expect(captions[0].translation).toBe('Xin chào');
  });

  it('deletes entire session atomically', async () => {
    await createRecording({
      id: 'rec_del_all',
      title: 'Buổi xóa tất cả',
      mode: 'lecture',
      sourceLanguage: 'ja',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    const { updateRecording } = await import('@/storage/recordings');
    await updateRecording('rec_del_all', { state: 'stopped' });

    await addAudioChunk({
      recordingId: 'rec_del_all',
      sequence: 0,
      mimeType: 'audio/webm',
      timestamp: 0,
      blob: new Blob(['audio']),
    });

    await saveCaption({
      id: 1,
      recordingId: 'rec_del_all',
      blockId: 1,
      startMs: 0,
      endMs: 1500,
      source: 'テスト',
      revision: 1,
      isFinal: true,
      translation: 'Kiểm thử',
      targetSourceRevision: 1,
      state: 'done',
    });

    await saveSummary({
      id: 'sum_1',
      recordingId: 'rec_del_all',
      sourceHash: 'hash123',
      preset: 'default',
      modelKey: 'google:gemini-3.8-flash',
      title: 'Tóm tắt kiểm thử',
      overview: 'Tổng quan',
      sections: [],
      generatedAt: new Date().toISOString(),
    });

    await deleteRecording('rec_del_all');

    expect(await getRecording('rec_del_all')).toBeUndefined();
    expect((await getAudioChunks('rec_del_all')).length).toBe(0);
    expect((await getCaptions('rec_del_all')).length).toBe(0);
    expect(await getSummary('rec_del_all')).toBeUndefined();
  });

  it('loads and saves settings', async () => {
    const initial = await loadSettings();
    expect(initial.translationModel).toBe('google:gemini-3.5-flash-lite');
    expect(initial.pauseMs).toBe(900);
    expect(initial.readingPauseMs).toBe(900);
    expect(initial.translationHistoryTurns).toBe(6);
    expect(initial.earlySegmentTranslation).toBe(false);

    await saveSettings({
      translationModel: 'openai:gpt-4o-mini',
      pauseMs: 1400,
      readingPauseMs: 7600,
      translationHistoryTurns: 3,
      earlySegmentTranslation: true,
    });

    const updated = await loadSettings();
    expect(updated.translationModel).toBe('openai:gpt-4o-mini');
    expect(updated.pauseMs).toBe(1400);
    expect(updated.readingPauseMs).toBe(7600);
    expect(updated.translationHistoryTurns).toBe(3);
    expect(updated.earlySegmentTranslation).toBe(true);
  });

  it('clamps saved pause settings to the supported range', async () => {
    await saveSettings({ pauseMs: 100, readingPauseMs: 12000 });

    const updated = await loadSettings();
    expect(updated.pauseMs).toBe(600);
    expect(updated.readingPauseMs).toBe(10000);
  });

  it('clamps translationHistoryTurns and normalizes earlySegmentTranslation', async () => {
    await saveSettings({ translationHistoryTurns: -5, earlySegmentTranslation: true });
    let updated = await loadSettings();
    expect(updated.translationHistoryTurns).toBe(0);
    expect(updated.earlySegmentTranslation).toBe(true);

    await saveSettings({ translationHistoryTurns: 10, earlySegmentTranslation: false });
    updated = await loadSettings();
    expect(updated.translationHistoryTurns).toBe(6);
    expect(updated.earlySegmentTranslation).toBe(false);
  });

  it('manages audio segments and retrieves per-segment blobs independently', async () => {
    const {
      createAudioSegment,
      updateAudioSegment,
      getAudioSegments,
      getAudioSegmentBlob,
      formatSegmentFileName,
      getExtensionFromMimeType,
    } = await import('@/storage/recordings');

    await createRecording({
      id: 'rec_segments_test',
      title: 'Buổi thử nghiệm chia đoạn',
      mode: 'lecture',
      sourceLanguage: 'ja',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });

    // Create Segment 1: Translating
    await createAudioSegment({
      recordingId: 'rec_segments_test',
      segmentIndex: 1,
      kind: 'translating',
      label: 'Đang dịch',
      startMs: 0,
      status: 'recording',
      mimeType: 'audio/webm',
    });

    await addAudioChunk({
      recordingId: 'rec_segments_test',
      segmentIndex: 1,
      sequence: 0,
      mimeType: 'audio/webm',
      timestamp: 0,
      blob: new Blob(['segment-1-chunk-0'], { type: 'audio/webm' }),
    });

    await addAudioChunk({
      recordingId: 'rec_segments_test',
      segmentIndex: 1,
      sequence: 1,
      mimeType: 'audio/webm',
      timestamp: 2000,
      blob: new Blob(['segment-1-chunk-1'], { type: 'audio/webm' }),
    });

    // Close Segment 1
    await updateAudioSegment('rec_segments_test', 1, {
      endMs: 5000,
      durationMs: 5000,
      status: 'completed',
    });

    // Create Segment 2: API Paused
    await createAudioSegment({
      recordingId: 'rec_segments_test',
      segmentIndex: 2,
      kind: 'apiPaused',
      label: 'Nghỉ API',
      startMs: 5000,
      status: 'recording',
      mimeType: 'audio/webm',
    });

    await addAudioChunk({
      recordingId: 'rec_segments_test',
      segmentIndex: 2,
      sequence: 0,
      mimeType: 'audio/webm',
      timestamp: 5000,
      blob: new Blob(['segment-2-pause-chunk-0'], { type: 'audio/webm' }),
    });

    await updateAudioSegment('rec_segments_test', 2, {
      endMs: 7000,
      durationMs: 2000,
      status: 'completed',
    });

    // Query segments
    const segments = await getAudioSegments('rec_segments_test');
    expect(segments.length).toBe(2);
    expect(segments[0].segmentIndex).toBe(1);
    expect(segments[0].kind).toBe('translating');
    expect(segments[0].label).toBe('Đang dịch');
    expect(segments[0].status).toBe('completed');
    expect(segments[0].durationMs).toBe(5000);

    expect(segments[1].segmentIndex).toBe(2);
    expect(segments[1].kind).toBe('apiPaused');
    expect(segments[1].label).toBe('Nghỉ API');
    expect(segments[1].status).toBe('completed');
    expect(segments[1].durationMs).toBe(2000);

    // Retrieve audio blobs per segment
    const blob1 = await getAudioSegmentBlob('rec_segments_test', 1);
    expect(blob1).not.toBeNull();
    expect(await blob1?.blob.text()).toBe('segment-1-chunk-0segment-1-chunk-1');

    const blob2 = await getAudioSegmentBlob('rec_segments_test', 2);
    expect(blob2).not.toBeNull();
    expect(await blob2?.blob.text()).toBe('segment-2-pause-chunk-0');

    // Filename formatting
    expect(getExtensionFromMimeType('audio/webm')).toBe('webm');
    expect(getExtensionFromMimeType('audio/mp4')).toBe('mp4');
    expect(getExtensionFromMimeType('audio/aac')).toBe('aac');
    expect(getExtensionFromMimeType('audio/wav')).toBe('wav');
    expect(formatSegmentFileName('rec_segments_test', 1, 'audio/webm')).toBe('buoi_rec_segments_tes_doan_01.webm');
    expect(formatSegmentFileName('rec_segments_test', 2, 'audio/mp4')).toBe('buoi_rec_segments_tes_doan_02.mp4');
  });

  it('provides legacy fallback segment for recordings without segment records', async () => {
    const { getAudioSegments, getAudioSegmentBlob } = await import('@/storage/recordings');

    await createRecording({
      id: 'rec_legacy_no_segments',
      title: 'Bản ghi cũ',
      mode: 'lecture',
      sourceLanguage: 'ja',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    const { updateRecording } = await import('@/storage/recordings');
    await updateRecording('rec_legacy_no_segments', {
      state: 'stopped',
      durationMs: 12000,
      audioState: 'present',
      audioMimeType: 'audio/webm',
    });

    await addAudioChunk({
      recordingId: 'rec_legacy_no_segments',
      sequence: 0,
      mimeType: 'audio/webm',
      timestamp: 0,
      blob: new Blob(['legacy-whole-audio'], { type: 'audio/webm' }),
    });

    const segments = await getAudioSegments('rec_legacy_no_segments');
    expect(segments.length).toBe(1);
    expect(segments[0].segmentIndex).toBe(1);
    expect(segments[0].label).toBe('Đang dịch');
    expect(segments[0].durationMs).toBe(12000);
    expect(segments[0].status).toBe('completed');

    const blob = await getAudioSegmentBlob('rec_legacy_no_segments', 1);
    expect(blob).not.toBeNull();
    expect(await blob?.blob.text()).toBe('legacy-whole-audio');
  });

  it('supports soft delete, trash listing, restore and empty trash', async () => {
    const { softDeleteRecording, restoreRecording, listTrashRecordings, emptyTrash, updateRecording } = await import('@/storage/recordings');

    await createRecording({
      id: 'rec_trash_1',
      title: 'Bản ghi 1',
      mode: 'lecture',
      sourceLanguage: 'ja',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    await updateRecording('rec_trash_1', { state: 'stopped' });

    await createRecording({
      id: 'rec_trash_2',
      title: 'Bản ghi 2',
      mode: 'lecture',
      sourceLanguage: 'ja',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    await updateRecording('rec_trash_2', { state: 'stopped' });

    const activeBefore = await listRecordings();
    expect(activeBefore.length).toBe(2);
    expect(await listTrashRecordings()).toHaveLength(0);

    // Soft delete rec_trash_1
    await softDeleteRecording('rec_trash_1');
    const activeAfterDelete = await listRecordings();
    expect(activeAfterDelete.map(r => r.id)).toEqual(['rec_trash_2']);

    const trash = await listTrashRecordings();
    expect(trash.map(r => r.id)).toEqual(['rec_trash_1']);

    // Restore rec_trash_1
    await restoreRecording('rec_trash_1');
    const activeAfterRestore = await listRecordings();
    expect(activeAfterRestore.length).toBe(2);
    expect(await listTrashRecordings()).toHaveLength(0);

    // Soft delete both and empty trash
    await softDeleteRecording('rec_trash_1');
    await softDeleteRecording('rec_trash_2');
    expect(await listTrashRecordings()).toHaveLength(2);

    await emptyTrash();
    expect(await listTrashRecordings()).toHaveLength(0);
    expect(await listRecordings(50, 0, true)).toHaveLength(0);
  });

  it('handles custom folder creation, renaming, and deletion with unlinking', async () => {
    const {
      getCustomFolders,
      saveCustomFolders,
      renameCustomFolder,
      deleteCustomFolder,
      updateRecordingFolder,
      createRecording,
      getRecording,
    } = await import('@/storage/recordings');

    await saveCustomFolders(['Toán học', 'Tiếng Nhật']);
    expect(await getCustomFolders()).toEqual(['Toán học', 'Tiếng Nhật']);

    await createRecording({
      id: 'rec_fld_1',
      title: 'Bài giảng tiếng Nhật',
      mode: 'lecture',
      sourceLanguage: 'ja',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    await updateRecordingFolder('rec_fld_1', 'Tiếng Nhật');
    expect((await getRecording('rec_fld_1'))?.folder).toBe('Tiếng Nhật');

    // Rename folder
    await renameCustomFolder('Tiếng Nhật', 'Ngoại ngữ');
    expect(await getCustomFolders()).toEqual(['Toán học', 'Ngoại ngữ']);
    expect((await getRecording('rec_fld_1'))?.folder).toBe('Ngoại ngữ');

    // Delete folder - recordings should unlink without data loss
    await deleteCustomFolder('Ngoại ngữ');
    expect(await getCustomFolders()).toEqual(['Toán học']);
    expect((await getRecording('rec_fld_1'))?.folder).toBeUndefined();
  });
});
