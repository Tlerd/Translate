import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { guard, readCloudRecording, readCloudRecordingIndex, writeCloudRecording } = vi.hoisted(() => ({
  guard: vi.fn(), readCloudRecording: vi.fn(), readCloudRecordingIndex: vi.fn(), writeCloudRecording: vi.fn(),
}));
vi.mock('@/server/http/guard', () => ({ verifyAuthGuard: guard }));
vi.mock('@/server/cloud/recording-store', () => ({ readCloudRecording, readCloudRecordingIndex, writeCloudRecording }));

import { GET, PUT } from '@/app/api/recordings/sync/route';

const validPayload = {
  recording: {
    id: 'rec-1', title: 'test', createdAt: '2026-10-01T00:00:00Z', mode: 'lecture',
    sourceLanguage: 'ja', targetLanguage: 'vi', state: 'stopped', durationMs: 100,
    audioState: 'missing', config: { translationModelKey: 'model' },
  },
  captions: [], summaries: [],
};

describe('/api/recordings/sync', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    process.env.OWNER_EMAIL = 'Owner@example.com ';
    guard.mockReset().mockResolvedValue(null);
    readCloudRecording.mockReset().mockResolvedValue(null);
    readCloudRecordingIndex.mockReset().mockResolvedValue({ items: [], nextCursor: null });
    writeCloudRecording.mockReset().mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns a small owner-scoped index page and fetches complete rows only by id', async () => {
    const response = await GET(new Request('http://localhost/api/recordings/sync'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(readCloudRecordingIndex).toHaveBeenCalledWith('owner@example.com', null);

    readCloudRecording.mockResolvedValueOnce({ id: 'rec-1', version: 1, payload: { ...validPayload, recording: { ...validPayload.recording, id: 'rec-1' } } });
    const detail = await GET(new Request('http://localhost/api/recordings/sync?id=rec-1'));
    expect(await detail.json()).toMatchObject({ row: { id: 'rec-1', version: 1 } });
    expect(readCloudRecording).toHaveBeenCalledWith('owner@example.com', 'rec-1');

    guard.mockResolvedValueOnce(new Response('denied', { status: 401 }));
    expect((await GET(new Request('http://localhost/api/recordings/sync'))).status).toBe(401);
    expect(readCloudRecordingIndex).toHaveBeenCalledOnce();
  });

  it('rejects oversized and malformed writes before reaching storage', async () => {
    const tooLarge = await PUT(new Request('http://localhost/api/recordings/sync', {
      method: 'PUT', body: ' '.repeat(3_000_001),
    }));
    expect(tooLarge.status).toBe(413);

    const malformed = await PUT(new Request('http://localhost/api/recordings/sync', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'other-id', expectedVersion: 0, payload: validPayload }),
    }));
    expect(malformed.status).toBe(400);
    expect(writeCloudRecording).not.toHaveBeenCalled();
  });

  it('maps compare-and-swap misses to 409 and does not fabricate an in-memory write', async () => {
    writeCloudRecording.mockResolvedValueOnce(null);
    const response = await PUT(new Request('http://localhost/api/recordings/sync', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'rec-1', expectedVersion: 4, payload: validPayload }),
    }));
    expect(response.status).toBe(409);
    expect(writeCloudRecording).toHaveBeenCalledWith('owner@example.com', 'rec-1', 4, validPayload);
  });

  it('fails closed when production auth or owner configuration is absent', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    guard.mockResolvedValueOnce(new Response('denied', { status: 503 }));
    expect((await PUT(new Request('http://localhost/api/recordings/sync', { method: 'PUT', body: '{}' }))).status).toBe(503);

    guard.mockResolvedValueOnce(null);
    delete process.env.OWNER_EMAIL;
    expect((await GET(new Request('http://localhost/api/recordings/sync'))).status).toBe(503);
    expect(readCloudRecordingIndex).not.toHaveBeenCalled();
  });
});
