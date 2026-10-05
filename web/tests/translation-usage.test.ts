import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTranslation } from '@/server/ai/translate';
import type { TranslateRequest } from '@/shared/ai-contracts';

const sdk = vi.hoisted(() => ({ generateContentStream: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContentStream: sdk.generateContentStream };
  },
}));

const request: TranslateRequest = {
  requestId: 'usage-request', recordingId: 'usage-recording', captionId: 7,
  sessionEpoch: 1, revision: 3, configRevision: 1,
  modelKey: 'google:gemini-3.1-flash-lite', sourceLanguage: 'ja', targetLanguage: 'vi',
  text: 'private source', context: 'private situation', glossary: 'private glossary',
};

describe('translation token usage diagnostics', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_API_KEY', 'private-test-key');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
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
});
