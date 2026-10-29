import { createToken } from '../di/tokens.js';

/**
 * Database- & vendor-agnostic caching extension port (Hard Constraint 5).
 * Implement with Redis, Valkey, Memcached, or use the built-in bounded `InMemoryCache`.
 */
export interface CachePort {
  get<T = unknown>(key: string): Promise<T | undefined> | T | undefined;
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> | void;
  del(key: string): Promise<void> | void;
  clear?(): Promise<void> | void;
}

/**
 * Canonical DI token for `CachePort` (matches `LoggerToken` and `RateLimiterToken`).
 */
export const CacheToken = createToken<CachePort>('Cache');

/** Alias retained for backwards compatibility. */
export const CachePortToken = CacheToken;

interface CacheEntry {
  value: unknown;
  expiresAt: number | undefined;
}

/**
 * Bounded, TTL-aware in-memory `CachePort` implementation suitable for single-node
 * deployments, local development, and deterministic integration tests.
 */
export class InMemoryCache implements CachePort {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxKeys: number;

  public constructor(maxKeys = 10_000) {
    this.maxKeys = maxKeys;
  }

  public get<T = unknown>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  public set<T = unknown>(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const expiresAt = ttlMs !== undefined && ttlMs > 0 ? now + ttlMs : undefined;

    if (!this.entries.has(key) && this.entries.size >= this.maxKeys) {
      this.evictExpiredOrOldest(now);
    }

    this.entries.set(key, { value, expiresAt });
  }

  public del(key: string): void {
    this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }

  private evictExpiredOrOldest(now: number): void {
    for (const [k, v] of this.entries) {
      if (v.expiresAt !== undefined && v.expiresAt <= now) {
        this.entries.delete(k);
      }
    }
    if (this.entries.size >= this.maxKeys) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
  }
}
