import { NextResponse } from 'next/server';
import { getPublicModelList } from '@/config/ai.server';
import { getServerEnv } from '@/config/env.server';
import { canonicalModelKey } from '@/shared/ai-model-keys';
import type { ModelsResponse } from '@/shared/ai-contracts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<ModelsResponse>> {
  const env = getServerEnv();
  const models = getPublicModelList();

  const responseData: ModelsResponse = {
    models,
    defaults: {
      translate: canonicalModelKey(env.AI_TRANSLATION_MODEL),
      summarize: env.AI_SUMMARY_MODEL,
      image: env.AI_IMAGE_MODEL,
    },
    imageEnabled: env.AI_IMAGE_ENABLED,
  };

  return NextResponse.json(responseData, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
