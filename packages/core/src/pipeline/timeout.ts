import type { Request, RequestHandler, Response } from 'express';
import { RequestTimeoutError } from '../errors/app-error.js';
import type { Logger } from '../logging/logger.js';
import { getOrCreateRequestMeta } from './context.js';

function triggerTimeoutResponse(
  req: Request,
  res: Response,
  timeoutMs: number,
  logger: Logger,
): void {
  if (res.headersSent || res.writableEnded) return;

  const meta = getOrCreateRequestMeta(req, res, logger);
  if (meta.timedOut) return;
  meta.timedOut = true;

  const requestId = meta.requestId;
  const timeoutError = new RequestTimeoutError(timeoutMs);
  meta.abort(timeoutError);
  const problem = timeoutError.toProblemDetails(req.originalUrl || req.url, requestId);

  meta.log.warn(
    { method: req.method, path: req.originalUrl, timeoutMs, requestId },
    timeoutError.detail,
  );

  res.setHeader('x-request-id', requestId);
  res
    .status(problem.status)
    .type('application/problem+json; charset=utf-8')
    .send(JSON.stringify(problem));
}

/**
 * Enforces an upper-bound request execution timeout (default `30_000ms`),
 * returning `408 Request Timeout` RFC 7807 Problem Details if exceeded and preventing
 * late asynchronous handlers from throwing `ERR_HTTP_HEADERS_SENT`.
 *
 * Uses Node's native socket idle timer (`res.setTimeout`) for standard `>= 250ms` deadlines
 * (zero JS `Timeout` heap allocations) and exact `setTimeout` for sub-250ms route overrides.
 */
export function createTimeoutMiddleware(timeoutMs: number, logger: Logger): RequestHandler {
  if (timeoutMs <= 0) {
    return (_req, _res, next) => next();
  }

  if (timeoutMs < 250) {
    return (req, res, next) => {
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        triggerTimeoutResponse(req, res, timeoutMs, logger);
      }, timeoutMs);
      timer.unref();

      res.once('close', () => {
        finished = true;
        clearTimeout(timer);
      });

      next();
    };
  }

  return (req, res, next) => {
    res.setTimeout(timeoutMs, () => {
      triggerTimeoutResponse(req, res, timeoutMs, logger);
    });
    next();
  };
}
