import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), create: vi.fn(), generate: vi.fn() }));
vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', STRING: 'STRING' },
  ThinkingLevel: { MINIMAL: 'MINIMAL' },
  GoogleGenAI: class {
    files = { upload: mocks.upload, delete: mocks.remove };
    interactions = { create: mocks.create };
    models = { generateContent: mocks.generate };
  },
}));

import { POST } from '@/app/api/speech/transcribe/route';

const transcriptInteraction = { output_text: 'えっと、こんにちは。こんにちは。' };

function formRequest(file: File, durationMs = 2_000, options: { mode?: string; speakerCount?: string | null; model?: string; language?: string } = {}): Request {
  const form = new FormData();
  form.set('audio', file);
  form.set('durationMs', String(durationMs));
  form.set('transcriptionMode', options.mode ?? 'verbatim');
  if (options.speakerCount !== null) form.set('speakerCount', options.speakerCount ?? '2');
  if (options.model !== undefined) form.set('model', options.model);
  if (options.language !== undefined) form.set('language', options.language);
  return new Request('http://localhost/api/speech/transcribe', { method: 'POST', body: form });
}

describe('POST /api/speech/transcribe', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.AUTH_SECRET;
    delete process.env.OWNER_EMAIL;
    process.env.GOOGLE_API_KEY = 'server-only-secret';
    mocks.upload.mockReset().mockResolvedValue({ name: 'files/temp-1', uri: 'files/temp-1' });
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.create.mockReset().mockResolvedValue(transcriptInteraction);
    mocks.generate.mockReset().mockResolvedValue({ text: JSON.stringify({ text: 'えっと、こんにちは。' }) });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects the removed Flash text-out model without making a provider call', async () => {
    const response = await POST(formRequest(new File(['audio'], 'voice.wav', { type: 'audio/wav' }), 1000, { model: 'gemini-3-flash-preview' }));
    expect(response.status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects arbitrary model IDs before making a provider call', async () => {
    const response = await POST(formRequest(new File(['audio'], 'voice.wav', { type: 'audio/wav' }), 1000, { model: 'gemini-3.1-pro' }));
    expect(response.status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it.each(['es-419', 'yue-Hant-HK', 'cmn-Hans-CN'])('preserves the selected BCP-47 hint %s in the actual provider request', async language => {
    const response = await POST(formRequest(new File(['audio'], 'voice.wav', { type: 'audio/wav' }), 2000, { language }));
    expect(response.status).toBe(200);
    expect(mocks.create.mock.calls[0][0].generation_config.transcription_config.language_codes).toEqual([language]);
  });

  it('rejects malformed language hints before uploading to Google', async () => {
    expect((await POST(formRequest(new File(['audio'], 'voice.wav', { type: 'audio/wav' }), 2000, { language: 'ja_JP' }))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('uses verbatim unary transcription and cleans up the provider upload', async () => {
    const response = await POST(formRequest(new File(['audio-data'], 'recording.wav', { type: 'audio/wav' })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ model: 'gemini-3.5-transcribe', text: transcriptInteraction.output_text, turns: [] });
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ model: 'gemini-3.5-transcribe', generation_config: { transcription_config: { mode: { type: 'verbatim', diarization_mode: 'speaker', timestamp_granularities: ['word'] } } } });
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'files/temp-1' }));
  });

  it('sends smart without incompatible diarization or timestamp fields', async () => {
    const response = await POST(formRequest(new File(['audio'], 'voice.wav', { type: 'audio/wav' }), 2_000, { mode: 'smart', speakerCount: '8' }));
    expect(response.status).toBe(200);
    expect((await response.json()).turns).toEqual([]);
    expect(mocks.create.mock.calls[0][0].generation_config.transcription_config).toEqual({ language_codes: [], mode: 'smart' });
  });

  it('returns speaker turns and preserves the verbatim source exactly', async () => {
    mocks.create.mockResolvedValueOnce({
      output_text: 'Um, hello. Hi!',
      steps: [{ type: 'model_output', content: [{ type: 'text', annotations: [
        { type: 'word_info', text: 'Um', speaker: 'spk_1', start_offset: '0.000s', end_offset: '0.200s' },
        { type: 'word_info', text: 'hello', speaker: 'spk_1', start_offset: '0.300s', end_offset: '0.600s' },
        { type: 'word_info', text: 'Hi', speaker: 'spk_2', start_offset: '1.000s', end_offset: '1.500s' },
      ] }] }],
    });
    const response = await POST(formRequest(new File(['audio'], 'voice.wav', { type: 'audio/wav' })));
    expect(await response.json()).toMatchObject({ text: 'Um, hello. Hi!', turns: [
      { text: 'Um, hello.', speakerLabel: 'spk_1', startMs: 0, endMs: 600 },
      { text: 'Hi!', speakerLabel: 'spk_2', startMs: 1000, endMs: 1500 },
    ] });
  });

  it.each([null, '', '0', '9', '1.5', 'NaN', '01'])('rejects missing or invalid required speaker count %s before upload', async (speakerCount) => {
    const response = await POST(formRequest(new File(['audio'], 'voice.wav', { type: 'audio/wav' }), 2000, { speakerCount }));
    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects unknown transcription modes before upload', async () => {
    const response = await POST(formRequest(new File(['audio'], 'voice.wav', { type: 'audio/wav' }), 2000, { mode: 'other' }));
    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('does not convert provider errors into successful transcription', async () => {
    mocks.create.mockRejectedValueOnce(new Error('provider failure'));
    const response = await POST(formRequest(new File(['audio-data'], 'recording.wav', { type: 'audio/wav' })));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.remove).toHaveBeenCalled();
  });

  it('rejects oversized files and durations beyond 20 seconds before uploading', async () => {
    const oversized = await POST(formRequest(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.webm', { type: 'audio/webm' })));
    expect(oversized.status).toBe(413);
    const tooLong = await POST(formRequest(new File(['tiny'], 'long.webm', { type: 'audio/webm' }), 20_001));
    expect(tooLong.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('requires the configured owner guard in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.AUTH_SECRET;
    delete process.env.OWNER_EMAIL;
    const response = await POST(formRequest(new File(['audio'], 'voice.webm', { type: 'audio/webm' })));
    expect(response.status).toBe(503);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
