import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { CachePort } from '../ports/cache.js';

export interface RouteCachePolicy {
  /** Time-to-live in milliseconds for fresh cache entries. */
  readonly ttlMs: number;
  /** Optional stale-while-revalidate window in milliseconds beyond `ttlMs`. */
  readonly swrMs?: number;
  /** `Cache-Control` visibility (`"public"` default, or `"private"` when `varyByUser` is true). */
  readonly scope?: 'public' | 'private';
  /** Partition cache entries by authenticated `user` (`subject` / `id`) or `Authorization` header. */
  readonly varyByUser?: boolean;
  /** Optional custom cache key builder. */
  readonly key?: (req: Request, user: unknown) => string;
}

export interface StoredHttpCacheEnvelope {
  readonly payload: unknown;
  readonly etag: string;
  readonly freshUntilMs: number;
}

/**
 * Computes a deterministic RFC 9110 weak ETag (`W/"<hex>"`) for a serialized JSON string or Buffer.
 */
export function computeWeakEtag(serializedJson: string): string {
  const digest = createHash('sha1').update(serializedJson, 'utf8').digest('base64url');
  return `W/"${serializedJson.length.toString(16)}-${digest.slice(0, 20)}"`;
}

/**
 * Evaluates RFC 9110 `If-None-Match` against a candidate `etag` (supporting `*` and comma-separated lists).
 */
export function matchesIfNoneMatch(req: Request, etag: string): boolean {
  const header = req.headers['if-none-match'];
  if (typeof header !== 'string' || header.length === 0) {
    return false;
  }
  const trimmed = header.trim();
  if (trimmed === '*') {
    return true;
  }
  const normalizedTarget = etag.startsWith('W/') ? etag.slice(2) : etag;
  const candidates = trimmed.split(',');
  for (const raw of candidates) {
    const token = raw.trim();
    const normalizedToken = token.startsWith('W/') ? token.slice(2) : token;
    if (normalizedToken === normalizedTarget) {
      return true;
    }
  }
  return false;
}

export function buildCacheControlHeader(policy: RouteCachePolicy): string {
  const scope = policy.scope ?? (policy.varyByUser ? 'private' : 'public');
  const maxAgeSec = Math.max(0, Math.floor(policy.ttlMs / 1000));
  const swrSec = policy.swrMs && policy.swrMs > 0 ? Math.floor(policy.swrMs / 1000) : 0;
  return swrSec > 0
    ? `${scope}, max-age=${maxAgeSec}, stale-while-revalidate=${swrSec}`
    : `${scope}, max-age=${maxAgeSec}`;
}

function extractUserPartition(req: Request, user: unknown): string {
  if (typeof user === 'object' && user !== null) {
    const rec = user as Record<string, unknown>;
    if (typeof rec['subject'] === 'string') return rec['subject'];
    if (typeof rec['id'] === 'string') return rec['id'];
    if (typeof rec['sub'] === 'string') return rec['sub'];
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.length > 0) {
    return createHash('sha1').update(auth, 'utf8').digest('base64url').slice(0, 12);
  }
  return 'anon';
}

export function buildDefaultRouteCacheKey(
  req: Request,
  user: unknown,
  policy: RouteCachePolicy,
): string {
  if (policy.key) {
    return policy.key(req, user);
  }
  const urlKey = req.originalUrl || req.url;
  if (policy.varyByUser) {
    return `http:${req.method}:${urlKey}:u=${extractUserPartition(req, user)}`;
  }
  return `http:${req.method}:${urlKey}`;
}

/**
 * Sends a JSON payload with weak `ETag` and returns `true` if short-circuited via `304 Not Modified`.
 */
export function sendJsonWithEtag(
  req: Request,
  res: Response,
  statusCode: number,
  payload: unknown,
  precomputedEtag?: string,
): { readonly etag: string; readonly serialized: string } {
  const serialized = JSON.stringify(payload);
  const etag = precomputedEtag ?? computeWeakEtag(serialized);
  res.setHeader('ETag', etag);

  if ((req.method === 'GET' || req.method === 'HEAD') && statusCode === 200) {
    if (matchesIfNoneMatch(req, etag)) {
      res.status(304).end();
      return { etag, serialized };
    }
  }

  res.status(statusCode).type('application/json; charset=utf-8').send(serialized);
  return { etag, serialized };
}

