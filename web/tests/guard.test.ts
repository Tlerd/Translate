import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode } from 'next-auth/jwt';
import { verifyAuthGuard } from '@/server/http/guard';

const secret = 'test-secret-that-is-long-enough-for-nextauth';
const cookieName = 'authjs.session-token';

async function signedSession(email: string, overrides: Record<string, unknown> = {}) {
  return encode({
    secret,
    salt: cookieName,
    maxAge: overrides.exp ? -60 * 60 : 60 * 60,
    token: { sub: 'owner-user', email, ...overrides },
  });
}

function request(cookie?: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/translate', {
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
}

describe('verifyAuthGuard', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    process.env.AUTH_SECRET = secret;
    process.env.OWNER_EMAIL = 'Owner@example.com ';
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects spoofed authorization and unrelated cookies', async () => {
    expect(await verifyAuthGuard(request(undefined, { authorization: 'Bearer anything' }))).not.toBeNull();
    expect(await verifyAuthGuard(request('theme=dark'))).not.toBeNull();
  });

  it('rejects malformed, expired, tampered, and wrong-owner session cookies', async () => {
    const expired = await signedSession('owner@example.com', { exp: Math.floor(Date.now() / 1000) - 1 });
    const valid = await signedSession('owner@example.com');
    const tampered = `${valid.slice(0, 20)}x${valid.slice(21)}`;

    for (const value of ['not-a-token', expired, tampered]) {
      expect(await verifyAuthGuard(request(`${cookieName}=${value}`)), value.slice(0, 12)).not.toBeNull();
    }
    expect(await verifyAuthGuard(request(`${cookieName}=${await signedSession('someone@example.com')}`))).not.toBeNull();
  });

  it('accepts a genuine signed NextAuth session for the normalized owner email', async () => {
    const token = await signedSession('OWNER@example.com');
    expect(await verifyAuthGuard(request(`${cookieName}=${token}`))).toBeNull();
  });

  it('fails closed in production when auth configuration is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.AUTH_SECRET;
    delete process.env.OWNER_EMAIL;
    expect(await verifyAuthGuard(request())).not.toBeNull();
  });

  it('keeps unconfigured local development available', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.AUTH_SECRET;
    delete process.env.OWNER_EMAIL;
    expect(await verifyAuthGuard(request())).toBeNull();
  });
});
