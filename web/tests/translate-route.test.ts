import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
  providerSignal: undefined as AbortSignal | undefined,
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream: sdk.generateContentStream };
    constructor(config: unknown) { void config; }
  },
}));

vi.mock('@/server/http/guard', () => ({
  verifyAuthGuard: vi.fn(async () => null),
  makeErrorResponse: vi.fn(),
}));

vi.mock('@/server/http/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 10 })),
}));

import { POST } from '@/app/api/translate/route';

function translateRequest(signal?: AbortSignal) {
  return new Request('http://localhost/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'req-abort',
      recordingId: 'rec-abort',
      captionId: 1,
      sessionEpoch: 1,
      revision: 1,
      modelKey: 'google:gemini-3.5-flash-lite',
      text: 'こんにちは',
    }),
    signal,
  });
}

describe('POST /api/translate cancellation', () => {
  beforeEach(() => {
    process.env.AI_TRANSLATION_MODEL = 'google:gemini-3.5-flash-lite';
    process.env.GOOGLE_API_KEY = 'offline-test-key';
  });
  afterEach(() => vi.clearAllMocks());

  it('aborts the provider on stream cancellation and emits no terminal event', async () => {
    sdk.providerSignal = undefined;
    sdk.generateContentStream.mockImplementation(async (params: {
      config?: { abortSignal?: AbortSignal };
    }) => {
      sdk.providerSignal = params.config?.abortSignal;
      return {
        async *[Symbol.asyncIterator]() {
          yield { text: 'partial' };
          await new Promise<void>((resolve) => {
            if (sdk.providerSignal) {
              sdk.providerSignal.addEventListener('abort', () => resolve(), { once: true });
            } else {
              setTimeout(resolve, 250);
            }
          });
          throw new Error('provider stopped');
        },
      };
    });

    const response = await POST(translateRequest());
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: delta');

    await reader.cancel('client left');
    expect((sdk.providerSignal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  it('aborts the provider when the HTTP request signal is aborted', async () => {
    sdk.providerSignal = undefined;
    sdk.generateContentStream.mockImplementation(async (params: {
      config?: { abortSignal?: AbortSignal };
    }) => {
      sdk.providerSignal = params.config?.abortSignal;
      return {
        async *[Symbol.asyncIterator]() {
          yield { text: 'partial' };
          await new Promise<void>((resolve) => {
            if (sdk.providerSignal) {
              sdk.providerSignal.addEventListener('abort', () => resolve(), { once: true });
            } else {
              setTimeout(resolve, 250);
            }
          });
          throw new Error('provider stopped');
        },
      };
    });

    const client = new AbortController();
    const response = await POST(translateRequest(client.signal));
    const reader = response.body!.getReader();
    await reader.read();
    client.abort();
    await vi.waitFor(() => expect((sdk.providerSignal as AbortSignal | undefined)?.aborted).toBe(true));
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });
});
