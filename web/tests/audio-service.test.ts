import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode } from 'next-auth/jwt';
import { GET, POST, PUT, DELETE } from '@/app/api/recordings/audio/route';
import { POST as authorizeUpload } from '@/app/api/recordings/audio/upload/route';
import { deleteOwnedAudio, playbackPermission, verifyUploadedAudio } from '@/server/cloud/audio-service';
import type { RemoteAudio } from '@/shared/audio';

const fixtures = vi.hoisted(() => ({
  audio: null as RemoteAudio | null, readRecording: vi.fn(), complete: vi.fn(), reserve: vi.fn(), extendLease: vi.fn(),
  head: vi.fn(), get: vi.fn(), del: vi.fn(), issue: vi.fn(), presign: vi.fn(), list: vi.fn(),
}));
vi.mock('@/server/cloud/recording-store', () => ({ readCloudRecording: fixtures.readRecording }));
vi.mock('@/server/cloud/audio-store', () => ({
  readAudio: vi.fn(async () => fixtures.audio), completeAudio: fixtures.complete, reserveAudio: fixtures.reserve,
  listAudio: fixtures.list, extendUploadLease: fixtures.extendLease, cleanupDeletedAudio: vi.fn(),
  tombstoneAudio: vi.fn(async () => { fixtures.audio = { ...fixtures.audio!, state: 'deleted', version: fixtures.audio!.version + 1 }; return fixtures.audio; }),
}));
vi.mock('@vercel/blob', () => ({ head: fixtures.head, get: fixtures.get, del: fixtures.del, issueSignedToken: fixtures.issue, presignUrl: fixtures.presign }));
vi.mock('@vercel/blob/client', () => ({ handleUploadPresigned: vi.fn(async options => {
  await options.getSignedToken(options.body.payload.pathname, options.body.payload.clientPayload, options.body.payload.multipart);
  return { type: 'blob.generate-presigned-url', presignedUrlPayload: {} };
}) }));
const owner = 'owner@example.com'; const secret = 'fixture-auth-secret-over-thirty-two-characters';
const content = new TextEncoder().encode('actual audio upload');
async function request(method: string, body?: unknown, email = owner, query = '?id=lesson') {
  const cookie = 'authjs.session-token';
  const token = await encode({ secret, salt: cookie, token: { email }, maxAge: 3600 });
  return new Request(`http://localhost/api/recordings/audio${query}`, { method, headers: { cookie: `${cookie}=${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_SECRET', secret); vi.stubEnv('OWNER_EMAIL', owner); vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'fixture-private-storage-token');
  fixtures.audio = { recordingId: 'lesson', version: 1, state: 'pending', pathname: 'recordings/owner/lesson.webm', updatedAt: new Date().toISOString(), file: {
    mimeType: 'audio/webm', durationMs: 1000, sizeBytes: content.length, checksum: createHash('sha256').update(content).digest('hex'), formatVersion: 1,
  } };
  fixtures.readRecording.mockResolvedValue({ id: 'lesson', version: 1, payload: { recording: { state: 'stopped' } } });
  fixtures.head.mockImplementation(async () => ({ pathname: fixtures.audio!.pathname, size: content.length, contentType: 'audio/webm' }));
  fixtures.get.mockImplementation(async () => ({ stream: new ReadableStream({ start(controller) { controller.enqueue(content.slice(0, 5)); controller.enqueue(content.slice(5)); controller.close(); } }) }));
  fixtures.complete.mockImplementation(async () => { fixtures.audio = { ...fixtures.audio!, version: 2, state: 'available' }; return fixtures.audio; });
  fixtures.reserve.mockImplementation(async () => fixtures.audio); fixtures.extendLease.mockResolvedValue(true);
  fixtures.del.mockResolvedValue(undefined); fixtures.issue.mockResolvedValue({ delegationToken: 'fixture', clientSigningToken: 'fixture', validUntil: Date.now() + 1000 });
  fixtures.presign.mockResolvedValue({ presignedUrl: 'https://private.blob.local/short-lived-file' });
  fixtures.list.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => vi.unstubAllEnvs());
describe('private audio API and verified completion', () => {
  it('rejects wrong-account sessions on all metadata/upload/play/delete operations', async () => {
    for (const handler of [GET, POST, PUT, DELETE, authorizeUpload]) {
      expect((await handler(await request(handler === GET ? 'GET' : 'POST', handler === GET ? undefined : {}, 'other@example.com'))).status).toBe(401);
    }
    expect(fixtures.readRecording).not.toHaveBeenCalled(); expect(fixtures.issue).not.toHaveBeenCalled();
  });
  it('checks recording ownership before granting playback or upload', async () => {
    fixtures.readRecording.mockResolvedValue(null);
    expect((await GET(await request('GET', undefined, owner, '?id=lesson&play=1'))).status).toBe(404);
    expect((await PUT(await request('PUT', { id: 'lesson', file: fixtures.audio!.file }))).status).toBe(404);
    expect(fixtures.issue).not.toHaveBeenCalled();
  });
  it('verifies streamed size and checksum before completing the reserved version', async () => {
    const audio = await verifyUploadedAudio(owner, 'lesson', 1);
    expect(audio.state).toBe('available'); expect(fixtures.complete).toHaveBeenCalledWith(owner, 'lesson', 1);
    expect(fixtures.get).toHaveBeenCalledWith('recordings/owner/lesson.webm', { access: 'private', useCache: false });
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
    const permission = await playbackPermission(owner, 'lesson');
    expect(permission.expiresAt - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    expect(fixtures.issue).toHaveBeenCalledWith(expect.objectContaining({ pathname: 'recordings/owner/lesson.webm', operations: ['get'] }));
    expect(fixtures.presign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ access: 'private', operation: 'get' }));
  });
  it('limits direct multipart upload to the reservation size and MIME and rejects arbitrary paths', async () => {
    const body = { type: 'blob.generate-presigned-url', payload: { pathname: fixtures.audio!.pathname, multipart: true, clientPayload: JSON.stringify({ id: 'lesson', version: 1 }) } };
    expect((await authorizeUpload(await request('POST', body))).status).toBe(200);
    expect(fixtures.issue).toHaveBeenCalledWith(expect.objectContaining({ pathname: fixtures.audio!.pathname, operations: ['put'], allowedContentTypes: ['audio/webm'], maximumSizeInBytes: content.length }));
    body.payload.pathname = 'another-account/private-file';
    expect((await authorizeUpload(await request('POST', body))).status).toBe(409);
  });
  it('returns validation errors for malformed or oversized JSON without creating a reservation', async () => {
    expect((await PUT(await request('PUT', '{bad json'))).status).toBe(400);
    expect((await PUT(await request('PUT', 'x'.repeat(5000)))).status).toBe(413);
    expect(fixtures.reserve).not.toHaveBeenCalled();
  });
});
