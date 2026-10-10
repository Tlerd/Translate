import 'server-only';
import { database } from './recording-store';
import { usageStoreEnabled } from './translation-usage-store';
import { estimateSpeechUsd, roundUsd, SPEECH_PROVIDER_IDS, speechUsdPerMinute } from '@/shared/speech-pricing';
import type { SpeechUsageSummary } from '@/shared/usage';
import type { SpeechProvider } from '@/shared/transcription';

export { usageStoreEnabled };

export interface SpeechUsageRecord {
  sessionId: string;
  recordingId: string;
  provider: SpeechProvider;
  model: string;
  translated: boolean;
  audioMs: number;
  startedAt: Date;
}

let schemaReadyPromise: Promise<void> | null = null;

export function resetSpeechSchemaReadyForTest(): void {
  schemaReadyPromise = null;
}

async function ensureSchema(): Promise<ReturnType<typeof database>> {
  const sql = database();
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS speech_usage (
        session_id text PRIMARY KEY,
        recording_id text NOT NULL,
        provider text NOT NULL,
        model text NOT NULL,
        translated boolean NOT NULL,
        audio_ms integer NOT NULL,
        started_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_speech_usage_started_at ON speech_usage(started_at)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_speech_usage_recording_id ON speech_usage(recording_id)`;
    })().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  await schemaReadyPromise;
  return sql;
}

/** Idempotent per sessionId: repeated reports only ever raise the stored audio time. */
export async function upsertSpeechUsage(r: SpeechUsageRecord): Promise<void> {
  const sql = await ensureSchema();
  await sql`
    INSERT INTO speech_usage (session_id, recording_id, provider, model, translated, audio_ms, started_at, updated_at)
    VALUES (${r.sessionId}, ${r.recordingId}, ${r.provider}, ${r.model}, ${r.translated}, ${r.audioMs}, ${r.startedAt.toISOString()}, now())
    ON CONFLICT (session_id) DO UPDATE SET
      audio_ms = GREATEST(speech_usage.audio_ms, EXCLUDED.audio_ms),
      updated_at = now()
  `;
}

interface SpeechUsageGroupRow {
  provider: SpeechProvider;
  model: string;
  translated: boolean;
  day: string;
  sessions: number;
  audioMs: number;
}

export async function summarizeSpeechUsage(q: {
  from: Date;
  to?: Date;
  toExclusive?: Date;
  recordingId?: string;
}): Promise<SpeechUsageSummary> {
  const sql = await ensureSchema();
  const toExclusive = q.toExclusive ?? q.to ?? new Date();

  const rawRows = q.recordingId
    ? await sql`
        SELECT
          provider,
          model,
          translated,
          (started_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day,
          COUNT(*)::int AS sessions,
          COALESCE(SUM(audio_ms), 0)::bigint AS audio_ms
        FROM speech_usage
        WHERE started_at >= ${q.from.toISOString()}
          AND started_at < ${toExclusive.toISOString()}
          AND recording_id = ${q.recordingId}
        GROUP BY provider, model, translated, (started_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        ORDER BY day ASC
      `
    : await sql`
        SELECT
          provider,
          model,
          translated,
          (started_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day,
          COUNT(*)::int AS sessions,
          COALESCE(SUM(audio_ms), 0)::bigint AS audio_ms
        FROM speech_usage
        WHERE started_at >= ${q.from.toISOString()}
          AND started_at < ${toExclusive.toISOString()}
        GROUP BY provider, model, translated, (started_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        ORDER BY day ASC
      `;

  const rows: SpeechUsageGroupRow[] = (rawRows as Array<Record<string, unknown>>)
    .filter((r) => (SPEECH_PROVIDER_IDS as readonly string[]).includes(String(r.provider)))
    .map((r) => ({
    provider: String(r.provider) as SpeechProvider,
    model: String(r.model),
    translated: r.translated === true || r.translated === 'true' || r.translated === 't',
    day: String(r.day),
    sessions: Number(r.sessions || 0),
    audioMs: Number(r.audio_ms || 0),
  }));

  let sessions = 0;
  let audioMs = 0;
  let estimatedUsd = 0;
  const providerMap = new Map<string, { provider: SpeechProvider; model: string; translated: boolean; sessions: number; audioMs: number }>();
  const dayMap = new Map<string, { audioMs: number; estimatedUsd: number }>();

  for (const r of rows) {
    const cost = estimateSpeechUsd(r.provider, r.translated, r.audioMs);
    sessions += r.sessions;
    audioMs += r.audioMs;
    estimatedUsd += cost;

    const key = `${r.provider}|${r.model}|${r.translated}`;
    const p = providerMap.get(key) ?? { provider: r.provider, model: r.model, translated: r.translated, sessions: 0, audioMs: 0 };
    p.sessions += r.sessions;
    p.audioMs += r.audioMs;
    providerMap.set(key, p);

    const d = dayMap.get(r.day) ?? { audioMs: 0, estimatedUsd: 0 };
    d.audioMs += r.audioMs;
    d.estimatedUsd += cost;
    dayMap.set(r.day, d);
  }

  const byProvider = [...providerMap.values()]
    .map((p) => ({
      ...p,
      usdPerMinute: speechUsdPerMinute(p.provider, p.translated),
      estimatedUsd: estimateSpeechUsd(p.provider, p.translated, p.audioMs),
    }))
    .sort((a, b) => b.audioMs - a.audioMs);

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, audioMs: d.audioMs, estimatedUsd: roundUsd(d.estimatedUsd) }));

  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const toDisplayDate = q.to ?? new Date(toExclusive.getTime() - 1);

  return {
    range: { from: dayFormatter.format(q.from), to: dayFormatter.format(toDisplayDate) },
    totals: { sessions, audioMs, estimatedUsd: roundUsd(estimatedUsd) },
    byProvider,
    byDay,
  };
}
