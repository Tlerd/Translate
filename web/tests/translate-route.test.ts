import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
  providerSignal: undefined as AbortSignal | undefined,
}));

const store = vi.hoisted(() => ({
  afterFn: vi.fn((fn: () => unknown) => {
    void Promise.resolve().then(fn);
  }),
  usageStoreEnabled: vi.fn(() => true),
  insertTranslationUsage: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream: sdk.generateContentStream };
    constructor(config: unknown) { void config; }
  },
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (fn: () => unknown) => store.afterFn(fn),
  };
});

vi.mock('@/server/cloud/translation-usage-store', () => ({
  usageStoreEnabled: () => store.usageStoreEnabled(),
  insertTranslationUsage: (r: unknown) => store.insertTranslationUsage(r),
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

describe('POST /api/translate usage persistence', () => {
  beforeEach(() => {
    process.env.AI_TRANSLATION_MODEL = 'google:gemini-3.5-flash-lite';
    process.env.GOOGLE_API_KEY = 'offline-test-key';
    store.usageStoreEnabled.mockReturnValue(true);
    store.insertTranslationUsage.mockResolvedValue(undefined);
    store.afterFn.mockClear();
    store.insertTranslationUsage.mockClear();
  });

  it('registers after() synchronously before returning Response and inserts record upon completion', async () => {
    sdk.generateContentStream.mockImplementation(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { text: 'Xin chào', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } };
      },
    }));

    const response = await POST(translateRequest());
    expect(store.afterFn).toHaveBeenCalledOnce();

    const reader = response.body!.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    expect(chunks.join('')).toContain('event: done');
    const stream = chunks.join('');
    const usageFrame = stream.split('\n\n').find((frame) => frame.startsWith('event: usage'));
    expect(usageFrame).toBeDefined();
    const metrics = JSON.parse(usageFrame!.split('data: ')[1]);
    expect(metrics).toMatchObject({ requestId: 'req-abort', historyTurns: 0, promptVersion: 'lean-fidelity-v5', inputTokens: 10, outputTokens: 2, usageStatus: 'reported' });
    expect(Object.keys(metrics).sort()).toEqual(['cachedInputTokens', 'historyTurns', 'inputTokens', 'outputTokens', 'promptVersion', 'requestId', 'thinkingTokens', 'usageStatus'].sort());
    expect(stream.indexOf('event: usage')).toBeLessThan(stream.indexOf('event: done'));
    await vi.waitFor(() => expect(store.insertTranslationUsage).toHaveBeenCalledOnce());
    expect(store.insertTranslationUsage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-abort',
      recordingId: 'rec-abort',
      status: 'completed',
    }));
  });

  it('does not break SSE stream when insertTranslationUsage fails and logs message only', async () => {
    store.insertTranslationUsage.mockRejectedValue(new Error('private db connection error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    sdk.generateContentStream.mockImplementation(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { text: 'Bản dịch', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } };
      },
    }));

    const response = await POST(translateRequest());
    const reader = response.body!.getReader();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    expect(chunks.join('')).toContain('event: done');
    expect(store.afterFn).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(warnSpy).toHaveBeenCalledWith(
      '[translation-usage] persist failed',
      'private db connection error'
    );
    warnSpy.mockRestore();
  });
});
