import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuthGuard } from '@/server/http/guard';
import { ownerEmail } from '@/server/auth-policy';
import { cloudRecordingIdSchema } from '@/shared/cloud-recording';
import { audioFileSchema } from '@/shared/audio';
import { listAudio, readAudio, reserveAudio } from '@/server/cloud/audio-store';
import { AudioRequestError, cleanupAudio, deleteOwnedAudio, playbackPermission, requireAudioStorage, requireRecordingOwner, verifyUploadedAudio } from '@/server/cloud/audio-service';
import { boundedJson, JsonRequestError } from '@/server/http/bounded-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'private, no-store' };
const reserveSchema = z.object({ id: cloudRecordingIdSchema, file: audioFileSchema }).strict();
const completeSchema = z.object({ id: cloudRecordingIdSchema, version: z.number().int().positive() }).strict();
function errorResponse(error: unknown) {
  const known = error instanceof AudioRequestError || error instanceof JsonRequestError;
  return NextResponse.json({ error: known ? error.message : 'Không đồng bộ được audio. Bản gốc trên máy vẫn được giữ.' }, { status: known ? error.status : 503, headers });
}
async function account(req: Request): Promise<string | Response> {
  const denied = await verifyAuthGuard(req); if (denied) return denied;
  return ownerEmail() ?? NextResponse.json({ error: 'Chưa cấu hình tài khoản cloud.' }, { status: 503, headers });
}
export async function GET(req: Request) {
  const owner = await account(req); if (typeof owner !== 'string') return owner;
  const url = new URL(req.url); const id = url.searchParams.get('id'); const cursor = url.searchParams.get('cursor');
  if ((id !== null && !cloudRecordingIdSchema.safeParse(id).success) || (cursor !== null && !cloudRecordingIdSchema.safeParse(cursor).success) || (id !== null && cursor !== null)) return NextResponse.json({ error: 'Mã bản ghi không hợp lệ.' }, { status: 400, headers });
  try {
    if (!id) {
      await cleanupAudio(owner);
      return NextResponse.json(await listAudio(owner, cursor), { headers });
    }
    await requireRecordingOwner(owner, id, true);
    if (url.searchParams.get('play') === '1') { requireAudioStorage(); return NextResponse.json(await playbackPermission(owner, id), { headers }); }
    return NextResponse.json({ audio: await readAudio(owner, id) }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function PUT(req: Request) {
  const owner = await account(req); if (typeof owner !== 'string') return owner;
  try {
    const body = reserveSchema.safeParse(await boundedJson(req, 4096));
    if (!body.success) throw new AudioRequestError(400, 'Metadata audio không hợp lệ.');
    requireAudioStorage();
    const recording = await requireRecordingOwner(owner, body.data.id);
    if (recording.payload?.recording.state === 'recording') throw new AudioRequestError(409, 'Kết thúc buổi thu trước khi upload.');
    const audio = await reserveAudio(owner, body.data.id, body.data.file);
    if (!audio) throw new AudioRequestError(409, 'Audio đã xóa hoặc có phiên bản khác trên cloud.');
    return NextResponse.json({ audio }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(req: Request) {
  const owner = await account(req); if (typeof owner !== 'string') return owner;
  try {
    const body = completeSchema.safeParse(await boundedJson(req, 4096));
    if (!body.success) throw new AudioRequestError(400, 'Xác nhận audio không hợp lệ.');
    requireAudioStorage();
    return NextResponse.json({ audio: await verifyUploadedAudio(owner, body.data.id, body.data.version) }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(req: Request) {
  const owner = await account(req); if (typeof owner !== 'string') return owner;
  const id = new URL(req.url).searchParams.get('id');
  if (!cloudRecordingIdSchema.safeParse(id).success) return NextResponse.json({ error: 'Mã bản ghi không hợp lệ.' }, { status: 400, headers });
  try { return NextResponse.json({ audio: await deleteOwnedAudio(owner, id!) }, { headers }); }
  catch (error) { return errorResponse(error); }
}
