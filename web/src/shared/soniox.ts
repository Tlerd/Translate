export const SONIOX_MODEL = 'stt-rt-v5';
export const SONIOX_WEBSOCKET_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
export const SONIOX_LOCALES = ['ja-JP', 'vi-VN'];
export const SONIOX_KEY_TTL_SECONDS = 120;
export const SONIOX_SESSION_LIMIT_MS = 60 * 60_000;
export const SONIOX_RENEW_AFTER_MS = 55 * 60_000;

export interface SonioxSession {
  token: string;
  expiresAt: string;
  model: typeof SONIOX_MODEL;
  websocketUrl: typeof SONIOX_WEBSOCKET_URL;
  sessionLimitMs: number;
  renewAfterMs: number;
}

export class SonioxSpeechError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly providerErrorType?: string) {
    super(message);
    this.name = 'SonioxSpeechError';
  }
}

export function sonioxLanguage(code: string): 'ja' | 'vi' | null {
  if (code === 'ja' || code === 'ja-JP') return 'ja';
  if (code === 'vi' || code === 'vi-VN') return 'vi';
  return null;
}

export function sonioxErrorRetryable(type: string | undefined, status: number): boolean {
  if (type === 'temp_api_key_session_expired' || type === 'max_duration_reached') return true;
  if (type && /^(unauthenticated|permission_denied|invalid_request|model_not_available|organization_balance_exhausted|organization_monthly_budget_exhausted|project_monthly_budget_exhausted)$/.test(type)) return false;
  return status === 408 || status === 429 || status >= 500 || status === 0;
}

export function canRetrySpeech(error: unknown): boolean {
  return !(error instanceof SonioxSpeechError) || error.retryable;
}
