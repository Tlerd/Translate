import 'server-only';
import { database } from './recording-store';
import { getModelConfig } from '@/config/ai-models';
import type { UsageBucket, UsageSummary } from '@/shared/usage';

export interface TranslationUsageRecord {
  requestId: string;
  recordingId: string;
  captionId: number;
  revision: number;
  modelKey: string;
  status: 'completed' | 'failed' | 'aborted';
  requestKind: 'final' | 'segment' | 'remainder';
  thinkingLevel: string | null;
  durationMs: number;
  sourceChars: number;
  systemChars: number;
  payloadChars: number;
  historyTurns: number;
  usageStatus: 'reported' | 'unavailable';
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  thinkingTokens: number | null;
  totalTokens: number | null;
}

export function usageStoreEnabled(): boolean {
  const hasDb = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  const storeSetting = process.env.TRANSLATION_USAGE_STORE;
  return hasDb && storeSetting !== 'off';
}

async function ready() {
  const sql = database();
  await sql`CREATE TABLE IF NOT EXISTS translation_usage (
    request_id text PRIMARY KEY,
    recording_id text NOT NULL,
    caption_id integer NOT NULL,
    revision integer NOT NULL,
    model_key text NOT NULL,
    status text NOT NULL,
    request_kind text NOT NULL,
    thinking_level text,
    duration_ms integer NOT NULL,
    source_chars integer NOT NULL,
    system_chars integer NOT NULL,
    payload_chars integer NOT NULL,
    history_turns integer NOT NULL,
    usage_status text NOT NULL,
    input_tokens integer,
    output_tokens integer,
    cached_input_tokens integer,
    thinking_tokens integer,
    total_tokens integer,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_translation_usage_created_at ON translation_usage(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_translation_usage_recording_id ON translation_usage(recording_id)`;
  return sql;
}

export async function insertTranslationUsage(r: TranslationUsageRecord): Promise<void> {
  const sql = await ready();
  await sql`
    INSERT INTO translation_usage (
      request_id, recording_id, caption_id, revision, model_key, status,
      request_kind, thinking_level, duration_ms, source_chars, system_chars,
      payload_chars, history_turns, usage_status, input_tokens, output_tokens,
      cached_input_tokens, thinking_tokens, total_tokens
    ) VALUES (
      ${r.requestId}, ${r.recordingId}, ${r.captionId}, ${r.revision}, ${r.modelKey}, ${r.status},
      ${r.requestKind}, ${r.thinkingLevel}, ${r.durationMs}, ${r.sourceChars}, ${r.systemChars},
      ${r.payloadChars}, ${r.historyTurns}, ${r.usageStatus}, ${r.inputTokens}, ${r.outputTokens},
      ${r.cachedInputTokens}, ${r.thinkingTokens}, ${r.totalTokens}
    )
    ON CONFLICT (request_id) DO NOTHING
  `;
}

interface DbUsageRow {
  request_id: string;
  recording_id: string;
  caption_id: number;
  revision: number;
  model_key: string;
  status: 'completed' | 'failed' | 'aborted';
  request_kind: 'final' | 'segment' | 'remainder';
  thinking_level: string | null;
  duration_ms: number;
  source_chars: number;
  system_chars: number;
  payload_chars: number;
  history_turns: number;
  usage_status: 'reported' | 'unavailable';
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  thinking_tokens: number | null;
  total_tokens: number | null;
  created_at: string | Date;
}

function calculateBucket(rows: DbUsageRow[]): UsageBucket {
  const requests = rows.length;
  let unavailable = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let thinkingTokens = 0;

  const modelTokens = new Map<string, { input: number; output: number; thinking: number }>();

  for (const r of rows) {
    if (r.usage_status === 'unavailable' || r.input_tokens === null) {
      unavailable++;
    }
    const inp = r.input_tokens ?? 0;
    const out = r.output_tokens ?? 0;
    const cached = r.cached_input_tokens ?? 0;
    const think = r.thinking_tokens ?? 0;

    inputTokens += inp;
    outputTokens += out;
    cachedInputTokens += cached;
    thinkingTokens += think;

    const mt = modelTokens.get(r.model_key) ?? { input: 0, output: 0, thinking: 0 };
    mt.input += inp;
    mt.output += out;
    mt.thinking += think;
    modelTokens.set(r.model_key, mt);
  }

  let estimatedUsd: number | null = 0;
  for (const [modelKey, mt] of modelTokens.entries()) {
    const config = getModelConfig(modelKey);
    if (!config || config.inputUsdPerM == null || config.outputUsdPerM == null) {
      estimatedUsd = null;
      break;
    }
    const cost = (mt.input * config.inputUsdPerM + (mt.output + mt.thinking) * config.outputUsdPerM) / 1_000_000;
    estimatedUsd += cost;
  }

  if (estimatedUsd !== null) {
    estimatedUsd = Math.round(estimatedUsd * 1e6) / 1e6;
  }

  return {
    requests,
    unavailable,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    thinkingTokens,
    estimatedUsd,
  };
}

