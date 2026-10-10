import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sqlClientMock } = vi.hoisted(() => ({ sqlClientMock: vi.fn() }));
vi.mock('@/server/cloud/sql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/cloud/sql')>()),
  createSqlClient: sqlClientMock,
}));

import {
  resetSpeechSchemaReadyForTest,
  summarizeSpeechUsage,
  upsertSpeechUsage,
  usageStoreEnabled,
} from '@/server/cloud/speech-usage-store';

interface Row {
  session_id: string;
  recording_id: string;
  provider: string;
  model: string;
  translated: boolean;
  audio_ms: number;
  started_at: string;
}

function fakeSql() {
  const rows: Row[] = [];
  const statements: string[] = [];
  const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join('?');
    statements.push(statement);
    if (statement.includes('CREATE TABLE') || statement.includes('CREATE INDEX')) return [];
    if (statement.includes('INSERT INTO speech_usage')) {
      const [sessionId, recordingId, provider, model, translated, audioMs, startedAt] = values as [string, string, string, string, boolean, number, string];
      const existing = rows.find((r) => r.session_id === sessionId);
      // ON CONFLICT (session_id) DO UPDATE SET audio_ms = GREATEST(...)
      if (existing) existing.audio_ms = Math.max(existing.audio_ms, audioMs);
      else rows.push({ session_id: sessionId, recording_id: recordingId, provider, model, translated, audio_ms: audioMs, started_at: startedAt });
      return [];
    }
    if (statement.includes('SELECT') && statement.includes('FROM speech_usage')) {
      const [from, toExclusive, recordingId] = values as [string, string, string | undefined];
      const filtered = rows.filter((r) => r.started_at >= from && r.started_at < toExclusive && (!statement.includes('recording_id = ?') || r.recording_id === recordingId));
      const groups = new Map<string, { provider: string; model: string; translated: boolean; day: string; sessions: number; audio_ms: number }>();
      for (const r of filtered) {
        const day = dayOf(r.started_at);
        const key = `${r.provider}|${r.model}|${r.translated}|${day}`;
        const g = groups.get(key) ?? { provider: r.provider, model: r.model, translated: r.translated, day, sessions: 0, audio_ms: 0 };
        g.sessions++; g.audio_ms += r.audio_ms; groups.set(key, g);
      }
      return [...groups.values()];
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  };
  return { sql, rows, statements };
}

const record = (over: Partial<Parameters<typeof upsertSpeechUsage>[0]> = {}) => ({
  sessionId: '00000000-0000-4000-8000-000000000001',
  recordingId: 'rec-1',
  provider: 'soniox' as const,
  model: 'stt-rt-v5',
  translated: false,
  audioMs: 60_000,
  startedAt: new Date('2026-10-05T03:00:00.000Z'),
  ...over,
});

