import { createToken } from '../di/tokens.js';

/**
 * Database- & vendor-agnostic caching extension port (Hard Constraint 5).
 * Implement with Redis, Valkey, Memcached, or use the built-in bounded LRU `InMemoryCache`.
 */
export interface CachePort {
  get<T = unknown>(key: string): Promise<T | undefined> | T | undefined;
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> | void;
  del(key: string): Promise<void> | void;
  delByPrefix?(prefix: string): Promise<number> | number;
  clear?(): Promise<void> | void;
}

/**
 * Canonical DI token for `CachePort` (matches `LoggerToken`, `RateLimiterToken`, and `MetricsToken`).
 */
export const CacheToken = createToken<CachePort>('Cache');

/** Alias retained for backwards compatibility. */
export const CachePortToken = CacheToken;

interface CacheEntry {
  value: unknown;
  expiresAt: number | undefined;
}

/**
 * Bounded, true-LRU, TTL-aware in-memory `CachePort` implementation suitable for single-node
 * deployments, local development, and deterministic integration tests.
 *
 * Includes in-flight stampede coalescing via `getOrSet(...)` and prefix invalidation via `delByPrefix(...)`.
 */
export class InMemoryCache implements CachePort {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxKeys: number;

  public constructor(maxKeys = 10_000) {
    this.maxKeys = maxKeys;
  }

  public get size(): number {
    return this.entries.size;
  }

  public get<T = unknown>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // O(1) LRU promotion: move accessed key to tail of Map insertion order
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  public set<T = unknown>(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const expiresAt = ttlMs !== undefined && ttlMs > 0 ? now + ttlMs : undefined;

    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxKeys) {
      this.evictExpiredOrLeastRecentlyUsed(now);
    }

    this.entries.set(key, { value, expiresAt });
  }

  public del(key: string): void {
    this.entries.delete(key);
  }

  public delByPrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public clear(): void {
    this.entries.clear();
    GLOBAL_STAMPEDE_MAP.delete(this);
  }

  /**
   * Stampede-safe read-through cache helper: concurrent callers for the same missing `key`
   * share a single in-flight `loader()` Promise.
   */
  public async getOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T> | T): Promise<T> {
    return cacheGetOrSet(this, key, ttlMs, loader);
  }

  private evictExpiredOrLeastRecentlyUsed(now: number): void {
    for (const [k, v] of this.entries) {
      if (v.expiresAt !== undefined && v.expiresAt <= now) {
        this.entries.delete(k);
      }
    }
    if (this.entries.size >= this.maxKeys) {
      const lruKey = this.entries.keys().next().value;
      if (lruKey !== undefined) {
        this.entries.delete(lruKey);
      }
    }
  }
}

const GLOBAL_STAMPEDE_MAP = new WeakMap<CachePort, Map<string, Promise<unknown>>>();

/**
 * Universal stampede-safe read-through cache helper that works with ANY `CachePort` adapter
 * (Redis, Valkey, Memcached, or `InMemoryCache`). Concurrent misses on `key` coalesce onto one `loader()` call.
 */
export async function cacheGetOrSet<T>(
  cache: CachePort,
  key: string,
  ttlMs: number,
  loader: () => Promise<T> | T,
): Promise<T> {
  let inflight = GLOBAL_STAMPEDE_MAP.get(cache);
  if (!inflight) {
    inflight = new Map<string, Promise<unknown>>();
    GLOBAL_STAMPEDE_MAP.set(cache, inflight);
  }

  const existingInFlight = inflight.get(key);
  if (existingInFlight !== undefined) {
    return (await existingInFlight) as T;
  }

  const coalescedPromise = (async (): Promise<T> => {
    try {
      const cached = await cache.get<T>(key);
      if (cached !== undefined) {
        return cached;
      }
      const fresh = await loader();
      await cache.set(key, fresh, ttlMs);
      return fresh;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, coalescedPromise);
  return coalescedPromise;
}
