import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { encode } from 'next-auth/jwt';
import { accessConfigured, allowedAccount, isOwnerAccount, localAuthBypass } from '@/server/auth-policy';
import { authenticate, verifyAuthGuard } from '@/server/http/guard';
import { localDataNamespace } from '@/server/account-storage';
import { DEFAULT_DB_NAME, getDb, resetDbInstance, selectAccountDb } from '@/storage/db';

const secret = 'test-secret-that-is-long-enough-for-nextauth';
const cookieName = 'authjs.session-token';
const request = async (email: string) => new Request('http://localhost/api/translate', {
  headers: { cookie: `${cookieName}=${await encode({ secret, salt: cookieName, maxAge: 3600, token: { sub: email, email } })}` },
});

describe('multi-user allowlist', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_SECRET', secret);
    vi.stubEnv('OWNER_EMAIL', 'Owner@example.com');
    vi.stubEnv('ALLOWED_EMAILS', ' Alice@Example.com, bob@example.com;carol@other.org\n');
    vi.stubEnv('ALLOWED_DOMAINS', '@school.edu.vn, lab.example');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('allows the owner, listed emails and exact domains, normalizing case and spaces', () => {
    expect(allowedAccount(' OWNER@example.com ')).toBe('owner@example.com');
    expect(allowedAccount('alice@example.com')).toBe('alice@example.com');
    expect(allowedAccount('CAROL@other.org')).toBe('carol@other.org');
    expect(allowedAccount('student@School.edu.vn')).toBe('student@school.edu.vn');
    expect(allowedAccount('x@lab.example')).toBe('x@lab.example');
  });

  it('rejects other emails, subdomains, look-alikes and malformed values', () => {
    for (const value of ['mallory@example.com', 'a@sub.school.edu.vn', 'a@school.edu.vn.evil.com', 'a@evilschool.edu.vn',
      'alice@example.com@evil.com', '@school.edu.vn', 'school.edu.vn', '', undefined, null, 42]) {
      expect(allowedAccount(value), String(value)).toBeUndefined();
    }
  });

  it('treats only the owner as administrator', () => {
    expect(isOwnerAccount('owner@example.com')).toBe(true);
    expect(isOwnerAccount('alice@example.com')).toBe(false);
    expect(isOwnerAccount(null)).toBe(false);
  });

  it('works with only a domain rule and without OWNER_EMAIL', async () => {
    vi.stubEnv('OWNER_EMAIL', '');
    vi.stubEnv('ALLOWED_EMAILS', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(accessConfigured()).toBe(true);
    expect(await authenticate(await request('student@school.edu.vn'))).toEqual({ account: 'student@school.edu.vn' });
    expect((await authenticate(await request('owner@example.com'))).denied?.status).toBe(401);
  });

  it('returns the signed-in account and re-checks the list on every request', async () => {
    const alice = await request('ALICE@example.com');
    expect(await authenticate(alice)).toEqual({ account: 'alice@example.com' });
    expect(await verifyAuthGuard(await request('mallory@example.com'))).not.toBeNull();
    vi.stubEnv('ALLOWED_EMAILS', 'bob@example.com');
    expect((await authenticate(alice)).denied?.status).toBe(401);
  });

  it('fails closed in production without any sign-in rule, and keeps unconfigured local development open', async () => {
    vi.stubEnv('OWNER_EMAIL', ''); vi.stubEnv('ALLOWED_EMAILS', ''); vi.stubEnv('ALLOWED_DOMAINS', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect((await authenticate(await request('owner@example.com'))).denied?.status).toBe(503);
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('AUTH_SECRET', '');
    expect(localAuthBypass()).toBe(true);
    expect(await authenticate(new Request('http://localhost/api/translate'))).toEqual({ account: null });
  });
});

describe('per-account browser database', () => {
  beforeEach(() => { vi.stubEnv('OWNER_EMAIL', 'owner@example.com'); resetDbInstance(); selectAccountDb(null); });
  afterEach(() => { vi.unstubAllEnvs(); resetDbInstance(); selectAccountDb(null); });

  it('keeps the original database for the owner and an opaque one per other account', () => {
    expect(localDataNamespace('owner@example.com')).toBeNull();
    expect(localDataNamespace(null)).toBeNull();
    const alice = localDataNamespace('alice@example.com');
    expect(alice).toMatch(/^[0-9a-f]{24}$/);
    expect(localDataNamespace('alice@example.com')).toBe(alice);
    expect(localDataNamespace('bob@example.com')).not.toBe(alice);
  });

  it('opens a separate IndexedDB per account so one browser never mixes recordings', async () => {
    expect(getDb().name).toBe(DEFAULT_DB_NAME);
    await getDb().settings.put({ key: 'who', value: 'owner' });

    selectAccountDb(localDataNamespace('alice@example.com'));
    expect(getDb().name).toBe(`${DEFAULT_DB_NAME}_${localDataNamespace('alice@example.com')}`);
    expect(await getDb().settings.get('who')).toBeUndefined();
    await getDb().settings.put({ key: 'who', value: 'alice' });

    selectAccountDb(null);
    expect((await getDb().settings.get('who'))?.value).toBe('owner');
  });
});
