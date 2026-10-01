import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase, getDb, resetDbInstance } from '@/storage/db';
import { createRecording, loadSettings, saveSettings, settingsUpdatedEvent, saveCaption, updateRecording, updateCaptionSpeaker, getCaptions } from '@/storage/recordings';
import { DEFAULT_SETTINGS, type CaptionItem } from '@/shared/recording';
import { cloudPayloadSchema } from '@/shared/cloud-recording';

beforeEach(() => {
  resetDbInstance(new AppDatabase(`transcription_settings_${Date.now()}_${Math.random()}`));
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { resetDbInstance(); vi.unstubAllGlobals(); });

describe('transcription settings and speaker persistence', () => {
  it.each(['google', 'browser', 'google-transcribe'])('migrates the old %s provider with safe provider migration with safe defaults', async (provider) => {
    await getDb().settings.put({ key: 'speechProvider', value: provider });
    expect(await loadSettings()).toMatchObject({ speechProvider: provider === 'google' ? 'google' : 'google-transcribe', transcriptionMode: 'verbatim', speakerCount: 1 });
  });

  it('persists smart and eight speakers, and dispatches the exact normalized settings', async () => {
    const listener = vi.fn();
    window.addEventListener(settingsUpdatedEvent, listener);
    await saveSettings({ ...DEFAULT_SETTINGS, transcriptionMode: 'smart', speakerCount: 8 });
    expect(await loadSettings()).toMatchObject({ transcriptionMode: 'smart', speakerCount: 8 });
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ speechProvider: 'google-transcribe', transcriptionMode: 'smart', speakerCount: 8 });
  });

  it('normalizes corrupted legacy settings and broadcasts the normalized values', async () => {
    await getDb().settings.bulkPut([{ key: 'transcriptionMode', value: 'unknown' }, { key: 'speakerCount', value: '9' }]);
    expect(await loadSettings()).toMatchObject({ transcriptionMode: 'verbatim', speakerCount: 1 });
    const listener = vi.fn(); window.addEventListener(settingsUpdatedEvent, listener);
    await saveSettings({ pauseMs: 0 });
    expect((listener.mock.calls[0][0] as CustomEvent).detail.pauseMs).toBe(600);
    expect((await loadSettings()).pauseMs).toBe(600);
  });

  it('stores the recording roster in metadata that survives cloud validation', async () => {
    const recording = await createRecording({ mode: 'lecture', sourceLanguage: 'ja-JP', targetLanguage: 'vi', translationModelKey: 'test', transcriptionMode: 'smart', speakerCount: 8 });
    const parsed = cloudPayloadSchema.parse({ recording, captions: [], summaries: [] });
    expect(parsed.recording.config).toMatchObject({ transcriptionMode: 'smart', speakerCount: 8 });
  });

  it('edits only the selected saved speaker and preserves source, history, and translation', async () => {
    const recording = await createRecording({ mode: 'lecture', sourceLanguage: 'ja-JP', targetLanguage: 'vi', translationModelKey: 'test', transcriptionMode: 'smart', speakerCount: 2 });
    const caption: CaptionItem = { recordingId: recording.id, id: 1, blockId: 1, startMs: 0, endMs: 1000, source: '元の言葉', sourceHistory: [{ text: 'old', revision: 1 }], revision: 2, isFinal: true, translation: 'Bản dịch', targetSourceRevision: 2, state: 'done' };
    await saveCaption(caption);
    await expect(updateCaptionSpeaker(recording.id, 1, 'spk_2', 2)).rejects.toThrow('Kết thúc');
    await updateRecording(recording.id, { state: 'stopped' });
    await expect(updateCaptionSpeaker(recording.id, 1, 'spk_3', 2)).rejects.toThrow('danh sách');
    await updateCaptionSpeaker(recording.id, 1, 'spk_2', 2);
    expect(await getCaptions(recording.id)).toEqual([{ ...caption, speakerLabel: 'spk_2' }]);
    await updateCaptionSpeaker(recording.id, 1, undefined, 2);
    expect((await getCaptions(recording.id))[0].speakerLabel).toBeUndefined();
  });
});
