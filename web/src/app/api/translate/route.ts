import { TranslateRequestSchema } from '@/shared/ai-contracts';
import { executeTranslation } from '@/server/ai/translate';
import { verifyAuthGuard, makeErrorResponse } from '@/server/http/guard';
import { checkRateLimit } from '@/server/http/rate-limit';

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

  const parsed = TranslateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return makeErrorResponse(
      400,
      'INTERNAL_ERROR',
      `Dữ liệu gửi lên không đúng định dạng: ${parsed.error.message}`
    );
  }

  const data = parsed.data;

  // Rate limit
  const rateLimitKey = `translate:${data.recordingId}`;
  const rateLimit = await checkRateLimit(rateLimitKey, 120, 60);
  if (!rateLimit.allowed) {
    return makeErrorResponse(
      429,
      'RATE_LIMIT_EXCEEDED',
      'Đã vượt quá giới hạn tần suất dịch live.',
      data.requestId,
      rateLimit.retryAfterMs
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = '';
      try {
        for await (const delta of executeTranslation(data)) {
          fullText += delta;
          const deltaMsg = `event: delta\ndata: ${JSON.stringify({ delta })}\n\n`;
          controller.enqueue(encoder.encode(deltaMsg));
        }

        const doneMsg = `event: done\ndata: ${JSON.stringify({ fullText, modelKey: data.modelKey })}\n\n`;
        controller.enqueue(encoder.encode(doneMsg));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errEvent = `event: error\ndata: ${JSON.stringify({ message: errorMsg })}\n\n`;
        controller.enqueue(encoder.encode(errEvent));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Request-Id': data.requestId,
    },
  });
}
