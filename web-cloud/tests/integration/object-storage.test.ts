import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Runs against a real S3-compatible server (moto, MinIO, R2...). Skipped unless INTEGRATION_S3_ENDPOINT is set, e.g.
 *   INTEGRATION_S3_ENDPOINT=http://127.0.0.1:59000 npx vitest run tests/integration
 * Optional: INTEGRATION_S3_ACCESS_KEY_ID / _SECRET_ACCESS_KEY (default test/test), INTEGRATION_S3_REGION (default us-east-1),
 * INTEGRATION_S3_ENFORCES_SIGNED_HEADERS=true when the server verifies signatures (R2, AWS, MinIO; moto does not).
 */
const endpoint = process.env.INTEGRATION_S3_ENDPOINT;
const accessKeyId = process.env.INTEGRATION_S3_ACCESS_KEY_ID ?? 'test';
const secretAccessKey = process.env.INTEGRATION_S3_SECRET_ACCESS_KEY ?? 'test';
const region = process.env.INTEGRATION_S3_REGION ?? 'us-east-1';
const enforcesSignedHeaders = process.env.INTEGRATION_S3_ENFORCES_SIGNED_HEADERS === 'true';
const bucket = `it-${randomUUID().slice(0, 12)}`;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const audio = new Uint8Array(new ArrayBuffer(300_000)).map((_, index) => (index * 31 + 7) % 251);

describe.skipIf(!endpoint)('object storage against a live S3-compatible server', () => {
  let storage: typeof import('@/server/cloud/object-storage');
  let admin: S3Client;

  beforeAll(async () => {
    vi.stubEnv('S3_ENDPOINT', endpoint!); vi.stubEnv('S3_REGION', region); vi.stubEnv('S3_BUCKET', bucket);
    vi.stubEnv('S3_ACCESS_KEY_ID', accessKeyId); vi.stubEnv('S3_SECRET_ACCESS_KEY', secretAccessKey); vi.stubEnv('S3_FORCE_PATH_STYLE', 'true');
    admin = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    storage = await import('@/server/cloud/object-storage');
    storage.resetObjectStorageClient();
  });
  afterAll(async () => {
    if (!storage) return;
    const { objects } = await storage.listObjects();
    await storage.deleteObjects(objects.map(item => item.pathname));
    await admin.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
    admin.destroy(); storage.resetObjectStorageClient(); vi.unstubAllEnvs();
  });

  const key = 'recordings/ns/rec/v1-abc.webm';
  const upload = (url: string, headers: Record<string, string>, body: Uint8Array<ArrayBuffer>) => fetch(url, { method: 'PUT', headers, body });

  it('uploads through a presigned PUT, then reports size and type, streams identical bytes and serves a presigned GET', async () => {
    expect(await storage.headObject(key)).toBeNull();
    const grant = await storage.presignPutUrl(key, { contentType: 'audio/webm', size: audio.length, expiresInSeconds: 600 });
    expect(grant.method).toBe('PUT'); expect(grant.headers).toEqual({ 'Content-Type': 'audio/webm', 'Content-Length': String(audio.length) });
    const put = await upload(grant.url, grant.headers, audio);
    expect(put.status, await put.clone().text()).toBeLessThan(300);

    expect(await storage.headObject(key)).toEqual({ size: audio.length, contentType: 'audio/webm' });

    const stream = await storage.getObjectStream(key);
    expect(stream).not.toBeNull();
    const reader = stream!.getReader(); const hash = createHash('sha256'); let bytes = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; hash.update(value); }
    expect(bytes).toBe(audio.length); expect(hash.digest('hex')).toBe(sha256(audio));

    const url = await storage.presignGetUrl(key, 300);
    const download = await fetch(url);
    expect(download.status).toBe(200);
    expect(sha256(new Uint8Array(await download.arrayBuffer()))).toBe(sha256(audio));
  });

  it('returns null for a missing object', async () => {
    expect(await storage.headObject('recordings/missing.webm')).toBeNull();
    expect(await storage.getObjectStream('recordings/missing.webm')).toBeNull();
  });

  it('does not accept an upload that differs from the signed Content-Type or Content-Length', async () => {
    const wrongType = 'recordings/ns/wrong-type.webm'; const wrongSize = 'recordings/ns/wrong-size.webm';
    const typed = await storage.presignPutUrl(wrongType, { contentType: 'audio/webm', size: audio.length, expiresInSeconds: 600 });
    const typeResponse = await upload(typed.url, { 'Content-Type': 'text/html' }, audio);
    const sized = await storage.presignPutUrl(wrongSize, { contentType: 'audio/webm', size: audio.length, expiresInSeconds: 600 });
    const sizeResponse = await upload(sized.url, { 'Content-Type': 'audio/webm' }, audio.slice(0, 1000));
    if (enforcesSignedHeaders) {
      expect(typeResponse.status).toBe(403); expect(sizeResponse.status).toBe(403);
      expect(await storage.headObject(wrongType)).toBeNull(); expect(await storage.headObject(wrongSize)).toBeNull();
    } else {
      // moto does not verify SigV4 signatures, so it stores whatever arrives. Enforcement is proven by the signature
      // covering both headers (tests/object-storage.test.ts) and by servers that verify (R2, AWS, MinIO).
      console.info(`[integration] signature not verified by this server: wrong type -> ${typeResponse.status}, wrong length -> ${sizeResponse.status}`);
      // The confirmation step still catches this: HEAD exposes what really landed.
      if (sizeResponse.ok) expect((await storage.headObject(wrongSize))?.size).toBe(1000);
      if (typeResponse.ok) expect((await storage.headObject(wrongType))?.contentType).toBe('text/html');
    }
  });

  it('lists by prefix with continuation tokens', async () => {
    const names = Array.from({ length: 5 }, (_, index) => `listing/a/${index}.bin`);
    await Promise.all([...names, 'listing/b/other.bin'].map(async name => {
      const grant = await storage.presignPutUrl(name, { contentType: 'application/octet-stream', size: 4, expiresInSeconds: 600 });
      const response = await upload(grant.url, grant.headers, new Uint8Array(new ArrayBuffer(4)).fill(7));
      expect(response.status).toBeLessThan(300);
    }));
    const seen: string[] = []; let token: string | undefined; let pages = 0;
    do {
      const page = await storage.listObjects('listing/a/', token, 2);
      pages++; seen.push(...page.objects.map(item => item.pathname));
      for (const item of page.objects) { expect(item.size).toBe(4); expect(Number.isFinite(item.uploadedAt)).toBe(true); }
      expect(page.hasMore).toBe(Boolean(page.cursor));
      token = page.cursor;
    } while (token);
    expect(pages).toBe(3); expect(seen.sort()).toEqual(names);
    expect((await storage.listObjects('listing/', undefined, 100)).objects).toHaveLength(6);
  });

  it('deletes idempotently and in bulk', async () => {
    await storage.deleteObject(key);
    expect(await storage.headObject(key)).toBeNull();
    await expect(storage.deleteObject(key)).resolves.toBeUndefined();
    await expect(storage.deleteObject('never/existed')).resolves.toBeUndefined();
    const { objects } = await storage.listObjects('listing/');
    await storage.deleteObjects([...objects.map(item => item.pathname), 'never/existed']);
    expect((await storage.listObjects('listing/')).objects).toEqual([]);
    await expect(storage.deleteObjects([])).resolves.toBeUndefined();
  });
});
