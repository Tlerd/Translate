export class JsonRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function boundedJson(request: Request, limit: number): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > limit) throw new JsonRequestError(413, 'Yêu cầu vượt giới hạn dung lượng.');
  if (!request.body) throw new JsonRequestError(400, 'Thiếu dữ liệu yêu cầu.');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new JsonRequestError(413, 'Yêu cầu vượt giới hạn dung lượng.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new JsonRequestError(400, 'Dữ liệu yêu cầu không phải JSON hợp lệ.'); }
}
