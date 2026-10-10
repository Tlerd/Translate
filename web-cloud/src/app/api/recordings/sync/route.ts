import { NextResponse } from 'next/server';
import { verifyAuthGuard } from '@/server/http/guard';
import { cloudRecordingIdSchema, cloudRecordingIndexPageSchema, cloudRowResponseSchema, cloudWriteSchema } from '@/shared/cloud-recording';
import { readCloudRecording, readCloudRecordingIndex, writeCloudRecording } from '@/server/cloud/recording-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
function owner() { return process.env.OWNER_EMAIL!.trim().toLowerCase(); }
async function boundedBody(req: Request, limit: number): Promise<string | null> {
  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}
function unavailable(error: unknown) {
  const absent = error instanceof Error && error.message === 'CLOUD_NOT_CONFIGURED';
  return NextResponse.json({ error: absent ? 'Chưa kết nối database cloud.' : 'Không thể đồng bộ lúc này. Dữ liệu trên máy vẫn được giữ.' }, { status: 503, headers });
}
export async function GET(req: Request) {
  const denied = await verifyAuthGuard(req); if (denied) return denied;
  if (!process.env.OWNER_EMAIL) return NextResponse.json({ error: 'Chưa cấu hình tài khoản.' }, { status: 503, headers });
  const url = new URL(req.url);
  const idParam = url.searchParams.get('id');
  const cursorParam = url.searchParams.get('cursor');
  if (idParam !== null && cursorParam !== null) return NextResponse.json({ error: 'Tham số đồng bộ không hợp lệ.' }, { status: 400, headers });
  if (idParam !== null && !cloudRecordingIdSchema.safeParse(idParam).success) return NextResponse.json({ error: 'Mã bản ghi không hợp lệ.' }, { status: 400, headers });
  if (cursorParam !== null && !cloudRecordingIdSchema.safeParse(cursorParam).success) return NextResponse.json({ error: 'Con trỏ đồng bộ không hợp lệ.' }, { status: 400, headers });
  try {
    if (idParam !== null) {
      const row = await readCloudRecording(owner(), idParam);
      const result = cloudRowResponseSchema.safeParse({ row });
      if (!result.success) return NextResponse.json({ error: 'Dữ liệu cloud không hợp lệ.' }, { status: 503, headers });
      return NextResponse.json(result.data, { headers });
    }
    const page = await readCloudRecordingIndex(owner(), cursorParam);
    const result = cloudRecordingIndexPageSchema.safeParse(page);
    if (!result.success) return NextResponse.json({ error: 'Danh sách cloud không hợp lệ.' }, { status: 503, headers });
    return NextResponse.json(result.data, { headers });
  } catch (e) { return unavailable(e); }
}
export async function PUT(req: Request) {
  const denied = await verifyAuthGuard(req); if (denied) return denied;
  if (!process.env.OWNER_EMAIL) return NextResponse.json({ error: 'Chưa cấu hình tài khoản.' }, { status: 503, headers });
  let raw: string | null;
  try { raw = await boundedBody(req, 3_000_000); } catch { return NextResponse.json({ error: 'Không thể đọc dữ liệu đồng bộ.' }, { status: 400, headers }); }
  if (raw === null) return NextResponse.json({ error: 'Bản ghi vượt giới hạn đồng bộ.' }, { status: 413, headers });
  let body; try { body = cloudWriteSchema.safeParse(JSON.parse(raw)); } catch { return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400, headers }); }
  if (!body.success) return NextResponse.json({ error: 'Dữ liệu đồng bộ không hợp lệ.' }, { status: 400, headers });
  try {
    const row = await writeCloudRecording(owner(), body.data.id, body.data.expectedVersion, body.data.payload);
    return NextResponse.json(row ? { row } : { error: 'Bản ghi đã thay đổi trên thiết bị khác.' }, { status: row ? 200 : 409, headers });
  } catch (e) { return unavailable(e); }
}
