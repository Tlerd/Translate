import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { AiConfigError } from '@/config/ai.server';

export interface ProviderCallParams {
  apiKey?: string;
  modelId: string;
  systemInstruction?: string;
  userPrompt: string;
  signal?: AbortSignal;
}

export async function* streamGoogleText(params: ProviderCallParams): AsyncIterable<string> {
  if (!params.apiKey) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      // Mock stream for testing without external API key
      const mockWords = ['[Bản dịch mock]: ', params.userPrompt.slice(0, 30)];
      for (const word of mockWords) {
        yield word;
      }
      return;
    }
    throw new AiConfigError('MISSING_CONFIG', 'Chưa cấu hình GOOGLE_API_KEY cho Google model.');
  }

  const ai = new GoogleGenAI({ apiKey: params.apiKey });

  const responseStream = await ai.models.generateContentStream({
    model: params.modelId,
    contents: params.userPrompt,
    config: {
      systemInstruction: params.systemInstruction,
    },
  });

  for await (const chunk of responseStream) {
    if (params.signal?.aborted) break;
    const text = chunk.text;
    if (text) {
      yield text;
    }
  }
}

export async function generateGoogleText(params: ProviderCallParams): Promise<string> {
  if (!params.apiKey) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return JSON.stringify({
        title: 'Tóm tắt bài học (Mock)',
        overview: 'Đây là bài tóm tắt tổng quan được tạo ở chế độ kiểm thử tự động.',
        sections: [
          {
            heading: 'Nội dung cốt lõi',
            bullets: ['Ý chính số 1 của bài học', 'Ý chính số 2 của bài học'],
            captionIds: [1],
          },
        ],
      });
    }
    throw new AiConfigError('MISSING_CONFIG', 'Chưa cấu hình GOOGLE_API_KEY cho Google model.');
  }

  const ai = new GoogleGenAI({ apiKey: params.apiKey });

  const response = await ai.models.generateContent({
    model: params.modelId,
    contents: params.userPrompt,
    config: {
      systemInstruction: params.systemInstruction,
    },
  });

  return response.text || '';
}

export async function generateGoogleImage(
  prompt: string,
  modelId: string,
  apiKey?: string
): Promise<Buffer> {
  if (!apiKey) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      // Return a 1x1 mock png buffer for tests
      return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
    }
    throw new AiConfigError('MISSING_CONFIG', 'Chưa cấu hình API key cho Google Image.');
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateImages({
    model: modelId,
    prompt,
    config: {
      numberOfImages: 1,
      outputMimeType: 'image/jpeg',
    },
  });

  const generated = response.generatedImages?.[0];
  if (!generated?.image?.imageBytes) {
    throw new Error('Google Image API không trả về dữ liệu ảnh.');
  }

  return Buffer.from(generated.image.imageBytes, 'base64');
}
