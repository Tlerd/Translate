import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTranslation, buildUsageRecord } from '@/server/ai/translate';
import type { TranslateRequest } from '@/shared/ai-contracts';
import type { TranslationUsageRecord } from '@/server/cloud/translation-usage-store';

const sdk = vi.hoisted(() => ({
  generateContentStream: vi.fn(),
  lastConfig: undefined as unknown,
}));
vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = {
        generateContentStream: (params: unknown) => {
          sdk.lastConfig = params;
          return sdk.generateContentStream(params);
        },
      };
    },
  };
});

const request: TranslateRequest = {
  requestId: 'usage-request', recordingId: 'usage-recording', captionId: 7,
  sessionEpoch: 1, revision: 3, configRevision: 1,
  modelKey: 'google:gemini-3.1-flash-lite', requestKind: 'final', sourceLanguage: 'ja', targetLanguage: 'vi',
  text: 'private source', context: 'private situation', glossary: 'private glossary',
};

describe('translation token usage diagnostics', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_API_KEY', 'private-test-key');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    sdk.lastConfig = undefined;
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('records final cumulative provider counts once with request identity and no content', async () => {
    sdk.generateContentStream.mockResolvedValue((async function* () {
      yield { text: 'Xin ', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 1 } };
      yield { text: 'chào', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 2, cachedContentTokenCount: 0, thoughtsTokenCount: 0, totalTokenCount: 102 } };
    })());
    const parts: string[] = [];
    for await (const part of executeTranslation(request)) parts.push(part);
    expect(parts.join('')).toBe('Xin chào');
    expect(console.info).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledWith('[translation-usage]', expect.objectContaining({
      requestId: request.requestId, captionId: 7, revision: 3, modelKey: request.modelKey,
      status: 'completed', usageStatus: 'reported', inputTokens: 100, outputTokens: 2, cachedInputTokens: 0, thinkingTokens: 0, totalTokens: 102,
      requestKind: 'final', historyTurns: 0, thinkingLevel: null,
    }));
    const logged = JSON.stringify(vi.mocked(console.info).mock.calls);
    for (const content of ['private source', 'private situation', 'private glossary', 'private-test-key', 'Xin chào']) expect(logged).not.toContain(content);
  });

  it('reports missing usage as unknown instead of zero for a completed stream', async () => {
    sdk.generateContentStream.mockResolvedValue((async function* () { yield { text: 'translated' }; })());
    for await (const part of executeTranslation(request)) void part;
    expect(console.info).toHaveBeenCalledWith('[translation-usage]', expect.objectContaining({
      status: 'completed', usageStatus: 'unavailable', inputTokens: null, outputTokens: null,
    }));
  });

  it('retains reported input counts when the last usage chunk only reports output', async () => {
    sdk.generateContentStream.mockResolvedValue((async function* () {
      yield { text: 'Xin ', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 1, cachedContentTokenCount: 0 } };
      yield { text: 'chào', usageMetadata: { candidatesTokenCount: 2, totalTokenCount: 102 } };
    })());
    for await (const part of executeTranslation(request)) void part;
    expect(console.info).toHaveBeenCalledWith('[translation-usage]', expect.objectContaining({
      status: 'completed', inputTokens: 100, outputTokens: 2, cachedInputTokens: 0, thinkingTokens: null, totalTokens: 102,
    }));
  });

  it('logs aborted work with unavailable usage without claiming it was free', async () => {
    sdk.generateContentStream.mockResolvedValue((async function* () { yield { text: 'partial' }; yield { text: 'late' }; })());
    const abort = new AbortController();
    const stream = executeTranslation(request, abort.signal)[Symbol.asyncIterator]();
    expect(await stream.next()).toMatchObject({ value: 'partial', done: false });
    abort.abort();
    expect(await stream.next()).toMatchObject({ done: true });
    expect(console.info).toHaveBeenCalledWith('[translation-usage]', expect.objectContaining({
      status: 'aborted', usageStatus: 'unavailable', inputTokens: null, outputTokens: null,
    }));
  });

  it('records a provider failure once without dumping its raw error or request', async () => {
    sdk.generateContentStream.mockRejectedValue(new Error('private upstream error'));
    await expect(async () => { for await (const part of executeTranslation(request)) void part; }).rejects.toThrow('private upstream error');
    expect(console.info).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledWith('[translation-usage]', expect.objectContaining({ status: 'failed', inputTokens: null }));
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('private upstream error');
  });

  it('uses minimal thinking level for segment requests when unspecified, and invokes onUsageRecord callback', async () => {
    sdk.generateContentStream.mockResolvedValue((async function* () {
      yield { text: 'Đoạn dịch', usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5, totalTokenCount: 55 } };
    })());

    let receivedRecord: TranslationUsageRecord | undefined;
    const segmentRequest: TranslateRequest = {
      ...request,
      requestKind: 'segment',
      previousTurns: [
        { source: 'turn 1 source', translation: 'turn 1 trans' },
      ],
    };

    for await (const part of executeTranslation(segmentRequest, undefined, (r) => { receivedRecord = r; })) {
      void part;
    }

    expect(receivedRecord).toBeDefined();
    expect(receivedRecord?.requestKind).toBe('segment');
    expect(receivedRecord?.thinkingLevel).toBe('minimal');
    expect(receivedRecord?.historyTurns).toBe(1);
    expect((sdk.lastConfig as { config?: { thinkingConfig?: { thinkingLevel?: unknown } } })?.config?.thinkingConfig?.thinkingLevel).toBeDefined();
  });

  it('leaves thinking level undefined for final requests with auto thinking', async () => {
    sdk.generateContentStream.mockResolvedValue((async function* () {
      yield { text: 'Toàn câu', usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 10, totalTokenCount: 90 } };
    })());

    let receivedRecord: TranslationUsageRecord | undefined;
    const finalRequest: TranslateRequest = {
      ...request,
      requestKind: 'final',
      thinkingLevel: undefined,
    };

    for await (const part of executeTranslation(finalRequest, undefined, (r) => { receivedRecord = r; })) {
      void part;
    }

    expect(receivedRecord).toBeDefined();
    expect(receivedRecord?.requestKind).toBe('final');
    expect(receivedRecord?.thinkingLevel).toBeNull();
    expect((sdk.lastConfig as { config?: { thinkingConfig?: unknown } })?.config?.thinkingConfig).toBeUndefined();
  });

  it('builds usage record accurately from parameters', () => {
    const record = buildUsageRecord({
      req: request,
      modelKey: request.modelKey,
      status: 'completed',
      durationMs: 150,
      systemChars: 500,
      payloadChars: 100,
      historyTurns: 2,
      thinkingLevel: 'minimal',
      usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
    });
    expect(record).toMatchObject({
      requestId: request.requestId,
      status: 'completed',
      requestKind: 'final',
      historyTurns: 2,
      thinkingLevel: 'minimal',
      inputTokens: 50,
      outputTokens: 10,
      promptVersion: 'lean-fidelity-v3',
    });
  });

  it('keeps partially reported token counts but marks metadata incomplete', () => {
    const record = buildUsageRecord({ req: request, modelKey: request.modelKey, status: 'aborted',
      durationMs: 10, systemChars: 10, payloadChars: 10, historyTurns: 0, thinkingLevel: null,
      usage: { inputTokens: 100 } });
    expect(record).toMatchObject({ usageStatus: 'unavailable', inputTokens: 100, outputTokens: null });
  });
});
