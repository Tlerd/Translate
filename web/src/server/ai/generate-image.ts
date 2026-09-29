import 'server-only';
import sharp from 'sharp';
import { resolveTaskConfig, AiConfigError } from '@/config/ai.server';
import { getServerEnv } from '@/config/env.server';
import { buildImageIllustrationPrompt } from './prompts/image';
import { generateGoogleImage } from './providers/google';
import { generateOpenAiImage } from './providers/openai';
import type { GenerateImageRequest } from '@/shared/ai-contracts';

export interface GeneratedImageResult {
  buffer: Buffer;
  mimeType: string;
  modelKey: string;
  width?: number;
  height?: number;
}

export async function executeGenerateImage(
  req: GenerateImageRequest
): Promise<GeneratedImageResult> {
  const env = getServerEnv();
  if (!env.AI_IMAGE_ENABLED && process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    throw new AiConfigError(
      'MISSING_CONFIG',
      'Tính năng tạo ảnh hiện chưa được kích hoạt trong cấu hình server (AI_IMAGE_ENABLED=false).'
    );
  }

  const resolved = resolveTaskConfig('image', req.modelKey);
  const prompt = buildImageIllustrationPrompt(req.summary);

  let rawBuffer: Buffer;
  if (resolved.model.provider === 'google') {
    rawBuffer = await generateGoogleImage(
      prompt,
      resolved.model.modelId,
      resolved.apiKey
    );
  } else {
    rawBuffer = await generateOpenAiImage(
      prompt,
      resolved.model.modelId,
      resolved.apiKey
    );
  }

  // Normalize image with sharp: max 1024px, WebP, < 3 MiB
  const pipeline = sharp(rawBuffer).resize({
    width: 1024,
    height: 1024,
    fit: 'inside',
    withoutEnlargement: true,
  });

  const webpBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
  const metadata = await sharp(webpBuffer).metadata();

  if (webpBuffer.byteLength > 3 * 1024 * 1024) {
    throw new Error('Ảnh sau khi chuẩn hóa vượt quá kích thước cho phép 3 MiB.');
  }

  return {
    buffer: webpBuffer,
    mimeType: 'image/webp',
    modelKey: resolved.model.key,
    width: metadata.width,
    height: metadata.height,
  };
}
