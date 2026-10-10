import { NextResponse } from 'next/server';
import { verifyAuthGuard, makeErrorResponse } from '@/server/http/guard';
import { parseUsageRangeQuery, usageRangeBounds } from '@/server/http/usage-range';
import { usageStoreEnabled, summarizeTranslationUsage } from '@/server/cloud/translation-usage-store';

export const dynamic = 'force-dynamic';

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

  const parsed = parseUsageRangeQuery(new URL(req.url));
  if (!parsed.success) {
    return makeErrorResponse(
      400,
      'INTERNAL_ERROR',
      `Tham số không hợp lệ: ${parsed.error.issues[0]?.message || 'Lỗi định dạng'}`
    );
  }

  try {
    const { from: fromDate, toExclusive: toDateExclusive } = usageRangeBounds(parsed.data.from, parsed.data.to);

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
