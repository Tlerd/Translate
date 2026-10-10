import 'server-only';
import Redis from 'ioredis';
import { getServerEnv } from '@/config/env.server';

interface MemoryEntry {
  count: number;
  resetAt: number;
}

const memoryRateLimitMap = new Map<string, MemoryEntry>();
const memoryIdempotencySet = new Map<string, number>();

interface RedisHolder {
  url: string;
  client: Redis;
  connecting: Promise<void> | null;
}

const REDIS_KEY = Symbol.for('may-dich.http.redis');
type GlobalWithRedis = typeof globalThis & { [REDIS_KEY]?: RedisHolder };

function createHolder(url: string): RedisHolder {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  // Without a listener ioredis would turn connection errors into unhandled 'error' events.
  client.on('error', () => undefined);
  return { url, client, connecting: null };
}

/**
 * Returns a connected client, or null when Redis is not configured or unreachable
 * (callers then use their in-memory path). Never throws.
 */
async function getRedisClient(): Promise<Redis | null> {
  const url = getServerEnv().REDIS_URL;
  if (!url) return null;
  try {
    const globals = globalThis as GlobalWithRedis;
    let holder = globals[REDIS_KEY];
    if (!holder || holder.url !== url) {
      if (holder) holder.client.disconnect();
      holder = createHolder(url);
      globals[REDIS_KEY] = holder;
    }
    const { client } = holder;
    // With the offline queue disabled, commands sent before the socket is ready fail fast, so connect explicitly first.
    if (client.status === 'wait' || client.status === 'end') {
      const current = holder;
      current.connecting ??= client.connect().finally(() => {
        current.connecting = null;
      });
    }
    if (holder.connecting) await holder.connecting;
    return client.status === 'ready' ? client : null;
  } catch {
    return null;
  }
}

/**
 * Checks rate limit for a given key.
 * Returns true if allowed, false if limit exceeded.
 */
export async function checkRateLimit(
  key: string,
  limit = 60,
  windowSeconds = 60
): Promise<{ allowed: boolean; remaining: number; retryAfterMs?: number }> {
  const redis = await getRedisClient();

  if (redis) {
    try {
      const fullKey = `rl:${key}`;
      // One MULTI round trip: the window TTL is only set when the key is created (SET NX), INCR keeps it.
      const replies = await redis.multi().set(fullKey, 0, 'EX', windowSeconds, 'NX').incr(fullKey).exec();
      const incr = replies?.[1];
      if (!incr || incr[0]) throw incr?.[0] ?? new Error('REDIS_MULTI_FAILED');
      const count = Number(incr[1]);
      if (count > limit) {
        const ttl = await redis.ttl(fullKey);
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(1000, ttl * 1000),
        };
      }
      return { allowed: true, remaining: limit - count };
    } catch {
      // Fallback to memory on redis error
    }
  }

  // Memory fallback
  const now = Date.now();
  const entry = memoryRateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    memoryRateLimitMap.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1 };
  }

  entry.count++;
  if (entry.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(1000, entry.resetAt - now),
    };
  }

  return { allowed: true, remaining: limit - entry.count };
}

/**
 * Atomic idempotency check with 15 minutes TTL.
 * Returns true if this is the first execution (lock acquired), false if already running or completed.
 */
export async function acquireIdempotencyLock(
  key: string,
  ttlSeconds = 900
): Promise<boolean> {
  const redis = await getRedisClient();

  if (redis) {
    try {
      const res = await redis.set(`idem:${key}`, 'locked', 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch {
      // Fallback
    }
  }

  // Memory fallback
  const now = Date.now();
  const expireAt = memoryIdempotencySet.get(key);
  if (expireAt && now < expireAt) {
    return false;
  }

  memoryIdempotencySet.set(key, now + ttlSeconds * 1000);
  return true;
}
