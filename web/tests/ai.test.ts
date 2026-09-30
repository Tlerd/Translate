import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';

const aiSdk = vi.hoisted(() => ({
  googleContent: vi.fn(),
  googleImage: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: aiSdk.googleContent };
    interactions = { create: aiSdk.googleImage };
    constructor(config: unknown) { void config; }
  },
}));
import {
  getModelsForTask,
} from '@/config/ai-models';
import {
  resolveTaskConfig,
  validateTwoModelsSeparation,
  AiConfigError,
} from '@/config/ai.server';
import { executeSummarize } from '@/server/ai/summarize';
import { executeGenerateImage } from '@/server/ai/generate-image';
import { buildImageIllustrationPrompt } from '@/server/ai/prompts/image';

beforeEach(async () => {
  process.env.AI_TRANSLATION_MODEL = 'google:gemini-3.5-flash-lite';
  process.env.AI_SUMMARY_MODEL = 'google:gemini-3.8-flash';
  process.env.AI_IMAGE_MODEL = 'google:gemini-3.1-flash-image';
  process.env.GOOGLE_API_KEY = 'test-google-key';
  delete process.env.SUMMARY_GOOGLE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const png = await sharp({
    create: { width: 40, height: 30, channels: 4, background: '#4a82c3' },
  }).png().toBuffer();
  aiSdk.googleContent.mockResolvedValue({
    text: JSON.stringify({
      title: 'Tóm tắt bài học', overview: 'Nội dung đã tóm tắt.',
      sections: [{ heading: 'Nội dung', bullets: ['Điểm chính'], captionIds: [1] }],
    }),
  });
  aiSdk.googleImage.mockResolvedValue({
    status: 'completed',
    output_image: { type: 'image', mime_type: 'image/png', data: png.toString('base64') },
  });
});

describe('AI Config and Separation', () => {
  it('strictly rejects identical models for translation and summary with AI_MODEL_ROLE_CONFLICT', () => {
    process.env.AI_TRANSLATION_MODEL = 'google:gemini-3.8-flash';
    process.env.AI_SUMMARY_MODEL = 'google:gemini-3.8-flash';

    expect(() => validateTwoModelsSeparation()).toThrowError(AiConfigError);
    try {
      validateTwoModelsSeparation();
    } catch (e) {
      expect((e as AiConfigError).code).toBe('AI_MODEL_ROLE_CONFLICT');
    }
  });

  it('rejects translation task attempting to use a summary-only model', () => {
    expect(() => resolveTaskConfig('translate', 'google:gemini-3.8-flash')).toThrowError(
      AiConfigError
    );
    try {
      resolveTaskConfig('translate', 'google:gemini-3.8-flash');
    } catch (e) {
      expect((e as AiConfigError).code).toBe('AI_MODEL_ROLE_CONFLICT');
    }
  });

  it('allows valid models with matching allowedTasks', () => {
    const trans = resolveTaskConfig('translate', 'google:gemini-3.5-flash-lite');
    expect(trans.model.key).toBe('google:gemini-3.5-flash-lite');
    expect(trans.task).toBe('translate');

    const summ = resolveTaskConfig('summarize', 'google:gemini-3.8-flash');
    expect(summ.model.key).toBe('google:gemini-3.8-flash');
    expect(summ.task).toBe('summarize');
  });

  it('resolves task-specific API key override over general provider key', () => {
    process.env.GOOGLE_API_KEY = 'general_key';
    process.env.SUMMARY_GOOGLE_API_KEY = 'specific_summary_key';

    const transConfig = resolveTaskConfig('translate');
    expect(transConfig.apiKey).toBe('general_key');

    const summConfig = resolveTaskConfig('summarize');
    expect(summConfig.apiKey).toBe('specific_summary_key');
  });

  it('filters models by task in registry', () => {
    const translateModels = getModelsForTask('translate');
    expect(translateModels.some((m) => m.key === 'google:gemini-3.5-flash-lite')).toBe(true);
    expect(translateModels.some((m) => m.key === 'google:gemini-3.8-flash')).toBe(false);

    const summaryModels = getModelsForTask('summarize');
    expect(summaryModels.some((m) => m.key === 'google:gemini-3.8-flash')).toBe(true);
    expect(summaryModels.some((m) => m.key === 'google:gemini-3.5-flash-lite')).toBe(false);

    const imageModels = getModelsForTask('image');
    expect(imageModels.some((m) => m.key === 'google:gemini-3.1-flash-image')).toBe(true);
    expect(imageModels.some((m) => m.key === 'openai:gpt-image-2.5-sunburst')).toBe(true);
  });
});

describe('Summarize Task Execution', () => {
  it('executes summary and validates citations', async () => {
    const res = await executeSummarize({
      requestId: 'req_sum_1',
      recordingId: 'rec_test',
      sourceHash: 'hash_abc',
      targetLanguage: 'vi',
      captions: [
        {
          id: 1,
          startMs: 0,
          endMs: 2000,
          source: '日本語の会話の練習をします。',
          revision: 1,
          isFinal: true,
        },
      ],
    });

    expect(res.title).toBeDefined();
    expect(res.overview).toBeDefined();
    expect(res.sections.length).toBeGreaterThan(0);
    // All captionIds must belong to input
    for (const sec of res.sections) {
      for (const cid of sec.captionIds) {
        expect(cid).toBe(1);
      }
    }
  });

  it('rejects input exceeding max characters with INPUT_TOO_LARGE', async () => {
    const longText = 'A'.repeat(65000);
    await expect(
      executeSummarize({
        requestId: 'req_sum_2',
        recordingId: 'rec_test',
        sourceHash: 'hash_long',
        targetLanguage: 'vi',
        captions: [
          {
            id: 1,
            startMs: 0,
            endMs: 5000,
            source: longText,
            revision: 1,
            isFinal: true,
          },
        ],
      })
    ).rejects.toThrowError(/giới hạn ký tự/);
  });
});

describe('Generate Image Task Execution', () => {
  it('builds image illustration prompt from summary', () => {
    const prompt = buildImageIllustrationPrompt({
      title: 'Học ngữ pháp tiếng Nhật N3',
      overview: 'Tổng quan về thể bị động và sai khiến',
      sections: [
        {
          heading: 'Thể bị động',
          bullets: ['Cách chia động từ nhóm 1, 2, 3'],
        },
      ],
    });

    expect(prompt).toContain('Học ngữ pháp tiếng Nhật N3');
    expect(prompt).toContain('Thể bị động');
  });

  it('generates normalized WebP image buffer with sharp', async () => {
    process.env.AI_IMAGE_ENABLED = 'true';
    const result = await executeGenerateImage({
      requestId: 'req_img_1',
      recordingId: 'rec_1',
      summaryId: 'sum_1',
      sourceHash: 's_hash',
      summaryHash: 'sum_hash',
      modelKey: 'google:gemini-3.1-flash-image',
      summary: {
        title: 'Tiết học kanji',
        overview: 'Ôn tập 20 chữ kanji cơ bản',
        sections: [
          {
            heading: 'Nhóm chữ chỉ phương hướng',
            bullets: ['Đông, Tây, Nam, Bắc'],
          },
        ],
      },
    });

    expect(result.mimeType).toBe('image/webp');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.byteLength).toBeGreaterThan(0);
    expect(result.buffer.byteLength).toBeLessThan(3 * 1024 * 1024);
  });
});
