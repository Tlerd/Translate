import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CloudPayload } from '@/shared/cloud-recording';
import { closeSqlPool } from '@/server/cloud/sql';
import { database, readCloudRecording, readCloudRecordingIndex, writeCloudRecording } from '@/server/cloud/recording-store';
import { insertTranslationUsage, resetSchemaReadyForTest, summarizeTranslationUsage } from '@/server/cloud/translation-usage-store';
import { resetSpeechSchemaReadyForTest, summarizeSpeechUsage, upsertSpeechUsage } from '@/server/cloud/speech-usage-store';
import { acquireIdempotencyLock, checkRateLimit } from '@/server/http/rate-limit';

// Real-service checks. Run with e.g.
//   INTEGRATION_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/postgres INTEGRATION_REDIS_URL=redis://127.0.0.1:56379 npm test -- tests/integration
const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const REDIS_URL = process.env.INTEGRATION_REDIS_URL;
const run = randomUUID().slice(0, 8);

function payload(title: string, audioState: 'missing' | 'deleted' = 'missing'): CloudPayload {
  return {
    recording: { id: 'x', title, createdAt: '2026-01-01', mode: 'lecture', sourceLanguage: 'ja', targetLanguage: 'vi', state: 'stopped', durationMs: 10, audioState, config: { translationModelKey: 'm' } },
    captions: [],
    summaries: [],
  } as unknown as CloudPayload;
}

describe.skipIf(!DATABASE_URL)('postgres through the pg-backed sql client', () => {
  const owner = `it-${run}@example.com`;
  const otherOwner = `it-other-${run}@example.com`;
  const recordingPrefix = `it-${run}`;

  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', DATABASE_URL!);
    vi.stubEnv('POSTGRES_URL', '');
    resetSchemaReadyForTest();
    resetSpeechSchemaReadyForTest();
  });

  afterAll(async () => {
    try {
      const sql = database();
      await sql`DELETE FROM recording_sync WHERE owner_email IN (${owner}, ${otherOwner})`;
      await sql`DELETE FROM recording_audio WHERE owner_email IN (${owner}, ${otherOwner})`;
      await sql`DELETE FROM translation_usage WHERE recording_id LIKE ${`${recordingPrefix}%`}`;
      await sql`DELETE FROM speech_usage WHERE recording_id LIKE ${`${recordingPrefix}%`}`;
    } finally {
      await closeSqlPool();
      vi.unstubAllEnvs();
    }
  });

  it('binds values as parameters, returning jsonb parsed and counts as numbers or strings as Postgres types them', async () => {
    const sql = database();
    const evil = `x'; DROP TABLE recording_sync; --`;
    const rows = await sql`SELECT ${evil}::text AS s, ${{ a: [1, 2] }}::jsonb AS j, ${['p', 'q']}::text[] AS arr, ${new Date('2026-02-03T04:05:06Z')}::timestamptz AS ts, COUNT(*) AS c, COUNT(*)::int AS ci FROM (SELECT 1) t`;
    expect(rows[0].s).toBe(evil);
    expect(rows[0].j).toEqual({ a: [1, 2] });
    expect(rows[0].arr).toEqual(['p', 'q']);
    expect(rows[0].ts).toBeInstanceOf(Date);
    expect((rows[0].ts as Date).toISOString()).toBe('2026-02-03T04:05:06.000Z');
    expect(rows[0].c).toBe('1'); // bigint arrives as a string, same as the Neon driver
    expect(rows[0].ci).toBe(1);
  });

  it('writes, reads, pages and rejects stale compare-and-swap writes', async () => {
    const id = `${recordingPrefix}-cas`;
    expect(await writeCloudRecording(owner, id, 0, payload('one'))).toMatchObject({ id, version: 1, payload: { recording: { title: 'one' } } });
    expect(await writeCloudRecording(owner, id, 0, payload('dup'))).toBeNull(); // already exists
    const results = await Promise.all([writeCloudRecording(owner, id, 1, payload('two')), writeCloudRecording(owner, id, 1, payload('three'))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const current = await readCloudRecording(owner, id);
    expect(current?.version).toBe(2);
    expect(current?.payload).toMatchObject({ recording: { title: results[0] ? 'two' : 'three' } });
    expect(await readCloudRecording(otherOwner, id)).toBeNull();
    expect(await writeCloudRecording(otherOwner, id, 0, payload('other'))).toMatchObject({ version: 1 });

    const index = await readCloudRecordingIndex(owner);
    expect(index.items).toEqual([{ id, version: 2 }]);
    expect(index.nextCursor).toBeNull();
    expect((await readCloudRecordingIndex(owner, id)).items).toEqual([]);
  });

  it('keeps tables intact after hostile parameter values were bound', async () => {
    const sql = database();
    expect(await sql`SELECT to_regclass('public.recording_sync') AS t`).toEqual([{ t: 'recording_sync' }]);
  });

  it('commits a tombstone and the recording_audio row together, and not on a CAS conflict', async () => {
    const sql = database();
    const id = `${recordingPrefix}-del`;
    await writeCloudRecording(owner, id, 0, payload('live'));
    expect(await writeCloudRecording(owner, id, 5, null)).toBeNull(); // stale version
    expect(await sql`SELECT 1 FROM recording_audio WHERE owner_email=${owner} AND recording_id=${id}`).toHaveLength(0);

    expect(await writeCloudRecording(owner, id, 1, null)).toMatchObject({ id, version: 2, payload: null });
    const audio = await sql`SELECT state, version FROM recording_audio WHERE owner_email=${owner} AND recording_id=${id}`;
    expect(audio).toEqual([{ state: 'deleted', version: 1 }]);

    // New-row tombstone path (expectedVersion 0) and the audioState:'deleted' payload path.
    const fresh = `${recordingPrefix}-fresh`;
    expect(await writeCloudRecording(owner, fresh, 0, null)).toMatchObject({ version: 1 });
    expect(await sql`SELECT state FROM recording_audio WHERE owner_email=${owner} AND recording_id=${fresh}`).toEqual([{ state: 'deleted' }]);
    const flagged = `${recordingPrefix}-flagged`;
    expect(await writeCloudRecording(owner, flagged, 0, payload('gone', 'deleted'))).toMatchObject({ version: 1 });
    expect(await sql`SELECT state FROM recording_audio WHERE owner_email=${owner} AND recording_id=${flagged}`).toEqual([{ state: 'deleted' }]);
  });

  it('inserts and summarises translation usage', async () => {
    const recordingId = `${recordingPrefix}-tr`;
    const base = { recordingId, captionId: 1, revision: 1, modelKey: 'google:gemini-3.5-flash-lite', status: 'completed' as const, requestKind: 'final' as const, thinkingLevel: null, durationMs: 100, sourceChars: 10, systemChars: 5, payloadChars: 20, historyTurns: 0, usageStatus: 'reported' as const, outputTokens: 20, cachedInputTokens: 0, thinkingTokens: 0, totalTokens: 120 };
    await insertTranslationUsage({ ...base, requestId: `${run}-a`, inputTokens: 100 });
    await insertTranslationUsage({ ...base, requestId: `${run}-a`, inputTokens: 999 }); // ON CONFLICT DO NOTHING
    await insertTranslationUsage({ ...base, requestId: `${run}-b`, inputTokens: 50, status: 'failed' });
    const summary = await summarizeTranslationUsage({ from: new Date(Date.now() - 3_600_000), toExclusive: new Date(Date.now() + 3_600_000), recordingId });
    expect(summary.totals.requests).toBe(2);
    expect(summary.totals.inputTokens).toBe(150);
    expect(summary.totals.byStatus).toMatchObject({ completed: 1, failed: 1 });
    expect(summary.byRecording[0]?.recordingId).toBe(recordingId);
  });

  it('upserts and summarises speech usage, only ever raising audio time', async () => {
    const recordingId = `${recordingPrefix}-sp`;
    const record = { sessionId: randomUUID(), recordingId, provider: 'soniox' as const, model: 'stt-rt-v5', translated: true, audioMs: 60_000, startedAt: new Date() };
    await upsertSpeechUsage(record);
    await upsertSpeechUsage({ ...record, audioMs: 30_000 });
    await upsertSpeechUsage({ ...record, audioMs: 90_000 });
    const summary = await summarizeSpeechUsage({ from: new Date(Date.now() - 3_600_000), toExclusive: new Date(Date.now() + 3_600_000), recordingId });
    expect(summary.totals.sessions).toBe(1);
    expect(summary.totals.audioMs).toBe(90_000);
  });
});

