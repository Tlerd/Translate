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
  inputPrice?: string;
  outputPrice?: string;
  inputUsdPerM?: number;
  outputUsdPerM?: number;
  imagePrice?: string;
  thinkingLevels?: Array<'minimal' | 'low' | 'medium' | 'high'>;
  disabledReason?: string;
}

export const AI_MODELS_REGISTRY: Record<string, ModelRegistryEntry> = {
  'google:gemini-3.5-flash-lite': {
    key: 'google:gemini-3.5-flash-lite',
    provider: 'google',
    modelId: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite · $0.30/$2.50 / 1M token',
    capabilities: ['translate', 'summarize'],
    allowedTasks: ['translate'],
    endpointKind: 'google-generate-content',
    enabled: true,
    maxChars: 30000,
    inputPrice: '$0.30/1M tokens',
    outputPrice: '$2.50/1M tokens',
    inputUsdPerM: 0.30,
    outputUsdPerM: 2.50,
    thinkingLevels: ['minimal', 'low', 'medium', 'high'],
  },
  'google:gemini-3.1-flash-lite': {
    key: 'google:gemini-3.1-flash-lite',
    provider: 'google',
    modelId: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite · $0.25/$1.50 / 1M token',
    capabilities: ['translate', 'summarize'],
    allowedTasks: ['translate', 'summarize'],
    endpointKind: 'google-generate-content',
    enabled: true,
    maxChars: 30000,
    inputPrice: '$0.25/1M tokens',
    outputPrice: '$1.50/1M tokens',
    inputUsdPerM: 0.25,
    outputUsdPerM: 1.50,
    thinkingLevels: ['minimal', 'low', 'medium', 'high'],
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
    thinkingLevels: ['low', 'medium', 'high'],
    inputPrice: '$0.75/1M tokens',
    outputPrice: '$3.75/1M tokens',
    inputUsdPerM: 0.75,
    outputUsdPerM: 3.75,
  },
  'google:gemini-3.1-flash-lite-image': {
    key: 'google:gemini-3.1-flash-lite-image',
    provider: 'google',
    modelId: 'gemini-3.1-flash-lite-image',
    name: 'Nano Banana 2 Lite · ~$0.034/ảnh 1K',
    capabilities: ['image'],
    allowedTasks: ['image'],
    endpointKind: 'google-image',
    enabled: true,
    inputPrice: '$0.25/1M text tokens',
    outputPrice: '$1.50/1M text tokens',
    imagePrice: '$0.034/image (1K)',
    thinkingLevels: ['minimal', 'high'],
  },
  'google:gemini-3.1-flash-image': {
    key: 'google:gemini-3.1-flash-image',
    provider: 'google',
    modelId: 'gemini-3.1-flash-image',
    name: 'Nano Banana 2 · $0.067/ảnh 1K',
    capabilities: ['image'],
    allowedTasks: ['image'],
    endpointKind: 'google-image',
    enabled: true,
    inputPrice: '$0.50/1M text tokens',
    outputPrice: '$3.00/1M text tokens',
    imagePrice: '$0.067/image (1K)',
    thinkingLevels: ['minimal', 'high'],
  },
  'google:gemini-2.5-flash-image': {
    key: 'google:gemini-2.5-flash-image',
    provider: 'google',
    modelId: 'gemini-2.5-flash-image',
    name: 'Nano Banana · $0.039/ảnh (ngừng 02/10/2026)',
    capabilities: ['image'],
    allowedTasks: ['image'],
    endpointKind: 'google-image',
    enabled: false,
    inputPrice: '$0.30/1M text tokens',
    imagePrice: '$0.039/image (1K)',
    disabledReason: 'Ngừng hoạt động ngày 02/10/2026 theo Google.',
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
