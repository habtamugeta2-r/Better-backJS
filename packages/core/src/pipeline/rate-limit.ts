import type { RequestHandler } from 'express';
import { RateLimitExceededError } from '../errors/app-error.js';
import {
  InMemoryRateLimiter,
  RateLimiterToken,
  type RateLimitDecision,
  type RateLimiterPort,
  type RateLimitPolicy,
} from '../ports/rate-limiter.js';

export {
  InMemoryRateLimiter,
  RateLimiterToken,
  type RateLimitDecision,
  type RateLimiterPort,
  type RateLimitPolicy,
};

/**
 * Express 5 middleware enforcing a `RateLimitPolicy` against a `RateLimiterPort`.
 *
 * When no custom `policy.keyGenerator` is supplied, keys are isolated by `scopePrefix`
 * (`${METHOD}:${fullPath}:${ip}` on per-route policies, or `GLOBAL:${ip}` on global policies)
 * so separate rate-limited endpoints never collide in a shared `RateLimiterPort`.
 */
export function createRateLimitMiddleware(
  limiter: RateLimiterPort,
  policy: RateLimitPolicy,
  scopePrefix = 'GLOBAL',
): RequestHandler {
  return async (req, res, next) => {
    const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = policy.keyGenerator ? policy.keyGenerator(req) : `${scopePrefix}:${clientIp}`;
    const decision = await limiter.consume(key, policy.max, policy.windowMs);

    res.setHeader('RateLimit-Limit', String(decision.limit));
    res.setHeader('RateLimit-Remaining', String(decision.remaining));
    res.setHeader('RateLimit-Reset', String(decision.resetEpochSeconds));

    if (!decision.allowed) {
      throw new RateLimitExceededError(decision.retryAfterSeconds);
    }

    next();
  };
}
