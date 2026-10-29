import { randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ServiceUnavailableError } from '../errors/app-error.js';
import type { Logger } from '../logging/logger.js';
import type { MetricsPort } from '../ports/metrics.js';
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
  readonly metrics?: MetricsPort;
  readonly metricsPath?: string;
  readonly bodyParser?: RequestHandler;
}

function resolveMetricRouteLabel(req: Parameters<RequestHandler>[0]): string {
  const expressRoute = req.route as { path?: unknown } | undefined;
  if (expressRoute && typeof expressRoute.path === 'string') {
    const base = req.baseUrl || '';
    return `${base}${expressRoute.path}` || '/';
  }
  return req.path || '/';
}

/**
 * Stage 1 & 2 of the pipeline:
 * - Extracts a sanitized `x-request-id` (blocking CRLF/header-injection) or mints a fast unique ID
 * - Propagates W3C `traceparent` trace IDs into structured logs and `Ctx.traceId`
 * - Optionally records RED metrics into `MetricsPort` when `metrics.enabled` is true
 * - Rejects new requests with `503 Service Unavailable` when graceful shutdown is draining
 * - Zero heap / WeakMap allocations on the non-logging, non-metrics Engine Core fast path
 */
export function createCorrelationAndLoggingMiddleware(
  options: CorrelationAndLoggingOptions,
): RequestHandler {
  const headerName = (options.headerName ?? 'x-request-id').toLowerCase();
  const metrics = options.metrics;
  const metricsPath = options.metricsPath ?? '/metrics';
  const bodyParser = options.bodyParser;
  const shouldLogSuccess =
    (options.logRequests ?? true) &&
    options.logger.level !== 'silent' &&
    options.logger.level !== 'warn' &&
    options.logger.level !== 'error' &&
    options.logger.level !== 'fatal';

  if (!shouldLogSuccess && !metrics) {
    if (bodyParser) {
      return (req, res, next) => {
        const rawHeader = req.headers[headerName];
        const requestId =
          typeof rawHeader === 'string' && SAFE_REQUEST_ID_RE.test(rawHeader)
            ? rawHeader
            : nextFastRequestId();

        res.setHeader('x-request-id', requestId);

        if (options.lifecycle.isShuttingDown && req.path !== '/health') {
          res.setHeader('Connection', 'close');
          next(
            new ServiceUnavailableError('Server is shutting down and draining active requests.'),
          );
          return;
        }

        const m = req.method;
        if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') {
          next();
          return;
        }
        bodyParser(req, res, next);
      };
    }

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
    const meta = shouldLogSuccess
      ? setRequestMeta(req, requestId, options.logger, startedAt)
      : undefined;
    res.setHeader('x-request-id', requestId);

    if (options.lifecycle.isShuttingDown && req.path !== '/health') {
      res.setHeader('Connection', 'close');
      next(new ServiceUnavailableError('Server is shutting down and draining active requests.'));
      return;
    }

    const recordMetric = Boolean(metrics && req.path !== metricsPath);
    if (recordMetric && metrics) {
      metrics.trackInFlight(1);
    }

    res.once('close', () => {
      const durationMs = Number((performance.now() - startedAt).toFixed(2));
      if (recordMetric && metrics) {
        metrics.trackInFlight(-1);
        metrics.recordHttpRequest({
          method: req.method,
          route: resolveMetricRouteLabel(req),
          statusCode: res.statusCode,
          durationMs,
        });
      }
      if (meta) {
        meta.log.info(
          {
            method: req.method,
            path: req.originalUrl || req.url,
            statusCode: res.statusCode,
            durationMs,
          },
          'request completed',
        );
      }
    });

    next();
  };
}
