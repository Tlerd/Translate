import 'server-only';
import { Pool } from 'pg';

/** One result row. Mirrors the loosely typed rows the previous Neon driver returned. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqlRow = Record<string, any>;

/**
 * Tagged-template query function: await sql`SELECT * FROM t WHERE id = ${id}`.
 * Every interpolated value is sent as a bound parameter ($1..$n), never spliced into the SQL text.
 */
export type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<SqlRow[]>;

export interface SqlQuery {
  text: string;
  values: unknown[];
}

/** Converts a template literal into parameterised SQL text plus its ordered values. */
export function buildQuery(strings: ReadonlyArray<string>, values: ReadonlyArray<unknown>): SqlQuery {
  let text = strings[0] ?? '';
  for (let index = 0; index < values.length; index++) text += `$${index + 1}${strings[index + 1] ?? ''}`;
  return { text, values: [...values] };
}

interface PoolHolder {
  url: string;
  pool: Pool;
}

const POOL_KEY = Symbol.for('may-dich.cloud.sql-pool');
type GlobalWithPool = typeof globalThis & { [POOL_KEY]?: PoolHolder };

function poolMax(): number {
  const parsed = Number.parseInt(process.env.DATABASE_POOL_MAX ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

/** Singleton pool kept on globalThis so dev hot reloads do not leak connections. */
export function getPool(url: string): Pool {
  const holder = globalThis as GlobalWithPool;
  const existing = holder[POOL_KEY];
  if (existing && existing.url === url) return existing.pool;
  if (existing) void existing.pool.end().catch(() => undefined);
  const pool = new Pool({
    connectionString: url,
    max: poolMax(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle client dropped by the server (restart, failover) emits 'error' on the pool; unhandled it would crash the process.
  pool.on('error', () => undefined);
  holder[POOL_KEY] = { url, pool };
  return pool;
}

/** Closes the shared pool (tests and graceful shutdown). */
export async function closeSqlPool(): Promise<void> {
  const holder = globalThis as GlobalWithPool;
  const existing = holder[POOL_KEY];
  holder[POOL_KEY] = undefined;
  if (existing) await existing.pool.end();
}

export function createSqlClient(url: string): SqlClient {
  return async (strings, ...values) => {
    const { text, values: params } = buildQuery(strings, values);
    const result = await getPool(url).query(text, params);
    return result.rows as SqlRow[];
  };
}
