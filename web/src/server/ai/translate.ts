import 'server-only';
import { resolveTaskConfig, AiConfigError } from '@/config/ai.server';
import {
  buildTranslationSystemPrompt,
  buildTranslationPayload,
} from './prompts/translation';
import { streamGoogleText } from './providers/google';
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

  const params = {
    apiKey: resolved.apiKey,
    modelId: resolved.model.modelId,
    systemInstruction,
    userPrompt: userPayload,
    signal,
    thinkingLevel: req.thinkingLevel,
  };

  if (resolved.model.provider === 'google') {
    if (req.thinkingLevel && !resolved.model.thinkingLevels?.includes(req.thinkingLevel)) {
      throw new AiConfigError('UNSUPPORTED_MODEL', `Mức suy luận ${req.thinkingLevel} không được model ${resolved.model.modelId} hỗ trợ.`);
    }
    yield* streamGoogleText(params);
  } else {
    yield* streamOpenAiText(params);
  }
}
