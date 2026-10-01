import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), create: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    files = { upload: mocks.upload, delete: mocks.remove };
    interactions = { create: mocks.create };
  },
}));

import { POST } from '@/app/api/speech/diarize/route';

const twoSpeakerInteraction = {
  output_text: 'Do not use this as transcript text.',
  steps: [{
    type: 'model_output',
    content: [{
      type: 'text',
      text: 'Do not use this as transcript text.',
      annotations: [
        { type: 'word_info', text: 'Hello', speaker: 'spk_1', start_offset: '0.100s', end_offset: '0.420s' },
        { type: 'word_info', text: 'there.', speaker: 'spk_1', start_offset: '0.430s', end_offset: '0.700s' },
        { type: 'word_info', text: 'Hi!', speaker: 'spk_2', start_offset: '1.200s', end_offset: '1.510s' },
      ],
    }],
  }],
};

function formRequest(file: File, durationMs = 2_000): Request {
  const form = new FormData();
  form.set('audio', file);
  form.set('durationMs', String(durationMs));
  return new Request('http://localhost/api/speech/diarize', { method: 'POST', body: form });
}

describe('POST /api/speech/diarize', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.AUTH_SECRET;
    delete process.env.OWNER_EMAIL;
    process.env.GOOGLE_API_KEY = 'server-only-secret';
    mocks.upload.mockReset().mockResolvedValue({ name: 'files/temp-1', uri: 'files/temp-1' });
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.create.mockReset().mockResolvedValue(twoSpeakerInteraction);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns provider word annotations by timestamp and speaker, then deletes its upload', async () => {
    const response = await POST(formRequest(new File(['audio-data'], 'recording.mp4', { type: 'audio/mp4' })));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      model: 'gemini-3.5-transcribe',
      segments: [
        { speakerLabel: 'spk_1', startMs: 100, endMs: 420, text: 'Hello' },
        { speakerLabel: 'spk_1', startMs: 430, endMs: 700, text: 'there.' },
        { speakerLabel: 'spk_2', startMs: 1200, endMs: 1510, text: 'Hi!' },
      ],
    });
    expect(mocks.upload.mock.calls[0][0].config.mimeType).toBe('audio/m4a');
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', uri: 'files/temp-1', mime_type: 'audio/m4a' }],
      generation_config: { transcription_config: { mode: {
        type: 'verbatim', diarization_mode: 'speaker', timestamp_granularities: ['word'],
      } } },
    });
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'files/temp-1' }));
  });

  it('rejects oversized files and durations beyond 30 minutes before uploading', async () => {
    const oversized = await POST(formRequest(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.webm', { type: 'audio/webm' })));
    expect(oversized.status).toBe(413);
    const tooLong = await POST(formRequest(new File(['tiny'], 'long.webm', { type: 'audio/webm' }), 1_800_001));
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
