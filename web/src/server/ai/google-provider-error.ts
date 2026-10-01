import { makeErrorResponse } from '@/server/http/guard';

interface SafeProviderFailure {
  status?: number;
  code?: string;
}

function safeProviderFailure(error: unknown): SafeProviderFailure {
  if (!error || typeof error !== 'object') return {};
  const record = error as Record<string, unknown>;
  let status: number | undefined;
  for (const candidate of [record.status, record.statusCode, record.httpStatus]) {
    if (typeof candidate === 'number' && candidate >= 100 && candidate <= 599) {
      status = candidate;
      break;
    }
  }
  if (!status && typeof record.message === 'string') {
    status = /\b(401|403|404|429)\b/.exec(record.message)?.[1]
      ? Number(/\b(401|403|404|429)\b/.exec(record.message)![1])
      : undefined;
  }
  const rawCode = record.code;
  const code = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(rawCode)
    ? rawCode
    : typeof rawCode === 'number' && Number.isInteger(rawCode)
      ? String(rawCode)
      : undefined;
  return { status, code };
}

function modelUnavailable(error: unknown, failure: SafeProviderFailure): boolean {
  if (failure.status === 404 || failure.code === 'NOT_FOUND' || failure.code === '404') return true;
  if (!error || typeof error !== 'object') return false;
  const message = (error as Record<string, unknown>).message;
  return typeof message === 'string' && /model.{0,80}(not found|unsupported|not available|does not exist)/i.test(message);
}

/** Log only provider status/code; never include request, response, or credentials. */
export function logGoogleProviderFailure(operation: string, error: unknown): SafeProviderFailure {
  const safe = safeProviderFailure(error);
  console.error(`[${operation}] Google API call failed`, safe);
  return safe;
}

export function googleProviderErrorResponse(
  operation: string,
  error: unknown,
  timedOut = false
): Response {
  const safe = logGoogleProviderFailure(operation, error);
  if (timedOut) {
    return makeErrorResponse(504, 'TIMEOUT', 'Google nhận dạng audio quá thời gian cho phép.');
  }
  if (safe.status === 401) {
    return makeErrorResponse(502, 'UPSTREAM_ERROR', 'Google từ chối GOOGLE_API_KEY (HTTP 401).');
  }
  if (safe.status === 403) {
    return makeErrorResponse(502, 'UPSTREAM_ERROR', 'Google từ chối quyền dùng API này (HTTP 403).');
  }
  if (safe.status === 429) {
    return makeErrorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Google đã giới hạn quota nhận dạng audio.');
  }
  if (modelUnavailable(error, safe)) {
    return makeErrorResponse(502, 'UNSUPPORTED_MODEL', 'Model Gemini transcription không khả dụng cho API key này.');
  }
  return makeErrorResponse(502, 'UPSTREAM_ERROR', 'Google không thể xử lý yêu cầu nhận dạng audio.');
}
