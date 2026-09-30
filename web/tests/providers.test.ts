import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const sdk = vi.hoisted(() => ({
  googleContent: vi.fn(),
  googleStream: vi.fn(),
  googleImage: vi.fn(),
  googleGenerateImages: vi.fn(),
  openAiCompletion: vi.fn(),
  openAiImage: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: sdk.googleContent,
      generateContentStream: sdk.googleStream,
      generateImages: sdk.googleGenerateImages,
    };
    interactions = { create: sdk.googleImage };
    constructor(config: unknown) { void config; }
  },
}));

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: sdk.openAiCompletion } };
    images = { generate: sdk.openAiImage };
    constructor(config: unknown) { void config; }
  },
}));

import {
  generateGoogleImage,
  generateGoogleText,
  streamGoogleText,
} from '@/server/ai/providers/google';
import {
  generateOpenAiImage,
  generateOpenAiText,
  streamOpenAiText,
} from '@/server/ai/providers/openai';

describe('provider SDK boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the native Gemini image interaction and decodes the returned image', async () => {
    const png = await sharp({
      create: { width: 32, height: 24, channels: 4, background: '#4a82c3' },
    }).png().toBuffer();
    sdk.googleImage.mockResolvedValue({
      status: 'completed',
      output_image: { type: 'image', mime_type: 'image/png', data: png.toString('base64') },
    });

    const image = await generateGoogleImage('A blue landscape', 'gemini-3.1-flash-image', 'key');

    expect(image).toEqual(png);
    expect(sdk.googleImage).toHaveBeenCalledWith({
      model: 'gemini-3.1-flash-image',
      input: 'A blue landscape',
    });
    expect(sdk.googleGenerateImages).not.toHaveBeenCalled();
  });

  it('reports Gemini safety or empty image output rather than fabricating an image', async () => {
    sdk.googleImage.mockResolvedValue({ status: 'incomplete', output_image: undefined });
    await expect(generateGoogleImage('blocked prompt', 'gemini-3.1-flash-image', 'key'))
      .rejects.toThrow(/incomplete/);
    await expect(generateGoogleImage('prompt', 'gemini-3.1-flash-image'))
      .rejects.toThrow(/Google Image/);
  });

  it('passes AbortSignal to Google text SDK requests', async () => {
    sdk.googleContent.mockResolvedValue({ text: 'translated' });
    const controller = new AbortController();
    await expect(generateGoogleText({
      apiKey: 'key', modelId: 'gemini-model', userPrompt: 'hello', signal: controller.signal,
    })).resolves.toBe('translated');
    expect(sdk.googleContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-model', contents: 'hello',
        config: expect.objectContaining({ abortSignal: controller.signal }),
      })
    );
  });

  it('does not return empty Google or OpenAI text as a successful result', async () => {
    sdk.googleContent.mockResolvedValue({ text: '' });
    sdk.openAiCompletion.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    await expect(generateGoogleText({ apiKey: 'key', modelId: 'm', userPrompt: 'p' }))
      .rejects.toThrow(/không trả về nội dung/);
    await expect(generateOpenAiText({ apiKey: 'key', modelId: 'm', userPrompt: 'p' }))
      .rejects.toThrow(/không trả về nội dung/);
  });

  it('passes AbortSignal through Google and OpenAI streaming calls', async () => {
    sdk.googleStream.mockResolvedValue((async function* () { yield { text: 'a' }; })());
    sdk.openAiCompletion.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'b' } }] };
    })());
    const controller = new AbortController();

    const googleParts: string[] = [];
    for await (const part of streamGoogleText({
      apiKey: 'key', modelId: 'gm', userPrompt: 'p', signal: controller.signal,
    })) googleParts.push(part);
    const openAiParts: string[] = [];
    for await (const part of streamOpenAiText({
      apiKey: 'key', modelId: 'om', userPrompt: 'p', signal: controller.signal,
    })) openAiParts.push(part);

    expect(googleParts).toEqual(['a']);
    expect(sdk.googleStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gm', config: expect.objectContaining({ abortSignal: controller.signal }),
      })
    );
    expect(openAiParts).toEqual(['b']);
    expect(sdk.openAiCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'om', stream: true }),
      { signal: controller.signal }
    );
  });

  it('decodes OpenAI image responses and preserves provider errors', async () => {
    const png = await sharp({
      create: { width: 48, height: 32, channels: 4, background: '#c3844a' },
    }).png().toBuffer();
    sdk.openAiImage.mockResolvedValue({ data: [{ b64_json: png.toString('base64') }] });
    await expect(generateOpenAiImage('A landscape', 'gpt-image-2', 'key')).resolves.toEqual(png);
    sdk.openAiImage.mockRejectedValue(new Error('provider blocked request'));
    await expect(generateOpenAiImage('prompt', 'gpt-image-2', 'key'))
      .rejects.toThrow('provider blocked request');
    await expect(generateOpenAiImage('prompt', 'gpt-image-2'))
      .rejects.toThrow(/API key/);
  });
});
