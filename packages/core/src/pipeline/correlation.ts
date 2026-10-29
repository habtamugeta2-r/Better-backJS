import { randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ServiceUnavailableError } from '../errors/app-error.js';
import type { Logger } from '../logging/logger.js';
import { setRequestMeta } from './context.js';

const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const BOOT_NONCE_PREFIX = `${randomBytes(6).toString('hex')}-`;
let requestSeq = 0;

function nextFastRequestId(): string {
  requestSeq = (requestSeq + 1) & 0x7fffffff;
  return BOOT_NONCE_PREFIX + requestSeq;
}

export interface LifecycleState {
  isShuttingDown: boolean;
}

export interface CorrelationAndLoggingOptions {
  readonly logger: Logger;
  readonly headerName?: string;
  readonly logRequests?: boolean;
  readonly lifecycle: LifecycleState;
}

/**
 * Stage 1 & 2 of the pipeline:
 * - Extracts a sanitized `x-request-id` (blocking CRLF/header-injection) or mints a fast unique ID
 * - Rejects new requests with `503 Service Unavailable` when graceful shutdown is draining
 * - Zero heap / WeakMap allocations on the non-logging fast path (`RequestMeta` created lazily on demand)
 */
export function createCorrelationAndLoggingMiddleware(
  options: CorrelationAndLoggingOptions,
): RequestHandler {
  const headerName = (options.headerName ?? 'x-request-id').toLowerCase();
  const shouldLogSuccess =
    (options.logRequests ?? true) &&
    options.logger.level !== 'silent' &&
    options.logger.level !== 'warn' &&
    options.logger.level !== 'error' &&
    options.logger.level !== 'fatal';

  if (!shouldLogSuccess) {
    return (req, res, next) => {
      const rawHeader = req.headers[headerName];
      const requestId =
        typeof rawHeader === 'string' && SAFE_REQUEST_ID_RE.test(rawHeader)
          ? rawHeader
          : nextFastRequestId();

      res.setHeader('x-request-id', requestId);

      if (options.lifecycle.isShuttingDown && req.path !== '/health') {
        res.setHeader('Connection', 'close');
        next(new ServiceUnavailableError('Server is shutting down and draining active requests.'));
        return;
      }

      next();
    };
  }

  return (req, res, next) => {
    const rawHeader = req.headers[headerName];
    const requestId =
      typeof rawHeader === 'string' && SAFE_REQUEST_ID_RE.test(rawHeader)
        ? rawHeader
        : nextFastRequestId();

    const startedAt = performance.now();
    const meta = setRequestMeta(req, requestId, options.logger, startedAt);
    res.setHeader('x-request-id', requestId);

    if (options.lifecycle.isShuttingDown && req.path !== '/health') {
      res.setHeader('Connection', 'close');
      next(new ServiceUnavailableError('Server is shutting down and draining active requests.'));
      return;
    }

    res.once('close', () => {
      const durationMs = Number((performance.now() - meta.startedAt).toFixed(2));
      meta.log.info(
        {
          method: req.method,
          path: req.originalUrl || req.url,
          statusCode: res.statusCode,
          durationMs,
        },
        'request completed',
      );
    });

    next();
  };
}
