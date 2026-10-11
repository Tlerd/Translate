import 'server-only';
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getServerEnv } from '@/config/env.server';
import { accessConfigured, allowedAccount, secureAuthCookies } from '@/server/auth-policy';
import type { ApiErrorResponse } from '@/shared/ai-contracts';

export function makeErrorResponse(
  status: number,
  code: ApiErrorResponse['error']['code'],
  message: string,
  requestId?: string,
  retryAfterMs?: number
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        requestId,
        retryAfterMs,
      },
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

export type AuthResult =
  | { account: string | null; denied?: undefined }
  | { account?: undefined; denied: NextResponse<ApiErrorResponse> };

/**
 * Verify the Auth.js encrypted session token and return the signed-in account
 * when it is still allowed (owner, ALLOWED_EMAILS or ALLOWED_DOMAINS). The
 * allowlist is re-checked on every request, so removing an email revokes it
 * without waiting for the session to expire. A local, unconfigured development
 * server stays usable with `account: null`.
 */
export async function authenticate(req: Request): Promise<AuthResult> {
  const env = getServerEnv();
  const production = process.env.NODE_ENV === 'production';
  const configured = accessConfigured();

  if (!production && !env.AUTH_SECRET && !configured) return { account: null };

  // Both values are required to establish a trust boundary. This also makes
  // production fail closed when deployment configuration is absent.
  if (!env.AUTH_SECRET || !configured) {
    return { denied: makeErrorResponse(503, 'UNAUTHORIZED', 'Chưa cấu hình xác thực tài khoản ứng dụng.') };
  }

  try {
    const token = await getToken({
      req,
      secret: env.AUTH_SECRET,
      secureCookie: secureAuthCookies(req.url, req.headers),
    });
    const account = allowedAccount(token?.email);
    if (account) return { account };
  } catch {
    // Treat malformed or undecryptable cookies as unauthenticated.
  }

  return { denied: makeErrorResponse(401, 'UNAUTHORIZED', 'Yêu cầu đăng nhập bằng tài khoản được cấp quyền.') };
}

export async function verifyAuthGuard(
  req: Request
): Promise<NextResponse<ApiErrorResponse> | null> {
  return (await authenticate(req)).denied ?? null;
}

/** Key for per-account rate limits and locks; local development shares one key. */
export function accountKey(account: string | null): string {
  return account ?? 'local';
}
