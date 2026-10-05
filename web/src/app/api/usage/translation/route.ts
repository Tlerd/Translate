import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuthGuard, makeErrorResponse } from '@/server/http/guard';
import { usageStoreEnabled, summarizeTranslationUsage } from '@/server/cloud/translation-usage-store';

export const dynamic = 'force-dynamic';

const QuerySchema = z
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

export async function GET(req: Request): Promise<Response> {
  const guard = await verifyAuthGuard(req);
  if (guard) return guard;

  if (!usageStoreEnabled()) {
    return makeErrorResponse(
      503,
      'MISSING_CONFIG',
      'Chưa cấu hình cơ sở dữ liệu lưu trữ usage hoặc tính năng đã bị tắt.'
    );
  }

  const url = new URL(req.url);
  const rawParams = {
    from: url.searchParams.get('from') ?? '',
    to: url.searchParams.get('to') ?? '',
    recordingId: url.searchParams.get('recordingId') || undefined,
  };

  const parsed = QuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return makeErrorResponse(
      400,
      'INTERNAL_ERROR',
      `Tham số không hợp lệ: ${parsed.error.issues[0]?.message || 'Lỗi định dạng'}`
    );
  }

  try {
    const fromDate = new Date(`${parsed.data.from}T00:00:00.000+07:00`);
    const [toYear, toMonth, toDay] = parsed.data.to.split('-').map(Number);
    const nextDayUtc = new Date(Date.UTC(toYear, toMonth - 1, toDay + 1));
    const nextDayStr = `${nextDayUtc.getUTCFullYear()}-${String(nextDayUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDayUtc.getUTCDate()).padStart(2, '0')}`;
    const toDateExclusive = new Date(`${nextDayStr}T00:00:00.000+07:00`);

    const summary = await summarizeTranslationUsage({
      from: fromDate,
      toExclusive: toDateExclusive,
      recordingId: parsed.data.recordingId,
      tz: 'Asia/Ho_Chi_Minh',
    });

    return NextResponse.json(summary, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return makeErrorResponse(
      500,
      'INTERNAL_ERROR',
      `Không thể tổng hợp usage: ${errorMsg}`
    );
  }
}
