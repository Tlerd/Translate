import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: { status: 'ready', multiResult: null as unknown, setResult: 'OK' as string | null, fail: false, instances: 0 },
}));

vi.mock('ioredis', () => ({
  default: class {
    status = state.status;
    constructor() {
      state.instances++;
    }
    on() {
      return this;
    }
    async connect() {
      this.status = 'ready';
    }
    disconnect() {}
    multi() {
      const chain = {
        set: () => chain,
        incr: () => chain,
        exec: async () => {
          if (state.fail) throw new Error('down');
          return state.multiResult;
        },
      };
      return chain;
    }
    async ttl() {
      return 30;
    }
    async set() {
      if (state.fail) throw new Error('down');
      return state.setResult;
    }
  },
}));

import { acquireIdempotencyLock, checkRateLimit } from '@/server/http/rate-limit';

describe('rate limit and idempotency over Redis', () => {
  beforeEach(() => {
    vi.stubEnv('REDIS_URL', 'redis://test-host:6379');
    state.status = 'wait';
    state.fail = false;
    state.setResult = 'OK';
    (globalThis as Record<symbol, unknown>)[Symbol.for('may-dich.http.redis')] = undefined;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('allows under the limit and reports remaining from the INCR count', async () => {
    state.multiResult = [[null, 'OK'], [null, 3]];
    expect(await checkRateLimit('a', 5, 60)).toEqual({ allowed: true, remaining: 2 });
  });

  it('blocks over the limit using the key TTL', async () => {
    state.multiResult = [[null, null], [null, 6]];
    expect(await checkRateLimit('b', 5, 60)).toEqual({ allowed: false, remaining: 0, retryAfterMs: 30_000 });
  });

  it('falls back to memory when Redis errors, keeping limit semantics', async () => {
    state.fail = true;
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await checkRateLimit('mem', 2, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
  });

  it('falls back to memory when a MULTI command reports an error', async () => {
    state.multiResult = [[null, 'OK'], [new Error('oom'), null]];
    expect((await checkRateLimit('multi-err', 1, 60)).allowed).toBe(true);
    expect((await checkRateLimit('multi-err', 1, 60)).allowed).toBe(false);
  });

  it('uses memory when REDIS_URL is unset', async () => {
    vi.stubEnv('REDIS_URL', '');
    const before = state.instances;
    expect((await checkRateLimit('nored', 1, 60)).allowed).toBe(true);
    expect((await checkRateLimit('nored', 1, 60)).allowed).toBe(false);
    expect(state.instances).toBe(before);
  });

  it('acquires the idempotency lock only when SET NX succeeds, with memory fallback on error', async () => {
    expect(await acquireIdempotencyLock('k1')).toBe(true);
    state.setResult = null;
    expect(await acquireIdempotencyLock('k1')).toBe(false);
    state.fail = true;
    expect(await acquireIdempotencyLock('k2')).toBe(true);
    expect(await acquireIdempotencyLock('k2')).toBe(false);
  });
});
