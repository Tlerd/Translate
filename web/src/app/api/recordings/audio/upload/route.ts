import { NextResponse } from 'next/server';
import { handleUploadPresigned } from '@vercel/blob/client';
import { issueSignedToken } from '@vercel/blob';
import { z } from 'zod';
import { verifyAuthGuard } from '@/server/http/guard';
import { ownerEmail } from '@/server/auth-policy';
import { readAudio, extendUploadLease } from '@/server/cloud/audio-store';
import { AudioRequestError, requireAudioStorage, requireRecordingOwner } from '@/server/cloud/audio-service';
import { cloudRecordingIdSchema } from '@/shared/cloud-recording';
import { boundedJson, JsonRequestError } from '@/server/http/bounded-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const payloadSchema = z.object({ id: cloudRecordingIdSchema, version: z.number().int().positive() }).strict();
const uploadSchema = z.object({ type: z.literal('blob.generate-presigned-url'), payload: z.object({ pathname: z.string().min(1).max(500), multipart: z.boolean(), clientPayload: z.string().max(2048).nullable() }).strict() }).strict();
export async function POST(request: Request) {
  const denied = await verifyAuthGuard(request); if (denied) return denied;
  const owner = ownerEmail(); if (!owner) return NextResponse.json({ error: 'Chưa cấu hình tài khoản cloud.' }, { status: 503, headers });
  try {
    requireAudioStorage();
    const body = uploadSchema.safeParse(await boundedJson(request, 8192));
    if (!body.success) throw new AudioRequestError(400, 'Yêu cầu upload không hợp lệ.');
    const result = await handleUploadPresigned({ request, body: body.data,
      getSignedToken: async (pathname, payload) => {
        let parsed;
        try { parsed = payloadSchema.safeParse(JSON.parse(payload ?? 'null')); }
        catch { throw new AudioRequestError(400, 'Quyền upload không hợp lệ.'); }
        if (!parsed.success) throw new AudioRequestError(400, 'Quyền upload không hợp lệ.');
        await requireRecordingOwner(owner, parsed.data.id);
        const audio = await readAudio(owner, parsed.data.id);
        if (audio?.state !== 'pending' || audio.version !== parsed.data.version || audio.pathname !== pathname || !audio.file) throw new AudioRequestError(409, 'Audio đã thay đổi hoặc đã xóa.');
        const validUntil = Date.now() + 60 * 60_000;
        if (!await extendUploadLease(owner, parsed.data.id, audio.version, validUntil)) throw new AudioRequestError(409, 'Audio đã xóa trong lúc cấp quyền upload.');
        const constraints = { allowedContentTypes: [audio.file.mimeType], maximumSizeInBytes: audio.file.sizeBytes };
        const token = await issueSignedToken({ pathname, operations: ['put'], validUntil, ...constraints });
        return { token, urlOptions: { access: 'private', allowOverwrite: false, addRandomSuffix: false, validUntil, ...constraints } };
      },
    });
    return NextResponse.json(result, { headers });
  } catch (error) {
    const known = error instanceof AudioRequestError || error instanceof JsonRequestError;
    return NextResponse.json({ error: known ? error.message : 'Không cấp được quyền upload audio.' }, { status: known ? error.status : 503, headers });
  }
}
