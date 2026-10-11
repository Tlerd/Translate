import 'server-only';
import { isOwnerAccount } from '@/server/auth-policy';
import { accountSpeechAudioMs } from '@/server/cloud/speech-usage-store';
import { usageStoreEnabled, type UsageScope } from '@/server/cloud/translation-usage-store';
import { makeErrorResponse } from '@/server/http/guard';

/** The owner (and an unconfigured local server) sees every account's usage; others see only their own. */
export function usageScope(account: string | null): UsageScope {
  return !account || isOwnerAccount(account) ? { all: true } : { all: false, owner: account };
}

/** USER_DAILY_SPEECH_MINUTES: speech minutes each non-owner account may use per Asia/Ho_Chi_Minh day. */
export function dailySpeechLimitMinutes(): number | null {
  const raw = process.env.USER_DAILY_SPEECH_MINUTES?.trim();
  if (!raw) return null;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

export function startOfSaigonDay(now: Date): Date {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${day}T00:00:00.000+07:00`);
}

/**
 * Refuses a new speech session once the account used up today's minutes. The
 * count comes from the usage the browser reports, so it is a soft limit
 * against accidental overuse. It needs the usage database; without one, or
 * when the database errors, speech stays available.
 */
export async function speechLimitResponse(account: string | null, now = new Date()): Promise<Response | null> {
  const minutes = dailySpeechLimitMinutes();
  if (minutes === null || !account || isOwnerAccount(account) || !usageStoreEnabled()) return null;
  let usedMs: number;
  try {
    usedMs = await accountSpeechAudioMs(account, startOfSaigonDay(now));
  } catch (error) {
    console.warn('[speech-limit] usage lookup failed', error instanceof Error ? error.message : String(error));
    return null;
  }
  if (usedMs < minutes * 60_000) return null;
  const response = makeErrorResponse(429, 'RATE_LIMIT_EXCEEDED', `Bạn đã dùng hết ${minutes} phút nhận giọng của hôm nay. Hạn mức được làm mới lúc 0 giờ (giờ Việt Nam).`);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
