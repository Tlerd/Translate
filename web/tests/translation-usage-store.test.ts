import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationUsageRecord } from '@/server/cloud/translation-usage-store';

const { neonMock } = vi.hoisted(() => ({ neonMock: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: neonMock }));

import {
  usageStoreEnabled,
  insertTranslationUsage,
  summarizeTranslationUsage,
  resetSchemaReadyForTest,
} from '@/server/cloud/translation-usage-store';

interface StoredRow {
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
  created_at: string;
  prompt_version?: string;
}

function fakeUsageNeon() {
  const rows: StoredRow[] = [];
  const statements: string[] = [];

  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join('?');
    statements.push(statement);

    if (statement.includes('CREATE TABLE') || statement.includes('CREATE INDEX') || statement.includes('ALTER TABLE')) {
      return [];
    }

    if (statement.includes('INSERT INTO translation_usage')) {
      const [
        requestId, recordingId, captionId, revision, modelKey, status,
        requestKind, thinkingLevel, durationMs, sourceChars, systemChars,
        payloadChars, historyTurns, usageStatus, inputTokens, outputTokens,
        cachedInputTokens, thinkingTokens, totalTokens
      ] = values as [
        string, string, number, number, string, 'completed' | 'failed' | 'aborted',
        'final' | 'segment' | 'remainder', string | null, number, number, number,
        number, number, 'reported' | 'unavailable', number | null, number | null,
        number | null, number | null, number | null
      ];

      // ON CONFLICT (request_id) DO NOTHING
      if (rows.some((r) => r.request_id === requestId)) return [];

      const row: StoredRow = {
        request_id: requestId,
        recording_id: recordingId,
        caption_id: captionId,
        revision: revision,
        model_key: modelKey,
        status,
        request_kind: requestKind,
        thinking_level: thinkingLevel,
        duration_ms: durationMs,
        source_chars: sourceChars,
        system_chars: systemChars,
        payload_chars: payloadChars,
        history_turns: historyTurns,
        usage_status: usageStatus,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cached_input_tokens: cachedInputTokens,
        thinking_tokens: thinkingTokens,
        total_tokens: totalTokens,
        created_at: new Date().toISOString(),
        prompt_version: String(values[19]),
      };
      rows.push(row);
      return [];
    }

    if (statement.includes('SELECT') && statement.includes('FROM translation_usage')) {
      let filtered = [...rows];
      const fromIso = values[0] as string;
      const toExclusiveIso = values[1] as string;

      filtered = filtered.filter((r) => r.created_at >= fromIso && r.created_at < toExclusiveIso);

      if (statement.includes('recording_id = ?')) {
        const recId = values[2] as string;
        filtered = filtered.filter((r) => r.recording_id === recId);
      }

      const dayFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      const groups = new Map<string, {
        model_key: string;
        request_kind: string;
        status: string;
        day: string;
        recording_id: string;
        requests: number;
        unavailable: number;
        reported: number;
        reported_input_tokens: number;
        input_tokens: number;
        output_tokens: number;
        cached_input_tokens: number;
        thinking_tokens: number;
      }>();

      for (const r of filtered) {
        const day = dayFormatter.format(new Date(r.created_at));
        const key = `${r.model_key}|${r.request_kind}|${r.status}|${day}|${r.recording_id}`;
        const g = groups.get(key) ?? {
          model_key: r.model_key,
          request_kind: r.request_kind,
          status: r.status,
          day,
          recording_id: r.recording_id,
          requests: 0,
          unavailable: 0,
          reported: 0,
          reported_input_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
          cached_input_tokens: 0,
          thinking_tokens: 0,
        };
        g.requests++;
        if (r.usage_status === 'unavailable' || r.input_tokens === null || r.output_tokens === null) {
          g.unavailable++;
        } else {
          g.reported++;
          g.reported_input_tokens += r.input_tokens;
        }
        g.input_tokens += r.input_tokens ?? 0;
        g.output_tokens += r.output_tokens ?? 0;
        g.cached_input_tokens += r.cached_input_tokens ?? 0;
        g.thinking_tokens += r.thinking_tokens ?? 0;
        groups.set(key, g);
      }

      return [...groups.values()];
    }

    throw new Error(`Unexpected SQL: ${statement}`);
  };

  return { sql, rows, statements };
}

