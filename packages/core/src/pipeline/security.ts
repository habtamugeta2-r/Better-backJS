import type { RequestHandler } from 'express';
import { SecurityConfigError } from '../errors/startup-errors.js';

export interface CorsOptions {
  /**
   * Allowed origins. Defaults to `[]` (strict deny-by-default for cross-origin browsers).
   * Pass explicit origins such as `['https://app.example.com']` or `'*'` (only when `credentials` is false).
   */
  readonly origins?: readonly string[] | '*';
  readonly methods?: readonly string[];
  readonly allowedHeaders?: readonly string[];
  readonly exposedHeaders?: readonly string[];
  readonly credentials?: boolean;
  readonly maxAgeSeconds?: number;
}

export interface SecurityHeadersOptions {
  readonly enabled?: boolean;
  readonly hstsMaxAgeSeconds?: number;
  /**
   * Controls clickjacking protection (`X-Frame-Options` and CSP `frame-ancestors`).
   * Defaults to `'DENY'` (strictest OWASP API8 default). Set to `'SAMEORIGIN'` or `false`
   * only when intentionally embedding `/docs` inside an internal developer portal or iframe.
   */
  readonly frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
}

export interface SecurityPipelineOptions {
  readonly headers?: SecurityHeadersOptions;
  readonly cors?: CorsOptions;
}

const DEFAULT_METHODS = 'GET,HEAD,POST,PUT,PATCH,DELETE';
const DEFAULT_ALLOWED_HEADERS = 'Content-Type,Authorization,X-Request-Id';
const DEFAULT_EXPOSED_HEADERS = 'X-Request-Id,RateLimit-Limit,RateLimit-Remaining,Retry-After';

/**
 * Validates security & CORS configuration at startup (Fail Fast — Hard Constraint 8 & 9)
 * and returns a fused, zero-allocation OWASP security headers + strict CORS middleware.
 */
export function createSecurityMiddleware(options: SecurityPipelineOptions = {}): RequestHandler {
  const headersEnabled = options.headers?.enabled ?? true;
  const hstsMaxAge = options.headers?.hstsMaxAgeSeconds ?? 31_536_000;

  const cors = options.cors ?? {};
  const credentials = cors.credentials ?? false;
  const origins = cors.origins ?? [];

  if (credentials && (origins === '*' || (Array.isArray(origins) && origins.includes('*')))) {
    throw new SecurityConfigError(
      'CORS cannot combine wildcard origin "*" with "credentials: true" (OWASP API8:2023). Specify explicit allowed origins.',
    );
  }

  if (Array.isArray(origins)) {
    for (const origin of origins) {
      if (origin.trim().length === 0 || /[\r\n]/.test(origin)) {
        throw new SecurityConfigError(`Malformed CORS origin "${origin}".`);
      }
    }
  }

  const originSet = Array.isArray(origins) ? new Set<string>(origins) : null;
  const allowWildcard = origins === '*';
  const methodsHeader = cors.methods ? cors.methods.join(',') : DEFAULT_METHODS;
  const allowedHeadersHeader = cors.allowedHeaders
    ? cors.allowedHeaders.join(',')
    : DEFAULT_ALLOWED_HEADERS;
  const exposedHeadersHeader = cors.exposedHeaders
    ? cors.exposedHeaders.join(',')
    : DEFAULT_EXPOSED_HEADERS;
  const maxAgeHeader = String(cors.maxAgeSeconds ?? 600);

  const frameOptions = options.headers?.frameOptions ?? 'DENY';
  const cspHeader =
    frameOptions === 'DENY'
      ? "default-src 'none'; frame-ancestors 'none'"
      : frameOptions === 'SAMEORIGIN'
        ? "default-src 'none'; frame-ancestors 'self'"
        : "default-src 'none'";

  const staticHeaders: readonly (readonly [string, string])[] = headersEnabled
    ? [
        ['X-Content-Type-Options', 'nosniff'],
        ...(frameOptions !== false ? ([['X-Frame-Options', frameOptions]] as const) : []),
        ['Referrer-Policy', 'no-referrer'],
        ['Content-Security-Policy', cspHeader],
        ['Cross-Origin-Resource-Policy', 'same-origin'],
        ['Permissions-Policy', 'geolocation=(), microphone=(), camera=()'],
        ['Strict-Transport-Security', `max-age=${hstsMaxAge}; includeSubDomains`],
      ]
    : [];

  return (req, res, next) => {
    for (let i = 0; i < staticHeaders.length; i += 1) {
      const pair = staticHeaders[i]!;
      res.setHeader(pair[0], pair[1]);
    }

    const requestOrigin = req.headers.origin;
    if (typeof requestOrigin === 'string' && requestOrigin.length > 0) {
      res.vary('Origin');

      const isPreflight =
        req.method === 'OPTIONS' &&
        typeof req.headers['access-control-request-method'] === 'string' &&
        req.headers['access-control-request-method'].length > 0;

      const isAllowed = allowWildcard || (originSet !== null && originSet.has(requestOrigin));
      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', allowWildcard ? '*' : requestOrigin);
        res.setHeader('Access-Control-Expose-Headers', exposedHeadersHeader);
        if (credentials) {
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', methodsHeader);
          res.setHeader('Access-Control-Allow-Headers', allowedHeadersHeader);
          res.setHeader('Access-Control-Max-Age', maxAgeHeader);
          if (isPreflight) {
            res.status(204).end();
            return;
          }
        }
      } else if (isPreflight) {
        res.status(204).end();
        return;
      }
    }

    next();
  };
}
