import express, { type RequestHandler } from 'express';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * JSON.parse reviver that strips prototype-pollution vector keys (`__proto__`,
 * `constructor`, `prototype`) at parse time before any validator or handler runs.
 */
export function safeJsonReviver(key: string, value: unknown): unknown {
  if (DANGEROUS_KEYS.has(key)) {
    return undefined;
  }
  return value;
}

/**
 * Recursively clones plain objects onto clean prototypes while stripping
 * dangerous keys — used for `req.query`, `req.params`, and `req.headers`.
 */
export function sanitizeUntrustedObject(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeUntrustedObject(item));
  }
  if (typeof input === 'object' && input !== null) {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (!DANGEROUS_KEYS.has(k)) {
        clean[k] = sanitizeUntrustedObject(v);
      }
    }
    return clean;
  }
  return input;
}

/**
 * Bounded JSON body parser (`100kb` default) hardened against prototype pollution.
 * Fast-paths `GET` / `HEAD` / `OPTIONS` requests that carry no request body.
 */
export function createSafeBodyParser(limit = '100kb'): RequestHandler {
  const jsonParser = express.json({
    limit,
    reviver: safeJsonReviver,
  });

  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    jsonParser(req, res, next);
  };
}
