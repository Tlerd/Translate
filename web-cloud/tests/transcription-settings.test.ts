import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase, getDb, resetDbInstance } from '@/storage/db';
import { createRecording, loadSettings, saveSettings, settingsUpdatedEvent, saveCaption, updateRecording, updateCaptionSpeaker, getCaptions } from '@/storage/recordings';
import { DEFAULT_SETTINGS, type CaptionItem } from '@/shared/recording';
import { cloudPayloadSchema } from '@/shared/cloud-recording';
import { normalizeSpeechProvider } from '@/shared/transcription';

beforeEach(() => {
  resetDbInstance(new AppDatabase(`transcription_settings_${Date.now()}_${Math.random()}`));
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { resetDbInstance(); vi.unstubAllGlobals(); });

describe('transcription settings and speaker persistence', () => {
  it.each(['google', 'browser', 'google-transcribe', 'google-flash', 'google-flash-live', 'nemotron', 'soniox'])('preserves supported %s providers and migrates the removed browser and Flash Live providers', async (provider) => {
    await getDb().settings.put({ key: 'speechProvider', value: provider });
    const removed = ['browser', 'google-flash', 'google-flash-live'].includes(provider);
    expect(await loadSettings()).toMatchObject({ speechProvider: removed ? 'google-transcribe' : provider, transcriptionMode: 'verbatim', speakerCount: 1 });
  });

  it.each(['google-flash', 'google-flash-live'])('normalizeSpeechProvider maps removed %s to Transcribe', (value) => {
    expect(normalizeSpeechProvider(value)).toBe('google-transcribe');
  });

  it.each(['soniox', 'nemotron'] as const)('persists and broadcasts %s instead of normalizing it back to Transcribe', async (provider) => {
    const listener = vi.fn(); window.addEventListener(settingsUpdatedEvent, listener);
    await saveSettings({ speechProvider: provider });
    expect((await loadSettings()).speechProvider).toBe(provider);
    expect((listener.mock.calls[0][0] as CustomEvent).detail.speechProvider).toBe(provider);
  });

  it('loads a saved retired 3.1 translation model as 3.5 and keeps the summary model valid', async () => {
    await getDb().settings.bulkPut([
      { key: 'translationModel', value: 'google:gemini-3.1-flash-lite' },
      { key: 'summaryModel', value: 'google:gemini-3.1-flash-lite' },
      { key: 'imageModel', value: 'google:gemini-3.1-flash-lite-image' },
    ]);
    expect(await loadSettings()).toMatchObject({
      translationModel: 'google:gemini-3.5-flash-lite',
      summaryModel: DEFAULT_SETTINGS.summaryModel,
      imageModel: 'google:gemini-3.1-flash-lite-image',
    });
  });

  it('leaves current and unrelated model choices untouched when loading settings', async () => {
    await getDb().settings.bulkPut([
      { key: 'translationModel', value: 'openai:gpt-4o-mini' },
      { key: 'summaryModel', value: 'google:gemini-3.8-flash' },
    ]);
    expect(await loadSettings()).toMatchObject({ translationModel: 'openai:gpt-4o-mini', summaryModel: 'google:gemini-3.8-flash' });
    await getDb().settings.clear();
    expect((await loadSettings()).translationModel).toBe('google:gemini-3.5-flash-lite');
  });

  it('never persists or broadcasts the retired translation model', async () => {
    const listener = vi.fn(); window.addEventListener(settingsUpdatedEvent, listener);
    await saveSettings({ translationModel: 'google:gemini-3.1-flash-lite' });
    expect((await getDb().settings.get('translationModel'))?.value).toBe('google:gemini-3.5-flash-lite');
    expect((listener.mock.calls[0][0] as CustomEvent).detail.translationModel).toBe('google:gemini-3.5-flash-lite');
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
