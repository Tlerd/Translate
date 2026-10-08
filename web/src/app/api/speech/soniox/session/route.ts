import { z } from 'zod';
import { getServerEnv } from '@/config/env.server';
import { verifyAuthGuard } from '@/server/http/guard';
import { boundedJson, JsonRequestError } from '@/server/http/bounded-json';
import { checkRateLimit } from '@/server/http/rate-limit';
import { createSonioxSession, SonioxProviderError, sonioxErrorResponse } from '@/server/speech/soniox';
import { inputLanguage } from '@/shared/languages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ languageCode: z.string().max(24), recordingId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional() }).strict();

export async function POST(req: Request): Promise<Response> {
  const guard = await verifyAuthGuard(req);
  if (guard) { guard.headers.set('Cache-Control', 'no-store'); return guard; }
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return sonioxErrorResponse(403, 'UNAUTHORIZED', 'Nguồn yêu cầu cấp phiên không hợp lệ.');
  let parsed: z.infer<typeof schema>;
  try {
    const result = schema.safeParse(await boundedJson(req, 2048));
    if (!result.success || !inputLanguage(result.data.languageCode, 'soniox')) return sonioxErrorResponse(400, 'UNSUPPORTED_MODEL', 'Soniox chưa hỗ trợ ngôn ngữ này.');
    parsed = result.data;
  } catch (error) {
    return sonioxErrorResponse(error instanceof JsonRequestError ? error.status : 400, error instanceof JsonRequestError && error.status === 413 ? 'INPUT_TOO_LARGE' : 'INTERNAL_ERROR', 'Yêu cầu cấp phiên Soniox không hợp lệ.');
  }
  const limit = await checkRateLimit('speech:soniox:owner', 10, 60);
  if (!limit.allowed) return sonioxErrorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Quá nhiều lượt cấp phiên Soniox. Hãy chờ rồi thử lại.', true, { retryAfterMs: limit.retryAfterMs });
  const key = getServerEnv().SONIOX_API_KEY;
  if (!key) return sonioxErrorResponse(503, 'MISSING_CONFIG', 'Chưa cấu hình SONIOX_API_KEY ở server.');
  try {
    const session = await createSonioxSession(key, req.signal, parsed.recordingId);
    return Response.json(session, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SonioxProviderError) return sonioxErrorResponse(error.status, error.code, error.message, error.retryable, { providerErrorType: error.providerErrorType, requestId: error.requestId });
    return sonioxErrorResponse(502, 'UPSTREAM_ERROR', 'Chưa cấp được phiên Soniox.', true);
  }
}
