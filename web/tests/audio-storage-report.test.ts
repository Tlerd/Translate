import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encode } from 'next-auth/jwt';

const fixtures = vi.hoisted(() => ({
  list: vi.fn(), del: vi.fn(), sql: vi.fn(), ensure: vi.fn(),
  rows: [] as Array<{ pathname: string; in_trash: boolean }>,
  blobs: [] as Array<{ pathname: string; size: number; uploadedAt: Date }>,
  pageSize: 1000,
}));
vi.mock('@vercel/blob', () => ({
  list: fixtures.list, del: fixtures.del, head: vi.fn(), get: vi.fn(), issueSignedToken: vi.fn(), presignUrl: vi.fn(),
}));
vi.mock('@/server/cloud/audio-table', () => ({ ensureAudioTable: fixtures.ensure }));
vi.mock('@/server/cloud/recording-store', () => ({ database: () => fixtures.sql, readCloudRecording: vi.fn() }));
vi.mock('@/server/cloud/audio-store', () => ({}));

import { cleanupOrphanAudio, scanAudioStorage } from '@/server/cloud/audio-storage-report';
import { GET, POST } from '@/app/api/recordings/audio/storage/route';

const MB = 1024 * 1024;
const NOW = new Date('2026-10-10T12:00:00Z').getTime();
const old = new Date(NOW - 3 * 3600_000);
const recent = new Date(NOW - 30 * 60_000);
const owner = 'owner@example.com'; const secret = 'fixture-auth-secret-over-thirty-two-characters';
const blob = (pathname: string, size: number, uploadedAt = old) => ({ pathname, size, uploadedAt });

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_SECRET', secret); vi.stubEnv('OWNER_EMAIL', owner);
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'fixture-private-storage-token');
  fixtures.rows = []; fixtures.blobs = []; fixtures.pageSize = 1000;
  fixtures.list.mockImplementation(async (options: { prefix?: string; cursor?: string; limit?: number }) => {
    const all = fixtures.blobs.filter(item => !options.prefix || item.pathname.startsWith(options.prefix));
    const start = options.cursor ? Number(options.cursor) : 0;
    const end = start + fixtures.pageSize;
    return { blobs: all.slice(start, end), hasMore: end < all.length, ...(end < all.length ? { cursor: String(end) } : {}) };
  });
  fixtures.sql.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('FROM recording_audio a')) return fixtures.rows;
    return [];
  });
  fixtures.del.mockResolvedValue(undefined); fixtures.ensure.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('scanAudioStorage', () => {
  it('classifies referenced, trash, orphan, recent and outside-prefix blobs', async () => {
    fixtures.blobs = [
      blob('recordings/a/live/v1-x.webm', 10 * MB), blob('recordings/a/trash/v1-x.webm', 5 * MB),
      blob('recordings/a/pending/v1-x.webm', 2 * MB, recent), blob('recordings/b/orphan/v1-x.webm', 7 * MB),
      blob('recordings/b/fresh/v1-x.webm', 1 * MB, recent), blob('other/thing.png', 3 * MB),
    ];
    fixtures.rows = [
      { pathname: 'recordings/a/live/v1-x.webm', in_trash: false }, { pathname: 'recordings/a/trash/v1-x.webm', in_trash: true },
      { pathname: 'recordings/a/pending/v1-x.webm', in_trash: false },
    ];
    expect(await scanAudioStorage()).toEqual({
      storeTotalBytes: 28 * MB, storeFiles: 6, referencedBytes: 12 * MB, referencedFiles: 2, trashBytes: 5 * MB, trashFiles: 1,
      orphanBytes: 7 * MB, orphanFiles: 1, graceBytes: 1 * MB, graceFiles: 1, cleanupBlockedReason: null, scannedAt: new Date(NOW).toISOString(),
    });
  });
  it('only reads live rows (pending/available with a pathname) from the database', async () => {
    await scanAudioStorage();
    const query = String(fixtures.sql.mock.calls[0][0].join('?'));
    expect(query).toContain("state IN ('pending','available')"); expect(query).toContain('pathname IS NOT NULL');
    expect(query).toContain("payload->'recording'->>'deletedAt'");
  });
  it('pages through every cursor for both the prefixed and the whole-store pass', async () => {
    fixtures.pageSize = 2;
    fixtures.blobs = [...Array.from({ length: 5 }, (_, i) => blob(`recordings/a/${i}/v1-x.webm`, MB)), blob('x/1', MB), blob('x/2', MB)];
    const report = await scanAudioStorage();
    expect(report.orphanFiles).toBe(5); expect(report.storeFiles).toBe(7); expect(report.storeTotalBytes).toBe(7 * MB);
    const prefixed = fixtures.list.mock.calls.filter(([options]) => options.prefix === 'recordings/');
    expect(prefixed).toHaveLength(3); expect(prefixed[1][0].cursor).toBe('2'); expect(prefixed[2][0].cursor).toBe('4');
    expect(fixtures.list.mock.calls.filter(([options]) => options.prefix === undefined)).toHaveLength(4);
  });
  it('treats an unreadable upload date as recent', async () => {
    fixtures.blobs = [blob('recordings/a/x/v1-x.webm', MB, new Date('nope'))];
    const report = await scanAudioStorage();
    expect(report.orphanFiles).toBe(0); expect(report.graceFiles).toBe(1);
  });
  it('stops on a repeating cursor instead of looping forever', async () => {
    fixtures.list.mockResolvedValue({ blobs: [], hasMore: true, cursor: 'same' });
    await expect(scanAudioStorage()).rejects.toThrow('BLOB_LIST_CURSOR_LOOP');
  });
});

