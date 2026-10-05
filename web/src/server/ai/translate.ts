import 'server-only';
import { resolveTaskConfig, AiConfigError } from '@/config/ai.server';
import {
  buildTranslationSystemPrompt,
  buildTranslationPayload,
} from './prompts/translation';
import { streamGoogleText, type ProviderTokenUsage } from './providers/google';
import { streamOpenAiText } from './providers/openai';
import type { TranslateRequest } from '@/shared/ai-contracts';

export async function* executeTranslation(
  req: TranslateRequest,
  signal?: AbortSignal
): AsyncIterable<string> {
  const resolved = resolveTaskConfig('translate', req.modelKey);

  const systemInstruction = buildTranslationSystemPrompt(
    req.sourceLanguage,
    req.targetLanguage
  );

  const userPayload = buildTranslationPayload({
    sourceLanguage: req.sourceLanguage,
    targetLanguage: req.targetLanguage,
    situation: req.context,
    glossary: req.glossary,
    previousTurns: req.previousTurns,
    currentUtterance: req.text,
  });

  const startedAt = Date.now();
  let usage: ProviderTokenUsage | undefined;
  let status: 'completed' | 'failed' | 'aborted' = 'aborted';
  const params = {
    apiKey: resolved.apiKey,
    modelId: resolved.model.modelId,
    systemInstruction,
    userPrompt: userPayload,
    signal,
    thinkingLevel: req.thinkingLevel,
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
      if (req.thinkingLevel && !resolved.model.thinkingLevels?.includes(req.thinkingLevel)) {
        throw new AiConfigError('UNSUPPORTED_MODEL', `Mức suy luận ${req.thinkingLevel} không được model ${resolved.model.modelId} hỗ trợ.`);
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
    console.info('[translation-usage]', {
      requestId: req.requestId,
      recordingId: req.recordingId,
      captionId: req.captionId,
      revision: req.revision,
      modelKey: resolved.model.key,
      status,
      durationMs: Date.now() - startedAt,
      sourceChars: req.text.length,
      systemChars: systemInstruction.length,
      payloadChars: userPayload.length,
      usageStatus: usage ? 'reported' : 'unavailable',
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      cachedInputTokens: usage?.cachedInputTokens ?? null,
      thinkingTokens: usage?.thinkingTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
    });
  }
}
