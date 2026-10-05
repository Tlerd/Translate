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
  promptVersion?: string;
}

export function usageStoreEnabled(): boolean {
  const hasDb = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  const storeSetting = process.env.TRANSLATION_USAGE_STORE;
  return hasDb && storeSetting !== 'off';
}

let schemaReadyPromise: Promise<void> | null = null;

export function resetSchemaReadyForTest(): void {
  schemaReadyPromise = null;
}

async function ensureSchema(): Promise<ReturnType<typeof database>> {
  const sql = database();
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
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
      await sql`ALTER TABLE translation_usage ADD COLUMN IF NOT EXISTS prompt_version text NOT NULL DEFAULT 'legacy-unknown'`;
    })().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  await schemaReadyPromise;
  return sql;
}

export async function insertTranslationUsage(r: TranslationUsageRecord): Promise<void> {
  const sql = await ensureSchema();
  await sql`
    INSERT INTO translation_usage (
      request_id, recording_id, caption_id, revision, model_key, status,
      request_kind, thinking_level, duration_ms, source_chars, system_chars,
      payload_chars, history_turns, usage_status, input_tokens, output_tokens,
      cached_input_tokens, thinking_tokens, total_tokens, prompt_version
    ) VALUES (
      ${r.requestId}, ${r.recordingId}, ${r.captionId}, ${r.revision}, ${r.modelKey}, ${r.status},
      ${r.requestKind}, ${r.thinkingLevel}, ${r.durationMs}, ${r.sourceChars}, ${r.systemChars},
      ${r.payloadChars}, ${r.historyTurns}, ${r.usageStatus}, ${r.inputTokens}, ${r.outputTokens},
      ${r.cachedInputTokens}, ${r.thinkingTokens}, ${r.totalTokens}, ${r.promptVersion ?? 'legacy-unknown'}
    )
    ON CONFLICT (request_id) DO NOTHING
  `;
}

export interface AggregatedUsageRow {
  model_key: string;
  request_kind: 'final' | 'segment' | 'remainder';
  status: 'completed' | 'failed' | 'aborted';
  day: string;
  recording_id: string;
  requests: number;
  unavailable: number;
  reported: number;
  reportedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  thinkingTokens: number;
}

function calculateBucketFromAggregatedRows(rows: AggregatedUsageRow[]): {
  bucket: UsageBucket;
  reported: number;
} {
  let requests = 0;
  let unavailable = 0;
  let reported = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let thinkingTokens = 0;

  const modelTokens = new Map<string, { input: number; output: number; thinking: number; cached: number }>();

  for (const r of rows) {
    requests += r.requests;
    unavailable += r.unavailable;
    reported += r.reported;
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    cachedInputTokens += r.cachedInputTokens;
    thinkingTokens += r.thinkingTokens;

    if (r.inputTokens + r.outputTokens + r.thinkingTokens === 0 && r.reported === 0) continue;
    const mt = modelTokens.get(r.model_key) ?? { input: 0, output: 0, thinking: 0, cached: 0 };
    mt.input += r.inputTokens;
    mt.output += r.outputTokens;
    mt.thinking += r.thinkingTokens;
    mt.cached += r.cachedInputTokens;
    modelTokens.set(r.model_key, mt);
  }

  let estimatedUsd: number | null = requests > 0 && reported === 0 ? null : 0;
  for (const [modelKey, mt] of modelTokens.entries()) {
    const config = getModelConfig(modelKey);
    if (!config || config.inputUsdPerM == null || config.outputUsdPerM == null ||
        (mt.cached > 0 && config.cachedInputUsdPerM == null)) {
      estimatedUsd = null;
      break;
    }
    const cost =
      (Math.max(0, mt.input - mt.cached) * config.inputUsdPerM +
        Math.min(mt.input, mt.cached) * (config.cachedInputUsdPerM ?? 0) +
        (mt.output + mt.thinking) * config.outputUsdPerM) /
      1_000_000;
    if (estimatedUsd !== null) estimatedUsd += cost;
  }

  if (estimatedUsd !== null) {
    estimatedUsd = Math.round(estimatedUsd * 1e6) / 1e6;
  }

  return {
    bucket: {
      requests,
      unavailable,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      thinkingTokens,
      estimatedUsd,
    },
    reported,
  };
}

