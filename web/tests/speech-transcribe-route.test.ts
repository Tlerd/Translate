import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), create: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    files = { upload: mocks.upload, delete: mocks.remove };
    interactions = { create: mocks.create };
  },
}));

import { POST } from '@/app/api/speech/transcribe/route';

const transcriptInteraction = { output_text: 'えっと、こんにちは。こんにちは。' };

function formRequest(file: File, durationMs = 2_000): Request {
  const form = new FormData();
  form.set('audio', file);
  form.set('durationMs', String(durationMs));
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
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses verbatim unary transcription and cleans up the provider upload', async () => {
    const response = await POST(formRequest(new File(['audio-data'], 'recording.wav', { type: 'audio/wav' })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ model: 'gemini-3.5-transcribe', text: transcriptInteraction.output_text });
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ model: 'gemini-3.5-transcribe', generation_config: { transcription_config: { mode: { type: 'verbatim' } } } });
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'files/temp-1' }));
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
