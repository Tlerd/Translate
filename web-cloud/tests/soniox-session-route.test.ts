import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/speech/soniox/session/route';
import { checkRateLimit } from '@/server/http/rate-limit';

vi.mock('@/server/http/rate-limit', () => ({ checkRateLimit: vi.fn() }));
const request = (body: unknown = { languageCode: 'ja-JP' }, headers?: HeadersInit) => new Request('http://localhost:3000/api/speech/soniox/session', { method: 'POST', body: JSON.stringify(body), headers });
const valid = () => ({ api_key: 'temporary-key-only', expires_at: new Date(Date.now() + 120_000).toISOString() });

describe('Soniox temporary session route', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('AUTH_SECRET', ''); vi.stubEnv('OWNER_EMAIL', ''); vi.stubEnv('SONIOX_API_KEY', 'server-only-secret');
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue({ allowed: true, remaining: 9 });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(valid(), { status: 201 })));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('mints a one-use STT key and returns only a temporary token with provider-specific renewal', async () => {
    const response = await POST(request({ languageCode: 'vi', recordingId: 'recording-1' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload = await response.json();
    expect(payload).toMatchObject({ token: 'temporary-key-only', model: 'stt-rt-v5', sessionLimitMs: 3_600_000, renewAfterMs: 3_300_000 });
    expect(JSON.stringify(payload)).not.toContain('server-only-secret');
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.soniox.com/v1/auth/temporary-api-key');
    expect(options).toMatchObject({ headers: { Authorization: 'Bearer server-only-secret' }, cache: 'no-store', redirect: 'error' });
    expect(JSON.parse(options!.body as string)).toEqual({ usage_type: 'transcribe_websocket', expires_in_seconds: 120, single_use: true, max_session_duration_seconds: 3600, client_reference_id: 'lesson:recording-1' });
    expect(checkRateLimit).toHaveBeenCalledWith('speech:soniox:owner', 10, 60);
  });
  it('requires configured owner authentication on production and a valid session when configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv('AUTH_SECRET', 'an-auth-secret-longer-than-thirty-two-characters'); vi.stubEnv('OWNER_EMAIL', 'owner@example.com');
    expect((await POST(request())).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
  it.each([{ languageCode: 'am-ET' }, { languageCode: 'ja_JP' }, { languageCode: 'ja', model: 'different-model' }, { languageCode: 'vi', websocketUrl: 'wss://evil.example' }, { languageCode: 'ja', recordingId: '../secrets' }, null])('rejects invalid or injected request %j before any provider call', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled(); expect(checkRateLimit).not.toHaveBeenCalled();
  });
  it('rejects oversized, malformed, and cross-origin requests before calling Soniox', async () => {
    expect((await POST(request({ languageCode: 'ja', extra: 'x'.repeat(2100) }))).status).toBe(413);
    expect((await POST(new Request('http://localhost:3000/api/speech/soniox/session', { method: 'POST', body: '{' }))).status).toBe(400);
    expect((await POST(request(undefined, { Origin: 'https://other.example' }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not call upstream when the key is absent or the application rate limit is reached', async () => {
    vi.stubEnv('SONIOX_API_KEY', '');
    expect(await (await POST(request())).json()).toMatchObject({ error: { code: 'MISSING_CONFIG', retryable: false } });
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterMs: 5000 });
    expect(await (await POST(request())).json()).toMatchObject({ error: { code: 'RATE_LIMIT_EXCEEDED', retryable: true, retryAfterMs: 5000 } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([[401, 'unauthenticated', false], [403, 'permission_denied', false], [402, 'organization_balance_exhausted', false], [429, 'limit_exceeded', true], [503, 'service_unavailable', true]] as const)('classifies upstream %s without leaking messages or credentials', async (status, error_type, retryable) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error_type, message: 'server-only-secret internal-url', api_key: 'server-only-secret' }, { status }));
    const response = await POST(request());
    const body = await response.json();
    expect(body.error).toMatchObject({ retryable, providerErrorType: error_type });
    expect(JSON.stringify(body)).not.toContain('server-only-secret');
    expect(JSON.stringify(body)).not.toContain('internal-url');
  });
  it.each([{ expires_at: 'invalid-date' }, { api_key: '' }, { api_key: 'server-only-secret' }, { expires_at: '2000-01-01T00:00:00Z' }])('rejects invalid temporary-key responses %j', async bad => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...valid(), ...bad }));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { retryable: false } });
  });
  it.each(['TimeoutError', 'AbortError'])('handles %s without exposing the underlying error', async name => {
    vi.mocked(fetch).mockRejectedValue(Object.assign(new Error('server-only-secret'), { name }));
    const response = await POST(request());
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: { code: 'TIMEOUT', retryable: true } });
  });
  it('combines the caller abort signal with the upstream timeout', async () => {
    const abort = new AbortController(); abort.abort();
    vi.mocked(fetch).mockImplementation(async (_url, init) => { expect(init!.signal?.aborted).toBe(true); throw new DOMException('aborted', 'AbortError'); });
    expect((await POST(new Request('http://localhost:3000/api/speech/soniox/session', { method: 'POST', body: JSON.stringify({ languageCode: 'ja' }), signal: abort.signal }))).status).toBe(504);
  });
});