describe('cleanupOrphanAudio', () => {
  it('deletes only old unreferenced blobs under recordings/ and nulls tombstoned pathnames', async () => {
    fixtures.blobs = [
      blob('recordings/a/live/v1-x.webm', 10 * MB), blob('recordings/a/trash/v1-x.webm', 5 * MB),
      blob('recordings/a/pending/v1-x.webm', 2 * MB, recent), blob('recordings/b/orphan/v1-x.webm', 7 * MB),
      blob('recordings/b/fresh/v1-x.webm', 1 * MB, recent), blob('other/old.png', 3 * MB),
    ];
    fixtures.rows = [
      { pathname: 'recordings/a/live/v1-x.webm', in_trash: false }, { pathname: 'recordings/a/trash/v1-x.webm', in_trash: true },
      { pathname: 'recordings/a/pending/v1-x.webm', in_trash: false },
    ];
    fixtures.del.mockImplementation(async (paths: string[]) => { fixtures.blobs = fixtures.blobs.filter(item => !paths.includes(item.pathname)); });
    const result = await cleanupOrphanAudio();
    expect(fixtures.del).toHaveBeenCalledTimes(1);
    expect(fixtures.del).toHaveBeenCalledWith(['recordings/b/orphan/v1-x.webm']);
    expect(result).toMatchObject({ deletedFiles: 1, freedBytes: 7 * MB, remaining: 0, report: { orphanFiles: 0, storeFiles: 5 } });
    const update = fixtures.sql.mock.calls.find(([strings]) => String(strings.join('?')).includes('UPDATE recording_audio SET pathname=NULL'));
    expect(String(update![0].join('?'))).toContain("state='deleted'");
    expect(update!.slice(1)).toEqual([['recordings/b/orphan/v1-x.webm']]);
  });
  it('deletes in batches of at most 100 and caps one call at 1000 files', async () => {
    fixtures.blobs = Array.from({ length: 1150 }, (_, i) => blob(`recordings/o/${String(i).padStart(4, '0')}/v1-x.webm`, 1000));
    fixtures.rows = [{ pathname: 'recordings/a/live/v1-x.webm', in_trash: false }];
    const result = await cleanupOrphanAudio();
    expect(fixtures.del).toHaveBeenCalledTimes(10);
    for (const [paths] of fixtures.del.mock.calls) expect(paths.length).toBeLessThanOrEqual(100);
    expect(result.deletedFiles).toBe(1000); expect(result.freedBytes).toBe(1_000_000); expect(result.remaining).toBe(150);
  });
  it('deletes nothing when every blob is referenced, recent or outside recordings/', async () => {
    fixtures.blobs = [blob('recordings/a/live/v1-x.webm', MB), blob('recordings/a/new/v1-x.webm', MB, recent), blob('legacy/old.webm', MB)];
    fixtures.rows = [{ pathname: 'recordings/a/live/v1-x.webm', in_trash: false }];
    const result = await cleanupOrphanAudio();
    expect(fixtures.del).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deletedFiles: 0, freedBytes: 0, remaining: 0 });
    expect(fixtures.sql.mock.calls.some(([strings]) => String(strings.join('?')).includes('UPDATE'))).toBe(false);
  });
  it('keeps pathname updates for batches already deleted when a later delete fails', async () => {
    fixtures.blobs = Array.from({ length: 150 }, (_, i) => blob(`recordings/o/${i}/v1-x.webm`, 10));
    fixtures.rows = [{ pathname: 'recordings/a/live/v1-x.webm', in_trash: false }];
    fixtures.del.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('blob down'));
    await expect(cleanupOrphanAudio()).rejects.toThrow('blob down');
    expect(fixtures.sql.mock.calls.filter(([strings]) => String(strings.join('?')).includes('UPDATE'))).toHaveLength(1);
  });
  it('refuses to delete on a preview deployment, whose database may lack the newest recordings', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    fixtures.blobs = [blob('recordings/b/orphan/v1-x.webm', MB)];
    fixtures.rows = [{ pathname: 'recordings/a/live/v1-x.webm', in_trash: false }];
    await expect(cleanupOrphanAudio()).rejects.toThrow('bản chính');
    expect(fixtures.del).not.toHaveBeenCalled();
    expect((await scanAudioStorage()).cleanupBlockedReason).toContain('bản chính');
  });
  it('allows cleanup in production and reports no block reason', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    fixtures.blobs = [blob('recordings/b/orphan/v1-x.webm', MB)];
    fixtures.rows = [{ pathname: 'recordings/a/live/v1-x.webm', in_trash: false }];
    expect((await scanAudioStorage()).cleanupBlockedReason).toBeNull();
    await expect(cleanupOrphanAudio()).resolves.toMatchObject({ deletedFiles: 1 });
  });
  it('refuses to wipe the store when the database has no live audio rows at all', async () => {
    fixtures.blobs = [blob('recordings/a/one/v1-x.webm', MB), blob('recordings/a/two/v1-x.webm', MB)];
    fixtures.rows = [];
    await expect(cleanupOrphanAudio()).rejects.toThrow('Không xóa gì');
    expect(fixtures.del).not.toHaveBeenCalled();
  });
});

