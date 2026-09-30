import 'server-only';
import type { AiTask } from '@/shared/ai-contracts';

export interface ModelRegistryEntry {
  key: string;
  provider: 'google' | 'openai';
  modelId: string;
  name: string;
  capabilities: AiTask[];
  allowedTasks: AiTask[];
  endpointKind: string;
  enabled: boolean;
  maxChars?: number;
}

export const AI_MODELS_REGISTRY: Record<string, ModelRegistryEntry> = {
  'google:gemini-3.5-flash-lite': {
    key: 'google:gemini-3.5-flash-lite',
    provider: 'google',
    modelId: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite (Google - Tiết kiệm)',
    capabilities: ['translate', 'summarize'],
    allowedTasks: ['translate'],
    endpointKind: 'google-generate-content',
    enabled: true,
    maxChars: 30000,
  },
  'openai:gpt-4o-mini': {
    key: 'openai:gpt-4o-mini',
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    name: 'GPT-4o mini (OpenAI - Tiết kiệm)',
    capabilities: ['translate', 'summarize'],
    allowedTasks: ['translate'],
    endpointKind: 'chat-completions',
    enabled: true,
    maxChars: 30000,
  },
  'google:gemini-3.8-flash': {
    key: 'google:gemini-3.8-flash',
    provider: 'google',
    modelId: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Google - Tóm tắt mạnh)',
    capabilities: ['translate', 'summarize'],
    allowedTasks: ['summarize'],
    endpointKind: 'google-generate-content',
    enabled: true,
    maxChars: 60000,
  },
  'google:gemini-3.1-flash-image': {
    key: 'google:gemini-3.1-flash-image',
    provider: 'google',
    modelId: 'gemini-3.1-flash-image',
    name: 'Gemini 3.1 Flash Image (Google - Sinh ảnh)',
    capabilities: ['image'],
    allowedTasks: ['image'],
    endpointKind: 'google-image',
    enabled: true,
  },
  'openai:gpt-image-2.5-sunburst': {
    key: 'openai:gpt-image-2.5-sunburst',
    provider: 'openai',
    modelId: 'gpt-image-2.5-sunburst',
    name: 'GPT Image 2.5 Sunburst (OpenAI - Sinh ảnh)',
    capabilities: ['image'],
    allowedTasks: ['image'],
    endpointKind: 'openai-images',
    enabled: true,
  },
};

export function getModelConfig(key: string): ModelRegistryEntry | undefined {
  return AI_MODELS_REGISTRY[key];
}

export function getModelsForTask(task: AiTask): ModelRegistryEntry[] {
  return Object.values(AI_MODELS_REGISTRY).filter(
    (m) => m.enabled && m.allowedTasks.includes(task)
  );
}
