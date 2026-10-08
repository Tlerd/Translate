export const SONIOX_MODEL = 'stt-rt-v5';
export const SONIOX_WEBSOCKET_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
// Soniox transcribes and translates between any pair of its 60+ languages. Codes are
// its bare ISO codes; ja-JP and vi-VN keep their region so saved settings still match.
export const SONIOX_LOCALES = [
  'ja-JP', 'vi-VN', ...`af sq ar az eu be bn bs bg ca zh hr cs da nl en et fi fr gl de el gu he hi hu id it kn kk ko lv lt mk ms ml mr no fa pl pt pa ro ru sr sk sl es sw sv tl ta te th tr uk ur cy`.split(' '),
];
const SONIOX_BASE_CODES = new Set(SONIOX_LOCALES.map((code) => code.split('-')[0]));
// Google catalogue codes whose Soniox spelling differs.
const SONIOX_ALIASES: Record<string, string> = { cmn: 'zh', nb: 'no', fil: 'tl' };
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

export function sonioxLanguage(code: string): string | null {
  const base = code.split('-')[0].toLowerCase();
  const mapped = SONIOX_ALIASES[base] ?? base;
  return SONIOX_BASE_CODES.has(mapped) ? mapped : null;
}

export type SonioxTranslationConfig =
  | { type: 'two_way'; language_a: string; language_b: string }
  | { type: 'one_way'; target_language: string };

/** two_way when both languages are known, one_way when the source is auto-detected. */
export function sonioxTranslationPair(sourceCode: string, targetCode?: string): SonioxTranslationConfig | null {
  const tgt = targetCode ? sonioxLanguage(targetCode) : null;
  if (!tgt) return null;
  if (sourceCode === 'auto') return { type: 'one_way', target_language: tgt };
  const src = sonioxLanguage(sourceCode);
  if (!src || src === tgt) return null;
  return { type: 'two_way', language_a: src, language_b: tgt };
}

/** Soniox speaker ids ("1", "2", …) become the app's spk_N labels, clamped to the configured count. */
export function sonioxSpeakerLabel(speaker: string | number | undefined, speakerCount: number): string | undefined {
  if (speakerCount < 2 || speaker === undefined) return undefined;
  const id = Number(speaker);
  if (!Number.isInteger(id) || id < 1) return undefined;
  return `spk_${Math.min(id, speakerCount, 8)}`;
}

export function sonioxErrorRetryable(type: string | undefined, status: number): boolean {
  if (type === 'temp_api_key_session_expired' || type === 'max_duration_reached') return true;
  if (type && /^(unauthenticated|permission_denied|invalid_request|model_not_available|organization_balance_exhausted|organization_monthly_budget_exhausted|project_monthly_budget_exhausted)$/.test(type)) return false;
  return status === 408 || status === 429 || status >= 500 || status === 0;
}

export function canRetrySpeech(error: unknown): boolean {
  return !(error instanceof SonioxSpeechError) || error.retryable;
}
