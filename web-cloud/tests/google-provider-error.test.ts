import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleProviderErrorResponse } from '@/server/ai/google-provider-error';

describe('Google provider error mapping', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [401, 'UPSTREAM_ERROR', 'HTTP 401'],
    [403, 'UPSTREAM_ERROR', 'HTTP 403'],
    [429, 'RATE_LIMIT_EXCEEDED', 'quota'],
    [404, 'UNSUPPORTED_MODEL', 'Model Gemini transcription'],
  ])('classifies provider status %i for the user', async (status, code, message) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = googleProviderErrorResponse('speech.test', Object.assign(
      new Error('private transcript/API key must not leak'), { status, code: 'GOOGLE_ERROR' }
    ));
    const body = await response.json();
    expect(response.status).toBe(status === 429 ? 429 : 502);
    expect(body.error.code).toBe(code);
    expect(body.error.message).toContain(message);
    expect(JSON.stringify(body)).not.toContain('private transcript');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private transcript');
    expect(log.mock.calls[0][1]).toEqual({ status, code: 'GOOGLE_ERROR' });
  });

  it('maps bounded timeouts to a timeout response without provider text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = googleProviderErrorResponse('speech.test', new Error('raw request data'), true);
    const body = await response.json();
    expect(response.status).toBe(504);
    expect(body.error.code).toBe('TIMEOUT');
    expect(JSON.stringify(log.mock.calls)).not.toContain('raw request data');
  });
});
