import 'server-only';
import OpenAI from 'openai';
import { AiConfigError } from '@/config/ai.server';
import type { ProviderCallParams } from './google';

export async function* streamOpenAiText(params: ProviderCallParams): AsyncIterable<string> {
  if (!params.apiKey) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      const mockWords = ['[OpenAI mock]: ', params.userPrompt.slice(0, 30)];
      for (const word of mockWords) {
        yield word;
      }
      return;
    }
    throw new AiConfigError('MISSING_CONFIG', 'Chưa cấu hình OPENAI_API_KEY cho OpenAI model.');
  }

  const client = new OpenAI({ apiKey: params.apiKey });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (params.systemInstruction) {
    messages.push({ role: 'system', content: params.systemInstruction });
  }
  messages.push({ role: 'user', content: params.userPrompt });

  const stream = await client.chat.completions.create(
    {
      model: params.modelId,
      messages,
      stream: true,
    },
    { signal: params.signal }
  );

  for await (const chunk of stream) {
    if (params.signal?.aborted) break;
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}

export async function generateOpenAiText(params: ProviderCallParams): Promise<string> {
  if (!params.apiKey) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return JSON.stringify({
        title: 'Tóm tắt bài học (OpenAI Mock)',
        overview: 'Đây là bài tóm tắt tổng quan được tạo ở chế độ kiểm thử tự động.',
        sections: [
          {
            heading: 'Nội dung chính',
            bullets: ['Điểm quan trọng thứ nhất', 'Điểm quan trọng thứ hai'],
            captionIds: [1],
          },
        ],
      });
    }
    throw new AiConfigError('MISSING_CONFIG', 'Chưa cấu hình OPENAI_API_KEY cho OpenAI model.');
  }

  const client = new OpenAI({ apiKey: params.apiKey });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (params.systemInstruction) {
    messages.push({ role: 'system', content: params.systemInstruction });
  }
  messages.push({ role: 'user', content: params.userPrompt });

  const response = await client.chat.completions.create(
    {
      model: params.modelId,
      messages,
      stream: false,
    },
    { signal: params.signal }
  );

  return response.choices[0]?.message?.content || '';
}

export async function generateOpenAiImage(
  prompt: string,
  modelId: string,
  apiKey?: string
): Promise<Buffer> {
  if (!apiKey) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
    }
    throw new AiConfigError('MISSING_CONFIG', 'Chưa cấu hình API key cho OpenAI Image.');
  }

  const client = new OpenAI({ apiKey });

  const response = await client.images.generate({
    model: modelId,
    prompt,
    n: 1,
    response_format: 'b64_json',
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI Image API không trả về b64_json.');
  }

  return Buffer.from(b64, 'base64');
}
