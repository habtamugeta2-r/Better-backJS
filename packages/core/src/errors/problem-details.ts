import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '../logging/logger.js';
import { getRequestMeta, readResponseRequestId } from '../pipeline/context.js';
import {
  AppError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PayloadTooLargeError,
  type ProblemDetails,
} from './app-error.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Maps arbitrary runtime or middleware errors to a safe `AppError`.
 * Stack traces and internal details are NEVER exposed on 500 errors.
 */
export function normalizeToAppError(err: unknown, bodyLimit = '100kb'): AppError {
  if (err instanceof AppError) {
    return err;
  }

  if (isRecord(err)) {
    const type = typeof err['type'] === 'string' ? err['type'] : '';
    const status =
      typeof err['status'] === 'number'
        ? err['status']
        : typeof err['statusCode'] === 'number'
          ? err['statusCode']
          : undefined;

    if (type === 'entity.too.large' || status === 413) {
      return new PayloadTooLargeError(bodyLimit);
    }

    if (err instanceof SyntaxError && (type === 'entity.parse.failed' || status === 400)) {
      return new BadRequestError('Request body contains malformed JSON.', err);
    }
  }

  return new InternalServerError('An unexpected internal error occurred.', err);
}

/**
 * Converts an error into an RFC 7807 / RFC 9457 `ProblemDetails` object.
 */
export function toProblemDetails(
  err: unknown,
  instance: string,
  requestId: string,
  bodyLimit?: string,
): ProblemDetails {
  return normalizeToAppError(err, bodyLimit).toProblemDetails(instance, requestId);
}

/**
 * Terminal Express 5 catch-all handler for unmatched HTTP routes.
 */
export function createNotFoundHandler(): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'OPTIONS' && typeof req.headers.origin === 'string') {
      res.status(204).end();
      return;
    }
    next(new NotFoundError(`No route matches ${req.method} ${req.path}.`));
  };
}

/**
 * Terminal Express 5 global error filter (`(err, req, res, next)`).
 * Guarantees RFC 7807 `application/problem+json` output and zero stack-trace leaks.
 */
export function createGlobalErrorFilter(logger: Logger, bodyLimit = '100kb'): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    const meta = getRequestMeta(req);
    const requestId = meta?.requestId ?? readResponseRequestId(res, 'unknown');
    const log = meta?.log ?? logger;

    if (meta?.timedOut || res.headersSent) {
      log.warn(
        { err, method: req.method, path: req.originalUrl, requestId },
        'Error occurred after response headers were already sent',
      );
      return;
    }

    const appError = normalizeToAppError(err, bodyLimit);
    const problem = appError.toProblemDetails(req.originalUrl || req.url, requestId);

    if (appError.status >= 500) {
      log.error(
        {
          err,
          status: appError.status,
          code: appError.code,
          method: req.method,
          path: req.originalUrl,
          requestId,
        },
        'Unhandled server error',
      );
    } else {
      log.warn(
        {
          status: appError.status,
          code: appError.code,
          method: req.method,
          path: req.originalUrl,
          requestId,
        },
        appError.detail,
      );
    }

    if (appError.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(appError.retryAfterSeconds));
    }
    res.setHeader('x-request-id', requestId);
    res
      .status(problem.status)
      .type('application/problem+json; charset=utf-8')
      .send(JSON.stringify(problem));
  };
}
