import 'server-only';
import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3-compatible object storage (Cloudflare R2 today; AWS S3 or the Google Cloud Storage XML API by env only).
 *
 *   S3_ENDPOINT            optional; omit for AWS S3. R2: https://<account>.r2.cloudflarestorage.com
 *   S3_REGION              default "auto" (R2); use the real region for AWS S3
 *   S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   S3_FORCE_PATH_STYLE    "true" for MinIO / moto
 *
 * Storage counts as configured only when bucket and both keys are set.
 */
export interface ObjectStorageConfig {
  endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}
export interface ObjectInfo { pathname: string; size: number; uploadedAt: number }
export interface ObjectHead { size: number; contentType: string }
export interface PresignedUpload { url: string; method: 'PUT'; headers: Record<string, string>; expiresAt: number }

const DELETE_CONCURRENCY = 8;

export function objectStorageConfig(env: Record<string, string | undefined> = process.env): ObjectStorageConfig | null {
  const bucket = env.S3_BUCKET?.trim(); const accessKeyId = env.S3_ACCESS_KEY_ID?.trim(); const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    ...(env.S3_ENDPOINT?.trim() ? { endpoint: env.S3_ENDPOINT.trim() } : {}),
    region: env.S3_REGION?.trim() || 'auto', bucket, accessKeyId, secretAccessKey,
    forcePathStyle: env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === 'true',
  };
}
export function isObjectStorageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return objectStorageConfig(env) !== null;
}

let cached: { signature: string; client: S3Client; config: ObjectStorageConfig } | null = null;
function storage() {
  const config = objectStorageConfig();
  if (!config) throw new Error('OBJECT_STORAGE_NOT_CONFIGURED');
  const signature = JSON.stringify(config);
  if (cached?.signature === signature) return cached;
  cached?.client.destroy();
  const client = new S3Client({
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    region: config.region, forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // SDK v3 adds CRC32 checksum parameters by default; R2 and GCS reject or mis-sign them in presigned URLs.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return (cached = { signature, client, config });
}
/** Test hook: drop the cached client so the next call re-reads the environment. */
export function resetObjectStorageClient() { cached?.client.destroy(); cached = null; }

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.Code === 'NoSuchKey';
}

/** Time-limited download URL. Fetching it needs no credentials. */
export async function presignGetUrl(pathname: string, expiresInSeconds: number): Promise<string> {
  const { client, config } = storage();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: pathname }), { expiresIn: expiresInSeconds });
}

/**
 * Time-limited upload URL. Content-Type and Content-Length are part of the signature, so the storage
 * service rejects a PUT that sends a different type or size. The caller must send exactly `headers`.
 */
export async function presignPutUrl(pathname: string, options: { contentType: string; size: number; expiresInSeconds: number }): Promise<PresignedUpload> {
  const { client, config } = storage();
  const url = await getSignedUrl(client,
    new PutObjectCommand({ Bucket: config.bucket, Key: pathname, ContentType: options.contentType, ContentLength: options.size }),
    { expiresIn: options.expiresInSeconds, signableHeaders: new Set(['content-type', 'content-length']) });
  return { url, method: 'PUT', headers: { 'Content-Type': options.contentType, 'Content-Length': String(options.size) }, expiresAt: Date.now() + options.expiresInSeconds * 1000 };
}

/** Size and media type of a stored object, or null when it does not exist. */
export async function headObject(pathname: string): Promise<ObjectHead | null> {
  const { client, config } = storage();
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: pathname }));
    return { size: Number(result.ContentLength ?? 0), contentType: result.ContentType ?? '' };
  } catch (error) { if (isNotFound(error)) return null; throw error; }
}

/** The object's bytes as a web stream (read with getReader()), or null when it does not exist. */
export async function getObjectStream(pathname: string): Promise<ReadableStream<Uint8Array> | null> {
  const { client, config } = storage();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: pathname }));
    return result.Body ? (result.Body.transformToWebStream() as ReadableStream<Uint8Array>) : null;
  } catch (error) { if (isNotFound(error)) return null; throw error; }
}

/** Idempotent: deleting a missing object succeeds. */
export async function deleteObject(pathname: string): Promise<void> {
  const { client, config } = storage();
  try { await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: pathname })); }
  catch (error) { if (!isNotFound(error)) throw error; }
}

/** Individual deletes with bounded concurrency: the GCS XML API has no multi-object delete. */
export async function deleteObjects(pathnames: readonly string[]): Promise<void> {
  const queue = [...pathnames]; let failure: unknown;
  const worker = async () => {
    while (queue.length && failure === undefined) {
      const next = queue.shift()!;
      try { await deleteObject(next); } catch (error) { failure ??= error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DELETE_CONCURRENCY, queue.length) }, worker));
  if (failure !== undefined) throw failure;
}

export async function listObjects(prefix?: string, continuationToken?: string, pageSize = 1000): Promise<{ objects: ObjectInfo[]; cursor?: string; hasMore: boolean }> {
  const { client, config } = storage();
  const result = await client.send(new ListObjectsV2Command({
    Bucket: config.bucket, MaxKeys: pageSize, ...(prefix ? { Prefix: prefix } : {}), ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
  }));
  const hasMore = result.IsTruncated === true && Boolean(result.NextContinuationToken);
  return {
    objects: (result.Contents ?? []).filter(item => item.Key).map(item => ({
      pathname: item.Key!, size: Number(item.Size ?? 0), uploadedAt: item.LastModified ? item.LastModified.getTime() : Number.NaN,
    })),
    ...(hasMore ? { cursor: result.NextContinuationToken } : {}), hasMore,
  };
}
