import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuthGuard } from '@/server/http/guard';
import { ownerEmail } from '@/server/auth-policy';
import { readAudio, extendUploadLease } from '@/server/cloud/audio-store';
import { AudioRequestError, requireAudioStorage, requireRecordingOwner } from '@/server/cloud/audio-service';
import { presignPutUrl } from '@/server/cloud/object-storage';
import { cloudRecordingIdSchema } from '@/shared/cloud-recording';
import { boundedJson, JsonRequestError } from '@/server/http/bounded-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const UPLOAD_LEASE_SECONDS = 60 * 60;
const uploadSchema = z.object({ id: cloudRecordingIdSchema, version: z.number().int().positive() }).strict();
/**
 * Returns a presigned PUT for the reserved pathname. Content-Type and Content-Length are signed, so the
 * browser can only upload the size and media type registered at reservation time.
 */
export async function POST(request: Request) {
  const denied = await verifyAuthGuard(request); if (denied) return denied;
  const owner = ownerEmail(); if (!owner) return NextResponse.json({ error: 'Chưa cấu hình tài khoản cloud.' }, { status: 503, headers });
  try {
    requireAudioStorage();
    const body = uploadSchema.safeParse(await boundedJson(request, 8192));
    if (!body.success) throw new AudioRequestError(400, 'Yêu cầu upload không hợp lệ.');
    await requireRecordingOwner(owner, body.data.id);
    const audio = await readAudio(owner, body.data.id);
    if (audio?.state !== 'pending' || audio.version !== body.data.version || !audio.pathname || !audio.file) throw new AudioRequestError(409, 'Audio đã thay đổi hoặc đã xóa.');
    const validUntil = Date.now() + UPLOAD_LEASE_SECONDS * 1000;
    if (!await extendUploadLease(owner, body.data.id, audio.version, validUntil)) throw new AudioRequestError(409, 'Audio đã xóa trong lúc cấp quyền upload.');
    const upload = await presignPutUrl(audio.pathname, { contentType: audio.file.mimeType, size: audio.file.sizeBytes, expiresInSeconds: UPLOAD_LEASE_SECONDS });
    return NextResponse.json({ url: upload.url, method: upload.method, headers: upload.headers, expiresAt: upload.expiresAt }, { headers });
  } catch (error) {
    const known = error instanceof AudioRequestError || error instanceof JsonRequestError;
    return NextResponse.json({ error: known ? error.message : 'Không cấp được quyền upload audio.' }, { status: known ? error.status : 503, headers });
  }
}
