import 'fake-indexeddb/auto';
vi.mock('@/storage/audio-sync', () => ({ synchronizeAudio: vi.fn().mockResolvedValue({ pending: 0, errors: 0 }) }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDatabase, resetDbInstance, getDb } from '@/storage/db';
import { cloudPayloadSchema, type CloudPayload, type CloudRow } from '@/shared/cloud-recording';
import { synchronizeRecordings, syncEvent } from '@/storage/cloud-sync';

const recording = (overrides: Partial<CloudPayload['recording']> = {}): CloudPayload['recording'] => ({
  id: 'rec-1', title: 'Test', createdAt: '2026-10-01T00:00:00.000Z', mode: 'lecture',
  sourceLanguage: 'ja', targetLanguage: 'vi', state: 'stopped', durationMs: 1000,
  audioState: 'missing', config: { translationModelKey: 'test-model' }, ...overrides,
});
const caption = (source: string, overrides: Partial<CloudPayload['captions'][number]> = {}): CloudPayload['captions'][number] => ({
  id: 1, recordingId: 'rec-1', blockId: 1, startMs: 0, endMs: 1000,
  source, revision: 1, isFinal: true, translation: 'translation', targetSourceRevision: 1,
  state: 'done', ...overrides,
});
const payload = (source: string, rec = recording()): CloudPayload => ({ recording: rec, captions: [caption(source)], summaries: [] });
const baseline = (version: number, content: CloudPayload | null) => ({ key: 'cloud:rec-1', value: JSON.stringify({ version, content: content === null ? null : JSON.stringify(content) }) });
function remoteFetch(row: CloudRow) {
  return vi.fn(async (url: string) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.searchParams.has('id')) return new Response(JSON.stringify({ row }), { status: 200 });
    return new Response(JSON.stringify({ items: [{ id: row.id, version: row.version }], nextCursor: null }), { status: 200 });
  });
}

describe('cloud payload audioSource', () => {
  it('accepts config.audioSource and payloads without it', () => {
    const withSource = payload('a', recording({ config: { translationModelKey: 'test-model', audioSource: 'display' } }));
    const withoutSource = payload('b');
    expect(cloudPayloadSchema.safeParse(withSource).success).toBe(true);
    expect(cloudPayloadSchema.safeParse(withoutSource).success).toBe(true);
  });

  it('still rejects unknown config fields', () => {
    const bogus = payload('c', recording({ config: { translationModelKey: 'test-model', bogus: true } as unknown as CloudPayload['recording']['config'] }));
    expect(cloudPayloadSchema.safeParse(bogus).success).toBe(false);
  });
});

