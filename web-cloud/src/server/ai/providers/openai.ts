import 'server-only';
import OpenAI from 'openai';
import { AiConfigError } from '@/config/ai.server';
import type { ProviderCallParams } from './google';

export async function* streamOpenAiText(params: ProviderCallParams): AsyncIterable<string> {
  if (!params.apiKey) {
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
      stream_options: { include_usage: true },
    },
    { signal: params.signal }
  );

  let receivedContent = false;
  for await (const chunk of stream) {
    if (params.signal?.aborted) break;
    if (chunk.usage) {
      const thinking = chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0;
      params.onUsage?.({
        inputTokens: chunk.usage.prompt_tokens,
        // OpenAI completion_tokens includes reasoning, unlike Gemini candidates.
        outputTokens: Math.max(0, chunk.usage.completion_tokens - thinking),
        thinkingTokens: thinking,
        cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
        totalTokens: chunk.usage.total_tokens,
      });
    }
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      receivedContent = true;
      yield delta;
    }
  }

  if (!params.signal?.aborted && !receivedContent) {
    throw new Error('OpenAI không trả về nội dung văn bản.');
  }
}

export async function generateOpenAiText(params: ProviderCallParams): Promise<string> {
  if (!params.apiKey) {
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

  const content = response.choices[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI không trả về nội dung văn bản.');
  }
  return content;
}

export async function generateOpenAiImage(
  prompt: string,
  modelId: string,
  apiKey?: string
): Promise<Buffer> {
  if (!apiKey) {
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