describe.skipIf(!REDIS_URL)('redis through ioredis', () => {
  const key = `it-${run}`;
  let probe: Redis;

  beforeAll(async () => {
    vi.stubEnv('REDIS_URL', REDIS_URL!);
    probe = new Redis(REDIS_URL!);
  });

  afterAll(async () => {
    await probe.del(`rl:${key}`, `rl:${key}-ttl`, `idem:${key}`);
    probe.disconnect();
    (globalThis as Record<symbol, Redis | undefined>)[Symbol.for('may-dich.http.redis')]?.disconnect?.();
    vi.unstubAllEnvs();
  });

  it('allows up to the limit, then blocks with a retry hint, and the window key always has a TTL', async () => {
    expect(await checkRateLimit(key, 2, 60)).toEqual({ allowed: true, remaining: 1 });
    expect(await checkRateLimit(key, 2, 60)).toEqual({ allowed: true, remaining: 0 });
    const blocked = await checkRateLimit(key, 2, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(1000);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(await probe.get(`rl:${key}`)).toBe('3'); // counted in Redis, not memory
    expect(await probe.ttl(`rl:${key}`)).toBeGreaterThan(0);
  });

  it('takes the idempotency lock exactly once per key', async () => {
    expect(await acquireIdempotencyLock(key, 60)).toBe(true);
    expect(await acquireIdempotencyLock(key, 60)).toBe(false);
    expect(await probe.ttl(`idem:${key}`)).toBeGreaterThan(0);
  });

  it('falls back to the in-memory limiter when Redis is unreachable, and recovers afterwards', async () => {
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1');
    const started = Date.now();
    expect((await checkRateLimit(`${key}-down`, 1, 60)).allowed).toBe(true);
    expect((await checkRateLimit(`${key}-down`, 1, 60)).allowed).toBe(false);
    expect(await acquireIdempotencyLock(`${key}-down`)).toBe(true);
    expect(await acquireIdempotencyLock(`${key}-down`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);

    vi.stubEnv('REDIS_URL', REDIS_URL!);
    expect(await checkRateLimit(`${key}-ttl`, 1, 60)).toEqual({ allowed: true, remaining: 0 });
    expect(await probe.get(`rl:${key}-ttl`)).toBe('1');
  });
});