const BACKGROUND_REFRESHES = new Set<string>();

/**
 * Executes a route handler with stampede-coalesced `CachePort` storage, optional
 * `stale-while-revalidate`, `Cache-Control`, `X-Cache`, and conditional `ETag` (`304 Not Modified`).
 */
export async function executeCachedRoute(options: {
  readonly cache: CachePort;
  readonly policy: RouteCachePolicy;
  readonly req: Request;
  readonly res: Response;
  readonly user: unknown;
  readonly statusCode: number;
  readonly enableEtag: boolean;
  readonly computeFresh: () => Promise<unknown>;
  readonly computeBackgroundRefresh?: () => Promise<unknown>;
  readonly onBackgroundError?: (err: unknown) => void;
}): Promise<void> {
  const { cache, policy, req, res, user, statusCode, enableEtag, computeFresh } = options;
  const refreshFn = options.computeBackgroundRefresh ?? computeFresh;

  // Only cache GET / HEAD requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const fresh = await computeFresh();
    if (res.headersSent) return;
    if (statusCode === 204 || fresh === undefined) {
      res.status(statusCode).end();
    } else if (enableEtag) {
      sendJsonWithEtag(req, res, statusCode, fresh);
    } else {
      res.status(statusCode).json(fresh);
    }
    return;
  }

  const cacheKey = buildDefaultRouteCacheKey(req, user, policy);
  const cacheControl = buildCacheControlHeader(policy);
  const totalStoreTtlMs = policy.ttlMs + (policy.swrMs ?? 0);
  const now = Date.now();

  const existing = await cache.get<StoredHttpCacheEnvelope>(cacheKey);
  if (
    existing &&
    typeof existing === 'object' &&
    'etag' in existing &&
    'freshUntilMs' in existing
  ) {
    const isFresh = existing.freshUntilMs > now;
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-Cache', isFresh ? 'HIT' : 'STALE');
    if (policy.varyByUser) {
      res.vary('Authorization');
    }

    if (enableEtag) {
      sendJsonWithEtag(req, res, statusCode, existing.payload, existing.etag);
    } else {
      res.status(statusCode).json(existing.payload);
    }

    if (!isFresh && !BACKGROUND_REFRESHES.has(cacheKey)) {
      BACKGROUND_REFRESHES.add(cacheKey);
      void (async () => {
        try {
          const refreshed = await refreshFn();
          if (refreshed !== undefined) {
            const refreshedSerialized = JSON.stringify(refreshed);
            const envelope: StoredHttpCacheEnvelope = {
              payload: refreshed,
              etag: computeWeakEtag(refreshedSerialized),
              freshUntilMs: Date.now() + policy.ttlMs,
            };
            await cache.set(cacheKey, envelope, totalStoreTtlMs);
          }
        } catch (err) {
          options.onBackgroundError?.(err);
        } finally {
          BACKGROUND_REFRESHES.delete(cacheKey);
        }
      })();
    }
    return;
  }

  const fresh = await computeFresh();
  if (res.headersSent) return;

  if (statusCode === 204 || fresh === undefined) {
    res.status(statusCode).end();
    return;
  }

  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Cache', 'MISS');
  if (policy.varyByUser) {
    res.vary('Authorization');
  }

  const { etag } = enableEtag
    ? sendJsonWithEtag(req, res, statusCode, fresh)
    : { etag: computeWeakEtag(JSON.stringify(fresh)) };

  if (!enableEtag) {
    res.status(statusCode).json(fresh);
  }

  const envelope: StoredHttpCacheEnvelope = {
    payload: fresh,
    etag,
    freshUntilMs: Date.now() + policy.ttlMs,
  };
  await cache.set(cacheKey, envelope, totalStoreTtlMs);
}
