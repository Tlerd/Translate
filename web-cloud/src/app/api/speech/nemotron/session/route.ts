import { getServerEnv } from '@/config/env.server';
import { verifyAuthGuard, makeErrorResponse } from '@/server/http/guard';
import { boundedJson, JsonRequestError } from '@/server/http/bounded-json';
import { publicOrigin } from '@/server/http/public-origin';
import { inputLanguage } from '@/shared/languages';
import { NEMOTRON_MODEL } from '@/shared/nemotron';
import { createNemotronTicket } from '../../../../../../scripts/lib/nemotron-ticket.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const guard = await verifyAuthGuard(req);
  if (guard) return guard;
  let body: unknown;
  try { body = await boundedJson(req, 2048); }
  catch (error) {
    return makeErrorResponse(error instanceof JsonRequestError ? error.status : 400, 'INTERNAL_ERROR', 'Yêu cầu nhận giọng không hợp lệ.');
  }
  if (!body || typeof body !== 'object') return makeErrorResponse(400, 'INTERNAL_ERROR', 'Thiếu cấu hình nhận giọng.');
  const options = body as Record<string, unknown>;
  const language = typeof options.languageCode === 'string' ? inputLanguage(options.languageCode, 'nemotron') : null;
  if (!language) return makeErrorResponse(400, 'UNSUPPORTED_MODEL', 'Nemotron chưa hỗ trợ ngôn ngữ đầu vào này.');
  const pauseMs = options.pauseMs ?? 900;
  if (typeof pauseMs !== 'number' || !Number.isInteger(pauseMs) || pauseMs < 600 || pauseMs > 10_000) {
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Khoảng nghỉ nhận giọng phải từ 600 đến 10.000 ms.');
  }
  const env = getServerEnv();
  if (!env.NEMOTRON_BASE_URL || !env.NEMOTRON_WEBSOCKET_URL || !env.NEMOTRON_GATEWAY_SECRET || env.NEMOTRON_GATEWAY_SECRET.length < 32) {
    return makeErrorResponse(503, 'MISSING_CONFIG', 'Máy chủ Nemotron chưa được cấu hình.');
  }
  let base: URL; let socket: URL;
  try {
    base = new URL(env.NEMOTRON_BASE_URL); socket = new URL(env.NEMOTRON_WEBSOCKET_URL);
    if (!['http:', 'https:'].includes(base.protocol) || !['ws:', 'wss:'].includes(socket.protocol) ||
        base.username || base.password || base.search || base.hash || socket.username || socket.password || socket.search || socket.hash) throw new Error('Invalid URLs');
    if (new URL(publicOrigin(req)).protocol === 'https:' && socket.protocol !== 'wss:') throw new Error('WSS is required');
  } catch { return makeErrorResponse(503, 'MISSING_CONFIG', 'Địa chỉ máy chủ Nemotron chưa hợp lệ hoặc chưa hỗ trợ kết nối bảo mật.'); }
  try {
    const ready = await fetch(new URL('/ready', base), {
      headers: env.NEMOTRON_API_KEY ? { Authorization: `Bearer ${env.NEMOTRON_API_KEY}` } : {},
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(5000)]), cache: 'no-store', redirect: 'error',
    });
    const status = await ready.json() as { ready?: boolean; capabilities?: string[] };
    if (!ready.ok || status.ready !== true || !status.capabilities?.includes('asr')) throw new Error('ASR not ready');
  } catch { return makeErrorResponse(503, 'INTERNAL_ERROR', 'Máy chủ Nemotron chưa sẵn sàng. Kiểm tra tiến trình nhận giọng rồi thử lại.'); }
  const ticket = createNemotronTicket(env.NEMOTRON_GATEWAY_SECRET, {
    origin: publicOrigin(req), language, endpointingMs: pauseMs,
  });
  return Response.json({ ...ticket, model: NEMOTRON_MODEL, websocketUrl: socket.toString(), sessionLimitMs: 600_000 }, { headers: { 'Cache-Control': 'no-store' } });
}
