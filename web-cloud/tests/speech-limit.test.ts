import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ accountSpeechAudioMs: vi.fn() }));
vi.mock('@/server/cloud/speech-usage-store', () => ({ accountSpeechAudioMs: (owner: string, from: Date) => store.accountSpeechAudioMs(owner, from) }));

import { encode } from 'next-auth/jwt';
import { POST as sonioxSession } from '@/app/api/speech/soniox/session/route';
import { dailySpeechLimitMinutes, speechLimitResponse, startOfSaigonDay, usageScope } from '@/server/http/account-usage';

describe('per-account speech limit', () => {
  beforeEach(() => {
    vi.stubEnv('OWNER_EMAIL', 'owner@example.com');
    vi.stubEnv('DATABASE_URL', 'postgres://test-only');
    vi.stubEnv('TRANSLATION_USAGE_STORE', 'on');
    vi.stubEnv('USER_DAILY_SPEECH_MINUTES', '30');
    store.accountSpeechAudioMs.mockReset().mockResolvedValue(0);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('scopes usage to the account except for the owner and local development', () => {
    expect(usageScope('alice@example.com')).toEqual({ all: false, owner: 'alice@example.com' });
    expect(usageScope('owner@example.com')).toEqual({ all: true });
    expect(usageScope(null)).toEqual({ all: true });
  });

  it('counts from midnight in Asia/Ho_Chi_Minh', () => {
    expect(startOfSaigonDay(new Date('2026-10-10T16:59:00.000Z')).toISOString()).toBe('2026-10-09T17:00:00.000Z');
    expect(startOfSaigonDay(new Date('2026-10-10T17:00:00.000Z')).toISOString()).toBe('2026-10-10T17:00:00.000Z');
  });

  it('parses the limit and ignores invalid values', () => {
    expect(dailySpeechLimitMinutes()).toBe(30);
    vi.stubEnv('USER_DAILY_SPEECH_MINUTES', 'abc'); expect(dailySpeechLimitMinutes()).toBeNull();
    vi.stubEnv('USER_DAILY_SPEECH_MINUTES', ''); expect(dailySpeechLimitMinutes()).toBeNull();
  });

  it('allows an account under the limit and refuses it once the minutes are used', async () => {
    const now = new Date('2026-10-10T05:00:00.000Z');
    store.accountSpeechAudioMs.mockResolvedValue(29 * 60_000);
    expect(await speechLimitResponse('alice@example.com', now)).toBeNull();
    expect(store.accountSpeechAudioMs).toHaveBeenCalledWith('alice@example.com', new Date('2026-10-09T17:00:00.000Z'));
    store.accountSpeechAudioMs.mockResolvedValue(30 * 60_000);
    const refused = await speechLimitResponse('alice@example.com', now);
    expect(refused?.status).toBe(429);
    expect(await refused?.json()).toMatchObject({ error: { code: 'RATE_LIMIT_EXCEEDED' } });
  });

  it('never limits the owner, local development, an unset limit or a missing usage database', async () => {
    store.accountSpeechAudioMs.mockResolvedValue(10 ** 9);
    expect(await speechLimitResponse('owner@example.com')).toBeNull();
    expect(await speechLimitResponse(null)).toBeNull();
    vi.stubEnv('TRANSLATION_USAGE_STORE', 'off');
    expect(await speechLimitResponse('alice@example.com')).toBeNull();
    vi.stubEnv('TRANSLATION_USAGE_STORE', 'on'); vi.stubEnv('USER_DAILY_SPEECH_MINUTES', '');
    expect(await speechLimitResponse('alice@example.com')).toBeNull();
    expect(store.accountSpeechAudioMs).not.toHaveBeenCalled();
  });

  it('keeps speech available when the usage lookup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    store.accountSpeechAudioMs.mockRejectedValue(new Error('db down'));
    expect(await speechLimitResponse('alice@example.com')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses a new Soniox session for an account over its limit before calling Soniox', async () => {
    const secret = 'test-secret-that-is-long-enough-for-nextauth';
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_SECRET', secret); vi.stubEnv('ALLOWED_EMAILS', 'alice@example.com'); vi.stubEnv('SONIOX_API_KEY', 'server-only-secret');
    const fetchMock = vi.fn(async () => Response.json({ api_key: 'temporary', expires_at: new Date(Date.now() + 120_000).toISOString() }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const cookie = `authjs.session-token=${await encode({ secret, salt: 'authjs.session-token', maxAge: 3600, token: { email: 'alice@example.com' } })}`;
    const call = () => sonioxSession(new Request('http://localhost/api/speech/soniox/session', { method: 'POST', body: JSON.stringify({ languageCode: 'ja' }), headers: { cookie } }));
    store.accountSpeechAudioMs.mockResolvedValue(31 * 60_000);
    expect((await call()).status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    store.accountSpeechAudioMs.mockResolvedValue(0);
    expect((await call()).status).toBe(200);
    vi.unstubAllGlobals();
  });
});