describe('speech-usage-store', () => {
  let db: ReturnType<typeof fakeSql>;
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://test-only');
    vi.stubEnv('POSTGRES_URL', '');
    vi.stubEnv('TRANSLATION_USAGE_STORE', 'on');
    resetSpeechSchemaReadyForTest();
    db = fakeSql();
    sqlClientMock.mockReturnValue(db.sql);
  });
  afterEach(() => { vi.unstubAllEnvs(); sqlClientMock.mockReset(); resetSpeechSchemaReadyForTest(); });

  it('follows the translation usage store switch', () => {
    expect(usageStoreEnabled()).toBe(true);
    vi.stubEnv('TRANSLATION_USAGE_STORE', 'off');
    expect(usageStoreEnabled()).toBe(false);
  });

  it('creates the table and indexes once, lazily', async () => {
    await upsertSpeechUsage(record());
    await upsertSpeechUsage(record({ sessionId: '00000000-0000-4000-8000-000000000002' }));
    const creates = db.statements.filter((s) => s.includes('CREATE TABLE IF NOT EXISTS speech_usage'));
    expect(creates).toHaveLength(1);
    expect(db.statements.filter((s) => s.includes('idx_speech_usage_started_at'))).toHaveLength(1);
    expect(db.statements.filter((s) => s.includes('idx_speech_usage_recording_id'))).toHaveLength(1);
    expect(db.statements.some((s) => s.includes('GREATEST(speech_usage.audio_ms, EXCLUDED.audio_ms)'))).toBe(true);
  });

  it('upserts idempotently and never lowers audio time', async () => {
    await upsertSpeechUsage(record({ audioMs: 60_000 }));
    await upsertSpeechUsage(record({ audioMs: 120_000 }));
    await upsertSpeechUsage(record({ audioMs: 90_000 })); // late, out-of-order report
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].audio_ms).toBe(120_000);
  });

  it('aggregates totals, by provider (with per-minute price) and by Saigon day', async () => {
    await upsertSpeechUsage(record({ sessionId: '00000000-0000-4000-8000-000000000001', provider: 'soniox', model: 'stt-rt-v5', translated: false, audioMs: 3_600_000 }));
    await upsertSpeechUsage(record({ sessionId: '00000000-0000-4000-8000-000000000002', provider: 'soniox', model: 'stt-rt-v5', translated: true, audioMs: 3_600_000 }));
    await upsertSpeechUsage(record({ sessionId: '00000000-0000-4000-8000-000000000003', provider: 'google-transcribe', model: 'gemini-3.5-transcribe', audioMs: 600_000, startedAt: new Date('2026-10-06T17:30:00.000Z') })); // 07 Oct in Saigon
    await upsertSpeechUsage(record({ sessionId: '00000000-0000-4000-8000-000000000004', provider: 'nemotron', model: 'nemotron-3.5-asr-streaming', audioMs: 120_000 }));
    await upsertSpeechUsage(record({ sessionId: '00000000-0000-4000-8000-000000000005', provider: 'google', model: 'gemini-3.5-transcribe-live', audioMs: 60_000, startedAt: new Date('2026-09-01T00:00:00.000Z') })); // out of range

    const summary = await summarizeSpeechUsage({
      from: new Date('2026-10-01T00:00:00.000+07:00'),
      toExclusive: new Date('2026-10-11T00:00:00.000+07:00'),
    });

    expect(summary.range).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(summary.totals).toEqual({ sessions: 4, audioMs: 7_920_000, estimatedUsd: 0.12 + 0.18 + 0.05 });
    const byKey = Object.fromEntries(summary.byProvider.map((p) => [`${p.provider}:${p.translated}`, p]));
    expect(byKey['soniox:false']).toMatchObject({ model: 'stt-rt-v5', sessions: 1, audioMs: 3_600_000, usdPerMinute: 0.002, estimatedUsd: 0.12 });
    expect(byKey['soniox:true']).toMatchObject({ usdPerMinute: 0.003, estimatedUsd: 0.18 });
    expect(byKey['google-transcribe:false']).toMatchObject({ usdPerMinute: 0.005, estimatedUsd: 0.05 });
    expect(byKey['nemotron:false']).toMatchObject({ audioMs: 120_000, usdPerMinute: 0, estimatedUsd: 0 });
    expect(summary.byProvider[0].audioMs).toBeGreaterThanOrEqual(summary.byProvider[1].audioMs);
    expect(summary.byDay).toEqual([
      { date: '2026-10-05', audioMs: 7_320_000, estimatedUsd: 0.3 },
      { date: '2026-10-07', audioMs: 600_000, estimatedUsd: 0.05 },
    ]);
  });

  it('filters by recording id', async () => {
    await upsertSpeechUsage(record({ sessionId: '00000000-0000-4000-8000-000000000001', recordingId: 'rec-1', audioMs: 60_000 }));
    await upsertSpeechUsage(record({ sessionId: '00000000-0000-4000-8000-000000000002', recordingId: 'rec-2', audioMs: 120_000 }));
    const summary = await summarizeSpeechUsage({
      from: new Date('2026-10-01T00:00:00.000+07:00'),
      toExclusive: new Date('2026-10-11T00:00:00.000+07:00'),
      recordingId: 'rec-2',
    });
    expect(summary.totals).toMatchObject({ sessions: 1, audioMs: 120_000 });
  });

  it('returns empty aggregates when nothing was recorded', async () => {
    const summary = await summarizeSpeechUsage({ from: new Date('2026-10-01T00:00:00.000+07:00'), toExclusive: new Date('2026-10-02T00:00:00.000+07:00') });
    expect(summary.totals).toEqual({ sessions: 0, audioMs: 0, estimatedUsd: 0 });
    expect(summary.byProvider).toEqual([]);
    expect(summary.byDay).toEqual([]);
  });
});