async function request(method: string, body?: unknown, email = owner) {
  const cookie = 'authjs.session-token';
  const token = await encode({ secret, salt: cookie, token: { email }, maxAge: 3600 });
  return new Request('http://localhost/api/recordings/audio/storage', { method, headers: { cookie: `${cookie}=${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}

describe('/api/recordings/audio/storage', () => {
  it('rejects wrong-account sessions without touching storage', async () => {
    expect((await GET(await request('GET', undefined, 'other@example.com'))).status).toBe(401);
    expect((await POST(await request('POST', { confirm: true }, 'other@example.com'))).status).toBe(401);
    expect(fixtures.list).not.toHaveBeenCalled(); expect(fixtures.del).not.toHaveBeenCalled();
  });
  it('returns the report with private no-store headers', async () => {
    fixtures.blobs = [blob('recordings/a/x/v1-x.webm', MB)];
    const response = await GET(await request('GET'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ storeFiles: 1, orphanFiles: 1, orphanBytes: MB });
  });
  it('requires an exact { confirm: true } body before deleting anything', async () => {
    fixtures.blobs = [blob('recordings/a/x/v1-x.webm', MB)];
    fixtures.rows = [{ pathname: 'recordings/a/live/v1-x.webm', in_trash: false }];
    for (const body of [{}, { confirm: false }, { confirm: 'true' }, { confirm: true, paths: ['recordings/a/x/v1-x.webm'] }, '[]', 'not json']) {
      const response = await POST(await request('POST', body));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual(expect.any(String));
    }
    expect(fixtures.del).not.toHaveBeenCalled();
    const ok = await POST(await request('POST', { confirm: true }));
    expect(ok.status).toBe(200); expect(await ok.json()).toMatchObject({ deletedFiles: 1, freedBytes: MB });
  });
  it('rejects oversized bodies', async () => {
    const response = await POST(await request('POST', JSON.stringify({ confirm: true, pad: 'x'.repeat(2000) })));
    expect(response.status).toBe(413);
    expect(fixtures.del).not.toHaveBeenCalled();
  });
  it('answers 503 without a Blob token and does not list or delete', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    const get = await GET(await request('GET')); const post = await POST(await request('POST', { confirm: true }));
    expect(get.status).toBe(503); expect(post.status).toBe(503);
    expect(post.headers.get('cache-control')).toBe('private, no-store');
    expect((await get.json()).error).toContain('audio');
    expect(fixtures.list).not.toHaveBeenCalled(); expect(fixtures.del).not.toHaveBeenCalled();
  });
  it('turns provider failures into a Vietnamese JSON error', async () => {
    fixtures.list.mockRejectedValue(new Error('secret provider detail'));
    const response = await GET(await request('GET'));
    expect(response.status).toBe(503);
    const { error } = await response.json();
    expect(error).not.toContain('secret'); expect(error).toContain('Không');
  });
});
