import 'server-only';
import { resolveTaskConfig, AiConfigError } from '@/config/ai.server';
import {
  buildTranslationSystemPrompt,
  buildTranslationPayloadWithStats,
} from './prompts/translation';
import { streamGoogleText, type ProviderTokenUsage } from './providers/google';
import { streamOpenAiText } from './providers/openai';
import type { TranslateRequest } from '@/shared/ai-contracts';
import type { TranslationUsageRecord } from '@/server/cloud/translation-usage-store';

export function buildUsageRecord(params: {
  req: TranslateRequest;
  modelKey: string;
  status: 'completed' | 'failed' | 'aborted';
  durationMs: number;
  systemChars: number;
  payloadChars: number;
  historyTurns: number;
  thinkingLevel: string | null;
  usage?: ProviderTokenUsage;
}): TranslationUsageRecord {
  const { req, modelKey, status, durationMs, systemChars, payloadChars, historyTurns, thinkingLevel, usage } = params;
  return {
    requestId: req.requestId,
    recordingId: req.recordingId,
    captionId: req.captionId,
    revision: req.revision,
    modelKey,
    status,
    requestKind: req.requestKind ?? 'final',
    thinkingLevel,
    durationMs,
    sourceChars: req.text.length,
    systemChars,
    payloadChars,
    historyTurns,
    usageStatus: usage ? 'reported' : 'unavailable',
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cachedInputTokens: usage?.cachedInputTokens ?? null,
    thinkingTokens: usage?.thinkingTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
  };
}

export async function* executeTranslation(
  req: TranslateRequest,
  signal?: AbortSignal,
  onUsageRecord?: (record: TranslationUsageRecord) => void
): AsyncIterable<string> {
  const resolved = resolveTaskConfig('translate', req.modelKey);

  const systemInstruction = buildTranslationSystemPrompt(
    req.sourceLanguage,
    req.targetLanguage
  );

  const { payload: userPayload, historyTurns } = buildTranslationPayloadWithStats({
    sourceLanguage: req.sourceLanguage,
    targetLanguage: req.targetLanguage,
    previousTurns: req.previousTurns,
    currentUtterance: req.text,
  });

  const effectiveThinkingLevel =
    req.thinkingLevel ??
    (req.requestKind && req.requestKind !== 'final' && resolved.model.thinkingLevels?.includes('minimal')
      ? 'minimal'
      : undefined);

  const startedAt = Date.now();
  let usage: ProviderTokenUsage | undefined;
  let status: 'completed' | 'failed' | 'aborted' = 'aborted';
  const params = {
    apiKey: resolved.apiKey,
    modelId: resolved.model.modelId,
    systemInstruction,
    userPrompt: userPayload,
    signal,
    thinkingLevel: effectiveThinkingLevel,
    onUsage: (reported: ProviderTokenUsage) => {
      usage = {
        inputTokens: reported.inputTokens ?? usage?.inputTokens,
        outputTokens: reported.outputTokens ?? usage?.outputTokens,
        cachedInputTokens: reported.cachedInputTokens ?? usage?.cachedInputTokens,
        thinkingTokens: reported.thinkingTokens ?? usage?.thinkingTokens,
        totalTokens: reported.totalTokens ?? usage?.totalTokens,
      };
    },
  };

  try {
    if (resolved.model.provider === 'google') {
      if (effectiveThinkingLevel && !resolved.model.thinkingLevels?.includes(effectiveThinkingLevel)) {
        throw new AiConfigError('UNSUPPORTED_MODEL', `Mức suy luận ${effectiveThinkingLevel} không được model ${resolved.model.modelId} hỗ trợ.`);
      }
      yield* streamGoogleText(params);
    } else {
      yield* streamOpenAiText(params);
    }
    status = signal?.aborted ? 'aborted' : 'completed';
  } catch (error) {
    status = signal?.aborted ? 'aborted' : 'failed';
    throw error;
  } finally {
    // Correlate provider usage with a caption without logging speech, glossary,
    // translations or keys. Missing/aborted metadata is unknown, never free.
    const record = buildUsageRecord({
      req,
      modelKey: resolved.model.key,
      status,
      durationMs: Date.now() - startedAt,
      systemChars: systemInstruction.length,
      payloadChars: userPayload.length,
      historyTurns,
      thinkingLevel: effectiveThinkingLevel ?? null,
      usage,
    });
    console.info('[translation-usage]', record);
    if (onUsageRecord) {
      try {
        onUsageRecord(record);
      } catch {
        // Best-effort callback
      }
    }
  }
}
