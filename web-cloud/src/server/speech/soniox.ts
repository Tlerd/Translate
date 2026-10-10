import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ApiErrorDetail } from '@/shared/ai-contracts';
import { SONIOX_KEY_TTL_SECONDS, SONIOX_MODEL, SONIOX_RENEW_AFTER_MS, SONIOX_SESSION_LIMIT_MS, SONIOX_WEBSOCKET_URL, SonioxSpeechError, sonioxErrorRetryable, type SonioxSession } from '@/shared/soniox';

export class SonioxProviderError extends SonioxSpeechError {
  constructor(public readonly status: number, public readonly code: ApiErrorDetail['code'], message: string, retryable: boolean, providerErrorType?: string, public readonly requestId?: string) {
    super(message, retryable, providerErrorType);
  }
}

export function sonioxErrorResponse(status: number, code: ApiErrorDetail['code'], message: string, retryable = false, extra: { providerErrorType?: string; requestId?: string; retryAfterMs?: number } = {}): Response {
  return Response.json({ error: { code, message, retryable, ...extra } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function createSonioxSession(apiKey: string, signal: AbortSignal, recordingId?: string): Promise<SonioxSession> {
  try {
    const response = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: SONIOX_KEY_TTL_SECONDS, single_use: true, max_session_duration_seconds: SONIOX_SESSION_LIMIT_MS / 1000, client_reference_id: `lesson:${recordingId ?? randomUUID()}` }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      cache: 'no-store', redirect: 'error',
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const type = typeof payload.error_type === 'string' && /^[a-z_]{1,80}$/.test(payload.error_type) ? payload.error_type : undefined;
      const requestId = typeof payload.request_id === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(payload.request_id) ? payload.request_id : undefined;
      const rateLimited = response.status === 429;
      throw new SonioxProviderError(rateLimited ? 429 : 502, rateLimited ? 'RATE_LIMIT_EXCEEDED' : 'UPSTREAM_ERROR',
        rateLimited ? 'Soniox đang giới hạn số lượt kết nối. Hãy thử lại sau.' : 'Soniox chưa chấp nhận phiên nhận giọng. Kiểm tra API key, quyền STT và số dư trong Soniox Console.',
        sonioxErrorRetryable(type, response.status), type, requestId);
    }
    if (typeof payload.api_key !== 'string' || !payload.api_key.trim() || payload.api_key === apiKey || typeof payload.expires_at !== 'string' || !Number.isFinite(Date.parse(payload.expires_at)) || Date.parse(payload.expires_at) <= Date.now()) {
      throw new SonioxProviderError(502, 'UPSTREAM_ERROR', 'Soniox trả về khóa tạm không hợp lệ.', false, 'invalid_response');
    }
    return { token: payload.api_key, expiresAt: payload.expires_at, model: SONIOX_MODEL, websocketUrl: SONIOX_WEBSOCKET_URL, sessionLimitMs: SONIOX_SESSION_LIMIT_MS, renewAfterMs: SONIOX_RENEW_AFTER_MS };
  } catch (error) {
    if (error instanceof SonioxProviderError) throw error;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new SonioxProviderError(504, 'TIMEOUT', 'Hết thời gian chờ cấp phiên Soniox.', true);
    }
    throw new SonioxProviderError(502, 'UPSTREAM_ERROR', 'Không kết nối được Soniox. Audio vẫn được lưu trên máy.', true);
  }
}
