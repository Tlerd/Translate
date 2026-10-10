import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => ({
  verifyAuthGuard: vi.fn(),
}));

const store = vi.hoisted(() => ({
  usageStoreEnabled: vi.fn(),
  summarizeTranslationUsage: vi.fn(),
}));

vi.mock('@/server/http/guard', () => ({
  verifyAuthGuard: (req: Request) => guard.verifyAuthGuard(req),
  makeErrorResponse: (status: number, code: string, message: string) => {
    return new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  },
}));

vi.mock('@/server/cloud/translation-usage-store', () => ({
  usageStoreEnabled: () => store.usageStoreEnabled(),
  summarizeTranslationUsage: (q: unknown) => store.summarizeTranslationUsage(q),
}));

import { GET } from '@/app/api/usage/translation/route';

describe('GET /api/usage/translation', () => {
  beforeEach(() => {
    guard.verifyAuthGuard.mockResolvedValue(null);
    store.usageStoreEnabled.mockReturnValue(true);
    store.summarizeTranslationUsage.mockResolvedValue({
      range: { from: '2026-10-01', to: '2026-10-05' },
      totals: {
        requests: 10,
        unavailable: 0,
        inputTokens: 1000,
        outputTokens: 200,
        cachedInputTokens: 0,
        thinkingTokens: 0,
        estimatedUsd: 0.001,
        byStatus: { completed: 10, failed: 0, aborted: 0 },
      },
      byModel: [],
      byKind: [],
      byDay: [],
      byRecording: [],
      avgInputTokensPerRequest: 100,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests if auth guard triggers', async () => {
    guard.verifyAuthGuard.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 })
    );

    const req = new Request('http://localhost/api/usage/translation?from=2026-10-01&to=2026-10-05');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 503 MISSING_CONFIG when usageStoreEnabled is false', async () => {
    store.usageStoreEnabled.mockReturnValue(false);

    const req = new Request('http://localhost/api/usage/translation?from=2026-10-01&to=2026-10-05');
    const res = await GET(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('MISSING_CONFIG');
  });

  it('returns 400 when date range is invalid or exceeds 92 days', async () => {
    // Missing dates
    const resMissing = await GET(new Request('http://localhost/api/usage/translation'));
    expect(resMissing.status).toBe(400);

    // Invalid format
    const resBadFormat = await GET(new Request('http://localhost/api/usage/translation?from=invalid&to=2026-10-05'));
    expect(resBadFormat.status).toBe(400);

    // from > to
    const resInverted = await GET(new Request('http://localhost/api/usage/translation?from=2026-10-10&to=2026-10-05'));
    expect(resInverted.status).toBe(400);

    // Exceeds 92 days (e.g. 100 days)
    const resTooLong = await GET(new Request('http://localhost/api/usage/translation?from=2026-01-01&to=2026-05-01'));
    expect(resTooLong.status).toBe(400);
  });

  it('returns 200 with summary and passes filter recordingId', async () => {
    const req = new Request('http://localhost/api/usage/translation?from=2026-10-01&to=2026-10-05&recordingId=rec-123');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(store.summarizeTranslationUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: 'rec-123',
        tz: 'Asia/Ho_Chi_Minh',
      })
    );
    const body = await res.json();
    expect(body.totals.requests).toBe(10);
  });
});
