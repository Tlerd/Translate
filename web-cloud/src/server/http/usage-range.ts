import 'server-only';
import { z } from 'zod';

/** from/to are Asia/Ho_Chi_Minh calendar dates, at most 92 days apart. */
export const UsageRangeQuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from phải có định dạng YYYY-MM-DD'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to phải có định dạng YYYY-MM-DD'),
    recordingId: z.string().optional(),
  })
  .refine(
    (data) => {
      const fromDate = new Date(`${data.from}T00:00:00.000+07:00`);
      const toDate = new Date(`${data.to}T23:59:59.999+07:00`);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return false;
      if (fromDate.getTime() > toDate.getTime()) return false;
      const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays <= 92;
    },
    {
      message: 'Khoảng thời gian không hợp lệ hoặc vượt quá 92 ngày.',
    }
  );

export function parseUsageRangeQuery(url: URL) {
  return UsageRangeQuerySchema.safeParse({
    from: url.searchParams.get('from') ?? '',
    to: url.searchParams.get('to') ?? '',
    recordingId: url.searchParams.get('recordingId') || undefined,
  });
}

/** Inclusive start and exclusive end instants for the Saigon calendar dates. */
export function usageRangeBounds(from: string, to: string): { from: Date; toExclusive: Date } {
  const fromDate = new Date(`${from}T00:00:00.000+07:00`);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const nextDayUtc = new Date(Date.UTC(toYear, toMonth - 1, toDay + 1));
  const nextDayStr = `${nextDayUtc.getUTCFullYear()}-${String(nextDayUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDayUtc.getUTCDate()).padStart(2, '0')}`;
  return { from: fromDate, toExclusive: new Date(`${nextDayStr}T00:00:00.000+07:00`) };
}
