import 'server-only';
import { getServerEnv } from './env.server';
import {
  AI_MODELS_REGISTRY,
  getModelConfig,
  type ModelRegistryEntry,
} from './ai-models';
import type { AiTask, ModelInfo } from '@/shared/ai-contracts';

export class AiConfigError extends Error {
  public code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AiConfigError';
  }
}

export interface ResolvedTaskConfig {
  task: AiTask;
  model: ModelRegistryEntry;
  apiKey?: string;
  hasKey: boolean;
  timeoutMs: number;
}

export function validateTwoModelsSeparation(): void {
  const env = getServerEnv();
  const transKey = env.AI_TRANSLATION_MODEL;
  const summKey = env.AI_SUMMARY_MODEL;

  const transModel = getModelConfig(transKey);
  const summModel = getModelConfig(summKey);

  // Check key identity or exact model ID within same provider
  if (
    transKey === summKey ||
    (transModel && summModel && transModel.provider === summModel.provider && transModel.modelId === summModel.modelId)
  ) {
    throw new AiConfigError(
      'AI_MODEL_ROLE_CONFLICT',
      `Model dịch (${transKey}) và model tóm tắt (${summKey}) bắt buộc phải khác nhau. Server nghiêm cấm dùng chung một model cho cả hai vai trò.`
    );
  }
}

export function resolveTaskConfig(
  task: AiTask,
  requestedModelKey?: string
): ResolvedTaskConfig {
  // Validate separation
  validateTwoModelsSeparation();

  const env = getServerEnv();
  let modelKey = requestedModelKey;

  if (!modelKey) {
    if (task === 'translate') {
      modelKey = env.AI_TRANSLATION_MODEL;
    } else if (task === 'summarize') {
      modelKey = env.AI_SUMMARY_MODEL;
    } else if (task === 'image') {
      modelKey = env.AI_IMAGE_MODEL;
    }
  }

  const model = modelKey ? getModelConfig(modelKey) : undefined;
  if (!model) {
    throw new AiConfigError(
      'UNSUPPORTED_MODEL',
      `Model không nằm trong danh mục hỗ trợ: ${modelKey}`
    );
  }

  if (!model.allowedTasks.includes(task)) {
    throw new AiConfigError(
      'AI_MODEL_ROLE_CONFLICT',
      `Model ${model.key} không được phép dùng cho tác vụ ${task}. Danh sách cho phép: ${model.allowedTasks.join(', ')}`
    );
  }

  // Resolve API Key according to priority
  let apiKey: string | undefined;
  if (model.provider === 'google') {
    if (task === 'summarize') {
      apiKey = env.SUMMARY_GOOGLE_API_KEY || env.GOOGLE_API_KEY;
    } else if (task === 'image') {
      apiKey = env.IMAGE_GOOGLE_API_KEY || env.GOOGLE_API_KEY;
    } else {
      apiKey = env.GOOGLE_API_KEY;
    }
  } else if (model.provider === 'openai') {
    if (task === 'summarize') {
      apiKey = env.SUMMARY_OPENAI_API_KEY || env.OPENAI_API_KEY;
    } else if (task === 'image') {
      apiKey = env.IMAGE_OPENAI_API_KEY || env.OPENAI_API_KEY;
    } else {
      apiKey = env.OPENAI_API_KEY;
    }
  }

  const timeoutMs =
    task === 'translate' ? 12000 : task === 'summarize' ? 90000 : 180000;

  return {
    task,
    model,
    apiKey,
    hasKey: !!apiKey,
    timeoutMs,
  };
}

export function getPublicModelList(): ModelInfo[] {
  const env = getServerEnv();

  return Object.values(AI_MODELS_REGISTRY).map((m) => {
    let hasKey = false;
    if (m.provider === 'google') {
      hasKey = !!env.GOOGLE_API_KEY || !!env.SUMMARY_GOOGLE_API_KEY || !!env.IMAGE_GOOGLE_API_KEY;
    } else if (m.provider === 'openai') {
      hasKey = !!env.OPENAI_API_KEY || !!env.SUMMARY_OPENAI_API_KEY || !!env.IMAGE_OPENAI_API_KEY;
    }

    return {
      key: m.key,
      provider: m.provider,
      modelId: m.modelId,
      name: m.name,
      capabilities: m.capabilities,
      allowedTasks: m.allowedTasks,
      configured: hasKey,
    };
  });
}
