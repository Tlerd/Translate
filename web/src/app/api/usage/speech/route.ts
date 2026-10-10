import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuthGuard, makeErrorResponse } from '@/server/http/guard';
import { boundedJson, JsonRequestError } from '@/server/http/bounded-json';
import { parseUsageRangeQuery, usageRangeBounds } from '@/server/http/usage-range';
import { usageStoreEnabled, summarizeSpeechUsage, upsertSpeechUsage } from '@/server/cloud/speech-usage-store';
import { cloudRecordingIdSchema } from '@/shared/cloud-recording';
import { SPEECH_PROVIDER_IDS, SPEECH_USAGE_MAX_AUDIO_MS } from '@/shared/speech-pricing';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;

const SpeechUsageSchema = z
  .object({
    sessionId: z.string().uuid(),
    recordingId: cloudRecordingIdSchema,
    provider: z.enum(SPEECH_PROVIDER_IDS),
    model: z.string().min(1).max(120),
    translated: z.boolean(),
    audioMs: z.number().int().min(0).max(SPEECH_USAGE_MAX_AUDIO_MS),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export async function POST(req: Request): Promise<Response> {
  const guard = await verifyAuthGuard(req);
  if (guard) return guard;

  let body: unknown;
  try {
    body = await boundedJson(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof JsonRequestError) return makeErrorResponse(err.status, 'INTERNAL_ERROR', err.message);
    return makeErrorResponse(400, 'INTERNAL_ERROR', 'Request body không phải JSON hợp lệ.');
  }

  const parsed = SpeechUsageSchema.safeParse(body);
  if (!parsed.success) {
    return makeErrorResponse(
      400,
      'INTERNAL_ERROR',
      `Dữ liệu usage nhận giọng không hợp lệ: ${parsed.error.issues[0]?.message || 'Lỗi định dạng'}`
    );
  }

  if (!usageStoreEnabled()) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

  try {
    const d = parsed.data;
    await upsertSpeechUsage({
      sessionId: d.sessionId,
      recordingId: d.recordingId,
      provider: d.provider,
      model: d.model,
      translated: d.translated,
      audioMs: d.audioMs,
      startedAt: new Date(d.startedAt),
    });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return makeErrorResponse(500, 'INTERNAL_ERROR', `Không thể lưu usage nhận giọng: ${errorMsg}`);
  }
}

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
    const { from, toExclusive } = usageRangeBounds(parsed.data.from, parsed.data.to);
    const summary = await summarizeSpeechUsage({ from, toExclusive, recordingId: parsed.data.recordingId });
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return makeErrorResponse(500, 'INTERNAL_ERROR', `Không thể tổng hợp usage nhận giọng: ${errorMsg}`);
  }
}
