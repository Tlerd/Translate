import 'server-only';
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getServerEnv } from '@/config/env.server';
import { secureAuthCookies } from '@/server/auth-policy';
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

/**
 * Verify the Auth.js encrypted session token and ensure it belongs to the
 * configured owner. A local, unconfigured development server remains usable.
 */
export async function verifyAuthGuard(
  req: Request
): Promise<NextResponse<ApiErrorResponse> | null> {
  const env = getServerEnv();
  const production = process.env.NODE_ENV === 'production';
  const authConfigured = Boolean(env.AUTH_SECRET || env.OWNER_EMAIL);

  if (!production && !authConfigured) return null;

  // Both values are required to establish an owner-only trust boundary. This
  // also makes production fail closed when deployment configuration is absent.
  if (!env.AUTH_SECRET || !env.OWNER_EMAIL) {
    return makeErrorResponse(
      503,
      'UNAUTHORIZED',
      'Chưa cấu hình xác thực tài khoản chủ ứng dụng.'
    );
  }

  try {
    const token = await getToken({
      req,
      secret: env.AUTH_SECRET,
      secureCookie: secureAuthCookies(req.url, req.headers),
    });
    const email = typeof token?.email === 'string' ? token.email.trim().toLowerCase() : '';
    if (email && email === env.OWNER_EMAIL.trim().toLowerCase()) return null;
  } catch {
    // Treat malformed or undecryptable cookies as unauthenticated.
  }

  return makeErrorResponse(
    401,
    'UNAUTHORIZED',
    'Yêu cầu xác thực tài khoản chủ ứng dụng.'
  );
}
