import 'server-only';
import { resolveTaskConfig, AiConfigError } from '@/config/ai.server';
import {
  buildSummarySystemPrompt,
  buildSummaryUserPayload,
} from './prompts/summary';
import { generateGoogleText } from './providers/google';
import { generateOpenAiText } from './providers/openai';
import type { SummarizeRequest, SummarizeResponse } from '@/shared/ai-contracts';

export async function executeSummarize(
  req: SummarizeRequest,
  signal?: AbortSignal
): Promise<SummarizeResponse> {
  const resolved = resolveTaskConfig('summarize', req.modelKey, req.translationModelKey);

  // Check input length
  let totalChars = 0;
  for (const cap of req.captions) {
    totalChars += cap.source.length;
  }
  const maxLimit = resolved.model.maxChars || 60000;
  if (totalChars > maxLimit) {
    throw new AiConfigError(
      'INPUT_TOO_LARGE',
      `Bản ghi vượt quá giới hạn ký tự cho phép tóm tắt (${totalChars}/${maxLimit} ký tự).`
    );
  }

  const systemInstruction = buildSummarySystemPrompt(req.targetLanguage);
  const userPayload = buildSummaryUserPayload(req.captions);

  const params = {
    apiKey: resolved.apiKey,
    modelId: resolved.model.modelId,
    systemInstruction,
    userPrompt: userPayload,
    signal,
    thinkingLevel: req.thinkingLevel,
  };

  let rawOutput = '';
  if (resolved.model.provider === 'google') {
    if (req.thinkingLevel && !resolved.model.thinkingLevels?.includes(req.thinkingLevel)) {
      throw new AiConfigError('UNSUPPORTED_MODEL', `Mức suy luận ${req.thinkingLevel} không được model ${resolved.model.modelId} hỗ trợ.`);
    }
    rawOutput = await generateGoogleText(params);
  } else {
    rawOutput = await generateOpenAiText(params);
  }

  // Parse JSON response safely (handling any accidental markdown block wrappers)
  const cleaned = rawOutput.replace(/^```(json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: {
    title?: string;
    overview?: string;
    sections?: Array<{
      heading: string;
      bullets: string[];
      captionIds: number[];
    }>;
  };

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Mô hình tóm tắt không trả về định dạng JSON hợp lệ.');
  }

  const validCaptionIdSet = new Set(req.captions.map((c) => c.id));

  // Sanitize sections and citation IDs
  const sections = (parsed.sections || []).map((sec) => ({
    heading: sec.heading || 'Nội dung chính',
    bullets: Array.isArray(sec.bullets) ? sec.bullets : [],
    captionIds: (sec.captionIds || []).filter((id) => validCaptionIdSet.has(id)),
  }));

  return {
    requestId: req.requestId,
    recordingId: req.recordingId,
    title: parsed.title || 'Tóm tắt buổi học',
    overview: parsed.overview || '',
    sections,
    modelKey: resolved.model.key,
    sourceHash: req.sourceHash,
    generatedAt: new Date().toISOString(),
  };
}
