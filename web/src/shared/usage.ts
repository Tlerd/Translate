export interface UsageBucket {
  requests: number;
  unavailable: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  thinkingTokens: number;
  estimatedUsd: number | null;
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
