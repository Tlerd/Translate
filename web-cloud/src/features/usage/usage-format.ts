import type { SpeechUsageSummary, UsageSummary } from '@/shared/usage';

export type UsagePreset = 'today' | '7days' | '30days';

export function getSaigonDateParts(d: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(d);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return { year, month, day };
}

export function formatSaigonDate(d: Date): string {
  const { year, month, day } = getSaigonDateParts(d);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function rangePreset(
  preset: UsagePreset,
  now: Date = new Date()
): { from: string; to: string } {
  const { year, month, day } = getSaigonDateParts(now);
  const toStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  if (preset === 'today') {
    return { from: toStr, to: toStr };
  }

  const daysOffset = preset === '7days' ? 6 : 29;
  const fromDate = new Date(Date.UTC(year, month - 1, day - daysOffset));
  const fromStr = `${fromDate.getUTCFullYear()}-${String(fromDate.getUTCMonth() + 1).padStart(2, '0')}-${String(fromDate.getUTCDate()).padStart(2, '0')}`;

  return { from: fromStr, to: toStr };
}

export function formatTokens(count: number | null | undefined): string {
  if (count === null || count === undefined) return '0';
  return count.toLocaleString('vi-VN');
}

export function formatUsd(val: number | null | undefined): string {
  if (val === null || val === undefined) return 'Chưa rõ';
  if (val === 0) return '$0.00';
  if (val < 0.01) {
    return `$${val.toFixed(4)}`;
  }
  return `$${val.toFixed(2)}`;
}

/** m:ss, or h:mm:ss from one hour (or always, with `forceHours`). */
export function formatClock(ms: number | null | undefined, forceHours = false): string {
  const totalSeconds = Math.max(0, Math.round((ms ?? 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0 || forceHours) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

/** "12 phút 30 giây", "1 giờ 5 phút 3 giây", "45 giây". */
export function formatDurationVi(ms: number | null | undefined): string {
  const totalSeconds = Math.max(0, Math.round((ms ?? 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} giờ ${minutes} phút ${seconds} giây`;
  if (minutes > 0) return `${minutes} phút ${seconds} giây`;
  return `${seconds} giây`;
}

export function formatUsdPerMinute(val: number): string {
  return val === 0 ? '$0.00' : `$${val.toFixed(4)}`;
}

/** Translation cost can be unknown (null); the combined total then only covers speech. */
export function combineEstimatedUsd(
  translationUsd: number | null | undefined,
  speechUsd: number | null | undefined
): { usd: number; partial: boolean } {
  const partial = translationUsd == null;
  return { usd: Math.round(((translationUsd ?? 0) + (speechUsd ?? 0)) * 1e6) / 1e6, partial };
}

/** One line for the recording detail header, e.g. "Nhận giọng 12:34 · ~$0.11 · Dịch 40 request · ~$0.02". */
export function recordingCostText(
  translation: Pick<UsageSummary, 'totals'> | null | undefined,
  speech: Pick<SpeechUsageSummary, 'totals'> | null | undefined
): string | null {
  const parts: string[] = [];
  if (speech && speech.totals.sessions > 0) {
    parts.push(`Nhận giọng ${formatClock(speech.totals.audioMs)} · ~${formatUsd(speech.totals.estimatedUsd)}`);
  }
  if (translation && translation.totals.requests > 0) {
    const usd = translation.totals.estimatedUsd != null ? `~${formatUsd(translation.totals.estimatedUsd)}` : 'Chưa rõ';
    parts.push(`Dịch ${translation.totals.requests} request · ${usd}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
