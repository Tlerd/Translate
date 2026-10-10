import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => ({ verifyAuthGuard: vi.fn() }));
const store = vi.hoisted(() => ({
  usageStoreEnabled: vi.fn(),
  upsertSpeechUsage: vi.fn(),
  summarizeSpeechUsage: vi.fn(),
}));

vi.mock('@/server/http/guard', () => ({
  verifyAuthGuard: (req: Request) => guard.verifyAuthGuard(req),
  makeErrorResponse: (status: number, code: string, message: string) =>
    new Response(JSON.stringify({ error: { code, message } }), { status, headers: { 'Content-Type': 'application/json' } }),
}));
vi.mock('@/server/cloud/speech-usage-store', () => ({
  usageStoreEnabled: () => store.usageStoreEnabled(),
  upsertSpeechUsage: (r: unknown) => store.upsertSpeechUsage(r),
  summarizeSpeechUsage: (q: unknown) => store.summarizeSpeechUsage(q),
}));

import { GET, POST } from '@/app/api/usage/speech/route';

const validBody = {
  sessionId: '3f0c2b52-6a9e-4d0e-8b6b-0d5f2f8a9c11',
  recordingId: 'rec_123',
  provider: 'soniox',
  model: 'stt-rt-v5',
  translated: true,
  audioMs: 61_000,
  startedAt: '2026-10-10T03:00:00.000Z',
  endedAt: '2026-10-10T03:01:01.000Z',
};
const post = (body: unknown, init: RequestInit = {}) =>
  POST(new Request('http://localhost/api/usage/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  }));

describe('POST /api/usage/speech', () => {
  beforeEach(() => {
    guard.verifyAuthGuard.mockResolvedValue(null);
    store.usageStoreEnabled.mockReturnValue(true);
    store.upsertSpeechUsage.mockResolvedValue(undefined);
  });
  afterEach(() => { vi.clearAllMocks(); });

  it('rejects unauthenticated requests without touching the store', async () => {
    guard.verifyAuthGuard.mockResolvedValue(new Response('{}', { status: 401 }));
    const res = await post(validBody);
    expect(res.status).toBe(401);
    expect(store.upsertSpeechUsage).not.toHaveBeenCalled();
  });

  it('upserts a valid report', async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect(store.upsertSpeechUsage).toHaveBeenCalledWith({
      sessionId: validBody.sessionId,
      recordingId: 'rec_123',
      provider: 'soniox',
      model: 'stt-rt-v5',
      translated: true,
      audioMs: 61_000,
      startedAt: new Date('2026-10-10T03:00:00.000Z'),
    });
  });

  it('accepts a report without endedAt and with 0 ms', async () => {
    const { endedAt: _endedAt, ...rest } = validBody;
    void _endedAt;
    expect((await post({ ...rest, audioMs: 0 })).status).toBe(200);
  });

  it('returns 204 without error when the store is disabled', async () => {
    store.usageStoreEnabled.mockReturnValue(false);
    const res = await post(validBody);
    expect(res.status).toBe(204);
    expect(store.upsertSpeechUsage).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', '{nope'],
    ['empty body', ''],
    ['non-object', '[]'],
    ['bad uuid', { ...validBody, sessionId: 'not-a-uuid' }],
    ['unknown provider', { ...validBody, provider: 'whisper' }],
    ['negative audio', { ...validBody, audioMs: -1 }],
    ['fractional audio', { ...validBody, audioMs: 1.5 }],
    ['more than 6h of audio', { ...validBody, audioMs: 6 * 3_600_000 + 1 }],
    ['empty recording id', { ...validBody, recordingId: '' }],
    ['overlong recording id', { ...validBody, recordingId: 'x'.repeat(161) }],
    ['non-boolean translated', { ...validBody, translated: 'yes' }],
    ['bad startedAt', { ...validBody, startedAt: 'yesterday' }],
    ['extra field', { ...validBody, extra: 1 }],
    ['missing field', { ...validBody, model: undefined }],
  ])('rejects %s with 400', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(store.upsertSpeechUsage).not.toHaveBeenCalled();
  });

  it('accepts the 6 hour upper bound', async () => {
    expect((await post({ ...validBody, audioMs: 6 * 3_600_000 })).status).toBe(200);
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await post({ ...validBody, model: 'x'.repeat(10_000) });
    expect(res.status).toBe(413);
  });

  it('returns 500 when the store fails', async () => {
    store.upsertSpeechUsage.mockRejectedValue(new Error('db down'));
    expect((await post(validBody)).status).toBe(500);
  });
});

describe('GET /api/usage/speech', () => {
  beforeEach(() => {
    guard.verifyAuthGuard.mockResolvedValue(null);
    store.usageStoreEnabled.mockReturnValue(true);
    store.summarizeSpeechUsage.mockResolvedValue({
      range: { from: '2026-10-01', to: '2026-10-05' },
      totals: { sessions: 1, audioMs: 60_000, estimatedUsd: 0.002 },
      byProvider: [],
      byDay: [],
    });
  });
  afterEach(() => { vi.clearAllMocks(); });

  it('requires auth', async () => {
    guard.verifyAuthGuard.mockResolvedValue(new Response('{}', { status: 401 }));
    expect((await GET(new Request('http://localhost/api/usage/speech?from=2026-10-01&to=2026-10-05'))).status).toBe(401);
  });

  it('returns 503 when the store is disabled', async () => {
    store.usageStoreEnabled.mockReturnValue(false);
    const res = await GET(new Request('http://localhost/api/usage/speech?from=2026-10-01&to=2026-10-05'));
    expect(res.status).toBe(503);
  });

  it('validates the date range', async () => {
    for (const query of ['', '?from=bad&to=2026-10-05', '?from=2026-10-10&to=2026-10-05', '?from=2026-01-01&to=2026-05-01']) {
      expect((await GET(new Request(`http://localhost/api/usage/speech${query}`))).status).toBe(400);
    }
  });

  it('summarizes with Saigon day bounds and the recording filter', async () => {
    const res = await GET(new Request('http://localhost/api/usage/speech?from=2026-10-01&to=2026-10-05&recordingId=rec-9'));
    expect(res.status).toBe(200);
    expect((await res.json()).totals.sessions).toBe(1);
    const query = store.summarizeSpeechUsage.mock.calls[0][0];
    expect(query.recordingId).toBe('rec-9');
    expect(query.from.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(query.toExclusive.toISOString()).toBe('2026-10-05T17:00:00.000Z');
  });
});
