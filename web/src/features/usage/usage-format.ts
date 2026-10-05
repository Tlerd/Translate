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
