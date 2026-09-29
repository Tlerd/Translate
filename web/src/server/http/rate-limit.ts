import 'server-only';
import { Redis } from '@upstash/redis';
import { getServerEnv } from '@/config/env.server';

interface MemoryEntry {
  count: number;
  resetAt: number;
}

const memoryRateLimitMap = new Map<string, MemoryEntry>();
const memoryIdempotencySet = new Map<string, number>();

function getRedisClient(): Redis | null {
  const env = getServerEnv();
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      return new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      });
    } catch {
      return null;
    }
  }
  return null;
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
  const redis = getRedisClient();

  if (redis) {
    try {
      const fullKey = `rl:${key}`;
      const count = await redis.incr(fullKey);
      if (count === 1) {
        await redis.expire(fullKey, windowSeconds);
      }
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
  const redis = getRedisClient();

  if (redis) {
    try {
      const res = await redis.set(`idem:${key}`, 'locked', {
        nx: true,
        ex: ttlSeconds,
      });
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
