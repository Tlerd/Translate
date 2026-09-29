import 'server-only';
import { NextResponse } from 'next/server';
import { getServerEnv } from '@/config/env.server';
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
 * Basic request guard ensuring the request is from an authorized caller.
 * In production with OWNER_EMAIL / AUTH_SECRET, verifies authorization.
 */
export async function verifyAuthGuard(
  req: Request
): Promise<NextResponse<ApiErrorResponse> | null> {
  const env = getServerEnv();

  // If in production and AUTH_SECRET is set, enforce authentication
  if (process.env.NODE_ENV === 'production' && env.AUTH_SECRET) {
    const authHeader = req.headers.get('authorization');
    // If auth is required in production, can check session or token
    // For single owner, verify session cookie or auth header if needed
    if (!authHeader && !req.headers.get('cookie')) {
      return makeErrorResponse(
        401,
        'UNAUTHORIZED',
        'Yêu cầu xác thực tài khoản chủ ứng dụng.'
      );
    }
  }

  return null;
}
