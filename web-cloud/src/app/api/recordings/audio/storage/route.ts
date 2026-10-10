import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuthGuard } from '@/server/http/guard';
import { ownerEmail } from '@/server/auth-policy';
import { AudioRequestError, requireAudioStorage } from '@/server/cloud/audio-service';
import { cleanupOrphanAudio, scanAudioStorage } from '@/server/cloud/audio-storage-report';
import { boundedJson, JsonRequestError } from '@/server/http/bounded-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store' };
const cleanupSchema = z.object({ confirm: z.literal(true) }).strict();
function errorResponse(error: unknown, fallback: string) {
  const known = error instanceof AudioRequestError || error instanceof JsonRequestError;
  return NextResponse.json({ error: known ? error.message : fallback }, { status: known ? error.status : 503, headers });
}
async function account(req: Request): Promise<string | Response> {
  const denied = await verifyAuthGuard(req); if (denied) return denied;
  return ownerEmail() ?? NextResponse.json({ error: 'Chưa cấu hình tài khoản cloud.' }, { status: 503, headers });
}
export async function GET(req: Request) {
  const owner = await account(req); if (typeof owner !== 'string') return owner;
  try {
    requireAudioStorage();
    return NextResponse.json(await scanAudioStorage(), { headers });
  } catch (error) { return errorResponse(error, 'Không kiểm tra được dung lượng audio trên cloud. Thử lại sau.'); }
}
export async function POST(req: Request) {
  const owner = await account(req); if (typeof owner !== 'string') return owner;
  try {
    const body = cleanupSchema.safeParse(await boundedJson(req, 1024));
    if (!body.success) throw new AudioRequestError(400, 'Cần xác nhận trước khi dọn audio mồ côi.');
    requireAudioStorage();
    return NextResponse.json(await cleanupOrphanAudio(), { headers });
  } catch (error) { return errorResponse(error, 'Không dọn được audio mồ côi. Thử lại sau.'); }
}
