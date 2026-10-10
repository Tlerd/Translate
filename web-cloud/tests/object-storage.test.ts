import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isObjectStorageConfigured, objectStorageConfig, presignGetUrl, presignPutUrl, resetObjectStorageClient } from '@/server/cloud/object-storage';

const NOW = new Date('2026-10-10T12:00:00Z');
function stubStorage(overrides: Record<string, string> = {}) {
  const env = { S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', S3_REGION: '', S3_BUCKET: 'audio', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret', S3_FORCE_PATH_STYLE: '', ...overrides };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}
const query = (url: string) => new URL(url).searchParams;

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); resetObjectStorageClient(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); resetObjectStorageClient(); });

describe('object storage configuration', () => {
  it('is configured only with bucket and both keys', () => {
    expect(objectStorageConfig({ S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })).toEqual({ bucket: 'b', accessKeyId: 'k', secretAccessKey: 's', region: 'auto', forcePathStyle: false });
    for (const missing of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      const env: Record<string, string> = { S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_ENDPOINT: 'https://x' };
      env[missing] = '  ';
      expect(isObjectStorageConfigured(env)).toBe(false);
    }
    expect(isObjectStorageConfigured({ S3_ENDPOINT: 'https://x' })).toBe(false);
  });
  it('reads endpoint, region and path style', () => {
    expect(objectStorageConfig({ S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_ENDPOINT: ' http://127.0.0.1:9000 ', S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: 'TRUE' }))
      .toMatchObject({ endpoint: 'http://127.0.0.1:9000', region: 'us-east-1', forcePathStyle: true });
  });
  it('fails clearly when used without configuration', async () => {
    stubStorage({ S3_BUCKET: '' });
    await expect(presignGetUrl('recordings/x.webm', 60)).rejects.toThrow('OBJECT_STORAGE_NOT_CONFIGURED');
  });
});

describe('presigned URLs', () => {
  it('signs Content-Type and Content-Length so the upload cannot differ in type or size', async () => {
    stubStorage();
    const base = await presignPutUrl('recordings/ns/rec/v1-abc.webm', { contentType: 'audio/webm', size: 1234, expiresInSeconds: 3600 });
    const params = query(base.url);
    expect(params.get('X-Amz-SignedHeaders')?.split(';')).toEqual(['content-length', 'content-type', 'host']);
    expect(params.get('X-Amz-Expires')).toBe('3600');
    expect(base).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'audio/webm', 'Content-Length': '1234' }, expiresAt: NOW.getTime() + 3600_000 });
    // Virtual-hosted style by default (bucket in the host); S3_FORCE_PATH_STYLE=true moves it into the path.
    expect(new URL(base.url).host).toBe('audio.acct.r2.cloudflarestorage.com');
    expect(new URL(base.url).pathname).toBe('/recordings/ns/rec/v1-abc.webm');
    // The storage service recomputes the signature from the headers it receives, so any change must yield a different signature.
    const otherType = await presignPutUrl('recordings/ns/rec/v1-abc.webm', { contentType: 'text/html', size: 1234, expiresInSeconds: 3600 });
    const otherSize = await presignPutUrl('recordings/ns/rec/v1-abc.webm', { contentType: 'audio/webm', size: 1235, expiresInSeconds: 3600 });
    const again = await presignPutUrl('recordings/ns/rec/v1-abc.webm', { contentType: 'audio/webm', size: 1234, expiresInSeconds: 3600 });
    expect(query(otherType.url).get('X-Amz-Signature')).not.toBe(params.get('X-Amz-Signature'));
    expect(query(otherSize.url).get('X-Amz-Signature')).not.toBe(params.get('X-Amz-Signature'));
    expect(query(again.url).get('X-Amz-Signature')).toBe(params.get('X-Amz-Signature'));
  });
  it('adds no CRC32 checksum parameters that R2 and GCS reject', async () => {
    stubStorage();
    const put = query((await presignPutUrl('a/b.webm', { contentType: 'audio/webm', size: 10, expiresInSeconds: 60 })).url);
    const get = query(await presignGetUrl('a/b.webm', 60));
    for (const params of [put, get]) {
      expect([...params.keys()].filter(name => /checksum/i.test(name))).toEqual([]);
      expect(params.get('X-Amz-Content-Sha256')).toBe('UNSIGNED-PAYLOAD');
    }
    expect(put.get('x-id')).toBe('PutObject'); expect(get.get('x-id')).toBe('GetObject');
  });
  it('presigns a GET with the requested expiry, with no credentials in the path', async () => {
    stubStorage({ S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: 'true', S3_ENDPOINT: 'http://127.0.0.1:59000' });
    const url = new URL(await presignGetUrl('recordings/a b/v1.webm', 900));
    expect(url.origin).toBe('http://127.0.0.1:59000'); expect(url.pathname).toBe('/audio/recordings/a%20b/v1.webm');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/us-east-1/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Credential')?.startsWith('key/')).toBe(true);
    expect(url.search).not.toContain('secret');
  });
  it('targets AWS S3 when no endpoint is configured, and rebuilds the client when the env changes', async () => {
    stubStorage({ S3_ENDPOINT: '', S3_REGION: 'ap-southeast-1' });
    const aws = new URL(await presignGetUrl('x.webm', 60));
    expect(aws.hostname).toBe('audio.s3.ap-southeast-1.amazonaws.com');
    stubStorage({ S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com' });
    expect(new URL(await presignGetUrl('x.webm', 60)).hostname).toBe('audio.acct.r2.cloudflarestorage.com');
  });
});
