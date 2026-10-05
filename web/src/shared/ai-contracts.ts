import { z } from 'zod';

export type AiTask = 'translate' | 'summarize' | 'image';

export interface ModelInfo {
  key: string;
  provider: 'google' | 'openai';
  modelId: string;
  name: string;
  capabilities: AiTask[];
  allowedTasks: AiTask[];
  configured: boolean;
  enabled: boolean;
  disabledReason?: string;
  inputPrice?: string;
  outputPrice?: string;
  imagePrice?: string;
  thinkingLevels?: Array<'minimal' | 'low' | 'medium' | 'high'>;
}

export interface ModelsResponse {
  models: ModelInfo[];
  defaults: {
    translate: string;
    summarize: string;
    image: string;
  };
  imageEnabled: boolean;
}

export const TranslateRequestSchema = z.object({
  requestId: z.string(),
  recordingId: z.string(),
  captionId: z.number(),
  sessionEpoch: z.number(),
  revision: z.number(),
  configRevision: z.number().default(1),
  modelKey: z.string(),
  requestKind: z.enum(['final', 'segment', 'remainder']).default('final'),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  sourceLanguage: z.string().default('ja'),
  targetLanguage: z.string().default('vi'),
  text: z.string().min(1),
  context: z.string().optional(),
  glossary: z.string().optional(),
  previousTurns: z
    .array(
      z.object({
        source: z.string(),
        translation: z.string(),
      })
    )
    .max(6)
    .optional(),
});

export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;
export type TranslateRequestInput = z.input<typeof TranslateRequestSchema>;

export const CaptionInputSchema = z.object({
  id: z.number(),
  startMs: z.number(),
  endMs: z.number(),
  source: z.string(),
  revision: z.number().default(1),
  isFinal: z.boolean().default(true),
});

export const SummarizeRequestSchema = z.object({
  requestId: z.string(),
  recordingId: z.string(),
  sourceHash: z.string(),
  targetLanguage: z.string().default('vi'),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  modelKey: z.string().optional(),
  translationModelKey: z.string().optional(),
  captions: z.array(CaptionInputSchema).min(1, 'Cần ít nhất một caption để tóm tắt'),
});

export type SummarizeRequest = z.infer<typeof SummarizeRequestSchema>;

export const SummarySectionSchema = z.object({
  heading: z.string(),
  bullets: z.array(z.string()),
  captionIds: z.array(z.number()),
});

export const SummarizeResponseSchema = z.object({
  requestId: z.string(),
  recordingId: z.string(),
  title: z.string(),
  overview: z.string(),
  sections: z.array(SummarySectionSchema),
  modelKey: z.string(),
  sourceHash: z.string(),
  generatedAt: z.string(),
});

export type SummarizeResponse = z.infer<typeof SummarizeResponseSchema>;

export const GenerateImageRequestSchema = z.object({
  requestId: z.string(),
  recordingId: z.string(),
  summaryId: z.string(),
  sourceHash: z.string(),
  summaryHash: z.string(),
  modelKey: z.string(),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  summary: z.object({
    title: z.string(),
    overview: z.string(),
    sections: z.array(
      z.object({
        heading: z.string(),
        bullets: z.array(z.string()),
      })
    ),
  }),
});

export type GenerateImageRequest = z.infer<typeof GenerateImageRequestSchema>;

export interface ApiErrorDetail {
  code:
    | 'UNAUTHORIZED'
    | 'MISSING_CONFIG'
    | 'AI_MODEL_ROLE_CONFLICT'
    | 'UNSUPPORTED_MODEL'
    | 'INPUT_TOO_LARGE'
    | 'RATE_LIMIT_EXCEEDED'
    | 'TIMEOUT'
    | 'UPSTREAM_ERROR'
    | 'INTERNAL_ERROR'
    | 'CONFLICT';
  message: string;
  retryAfterMs?: number;
  requestId?: string;
}

export interface ApiErrorResponse {
  error: ApiErrorDetail;
}
