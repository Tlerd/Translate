import { afterEach, describe, expect, it, vi } from 'vitest';

const { queryMock, endMock, onMock, poolCtor } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const endMock = vi.fn(async () => undefined);
  const onMock = vi.fn();
  const poolCtor = vi.fn();
  return { queryMock, endMock, onMock, poolCtor };
});
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      poolCtor(options);
    }
    query = queryMock;
    end = endMock;
    on = onMock;
  },
}));

import { buildQuery, closeSqlPool, createSqlClient, getPool } from '@/server/cloud/sql';

function tag(strings: TemplateStringsArray, ...values: unknown[]) {
  return buildQuery(strings, values);
}

describe('buildQuery', () => {
  it('numbers every interpolation as $1..$n and keeps values out of the text', () => {
    const owner = "o'; DROP TABLE x;--";
    const q = tag`SELECT id FROM t WHERE owner=${owner} AND id>${'a'} LIMIT ${500}`;
    expect(q.text).toBe('SELECT id FROM t WHERE owner=$1 AND id>$2 LIMIT $3');
    expect(q.values).toEqual([owner, 'a', 500]);
    expect(q.text).not.toContain('DROP');
  });

  it('gives a repeated value a fresh placeholder each time and keeps casts attached', () => {
    const json = '{"a":1}';
    const q = tag`INSERT INTO t(a,b) VALUES(${json}::jsonb,${json}::jsonb)`;
    expect(q.text).toBe('INSERT INTO t(a,b) VALUES($1::jsonb,$2::jsonb)');
    expect(q.values).toEqual([json, json]);
  });

  it('passes null, Date and array values through untouched for pg to serialize', () => {
    const when = new Date('2026-01-01T00:00:00Z');
    const paths = ['a', 'b'];
    const q = tag`UPDATE t SET x=${null}, y=${when} WHERE p = ANY(${paths})`;
    expect(q.text).toBe('UPDATE t SET x=$1, y=$2 WHERE p = ANY($3)');
    expect(q.values[0]).toBeNull();
    expect(q.values[1]).toBe(when);
    expect(q.values[2]).toBe(paths);
  });

  it('leaves a statement without values untouched', () => {
    expect(tag`CREATE TABLE IF NOT EXISTS t (id text)`).toEqual({ text: 'CREATE TABLE IF NOT EXISTS t (id text)', values: [] });
  });
});

describe('createSqlClient', () => {
  afterEach(async () => {
    await closeSqlPool();
    queryMock.mockReset();
    endMock.mockClear();
    onMock.mockClear();
    poolCtor.mockClear();
  });

  it('runs parameterised queries on a shared pool and returns the rows', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'r1', version: 2 }] });
    const sql = createSqlClient('postgres://u:p@h/db?sslmode=require');
    const rows = await sql`SELECT id,version FROM t WHERE owner=${'me'} LIMIT ${5}`;
    await sql`SELECT 1`;
    expect(rows).toEqual([{ id: 'r1', version: 2 }]);
    expect(queryMock).toHaveBeenNthCalledWith(1, 'SELECT id,version FROM t WHERE owner=$1 LIMIT $2', ['me', 5]);
    expect(poolCtor).toHaveBeenCalledTimes(1);
    expect(poolCtor).toHaveBeenCalledWith(expect.objectContaining({ connectionString: 'postgres://u:p@h/db?sslmode=require', max: 5, idleTimeoutMillis: 30_000 }));
  });

  it('registers an error listener so an idle client failure cannot crash the process', () => {
    getPool('postgres://one');
    expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('keys the singleton on the URL and closes the previous pool when it changes', () => {
    const a = getPool('postgres://one');
    expect(getPool('postgres://one')).toBe(a);
    const b = getPool('postgres://two');
    expect(b).not.toBe(a);
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it('propagates query errors to the caller', async () => {
    queryMock.mockRejectedValue(new Error('boom'));
    await expect(createSqlClient('postgres://x')`SELECT 1`).rejects.toThrow('boom');
  });
});
