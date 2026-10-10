import type { SpeechProvider } from './transcription';

export interface UsageBucket {
  requests: number;
  unavailable: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  thinkingTokens: number;
  estimatedUsd: number | null;
}

/** Safe per-request metrics; no credentials or source/translated text. */
export interface TranslationMetrics {
  requestId: string;
  historyTurns: number;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  cachedInputTokens: number | null;
  usageStatus: 'reported' | 'unavailable';
}

export interface UsageSummary {
  range: { from: string; to: string };
  totals: UsageBucket & { byStatus: Record<'completed' | 'failed' | 'aborted', number> };
  byModel: Array<UsageBucket & { modelKey: string }>;
  byKind: Array<UsageBucket & { requestKind: 'final' | 'segment' | 'remainder' }>;
  byDay: Array<UsageBucket & { day: string }>;
  byRecording: Array<UsageBucket & { recordingId: string }>;
  avgInputTokensPerRequest: number | null;
}

export interface SpeechUsageProviderRow {
  provider: SpeechProvider;
  model: string;
  translated: boolean;
  sessions: number;
  audioMs: number;
  usdPerMinute: number;
  estimatedUsd: number;
}

export interface SpeechUsageSummary {
  range: { from: string; to: string };
  totals: { sessions: number; audioMs: number; estimatedUsd: number };
  byProvider: SpeechUsageProviderRow[];
  byDay: Array<{ date: string; audioMs: number; estimatedUsd: number }>;
}