describe('translation-usage-store', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://test-only');
    vi.stubEnv('POSTGRES_URL', '');
    vi.stubEnv('TRANSLATION_USAGE_STORE', 'on');
    resetSchemaReadyForTest();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    neonMock.mockReset();
    resetSchemaReadyForTest();
  });

  describe('usageStoreEnabled', () => {
    it('returns true when DB url is present and store is not off', () => {
      expect(usageStoreEnabled()).toBe(true);
    });

    it('returns false when DB url is missing', () => {
      vi.stubEnv('DATABASE_URL', '');
      vi.stubEnv('POSTGRES_URL', '');
      expect(usageStoreEnabled()).toBe(false);
    });

    it('returns false when TRANSLATION_USAGE_STORE is off', () => {
      vi.stubEnv('TRANSLATION_USAGE_STORE', 'off');
      expect(usageStoreEnabled()).toBe(false);
    });
  });

  describe('insertTranslationUsage', () => {
    it('creates table and indexes once via memoized promise and inserts columns without speech text', async () => {
      const fake = fakeUsageNeon();
      neonMock.mockReturnValue(fake.sql);

      const record: TranslationUsageRecord = {
        requestId: 'req-1',
        recordingId: 'rec-1',
        captionId: 1,
        revision: 1,
        modelKey: 'google:gemini-3.5-flash-lite',
        status: 'completed',
        requestKind: 'final',
        thinkingLevel: null,
        durationMs: 250,
        sourceChars: 12,
        systemChars: 1200,
        payloadChars: 150,
        historyTurns: 2,
        usageStatus: 'reported',
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 0,
        thinkingTokens: 0,
        totalTokens: 120,
        promptVersion: 'lean-fidelity-v2',
      };

      await insertTranslationUsage(record);

      expect(fake.rows).toHaveLength(1);
      expect(fake.rows[0].request_id).toBe('req-1');
      expect(fake.rows[0].input_tokens).toBe(100);
      expect(fake.rows[0].prompt_version).toBe('lean-fidelity-v2');
      expect(fake.statements.filter((s) => s.includes('ADD COLUMN IF NOT EXISTS prompt_version'))).toHaveLength(1);

      const createTableStmts = fake.statements.filter((s) => s.includes('CREATE TABLE'));
      expect(createTableStmts).toHaveLength(1);

      // Second insert should NOT re-run CREATE TABLE
      await insertTranslationUsage({
        ...record,
        requestId: 'req-2',
      });
      const createTableStmtsAfter = fake.statements.filter((s) => s.includes('CREATE TABLE'));
      expect(createTableStmtsAfter).toHaveLength(1);

      // Verify no sensitive texts or glossary exist in SQL statements
      for (const stmt of fake.statements) {
        expect(stmt).not.toContain('private source');
        expect(stmt).not.toContain('private situation');
        expect(stmt).not.toContain('private glossary');
      }
    });

    it('retries schema setup when initial ensureSchema fails', async () => {
      let failOnce = true;
      const fake = fakeUsageNeon();
      const throwingSql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join('?').includes('CREATE TABLE') && failOnce) {
          failOnce = false;
          throw new Error('transient schema error');
        }
        return fake.sql(strings, ...values);
      };
      neonMock.mockReturnValue(throwingSql);

      const record: TranslationUsageRecord = {
        requestId: 'req-retry',
        recordingId: 'rec-1',
        captionId: 1,
        revision: 1,
        modelKey: 'google:gemini-3.5-flash-lite',
        status: 'completed',
        requestKind: 'final',
        thinkingLevel: null,
        durationMs: 250,
        sourceChars: 12,
        systemChars: 1200,
        payloadChars: 150,
        historyTurns: 0,
        usageStatus: 'reported',
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: 0,
        thinkingTokens: 0,
        totalTokens: 12,
      };

      await expect(insertTranslationUsage(record)).rejects.toThrow('transient schema error');
      // Second attempt should retry and succeed
      await expect(insertTranslationUsage(record)).resolves.toBeUndefined();
      expect(fake.rows).toHaveLength(1);
    });
  });

  describe('summarizeTranslationUsage', () => {
    it('averages input only across requests with complete metadata', async () => {
      const fake = fakeUsageNeon();
      neonMock.mockReturnValue(fake.sql);
      const base: TranslationUsageRecord = { requestId: 'full', recordingId: 'rec', captionId: 1, revision: 1,
        modelKey: 'google:gemini-3.1-flash-lite', status: 'completed', requestKind: 'final', thinkingLevel: null,
        durationMs: 100, sourceChars: 1, systemChars: 1, payloadChars: 1, historyTurns: 0,
        usageStatus: 'reported', inputTokens: 100, outputTokens: 10, cachedInputTokens: null, thinkingTokens: null, totalTokens: 110 };
      await insertTranslationUsage(base);
      await insertTranslationUsage({ ...base, requestId: 'partial', status: 'aborted', usageStatus: 'unavailable', inputTokens: 1000, outputTokens: null });
      const result = await summarizeTranslationUsage({ from: new Date('2020-01-01'), toExclusive: new Date('2030-01-01') });
      expect(result.totals.inputTokens).toBe(1100);
      expect(result.totals.unavailable).toBe(1);
      expect(result.avgInputTokensPerRequest).toBe(100);
    });
    it.each([
      ['google:gemini-3.1-flash-lite', 0.07],
      ['google:gemini-3.5-flash-lite', 0.0945],
      ['google:gemini-3.8-flash', 0.19875],
    ])('separates cached input and bills thinking once for %s', async (modelKey, expected) => {
      const fake = fakeUsageNeon();
      neonMock.mockReturnValue(fake.sql);
      await insertTranslationUsage({ requestId: 'cache', recordingId: 'rec', captionId: 1, revision: 1,
        modelKey, status: 'completed', requestKind: 'final', thinkingLevel: 'minimal',
        durationMs: 100, sourceChars: 1, systemChars: 1, payloadChars: 1, historyTurns: 0,
        usageStatus: 'reported', inputTokens: 1_000_000, cachedInputTokens: 900_000,
        outputTokens: 10_000, thinkingTokens: 5_000, totalTokens: 1_015_000 });
      const result = await summarizeTranslationUsage({ from: new Date('2020-01-01'), toExclusive: new Date('2030-01-01') });
      expect(result.totals.estimatedUsd).toBe(expected);
    });

    it('does not label an entirely unavailable request as zero cost', async () => {
      const fake = fakeUsageNeon();
      neonMock.mockReturnValue(fake.sql);
      await insertTranslationUsage({ requestId: 'unknown', recordingId: 'rec', captionId: 1, revision: 1,
        modelKey: 'google:gemini-3.1-flash-lite', status: 'aborted', requestKind: 'final', thinkingLevel: null,
        durationMs: 100, sourceChars: 1, systemChars: 1, payloadChars: 1, historyTurns: 0,
        usageStatus: 'unavailable', inputTokens: null, cachedInputTokens: null,
        outputTokens: null, thinkingTokens: null, totalTokens: null });
      const result = await summarizeTranslationUsage({ from: new Date('2020-01-01'), toExclusive: new Date('2030-01-01') });
      expect(result.totals.estimatedUsd).toBeNull();
      expect(result.totals.unavailable).toBe(1);
    });
    it('computes summary buckets, day buckets in Asia/Ho_Chi_Minh, and estimatedUsd', async () => {
      const fake = fakeUsageNeon();
      neonMock.mockReturnValue(fake.sql);

      // Day 1: 2026-10-05T08:00:00Z (which is 15:00 in +07:00 -> 2026-10-05)
      fake.rows.push({
        request_id: 'r1',
        recording_id: 'rec-a',
        caption_id: 1,
        revision: 1,
        model_key: 'google:gemini-3.5-flash-lite',
        status: 'completed',
        request_kind: 'final',
        thinking_level: null,
        duration_ms: 200,
        source_chars: 10,
        system_chars: 1000,
        payload_chars: 100,
        history_turns: 1,
        usage_status: 'reported',
        input_tokens: 1_000_000, // $0.30
        output_tokens: 200_000,  // 0.2M * $2.50 = $0.50
        cached_input_tokens: 50_000,
        thinking_tokens: 0,
        total_tokens: 1_200_000,
        created_at: '2026-10-05T08:00:00.000Z',
      });

      fake.rows.push({
        request_id: 'r2',
        recording_id: 'rec-a',
        caption_id: 2,
        revision: 1,
        model_key: 'google:gemini-3.1-flash-lite',
        status: 'aborted',
        request_kind: 'segment',
        thinking_level: 'minimal',
        duration_ms: 100,
        source_chars: 5,
        system_chars: 1000,
        payload_chars: 50,
        history_turns: 0,
        usage_status: 'unavailable',
        input_tokens: null,
        output_tokens: null,
        cached_input_tokens: null,
        thinking_tokens: null,
        total_tokens: null,
        created_at: '2026-10-05T09:00:00.000Z',
      });

      const summary = await summarizeTranslationUsage({
        from: new Date('2026-10-01T00:00:00.000Z'),
        toExclusive: new Date('2026-10-10T23:59:59.999Z'),
      });

      expect(summary.totals.requests).toBe(2);
      expect(summary.totals.unavailable).toBe(1);
      expect(summary.totals.inputTokens).toBe(1_000_000);
      expect(summary.totals.outputTokens).toBe(200_000);
      expect(summary.totals.byStatus).toEqual({ completed: 1, failed: 0, aborted: 1 });
      // .95M uncached * .30 + .05M cached * .03 + .2M output * 2.50.
      // Aborted metadata is unknown; the total estimates only observed usage.
      expect(summary.totals.estimatedUsd).toBe(0.7865);
      expect(summary.byModel.find((m) => m.modelKey === 'google:gemini-3.1-flash-lite')?.estimatedUsd).toBeNull();

      expect(summary.byModel).toHaveLength(2);
      expect(summary.byKind).toHaveLength(2);
      expect(summary.byDay).toHaveLength(1);
      expect(summary.byDay[0].day).toBe('2026-10-05');
      expect(summary.byRecording).toHaveLength(1);
      expect(summary.byRecording[0].recordingId).toBe('rec-a');
      // avgInputTokensPerRequest is inputTokens / reported (1 reported request with 1_000_000)
      expect(summary.avgInputTokensPerRequest).toBe(1_000_000);
    });

    it('returns null estimatedUsd when model price is unknown', async () => {
      const fake = fakeUsageNeon();
      neonMock.mockReturnValue(fake.sql);

      fake.rows.push({
        request_id: 'r3',
        recording_id: 'rec-b',
        caption_id: 1,
        revision: 1,
        model_key: 'openai:gpt-4o-mini', // No inputUsdPerM/outputUsdPerM configured
        status: 'completed',
        request_kind: 'final',
        thinking_level: null,
        duration_ms: 300,
        source_chars: 20,
        system_chars: 1000,
        payload_chars: 100,
        history_turns: 0,
        usage_status: 'reported',
        input_tokens: 500,
        output_tokens: 100,
        cached_input_tokens: 0,
        thinking_tokens: 0,
        total_tokens: 600,
        created_at: '2026-10-05T08:00:00.000Z',
      });

      const summary = await summarizeTranslationUsage({
        from: new Date('2026-10-01T00:00:00.000Z'),
        toExclusive: new Date('2026-10-10T23:59:59.999Z'),
      });

      expect(summary.totals.estimatedUsd).toBeNull();
      const modelBucket = summary.byModel.find((m) => m.modelKey === 'openai:gpt-4o-mini');
      expect(modelBucket?.estimatedUsd).toBeNull();
    });
  });
});