export async function summarizeTranslationUsage(q: {
  from: Date;
  to: Date;
  recordingId?: string;
  tz?: 'Asia/Ho_Chi_Minh';
}): Promise<UsageSummary> {
  const sql = await ready();
  const rawRows = q.recordingId
    ? await sql`
        SELECT
          request_id, recording_id, caption_id, revision, model_key, status,
          request_kind, thinking_level, duration_ms, source_chars, system_chars,
          payload_chars, history_turns, usage_status, input_tokens, output_tokens,
          cached_input_tokens, thinking_tokens, total_tokens, created_at
        FROM translation_usage
        WHERE created_at >= ${q.from.toISOString()}
          AND created_at <= ${q.to.toISOString()}
          AND recording_id = ${q.recordingId}
        ORDER BY created_at ASC
      `
    : await sql`
        SELECT
          request_id, recording_id, caption_id, revision, model_key, status,
          request_kind, thinking_level, duration_ms, source_chars, system_chars,
          payload_chars, history_turns, usage_status, input_tokens, output_tokens,
          cached_input_tokens, thinking_tokens, total_tokens, created_at
        FROM translation_usage
        WHERE created_at >= ${q.from.toISOString()}
          AND created_at <= ${q.to.toISOString()}
        ORDER BY created_at ASC
      `;

  const rows = rawRows as unknown as DbUsageRow[];

  const totalsBucket = calculateBucket(rows);
  const byStatus = {
    completed: rows.filter((r) => r.status === 'completed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    aborted: rows.filter((r) => r.status === 'aborted').length,
  };

  // Group by model
  const modelMap = new Map<string, DbUsageRow[]>();
  for (const r of rows) {
    const list = modelMap.get(r.model_key) ?? [];
    list.push(r);
    modelMap.set(r.model_key, list);
  }
  const byModel = [...modelMap.entries()]
    .map(([modelKey, group]) => ({
      ...calculateBucket(group),
      modelKey,
    }))
    .sort((a, b) => (b.inputTokens + b.outputTokens + b.thinkingTokens) - (a.inputTokens + a.outputTokens + a.thinkingTokens));

  // Group by kind
  const kindMap = new Map<'final' | 'segment' | 'remainder', DbUsageRow[]>();
  for (const r of rows) {
    const kind = (r.request_kind || 'final') as 'final' | 'segment' | 'remainder';
    const list = kindMap.get(kind) ?? [];
    list.push(r);
    kindMap.set(kind, list);
  }
  const byKind = (['final', 'segment', 'remainder'] as const)
    .filter((k) => kindMap.has(k))
    .map((requestKind) => ({
      ...calculateBucket(kindMap.get(requestKind)!),
      requestKind,
    }));

  // Group by day (Asia/Ho_Chi_Minh)
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dayMap = new Map<string, DbUsageRow[]>();
  for (const r of rows) {
    const d = new Date(r.created_at);
    const dayStr = dayFormatter.format(d);
    const list = dayMap.get(dayStr) ?? [];
    list.push(r);
    dayMap.set(dayStr, list);
  }
  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, group]) => ({
      ...calculateBucket(group),
      day,
    }));

  // Group by recording
  const recMap = new Map<string, DbUsageRow[]>();
  for (const r of rows) {
    const list = recMap.get(r.recording_id) ?? [];
    list.push(r);
    recMap.set(r.recording_id, list);
  }
  const byRecording = [...recMap.entries()]
    .map(([recordingId, group]) => ({
      ...calculateBucket(group),
      recordingId,
    }))
    .sort((a, b) => (b.inputTokens + b.outputTokens + b.thinkingTokens) - (a.inputTokens + a.outputTokens + a.thinkingTokens))
    .slice(0, 50);

  const avgInputTokensPerRequest =
    totalsBucket.requests > 0
      ? Math.round(totalsBucket.inputTokens / totalsBucket.requests)
      : null;

  return {
    range: {
      from: dayFormatter.format(q.from),
      to: dayFormatter.format(q.to),
    },
    totals: {
      ...totalsBucket,
      byStatus,
    },
    byModel,
    byKind,
    byDay,
    byRecording,
    avgInputTokensPerRequest,
  };
}
