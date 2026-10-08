import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { AppDatabase, resetDbInstance } from '@/storage/db';
import { getRecording } from '@/storage/recordings';
import { importWebBundle, sanitizeRecording } from '@/storage/export-import';
import type { RecordingItem, WebExportBundle } from '@/shared/recording';

const fullRecording: RecordingItem = {
  id: 'rec_full',
  title: 'Buổi học đầy đủ',
  createdAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T01:00:00.000Z',
  mode: 'lecture',
  sourceLanguage: 'ja-JP',
  targetLanguage: 'vi',
  state: 'stopped',
  durationMs: 1234,
  audioState: 'present',
  audioDeletedAt: '2026-02-01T00:00:00.000Z',
  deletedAt: '2026-03-01T00:00:00.000Z',
  audioMimeType: 'audio/webm',
  folder: 'Toán',
  category: 'priority',
  config: {
    translationModelKey: 'google:gemini-3.1-flash-lite',
    summaryModelKey: 'google:gemini-3.8-flash',
    imageModelKey: 'google:gemini-3.1-flash-image',
    context: 'ngữ cảnh',
    glossary: 'thuật ngữ',
    transcriptionMode: 'smart',
    speakerCount: 3,
  },
};

function withUnknownFields(recording: RecordingItem): RecordingItem {
  return {
    ...recording,
    legacyField: 'lạ',
    syncVersion: 7,
    config: { ...recording.config, legacyConfig: true, anotherUnknown: { nested: 1 } },
  } as unknown as RecordingItem;
}

function bundleWith(recording: RecordingItem): WebExportBundle {
  return {
    schemaVersion: 1,
    exportedAt: '2026-04-01T00:00:00.000Z',
    recording,
    captions: [],
    hasAudio: false,
    hasImage: false,
  };
}

describe('sanitizeRecording', () => {
  it('drops unknown fields at recording and config level but keeps every valid field', () => {
    const sanitized = sanitizeRecording(withUnknownFields(fullRecording));
    expect(sanitized).toEqual(fullRecording);
    expect(Object.keys(sanitized).sort()).toEqual(Object.keys(fullRecording).sort());
    expect(Object.keys(sanitized.config).sort()).toEqual(Object.keys(fullRecording.config).sort());
  });

  it('keeps config.audioSource on a display-audio recording', () => {
    const withDisplay: RecordingItem = { ...fullRecording, config: { ...fullRecording.config, audioSource: 'display' } };
    expect(sanitizeRecording(withUnknownFields(withDisplay)).config.audioSource).toBe('display');
  });

  it('keeps a minimal recording without optional fields unchanged', () => {
    const minimal: RecordingItem = {
      id: 'rec_min',
      title: 'Tối thiểu',
      createdAt: '2026-01-01T00:00:00.000Z',
      mode: 'readingPractice',
      sourceLanguage: 'en-US',
      targetLanguage: 'vi',
      state: 'interrupted',
      durationMs: 0,
      audioState: 'missing',
      config: { translationModelKey: 'apk-imported' },
    };
    expect(sanitizeRecording(minimal)).toEqual(minimal);
  });

  it('does not mutate the input object', () => {
    const input = withUnknownFields(fullRecording);
    sanitizeRecording(input);
    expect(Object.prototype.hasOwnProperty.call(input, 'legacyField')).toBe(true);
  });
});

describe('importWebBundle sanitization', () => {
  beforeEach(async () => {
    const testDb = new AppDatabase(`test_db_import_sanitize_${Date.now()}_${Math.random()}`);
    resetDbInstance(testDb);
  });

  it('stores the imported recording without unknown fields', async () => {
    await importWebBundle(bundleWith(withUnknownFields(fullRecording)));

    const stored = await getRecording('rec_full') as unknown as Record<string, unknown>;
    expect(stored).toBeDefined();
    expect(stored).not.toHaveProperty('legacyField');
    expect(stored).not.toHaveProperty('syncVersion');
    expect(stored.config).not.toHaveProperty('legacyConfig');
    expect(stored.config).not.toHaveProperty('anotherUnknown');
    expect(stored).toMatchObject({
      folder: 'Toán',
      category: 'priority',
      deletedAt: '2026-03-01T00:00:00.000Z',
      config: fullRecording.config,
    });
  });

  it('drops unknown fields from imported captions and summaries too', async () => {
    const bundle = bundleWith(fullRecording);
    bundle.captions = [{
      id: 1, recordingId: 'rec_full', blockId: 0, startMs: 0, endMs: 1000, source: 'こんにちは', revision: 1,
      isFinal: true, translation: 'Xin chào', targetSourceRevision: 1, state: 'done', extraCaptionField: 'x',
    } as unknown as WebExportBundle['captions'][number]];
    bundle.summary = {
      id: 'sum_old', recordingId: 'rec_full', sourceHash: 'h', preset: 'default', modelKey: 'm', title: 'T',
      overview: 'O', sections: [], generatedAt: '2026-01-01T00:00:00.000Z', extraSummaryField: 'y',
    } as unknown as WebExportBundle['summary'];
    await importWebBundle(bundle);

    const db = (await import('@/storage/db')).getDb();
    const caption = await db.captions.get(['rec_full', 1]) as unknown as Record<string, unknown>;
    expect(caption.source).toBe('こんにちは');
    expect(caption).not.toHaveProperty('extraCaptionField');
    const summary = await db.summaries.get('sum_rec_full') as unknown as Record<string, unknown>;
    expect(summary.title).toBe('T');
    expect(summary).not.toHaveProperty('extraSummaryField');
  });
});
