import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationUsageRecord } from '@/server/cloud/translation-usage-store';

const { neonMock } = vi.hoisted(() => ({ neonMock: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: neonMock }));

import {
  usageStoreEnabled,
  insertTranslationUsage,
  summarizeTranslationUsage,
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
}

function fakeUsageNeon() {
  const rows: StoredRow[] = [];
  const statements: string[] = [];

  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join('?');
    statements.push(statement);

    if (statement.includes('CREATE TABLE') || statement.includes('CREATE INDEX')) {
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
      };
      rows.push(row);
      return [];
    }

    if (statement.includes('SELECT') && statement.includes('FROM translation_usage')) {
      let filtered = [...rows];
      const fromIso = values[0] as string;
      const toIso = values[1] as string;

      filtered = filtered.filter((r) => r.created_at >= fromIso && r.created_at <= toIso);

      if (statement.includes('recording_id = ?')) {
        const recId = values[2] as string;
        filtered = filtered.filter((r) => r.recording_id === recId);
      }

      return filtered;
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    neonMock.mockReset();
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
    it('creates table and indexes idempotently and inserts columns without speech text', async () => {
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
      };

      await insertTranslationUsage(record);

      expect(fake.rows).toHaveLength(1);
      expect(fake.rows[0].request_id).toBe('req-1');
      expect(fake.rows[0].input_tokens).toBe(100);

      const insertStmt = fake.statements.find((s) => s.includes('INSERT INTO translation_usage'));
      expect(insertStmt).toBeDefined();
      expect(insertStmt).toContain('ON CONFLICT (request_id) DO NOTHING');

      // Check duplicate requestId does not insert
      await insertTranslationUsage(record);
      expect(fake.rows).toHaveLength(1);

      // Verify no sensitive texts or glossary exist in SQL statements
      for (const stmt of fake.statements) {
        expect(stmt).not.toContain('private source');
        expect(stmt).not.toContain('private situation');
        expect(stmt).not.toContain('private glossary');
      }
    });
  });

  describe('summarizeTranslationUsage', () => {
    it('computes summary buckets, day buckets in Asia/Ho_Chi_Minh, and estimatedUsd', async () => {
      const fake = fakeUsageNeon();
      neonMock.mockReturnValue(fake.sql);

      // Add test rows
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
        to: new Date('2026-10-10T23:59:59.999Z'),
      });

      expect(summary.totals.requests).toBe(2);
      expect(summary.totals.unavailable).toBe(1);
      expect(summary.totals.inputTokens).toBe(1_000_000);
      expect(summary.totals.outputTokens).toBe(200_000);
      expect(summary.totals.byStatus).toEqual({ completed: 1, failed: 0, aborted: 1 });
      // estimatedUsd: r1 cost = 0.30 + 0.50 = 0.80. r2 has 0 tokens.
      expect(summary.totals.estimatedUsd).toBe(0.8);

      expect(summary.byModel).toHaveLength(2);
      expect(summary.byKind).toHaveLength(2);
      expect(summary.byDay).toHaveLength(1);
      expect(summary.byDay[0].day).toBe('2026-10-05');
      expect(summary.byRecording).toHaveLength(1);
      expect(summary.byRecording[0].recordingId).toBe('rec-a');
      expect(summary.avgInputTokensPerRequest).toBe(500_000);
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
        to: new Date('2026-10-10T23:59:59.999Z'),
      });

      expect(summary.totals.estimatedUsd).toBeNull();
      const modelBucket = summary.byModel.find((m) => m.modelKey === 'openai:gpt-4o-mini');
      expect(modelBucket?.estimatedUsd).toBeNull();
    });
  });
});
