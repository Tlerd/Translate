import { NextResponse } from 'next/server';
import { SummarizeRequestSchema } from '@/shared/ai-contracts';
import { executeSummarize } from '@/server/ai/summarize';
import { verifyAuthGuard, makeErrorResponse } from '@/server/http/guard';
import { checkRateLimit, acquireIdempotencyLock } from '@/server/http/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const guard = await verifyAuthGuard(req);
  if (guard) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Request body không phải JSON hợp lệ.');
  }

  const parsed = SummarizeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return makeErrorResponse(
      400,
      'INTERNAL_ERROR',
      `Dữ liệu gửi lên không đúng định dạng: ${parsed.error.message}`
    );
  }

  const data = parsed.data;

  // Rate limit
  const rateLimit = await checkRateLimit(`sum:${data.recordingId}`, 10, 60);
  if (!rateLimit.allowed) {
    return makeErrorResponse(
      429,
      'RATE_LIMIT_EXCEEDED',
      'Đã vượt quá giới hạn tần suất yêu cầu tóm tắt.',
      data.requestId,
      rateLimit.retryAfterMs
    );
  }

  // Idempotency lock: prevent double-clicks
  const lockKey = `sum:${data.recordingId}:${data.requestId}`;
  const acquired = await acquireIdempotencyLock(lockKey, 900);
  if (!acquired) {
    return makeErrorResponse(
      409,
      'CONFLICT',
      'Yêu cầu tóm tắt này đang được xử lý hoặc đã hoàn tất.',
      data.requestId
    );
  }

  try {
    const summary = await executeSummarize(data);
    return NextResponse.json(summary, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': data.requestId,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code === 'INPUT_TOO_LARGE' ? 'INPUT_TOO_LARGE' : 'UPSTREAM_ERROR';
    const status = code === 'INPUT_TOO_LARGE' ? 413 : 500;
    return makeErrorResponse(status, code, msg, data.requestId);
  }
}
