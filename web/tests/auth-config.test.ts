import { afterEach, expect, it, vi } from 'vitest';
import { encode } from 'next-auth/jwt';
import { verifyAuthGuard } from '@/server/http/guard';

afterEach(() => vi.unstubAllEnvs());
it('accepts the secure cookie issued by Auth.js on HTTPS even outside production', async () => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_SECRET', 'fixture-secret-with-at-least-thirty-two-characters'); vi.stubEnv('OWNER_EMAIL', 'owner@example.com');
  const name = '__Secure-authjs.session-token';
  const token = await encode({ secret: process.env.AUTH_SECRET!, salt: name, token: { email: 'owner@example.com' } });
  expect(await verifyAuthGuard(new Request('https://localhost/api/recordings/sync', { headers: { cookie: `${name}=${token}` } }))).toBeNull();
});
