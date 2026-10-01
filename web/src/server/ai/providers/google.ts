import 'server-only';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { ThinkingConfig } from '@google/genai';
import { AiConfigError } from '@/config/ai.server';

export interface ProviderCallParams {
  apiKey?: string;
  modelId: string;
  systemInstruction?: string;
  userPrompt: string;
  signal?: AbortSignal;
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
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
  });

  let receivedText = false;
  for await (const chunk of responseStream) {
    if (params.signal?.aborted) break;
    const text = chunk.text;
    if (text) {
      receivedText = true;
      yield text;
    }
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
  });

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