export async function summarizeTranslationUsage(q: {
  from: Date;
  to?: Date;
  toExclusive?: Date;
  recordingId?: string;
  tz?: 'Asia/Ho_Chi_Minh';
}): Promise<UsageSummary> {
  const sql = await ensureSchema();
  const toExclusive = q.toExclusive ?? q.to ?? new Date();

  const rawRows = q.recordingId
    ? await sql`
        SELECT
          model_key,
          request_kind,
          status,
          (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day,
          recording_id,
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (WHERE usage_status = 'unavailable' OR input_tokens IS NULL OR output_tokens IS NULL)::int AS unavailable,
          COUNT(*) FILTER (WHERE usage_status = 'reported' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL)::int AS reported,
          COALESCE(SUM(input_tokens) FILTER (WHERE usage_status = 'reported' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL), 0)::bigint AS reported_input_tokens,
          SUM(COALESCE(input_tokens, 0))::bigint AS input_tokens,
          SUM(COALESCE(output_tokens, 0))::bigint AS output_tokens,
          SUM(COALESCE(cached_input_tokens, 0))::bigint AS cached_input_tokens,
          SUM(COALESCE(thinking_tokens, 0))::bigint AS thinking_tokens
        FROM translation_usage
        WHERE created_at >= ${q.from.toISOString()}
          AND created_at < ${toExclusive.toISOString()}
          AND recording_id = ${q.recordingId}
        GROUP BY model_key, request_kind, status, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, recording_id
        ORDER BY day ASC
      `
    : await sql`
        SELECT
          model_key,
          request_kind,
          status,
          (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day,
          recording_id,
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (WHERE usage_status = 'unavailable' OR input_tokens IS NULL OR output_tokens IS NULL)::int AS unavailable,
          COUNT(*) FILTER (WHERE usage_status = 'reported' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL)::int AS reported,
          COALESCE(SUM(input_tokens) FILTER (WHERE usage_status = 'reported' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL), 0)::bigint AS reported_input_tokens,
          SUM(COALESCE(input_tokens, 0))::bigint AS input_tokens,
          SUM(COALESCE(output_tokens, 0))::bigint AS output_tokens,
          SUM(COALESCE(cached_input_tokens, 0))::bigint AS cached_input_tokens,
          SUM(COALESCE(thinking_tokens, 0))::bigint AS thinking_tokens
        FROM translation_usage
        WHERE created_at >= ${q.from.toISOString()}
          AND created_at < ${toExclusive.toISOString()}
        GROUP BY model_key, request_kind, status, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, recording_id
        ORDER BY day ASC
      `;

  const rows: AggregatedUsageRow[] = (rawRows as Array<Record<string, unknown>>).map((r) => ({
    model_key: String(r.model_key),
    request_kind: (String(r.request_kind) || 'final') as 'final' | 'segment' | 'remainder',
    status: String(r.status) as 'completed' | 'failed' | 'aborted',
    day: String(r.day),
    recording_id: String(r.recording_id),
    requests: Number(r.requests || 0),
    unavailable: Number(r.unavailable || 0),
    reported: Number(r.reported || 0),
    reportedInputTokens: Number(r.reported_input_tokens || 0),
    inputTokens: Number(r.input_tokens || 0),
    outputTokens: Number(r.output_tokens || 0),
    cachedInputTokens: Number(r.cached_input_tokens || 0),
    thinkingTokens: Number(r.thinking_tokens || 0),
  }));

  const { bucket: totalsBucket, reported: totalReported } = calculateBucketFromAggregatedRows(rows);

  const byStatus = {
    completed: rows.filter((r) => r.status === 'completed').reduce((sum, r) => sum + r.requests, 0),
    failed: rows.filter((r) => r.status === 'failed').reduce((sum, r) => sum + r.requests, 0),
    aborted: rows.filter((r) => r.status === 'aborted').reduce((sum, r) => sum + r.requests, 0),
  };

  // Group by model
  const modelMap = new Map<string, AggregatedUsageRow[]>();
  for (const r of rows) {
    const list = modelMap.get(r.model_key) ?? [];
    list.push(r);
    modelMap.set(r.model_key, list);
  }
  const byModel = [...modelMap.entries()]
    .map(([modelKey, group]) => ({
      ...calculateBucketFromAggregatedRows(group).bucket,
      modelKey,
    }))
    .sort((a, b) => (b.inputTokens + b.outputTokens + b.thinkingTokens) - (a.inputTokens + a.outputTokens + a.thinkingTokens));

  // Group by kind
  const kindMap = new Map<'final' | 'segment' | 'remainder', AggregatedUsageRow[]>();
  for (const r of rows) {
    const kind = r.request_kind;
    const list = kindMap.get(kind) ?? [];
    list.push(r);
    kindMap.set(kind, list);
  }
  const byKind = (['final', 'segment', 'remainder'] as const)
    .filter((k) => kindMap.has(k))
    .map((requestKind) => ({
      ...calculateBucketFromAggregatedRows(kindMap.get(requestKind)!).bucket,
      requestKind,
    }));

  // Group by day
  const dayMap = new Map<string, AggregatedUsageRow[]>();
  for (const r of rows) {
    const list = dayMap.get(r.day) ?? [];
    list.push(r);
    dayMap.set(r.day, list);
  }
  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, group]) => ({
      ...calculateBucketFromAggregatedRows(group).bucket,
      day,
    }));

  // Group by recording
  const recMap = new Map<string, AggregatedUsageRow[]>();
  for (const r of rows) {
    const list = recMap.get(r.recording_id) ?? [];
    list.push(r);
    recMap.set(r.recording_id, list);
  }
  const byRecording = [...recMap.entries()]
    .map(([recordingId, group]) => ({
      ...calculateBucketFromAggregatedRows(group).bucket,
      recordingId,
    }))
    .sort((a, b) => (b.inputTokens + b.outputTokens + b.thinkingTokens) - (a.inputTokens + a.outputTokens + a.thinkingTokens))
    .slice(0, 50);

  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const avgInputTokensPerRequest =
    totalReported > 0
      ? Math.round(rows.reduce((sum, row) => sum + row.reportedInputTokens, 0) / totalReported)
      : null;

  const toDisplayDate = q.to ?? new Date(toExclusive.getTime() - 1);

  return {
    range: {
      from: dayFormatter.format(q.from),
      to: dayFormatter.format(toDisplayDate),
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
