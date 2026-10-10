import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode } from 'next-auth/jwt';
import { GET, POST, PUT, DELETE } from '@/app/api/recordings/audio/route';
import { POST as authorizeUpload } from '@/app/api/recordings/audio/upload/route';
import { deleteOwnedAudio, playbackPermission, verifyUploadedAudio } from '@/server/cloud/audio-service';
import type { RemoteAudio } from '@/shared/audio';

const fixtures = vi.hoisted(() => ({
  audio: null as RemoteAudio | null, readRecording: vi.fn(), complete: vi.fn(), reserve: vi.fn(), extendLease: vi.fn(),
  head: vi.fn(), stream: vi.fn(), del: vi.fn(), presignPut: vi.fn(), presignGet: vi.fn(), list: vi.fn(),
}));
vi.mock('@/server/cloud/recording-store', () => ({ readCloudRecording: fixtures.readRecording }));
vi.mock('@/server/cloud/audio-store', () => ({
  readAudio: vi.fn(async () => fixtures.audio), completeAudio: fixtures.complete, reserveAudio: fixtures.reserve,
  listAudio: fixtures.list, extendUploadLease: fixtures.extendLease, cleanupDeletedAudio: vi.fn(),
  tombstoneAudio: vi.fn(async () => { fixtures.audio = { ...fixtures.audio!, state: 'deleted', version: fixtures.audio!.version + 1 }; return fixtures.audio; }),
}));
vi.mock('@/server/cloud/object-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/cloud/object-storage')>(),
  headObject: fixtures.head, getObjectStream: fixtures.stream, deleteObject: fixtures.del, presignPutUrl: fixtures.presignPut, presignGetUrl: fixtures.presignGet,
}));
const owner = 'owner@example.com'; const secret = 'fixture-auth-secret-over-thirty-two-characters';
const content = new TextEncoder().encode('actual audio upload');
function stubStorageEnv() {
  vi.stubEnv('S3_BUCKET', 'fixture-bucket'); vi.stubEnv('S3_ACCESS_KEY_ID', 'fixture-key'); vi.stubEnv('S3_SECRET_ACCESS_KEY', 'fixture-secret');
}
async function request(method: string, body?: unknown, email = owner, query = '?id=lesson') {
  const cookie = 'authjs.session-token';
  const token = await encode({ secret, salt: cookie, token: { email }, maxAge: 3600 });
  return new Request(`http://localhost/api/recordings/audio${query}`, { method, headers: { cookie: `${cookie}=${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_SECRET', secret); vi.stubEnv('OWNER_EMAIL', owner); stubStorageEnv();
  fixtures.audio = { recordingId: 'lesson', version: 1, state: 'pending', pathname: 'recordings/owner/lesson.webm', updatedAt: new Date().toISOString(), file: {
    mimeType: 'audio/webm', durationMs: 1000, sizeBytes: content.length, checksum: createHash('sha256').update(content).digest('hex'), formatVersion: 1,
  } };
  fixtures.readRecording.mockResolvedValue({ id: 'lesson', version: 1, payload: { recording: { state: 'stopped' } } });
  fixtures.head.mockImplementation(async () => ({ size: content.length, contentType: 'audio/webm' }));
  fixtures.stream.mockImplementation(async () => new ReadableStream({ start(controller) { controller.enqueue(content.slice(0, 5)); controller.enqueue(content.slice(5)); controller.close(); } }));
  fixtures.complete.mockImplementation(async () => { fixtures.audio = { ...fixtures.audio!, version: 2, state: 'available' }; return fixtures.audio; });
  fixtures.reserve.mockImplementation(async () => fixtures.audio); fixtures.extendLease.mockResolvedValue(true);
  fixtures.del.mockResolvedValue(undefined); fixtures.presignGet.mockResolvedValue('https://storage.local/short-lived-get');
  fixtures.presignPut.mockImplementation(async (_path: string, options: { contentType: string; size: number; expiresInSeconds: number }) => ({
    url: 'https://storage.local/signed-put', method: 'PUT', headers: { 'Content-Type': options.contentType, 'Content-Length': String(options.size) }, expiresAt: Date.now() + options.expiresInSeconds * 1000,
  }));
  fixtures.list.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => vi.unstubAllEnvs());
describe('private audio API and verified completion', () => {
  it('rejects wrong-account sessions on all metadata/upload/play/delete operations', async () => {
    for (const handler of [GET, POST, PUT, DELETE, authorizeUpload]) {
      expect((await handler(await request(handler === GET ? 'GET' : 'POST', handler === GET ? undefined : {}, 'other@example.com'))).status).toBe(401);
    }
    expect(fixtures.readRecording).not.toHaveBeenCalled(); expect(fixtures.presignPut).not.toHaveBeenCalled(); expect(fixtures.presignGet).not.toHaveBeenCalled();
  });
  it('checks recording ownership before granting playback or upload', async () => {
    fixtures.readRecording.mockResolvedValue(null);
    expect((await GET(await request('GET', undefined, owner, '?id=lesson&play=1'))).status).toBe(404);
    expect((await PUT(await request('PUT', { id: 'lesson', file: fixtures.audio!.file }))).status).toBe(404);
    expect(fixtures.presignPut).not.toHaveBeenCalled(); expect(fixtures.presignGet).not.toHaveBeenCalled();
  });
  it('verifies streamed size and checksum before completing the reserved version', async () => {
    const audio = await verifyUploadedAudio(owner, 'lesson', 1);
    expect(audio.state).toBe('available'); expect(fixtures.complete).toHaveBeenCalledWith(owner, 'lesson', 1);
    expect(fixtures.stream).toHaveBeenCalledWith('recordings/owner/lesson.webm');
  });
  it('rejects a forged checksum and leaves the upload unconfirmed', async () => {
    fixtures.audio!.file!.checksum = '0'.repeat(64);
    await expect(verifyUploadedAudio(owner, 'lesson', 1)).rejects.toMatchObject({ status: 400 });
    expect(fixtures.complete).not.toHaveBeenCalled();
  });
  it('does not revive a file deleted during confirmation and removes the late object', async () => {
    fixtures.complete.mockImplementation(async () => { fixtures.audio = { ...fixtures.audio!, state: 'deleted', version: 2 }; return null; });
    await expect(verifyUploadedAudio(owner, 'lesson', 1)).rejects.toMatchObject({ status: 409 });
    expect(fixtures.del).toHaveBeenCalledWith('recordings/owner/lesson.webm');
  });
  it('records the tombstone before removing bytes, even if storage is unavailable', async () => {
    fixtures.del.mockRejectedValue(new Error('temporary storage failure'));
    await expect(deleteOwnedAudio(owner, 'lesson')).rejects.toThrow('temporary storage failure');
    expect(fixtures.audio!.state).toBe('deleted');
    await expect(playbackPermission(owner, 'lesson')).rejects.toMatchObject({ status: 404 });
  });
  it('issues a short-lived private GET scoped to the exact owned pathname', async () => {
    fixtures.audio!.state = 'available';
    const before = Date.now();
    const permission = await playbackPermission(owner, 'lesson');
    expect(permission).toEqual({ audio: fixtures.audio, url: 'https://storage.local/short-lived-get', expiresAt: expect.any(Number) });
    expect(permission.expiresAt - before).toBeLessThanOrEqual(15 * 60_000 + 50);
    expect(fixtures.presignGet).toHaveBeenCalledWith('recordings/owner/lesson.webm', 15 * 60);
  });
  it('treats a missing uploaded object as not yet uploaded (404, never the 409 conflict the client rethrows)', async () => {
    fixtures.head.mockResolvedValue(null);
    await expect(verifyUploadedAudio(owner, 'lesson', 1)).rejects.toMatchObject({ status: 404 });
    expect(fixtures.complete).not.toHaveBeenCalled();
  });
  it('rejects an upload whose stored type or size differs from the reservation', async () => {
    fixtures.head.mockResolvedValue({ size: content.length, contentType: 'audio/wav' });
    await expect(verifyUploadedAudio(owner, 'lesson', 1)).rejects.toMatchObject({ status: 400 });
    fixtures.head.mockResolvedValue({ size: content.length + 1, contentType: 'audio/webm; codecs=opus' });
    await expect(verifyUploadedAudio(owner, 'lesson', 1)).rejects.toMatchObject({ status: 400 });
    expect(fixtures.stream).not.toHaveBeenCalled();
  });
  it('accepts a stored content type with parameters', async () => {
    fixtures.head.mockResolvedValue({ size: content.length, contentType: 'audio/webm; codecs=opus' });
    await expect(verifyUploadedAudio(owner, 'lesson', 1)).resolves.toMatchObject({ state: 'available' });
  });
  it('requires configured object storage for every storage-backed endpoint', async () => {
    vi.stubEnv('S3_SECRET_ACCESS_KEY', '');
    fixtures.audio!.state = 'available';
    expect((await GET(await request('GET', undefined, owner, '?id=lesson&play=1'))).status).toBe(503);
    expect((await PUT(await request('PUT', { id: 'lesson', file: fixtures.audio!.file }))).status).toBe(503);
    expect((await POST(await request('POST', { id: 'lesson', version: 1 }))).status).toBe(503);
    expect((await authorizeUpload(await request('POST', { id: 'lesson', version: 1 }))).status).toBe(503);
    expect(fixtures.presignGet).not.toHaveBeenCalled(); expect(fixtures.presignPut).not.toHaveBeenCalled();
  });
});

describe('POST /api/recordings/audio/upload', () => {
  it('returns a presigned PUT limited to the reservation MIME and size, and extends the upload lease', async () => {
    const before = Date.now();
    const response = await authorizeUpload(await request('POST', { id: 'lesson', version: 1 }));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toEqual({ url: 'https://storage.local/signed-put', method: 'PUT', headers: { 'Content-Type': 'audio/webm', 'Content-Length': String(content.length) }, expiresAt: expect.any(Number) });
    expect(body.expiresAt - before).toBeGreaterThanOrEqual(60 * 60_000 - 50);
    expect(fixtures.presignPut).toHaveBeenCalledWith('recordings/owner/lesson.webm', { contentType: 'audio/webm', size: content.length, expiresInSeconds: 3600 });
    expect(fixtures.extendLease).toHaveBeenCalledWith(owner, 'lesson', 1, expect.any(Number));
  });
  it('signs the pathname from the database, never one supplied by the client', async () => {
    const response = await authorizeUpload(await request('POST', { id: 'lesson', version: 1, pathname: 'another-account/private-file' }));
    expect(response.status).toBe(400); expect(fixtures.presignPut).not.toHaveBeenCalled();
  });
  it('rejects a stale version, a non-pending reservation, a missing recording and a failed lease', async () => {
    expect((await authorizeUpload(await request('POST', { id: 'lesson', version: 2 }))).status).toBe(409);
    fixtures.audio!.state = 'available';
    expect((await authorizeUpload(await request('POST', { id: 'lesson', version: 1 }))).status).toBe(409);
    fixtures.audio!.state = 'pending'; fixtures.extendLease.mockResolvedValue(false);
    expect((await authorizeUpload(await request('POST', { id: 'lesson', version: 1 }))).status).toBe(409);
    fixtures.extendLease.mockResolvedValue(true); fixtures.readRecording.mockResolvedValue(null);
    expect((await authorizeUpload(await request('POST', { id: 'lesson', version: 1 }))).status).toBe(404);
    expect(fixtures.presignPut).not.toHaveBeenCalled();
  });
  it('rejects malformed, oversized and unknown-field bodies', async () => {
    expect((await authorizeUpload(await request('POST', { id: 'lesson' }))).status).toBe(400);
    expect((await authorizeUpload(await request('POST', { id: 'lesson', version: 0 }))).status).toBe(400);
    expect((await authorizeUpload(await request('POST', '{bad'))).status).toBe(400);
    expect((await authorizeUpload(await request('POST', 'x'.repeat(9000)))).status).toBe(413);
    expect(fixtures.presignPut).not.toHaveBeenCalled(); expect(fixtures.extendLease).not.toHaveBeenCalled();
  });
  it('answers 503 with a Vietnamese error when signing fails', async () => {
    fixtures.presignPut.mockRejectedValue(new Error('provider detail'));
    const response = await authorizeUpload(await request('POST', { id: 'lesson', version: 1 }));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('provider detail');
  });
});

describe('audio API validation', () => {
  it('returns validation errors for malformed or oversized JSON without creating a reservation', async () => {
    expect((await PUT(await request('PUT', '{bad json'))).status).toBe(400);
    expect((await PUT(await request('PUT', 'x'.repeat(5000)))).status).toBe(413);
    expect(fixtures.reserve).not.toHaveBeenCalled();
  });
});
