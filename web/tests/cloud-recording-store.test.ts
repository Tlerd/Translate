import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudPayload, CloudRow } from '@/shared/cloud-recording';

const { neonMock } = vi.hoisted(() => ({ neonMock: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ neon: neonMock }));

import { readCloudRecording, readCloudRecordingIndex, writeCloudRecording } from '@/server/cloud/recording-store';

function fakeNeon() {
  const rows = new Map<string, CloudRow>();
  const audioTombstones = new Set<string>();
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join('?');
    if (statement.includes('CREATE TABLE')) return [];
    if (statement.includes('SELECT id,version FROM recording_sync')) {
      const owner = String(values[0]);
      const cursor = statement.includes('id>?') ? String(values[1]) : null;
      return [...rows.entries()]
        .filter(([key, row]) => key.startsWith(`${owner}:`) && (cursor === null || row.id > cursor))
        .map(([, row]) => ({ id: row.id, version: row.version }))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 500);
    }
    if (statement.includes('SELECT id,version,payload FROM recording_sync')) {
      const [owner, id] = values as [string, string];
      const row = rows.get(`${owner}:${id}`);
      return row ? [row] : [];
    }
    if (statement.includes('INSERT INTO recording_sync')) {
      const [owner, id, rawPayload] = values as [string, string, string | null];
      const key = `${owner}:${id}`;
      if (rows.has(key)) return [];
      const row: CloudRow = { id, version: 1, payload: rawPayload ? JSON.parse(rawPayload) as CloudPayload : null };
      rows.set(key, row);
      if (statement.includes('INSERT INTO recording_audio')) audioTombstones.add(key);
      return [row];
    }
    if (statement.includes('UPDATE recording_sync')) {
      const [rawPayload, owner, id, expectedVersion] = values as [string | null, string, string, number];
      const key = `${owner}:${id}`;
      const current = rows.get(key);
      if (!current || current.version !== expectedVersion) return [];
      const row: CloudRow = { id, version: current.version + 1, payload: rawPayload ? JSON.parse(rawPayload) as CloudPayload : null };
      rows.set(key, row);
      if (statement.includes('INSERT INTO recording_audio')) audioTombstones.add(key);
      return [row];
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  };
  return { sql, rows, audioTombstones };
}

describe('cloud recording SQL compare-and-swap', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://test-only');
    vi.stubEnv('POSTGRES_URL', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    neonMock.mockReset();
  });

  it('allows only one concurrent writer at the expected version and isolates owners', async () => {
    const fake = fakeNeon();
    neonMock.mockReturnValue(fake.sql);
    const one: CloudPayload = { recording: { id: 'rec', title: 'one', createdAt: '2026-01-01', mode: 'lecture', sourceLanguage: 'ja', targetLanguage: 'vi', state: 'stopped', durationMs: 10, audioState: 'missing', config: { translationModelKey: 'm' } }, captions: [], summaries: [] };
    const two = { ...one, recording: { ...one.recording, title: 'two' } };
    const three = { ...one, recording: { ...one.recording, title: 'three' } };

    expect(await writeCloudRecording('owner-a', 'rec', 0, one)).toMatchObject({ version: 1, payload: one });
    const results = await Promise.all([
      writeCloudRecording('owner-a', 'rec', 1, two),
      writeCloudRecording('owner-a', 'rec', 1, three),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((row) => row === null)).toHaveLength(1);
    expect(fake.rows.get('owner-a:rec')?.version).toBe(2);

    expect(await writeCloudRecording('owner-b', 'rec', 0, three)).toMatchObject({ version: 1, payload: three });
    expect(fake.rows.get('owner-b:rec')?.payload?.recording.title).toBe('three');
  });

  it('fails closed when no hosted database is configured', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    await expect(writeCloudRecording('owner-a', 'rec', 0, null)).rejects.toThrow('CLOUD_NOT_CONFIGURED');
    expect(neonMock).not.toHaveBeenCalled();
  });

  it('commits an audio tombstone for old text-only deletions without deleting on a CAS conflict', async () => {
    const fake = fakeNeon();
    neonMock.mockReturnValue(fake.sql);
    fake.rows.set('owner-a:rec', { id: 'rec', version: 2, payload: null });
    expect(await writeCloudRecording('owner-a', 'rec', 1, null)).toBeNull();
    expect(fake.audioTombstones.size).toBe(0);
    expect(await writeCloudRecording('owner-a', 'rec', 2, null)).toMatchObject({ version: 3, payload: null });
    expect(fake.audioTombstones).toEqual(new Set(['owner-a:rec']));
    expect(await writeCloudRecording('owner-b', 'new-rec', 0, null)).toMatchObject({ version: 1 });
    expect(fake.audioTombstones.has('owner-b:new-rec')).toBe(true);
  });

  it('serves an id/version index in cursor pages and returns payloads only for explicit IDs', async () => {
    const fake = fakeNeon();
    neonMock.mockReturnValue(fake.sql);
    for (let index = 0; index < 501; index++) {
      const id = `rec-${String(index).padStart(3, '0')}`;
      fake.rows.set(`owner-a:${id}`, { id, version: 1, payload: null });
    }

    const first = await readCloudRecordingIndex('owner-a');
    const second = await readCloudRecordingIndex('owner-a', first.nextCursor);
    expect(first.items).toHaveLength(500);
    expect(first.nextCursor).toBe(first.items.at(-1)?.id);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(await readCloudRecording('owner-a', 'rec-500')).toMatchObject({ id: 'rec-500', payload: null });
    expect(await readCloudRecording('owner-b', 'rec-500')).toBeNull();
  });
});
