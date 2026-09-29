import { GenerateImageRequestSchema } from '@/shared/ai-contracts';
import { executeGenerateImage } from '@/server/ai/generate-image';
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

  const parsed = GenerateImageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return makeErrorResponse(
      400,
      'INTERNAL_ERROR',
      `Dữ liệu gửi lên không đúng định dạng: ${parsed.error.message}`
    );
  }

  const data = parsed.data;

  // Rate limit
  const rateLimit = await checkRateLimit(`img:${data.recordingId}`, 5, 60);
  if (!rateLimit.allowed) {
    return makeErrorResponse(
      429,
      'RATE_LIMIT_EXCEEDED',
      'Đã vượt quá giới hạn tần suất yêu cầu tạo ảnh.',
      data.requestId,
      rateLimit.retryAfterMs
    );
  }

  // Idempotency lock
  const lockKey = `img:${data.recordingId}:${data.requestId}`;
  const acquired = await acquireIdempotencyLock(lockKey, 900);
  if (!acquired) {
    return makeErrorResponse(
      409,
      'CONFLICT',
      'Yêu cầu tạo ảnh này đang được xử lý hoặc đã hoàn tất.',
      data.requestId
    );
  }

  try {
    const result = await executeGenerateImage(data);
    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Cache-Control': 'no-store',
        'X-Request-Id': data.requestId,
        'X-Model-Key': result.modelKey,
        'X-Source-Hash': data.sourceHash,
        'X-Summary-Hash': data.summaryHash,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code === 'MISSING_CONFIG' ? 'MISSING_CONFIG' : 'UPSTREAM_ERROR';
    const status = code === 'MISSING_CONFIG' ? 400 : 500;
    return makeErrorResponse(status, code, msg, data.requestId);
  }
}
