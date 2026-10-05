import 'server-only';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { ThinkingConfig } from '@google/genai';
import { AiConfigError } from '@/config/ai.server';

export interface ProviderTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
}

export interface ProviderCallParams {
  apiKey?: string;
  modelId: string;
  systemInstruction?: string;
  userPrompt: string;
  signal?: AbortSignal;
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  onUsage?: (usage: ProviderTokenUsage) => void;
}

export async function* streamGoogleText(params: ProviderCallParams): AsyncIterable<string> {
  if (!params.apiKey) {
    throw new AiConfigError('MISSING_CONFIG', 'Chưa cấu hình GOOGLE_API_KEY cho Google model.');
  }

  const ai = new GoogleGenAI({ apiKey: params.apiKey });

  const responseStream = await ai.models.generateContentStream({
    model: params.modelId,
    contents: params.userPrompt,
    config: {
      systemInstruction: params.systemInstruction,
      abortSignal: params.signal,
      thinkingConfig: params.thinkingLevel ? thinkingConfigForModel(params.modelId, params.thinkingLevel) : undefined,
    },
  }).catch((error: unknown) => { throw readableGoogleError(error, params.modelId); });

  let receivedText = false;
  try {
    for await (const chunk of responseStream) {
      if (params.signal?.aborted) break;
      const usage = chunk.usageMetadata;
      if (usage && [usage.promptTokenCount, usage.candidatesTokenCount, usage.cachedContentTokenCount, usage.thoughtsTokenCount, usage.totalTokenCount].some((count) => typeof count === 'number')) {
        // Streaming usage is cumulative. Keep the latest report, never add it
        // once per text chunk or count a missing field as zero.
        params.onUsage?.({
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          cachedInputTokens: usage.cachedContentTokenCount,
          thinkingTokens: usage.thoughtsTokenCount,
          totalTokens: usage.totalTokenCount,
        });
      }
      const text = chunk.text;
      if (text) {
        receivedText = true;
        yield text;
      }
    }
  } catch (error: unknown) {
    if (params.signal?.aborted) return;
    throw readableGoogleError(error, params.modelId);
  }
  if (!params.signal?.aborted && !receivedText) {
    throw new Error('Google AI không trả về nội dung văn bản.');
  }
}

export async function generateGoogleText(params: ProviderCallParams): Promise<string> {
  if (!params.apiKey) {
    throw new AiConfigError('MISSING_CONFIG', 'Chưa cấu hình GOOGLE_API_KEY cho Google model.');
  }

  const ai = new GoogleGenAI({ apiKey: params.apiKey });

  const response = await ai.models.generateContent({
    model: params.modelId,
    contents: params.userPrompt,
    config: {
      systemInstruction: params.systemInstruction,
      abortSignal: params.signal,
      thinkingConfig: params.thinkingLevel ? thinkingConfigForModel(params.modelId, params.thinkingLevel) : undefined,
    },
  }).catch((error: unknown) => { throw readableGoogleError(error, params.modelId); });

  if (!response.text?.trim()) {
    throw new Error('Google AI không trả về nội dung văn bản.');
  }
  return response.text;
}

export async function generateGoogleImage(
  prompt: string,
  modelId: string,
  apiKey?: string,
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
): Promise<Buffer> {
  if (!apiKey) {
    throw new AiConfigError('MISSING_CONFIG', 'Chưa cấu hình API key cho Google Image.');
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.interactions.create({
    model: modelId,
    input: prompt,
    response_format: { type: 'image', image_size: '1K' },
    generation_config: thinkingLevel ? { thinking_level: thinkingLevel } : undefined,
  });

  const image = response.output_image;
  if (!image?.data) {
    const status = response.status ? ` (trạng thái: ${response.status})` : '';
    throw new Error(`Google Image API không trả về dữ liệu ảnh${status}.`);
  }

  if (image.mime_type && !image.mime_type.startsWith('image/')) {
    throw new Error(`Google Image API trả về MIME type không hợp lệ: ${image.mime_type}.`);
  }
  const buffer = Buffer.from(image.data, 'base64');
  if (!buffer.length) throw new Error('Google Image API trả về dữ liệu ảnh rỗng.');
  return buffer;
}

function readableGoogleError(error: unknown, modelId: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (
    modelId === 'gemini-2.5-flash-lite' &&
    /(no longer available to new users|limit.*access.*to the 2\.5 models|actively used.*in the past|not found|does not exist|permission denied|unsupported)/i.test(message)
  ) {
    return new Error('Google không mở Gemini 2.5 Flash-Lite cho key/tài khoản này do giới hạn tài khoản cũ. Hãy chọn Gemini 3.1 Flash-Lite; model 2.5 chỉ dùng được với tài khoản còn được Google hỗ trợ.');
  }
  return error;
}

function thinkingConfigForModel(
  modelId: string,
  level: 'minimal' | 'low' | 'medium' | 'high'
): ThinkingConfig {
  if (modelId.startsWith('gemini-2.5-')) {
    const thinkingBudget = level === 'minimal' ? 0 : { low: 512, medium: 8192, high: 24576 }[level];
    return { thinkingBudget };
  }
  return { thinkingLevel: {
    minimal: ThinkingLevel.MINIMAL,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
  }[level] };
}
