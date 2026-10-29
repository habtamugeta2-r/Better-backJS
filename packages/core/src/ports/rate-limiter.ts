import type { Request } from 'express';
import { createToken } from '../di/tokens.js';

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetEpochSeconds: number;
  readonly retryAfterSeconds: number;
}

/**
 * Vendor-agnostic rate-limiter port (swap `InMemoryRateLimiter` for Redis/Upstash in multi-replica clusters).
 */
export interface RateLimiterPort {
  consume(
    key: string,
    max: number,
    windowMs: number,
  ): Promise<RateLimitDecision> | RateLimitDecision;
}

export const RateLimiterToken = createToken<RateLimiterPort>('RateLimiter');

export interface RateLimitPolicy {
  readonly max: number;
  readonly windowMs: number;
  readonly keyGenerator?: (req: Request) => string;
}

interface Bucket {
  count: number;
  resetAtMs: number;
}

/**
 * Bounded fixed-window in-memory rate limiter suitable for single-node deployments and tests.
 * Automatically evicts expired keys when `maxKeys` is reached to prevent memory exhaustion.
 */
export class InMemoryRateLimiter implements RateLimiterPort {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;

  public constructor(maxKeys = 50_000) {
    this.maxKeys = maxKeys;
  }

  public consume(key: string, max: number, windowMs: number): RateLimitDecision {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAtMs <= now) {
      if (this.buckets.size >= this.maxKeys) {
        this.evictExpired(now);
      }
      bucket = { count: 0, resetAtMs: now + windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    const allowed = bucket.count <= max;
    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000));
    const resetEpochSeconds = Math.ceil(bucket.resetAtMs / 1000);

    return {
      allowed,
      limit: max,
      remaining,
      resetEpochSeconds,
      retryAfterSeconds,
    };
  }

  private evictExpired(now: number): void {
    for (const [k, v] of this.buckets) {
      if (v.resetAtMs <= now) {
        this.buckets.delete(k);
      }
    }
    if (this.buckets.size >= this.maxKeys) {
      const firstKey = this.buckets.keys().next().value;
      if (firstKey !== undefined) {
        this.buckets.delete(firstKey);
      }
    }
  }
}