describe('cloud recording sync', () => {
  beforeEach(() => {
    resetDbInstance(new AppDatabase(`cloud_sync_${Date.now()}_${Math.random()}`));
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  });
  afterEach(() => {
    resetDbInstance();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not overwrite a local caption edit made while a remote snapshot is being ingested', async () => {
    const db = getDb();
    const local = payload('baseline source');
    await db.recordings.put(local.recording);
    await db.captions.put(local.captions[0]);
    await db.settings.put(baseline(1, local));
    const remote: CloudRow = { id: 'rec-1', version: 2, payload: payload('remote source') };
    vi.stubGlobal('fetch', remoteFetch(remote));

    const originalGet = db.recordings.get.bind(db.recordings);
    let reads = 0;
    const hookedGet = (id: string) => originalGet(id).then((value) => {
      reads++;
      if (reads === 2) return db.captions.put(caption('local edit during download')).then(() => value);
      return value;
    });
    vi.spyOn(db.recordings, 'get').mockImplementation(hookedGet as typeof db.recordings.get);

    await synchronizeRecordings();

    expect((await db.captions.get(['rec-1', 1]))?.source).toBe('local edit during download');
    expect((await db.settings.get('cloud:rec-1'))?.value).toContain('"version":1');
    expect((window.dispatchEvent as ReturnType<typeof vi.fn>).mock.calls.some(([event]) => (event as Event).type === syncEvent && (event as CustomEvent).detail.state === 'error')).toBe(true);
  });

  it('accepts source revision history without relaxing the other cloud fields', () => {
    const candidate = payload('corrected source', recording({ audioState: 'deleted' }));
    candidate.captions[0].sourceHistory = [
      { text: 'first wording', revision: 1 },
      { text: 'corrected source', revision: 3 },
    ];
    expect(cloudPayloadSchema.parse(candidate).captions[0].sourceHistory).toEqual(candidate.captions[0].sourceHistory);
  });

  it('marks audio deleted on another device as missing when cloning a cloud recording', async () => {
    const db = getDb();
    const remote: CloudRow = { id: 'rec-1', version: 1, payload: payload('shared words', recording({ audioState: 'deleted', audioMimeType: 'audio/webm' })) };
    vi.stubGlobal('fetch', remoteFetch(remote));

    await synchronizeRecordings();

    expect(await db.recordings.get('rec-1')).toMatchObject({ audioState: 'missing' });
    expect((await db.recordings.get('rec-1'))?.audioMimeType).toBeUndefined();
  });

  it('preserves audio stored locally while importing remote transcript edits', async () => {
    const db = getDb();
    const localRecording = recording({ audioState: 'present', audioMimeType: 'audio/webm' });
    const local = payload('baseline source', localRecording);
    await db.recordings.put(local.recording);
    await db.captions.put(local.captions[0]);
    const cloudBaseline = payload('baseline source');
    await db.settings.put(baseline(1, cloudBaseline));
    const remote: CloudRow = { id: 'rec-1', version: 2, payload: payload('remote source') };
    vi.stubGlobal('fetch', remoteFetch(remote));

    await synchronizeRecordings();

    expect(await db.recordings.get('rec-1')).toMatchObject({ audioState: 'present', audioMimeType: 'audio/webm' });
    expect((await db.captions.get(['rec-1', 1]))?.source).toBe('remote source');
  });

  it('leaves an active local recording untouched and does not advance its cloud baseline', async () => {
    const db = getDb();
    const active = payload('live local source', recording({ state: 'recording' }));
    await db.recordings.put(active.recording);
    await db.captions.put(active.captions[0]);
    await db.settings.put(baseline(1, active));
    const remote: CloudRow = { id: 'rec-1', version: 2, payload: payload('remote source') };
    vi.stubGlobal('fetch', remoteFetch(remote));

    await synchronizeRecordings();

    expect((await db.recordings.get('rec-1'))?.state).toBe('recording');
    expect((await db.captions.get(['rec-1', 1]))?.source).toBe('live local source');
    expect((await db.settings.get('cloud:rec-1'))?.value).toContain('"version":1');
  });

  it('keeps the local version as a bounded, audio-free copy when both devices changed', async () => {
    const db = getDb();
    const previous = payload('previous source');
    const local = payload('local edit', recording({ title: 'x'.repeat(2000) }));
    const remotePayload = payload('remote edit');
    await db.recordings.put(local.recording);
    await db.captions.put(local.captions[0]);
    const oldBaseline = payload('previous source', local.recording);
    await db.settings.put(baseline(1, oldBaseline));
    const remote: CloudRow = { id: 'rec-1', version: 2, payload: remotePayload };
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (init?.method === 'PUT') {
        const sent = JSON.parse(String(init.body)) as { id: string; payload: CloudPayload };
        return new Response(JSON.stringify({ row: { id: sent.id, version: 1, payload: sent.payload } }), { status: 200 });
      }
      const parsed = new URL(url, 'http://localhost');
      return parsed.searchParams.has('id')
        ? new Response(JSON.stringify({ row: remote }), { status: 200 })
        : new Response(JSON.stringify({ items: [{ id: remote.id, version: remote.version }], nextCursor: null }), { status: 200 });
    }));

    await synchronizeRecordings();

    expect((await db.captions.get(['rec-1', 1]))?.source).toBe('remote edit');
    const copy = (await db.recordings.toArray()).find(item => item.id !== 'rec-1');
    expect(copy).toMatchObject({ title: `${'x'.repeat(1960)} (bản sao khi xung đột)`, audioState: 'missing' });
    const copyPayload = requests.map(request => request.init?.body).filter(Boolean).map(body => JSON.parse(String(body)) as { id: string; payload: CloudPayload })[0];
    expect(copyPayload.payload.captions[0].source).toBe('local edit');
    expect(copyPayload.id.length).toBeLessThanOrEqual(160);
    expect(copyPayload.payload.summaries).toEqual([]);
    expect(cloudPayloadSchema.safeParse(copyPayload.payload).success).toBe(true);
    expect(previous.recording.id).toBe('rec-1');
  });

  it('walks every metadata page without downloading unchanged transcript payloads', async () => {
    const db = getDb();
    const ids = Array.from({ length: 1001 }, (_, index) => `remote-${String(index).padStart(4, '0')}`);
    await db.settings.bulkPut(ids.map(id => ({ key: `cloud:${id}`, value: JSON.stringify({ version: 1, content: null }) })));
    const pageOne = ids.slice(0, 500).map(id => ({ id, version: 1 }));
    const pageTwo = ids.slice(500).map(id => ({ id, version: 1 }));
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, 'http://localhost');
      if (parsed.searchParams.has('id')) throw new Error('Unchanged index entries must not download full rows.');
      return parsed.searchParams.has('cursor')
        ? new Response(JSON.stringify({ items: pageTwo, nextCursor: null }), { status: 200 })
        : new Response(JSON.stringify({ items: pageOne, nextCursor: pageOne.at(-1)!.id }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await synchronizeRecordings();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain(`cursor=${pageOne.at(-1)!.id}`);
  });
});
