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
} from '@/storage/recordings';
import {
  exportRecordingData,
  importWebBundle,
  importApkExport,
} from '@/storage/export-import';
import type { ApkExportJson, WebExportBundle } from '@/shared/recording';

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

  it('exports and imports web session bundle', async () => {
    await createRecording({
      id: 'rec_export_test',
      title: 'Buổi export web',
      mode: 'lecture',
      sourceLanguage: 'ja',
      targetLanguage: 'vi',
      translationModelKey: 'google:gemini-3.5-flash-lite',
    });
    const { updateRecording } = await import('@/storage/recordings');
    await updateRecording('rec_export_test', { state: 'stopped' });

    await saveCaption({
      id: 1,
      recordingId: 'rec_export_test',
      blockId: 1,
      startMs: 100,
      endMs: 1200,
      source: 'おはようございます',
      revision: 1,
      isFinal: true,
      translation: 'Chào buổi sáng',
      targetSourceRevision: 1,
      state: 'done',
    });

    const exportData = await exportRecordingData('rec_export_test');
    expect(exportData.jsonString).toBeDefined();

    const parsedBundle = JSON.parse(exportData.jsonString) as WebExportBundle;
    expect(parsedBundle.recording.id).toBe('rec_export_test');
    expect(parsedBundle.captions.length).toBe(1);

    // Import into db (creates new unique ID if already exists)
    const imported = await importWebBundle(parsedBundle);
    expect(imported.id).not.toBe('rec_export_test');
    expect(imported.title).toContain('(Bản nhập)');

    const importedCaptions = await getCaptions(imported.id);
    expect(importedCaptions.length).toBe(1);
    expect(importedCaptions[0].translation).toBe('Chào buổi sáng');
  });

  it('imports APK conversation.json and converts 16kHz sample counts to ms', async () => {
    const apkSampleJson: ApkExportJson = {
      session: {
        id: '1727500000000000',
        createdAt: '2026-09-28T10:00:00.000Z',
        endedAt: '2026-09-28T10:30:00.000Z',
        mode: 'classroom',
        state: 'stopped',
        samples: 480000, // 480,000 samples @ 16kHz = 30,000 ms (30 seconds)
        audioState: 'present',
      },
      audio: 'conversation.wav',
      sampleRate: 16000,
      turns: [
        {
          id: 1,
          sessionId: '1727500000000000',
          startSample: 16000, // 1000 ms
          endSample: 48000,   // 3000 ms
          direction: 'jaVi',
          source: '日本語の授業を始めます',
          target: 'Chúng ta bắt đầu tiết học tiếng Nhật',
          recognitionFinal: 1,
          sourceRevision: 1,
          targetSourceRevision: 1,
          state: 'done',
        },
      ],
    };

    const imported = await importApkExport(apkSampleJson);
    expect(imported.durationMs).toBe(30000);
    expect(imported.mode).toBe('lecture');

    const captions = await getCaptions(imported.id);
    expect(captions.length).toBe(1);
    expect(captions[0].startMs).toBe(1000);
    expect(captions[0].endMs).toBe(3000);
    expect(captions[0].source).toBe('日本語の授業を始めます');
    expect(captions[0].translation).toBe('Chúng ta bắt đầu tiết học tiếng Nhật');
  });

  it('loads and saves settings', async () => {
    const initial = await loadSettings();
    expect(initial.translationModel).toBe('google:gemini-3.1-flash-lite');
    expect(initial.pauseMs).toBe(900);
    expect(initial.readingPauseMs).toBe(900);

    await saveSettings({
      translationModel: 'openai:gpt-4o-mini',
      glossary: 'AI=Trí tuệ nhân tạo',
      pauseMs: 1400,
      readingPauseMs: 7600,
    });

    const updated = await loadSettings();
    expect(updated.translationModel).toBe('openai:gpt-4o-mini');
    expect(updated.glossary).toBe('AI=Trí tuệ nhân tạo');
    expect(updated.pauseMs).toBe(1400);
    expect(updated.readingPauseMs).toBe(7600);
  });

  it('clamps saved pause settings to the supported range', async () => {
    await saveSettings({ pauseMs: 100, readingPauseMs: 12000 });

    const updated = await loadSettings();
    expect(updated.pauseMs).toBe(600);
    expect(updated.readingPauseMs).toBe(10000);
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
      translationModelKey: 'google:gemini-3.1-flash-lite',
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
      translationModelKey: 'google:gemini-3.1-flash-lite',
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
});
