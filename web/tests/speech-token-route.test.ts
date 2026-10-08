import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createToken } = vi.hoisted(() => ({ createToken: vi.fn() }));
vi.mock('@google/genai', () => ({
  Modality: { TEXT: 'TEXT' },
  AudioTranscriptionConfigMode: { VERBATIM: 'VERBATIM', SMART: 'SMART' },
  GoogleGenAI: class {
    authTokens = { create: createToken };
    constructor(public options: unknown) {}
  },
}));

import { POST } from '@/app/api/speech/token/route';

describe('POST /api/speech/token', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.AUTH_SECRET;
    delete process.env.OWNER_EMAIL;
    process.env.GOOGLE_API_KEY = 'server-secret';
    createToken.mockReset().mockResolvedValue({ name: 'ephemeral-value' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('creates a one-use short session constrained to verbatim live transcription', async () => {
    const response = await POST(new Request('http://localhost/api/speech/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ languageCode: 'ja-JP' }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      token: 'ephemeral-value', model: 'gemini-3.5-transcribe-live', sessionLimitMs: 600_000,
      websocketUrl: expect.stringContaining('.v1alpha.GenerativeService.BidiGenerateContentConstrained'),
    });
    const args = createToken.mock.calls[0][0];
    expect(args.config.uses).toBe(1);
    expect(Date.parse(args.config.newSessionExpireTime) - Date.now()).toBeLessThanOrEqual(120_000);
    expect(Date.parse(args.config.expireTime) - Date.now()).toBeLessThanOrEqual(600_000);
    expect(args.config.liveConnectConstraints).toMatchObject({
      model: 'gemini-3.5-transcribe-live',
      config: { responseModalities: ['TEXT'], inputAudioTranscription: {
        languageCodes: ['ja-JP'], mode: 'VERBATIM',
      } },
    });
    expect(args.config).not.toHaveProperty('apiKey');
  });

  it('constrains smart Live credentials to SMART mode', async () => {
    const response = await POST(new Request('http://localhost/api/speech/token', {
      method: 'POST', body: JSON.stringify({ languageCode: 'vi-VN', transcriptionMode: 'smart' }),
    }));
    expect(response.status).toBe(200);
    expect(createToken.mock.calls[0][0].config.liveConnectConstraints.config.inputAudioTranscription)
      .toEqual({ languageCodes: ['vi-VN'], mode: 'SMART' });
  });

  it('constrains Live credentials to translationConfig when targetLanguageCode is provided', async () => {
    const response = await POST(new Request('http://localhost/api/speech/token', {
      method: 'POST', body: JSON.stringify({ languageCode: 'ja-JP', targetLanguageCode: 'vi-VN' }),
    }));
    expect(response.status).toBe(200);
    expect(createToken.mock.calls[0][0].config.liveConnectConstraints.config.translationConfig).toEqual({
      targetLanguageCode: 'vi-VN',
      echoTargetLanguage: true,
    });
  });

  it('mints Flash Live credentials for input transcription without Transcribe-only options', async () => {
    const response = await POST(new Request('http://localhost/api/speech/token', {
      method: 'POST', body: JSON.stringify({ model: 'gemini-3.1-flash-live-preview', languageCode: 'ja-JP', transcriptionMode: 'smart' }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).model).toBe('gemini-3.1-flash-live-preview');
    expect(createToken.mock.calls[0][0].config.liveConnectConstraints).toMatchObject({
      model: 'gemini-3.1-flash-live-preview', config: { responseModalities: ['AUDIO'], inputAudioTranscription: {} },
    });
    expect(createToken.mock.calls[0][0].config.liveConnectConstraints.config.inputAudioTranscription).not.toHaveProperty('mode');
  });

  it.each(['gemini-3-flash-preview', 'arbitrary-model'])('rejects non-Live model %s before minting credentials', async (model) => {
    const response = await POST(new Request('http://localhost/api/speech/token', { method: 'POST', body: JSON.stringify({ model }) }));
    expect(response.status).toBe(400);
    expect(createToken).not.toHaveBeenCalled();
  });

  it('rejects unsupported modes without minting credentials', async () => {
    const response = await POST(new Request('http://localhost/api/speech/token', {
      method: 'POST', body: JSON.stringify({ transcriptionMode: 'unknown' }),
    }));
    expect(response.status).toBe(400);
    expect(createToken).not.toHaveBeenCalled();
  });

  it('rejects malformed language hints before requesting a token', async () => {
    const response = await POST(new Request('http://localhost/api/speech/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ languageCode: 'ja-JP\n&key=leak' }),
    }));
    expect(response.status).toBe(400);
    expect(createToken).not.toHaveBeenCalled();
  });

  it('rejects token request bodies over 2 KB before creating credentials', async () => {
    const response = await POST(new Request('http://localhost/api/speech/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extra: 'x'.repeat(2_100) }),
    }));
    expect(response.status).toBe(413);
    expect(createToken).not.toHaveBeenCalled();
  });
});
