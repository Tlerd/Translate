// Creates the private audio bucket if it is missing and sets the CORS rules the browser needs
// (presigned PUT upload, presigned GET playback). Works with R2, S3, MinIO and anything S3-compatible.
//
//   S3_ENDPOINT, S3_REGION (default auto), S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
//   S3_FORCE_PATH_STYLE (optional), CORS_ORIGINS (comma separated, required)
//
// R2 needs an API token with "Admin Read & Write" to create a bucket and set CORS.
import { CreateBucketCommand, GetBucketCorsCommand, HeadBucketCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

const env = process.env;
const required = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'CORS_ORIGINS'];
const missing = required.filter(name => !env[name]?.trim());
if (missing.length) {
  console.error(`Thiếu biến: ${missing.join(', ')}`);
  process.exit(1);
}

const bucket = env.S3_BUCKET.trim();
const origins = env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
const client = new S3Client({
  ...(env.S3_ENDPOINT?.trim() ? { endpoint: env.S3_ENDPOINT.trim() } : {}),
  region: env.S3_REGION?.trim() || 'auto',
  forcePathStyle: env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === 'true',
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID.trim(), secretAccessKey: env.S3_SECRET_ACCESS_KEY.trim() },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

async function bucketExists() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchBucket') return false;
    throw error;
  }
}

if (await bucketExists()) {
  console.log(`✓ Bucket ${bucket} đã có`);
} else {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`✓ Đã tạo bucket private ${bucket}`);
}

await client.send(new PutBucketCorsCommand({
  Bucket: bucket,
  CORSConfiguration: {
    CORSRules: [{
      AllowedOrigins: origins,
      AllowedMethods: ['GET', 'PUT', 'HEAD'],
      AllowedHeaders: ['content-type'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    }],
  },
}));
const cors = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log(`✓ CORS cho phép: ${cors.CORSRules?.flatMap(rule => rule.AllowedOrigins ?? []).join(', ')}`);
