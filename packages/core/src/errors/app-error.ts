/**
 * Structured field-level validation issue included in RFC 7807 Problem Details.
 */
export interface ValidationIssue {
  readonly location: 'body' | 'query' | 'params' | 'headers' | 'response';
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/**
 * IETF RFC 7807 / RFC 9457 Problem Details envelope (`application/problem+json`).
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly code: string;
  readonly requestId: string;
  readonly errors?: readonly ValidationIssue[];
  readonly retryAfterSeconds?: number;
}

export interface AppErrorOptions {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly typeSlug: string;
  readonly errors?: readonly ValidationIssue[];
  readonly retryAfterSeconds?: number;
  readonly cause?: unknown;
}

const ERROR_BASE_URI = 'https://better-back.dev/errors';

/**
 * Base operational error class for domain and HTTP errors.
 * Domain services may throw `AppError` subclasses directly with zero Express imports.
 */
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly title: string;
  public readonly detail: string;
  public readonly type: string;
  public readonly errors?: readonly ValidationIssue[];
  public readonly retryAfterSeconds?: number;

  public constructor(options: AppErrorOptions) {
    super(options.detail, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.title = options.title;
    this.detail = options.detail;
    this.type = `${ERROR_BASE_URI}/${options.typeSlug}`;
    this.errors = options.errors;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  public toProblemDetails(instance: string, requestId: string): ProblemDetails {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance,
      code: this.code,
      requestId,
      ...(this.errors !== undefined ? { errors: this.errors } : {}),
      ...(this.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: this.retryAfterSeconds }
        : {}),
    };
  }
}

export class BadRequestError extends AppError {
  public constructor(
    detail = 'The request could not be understood or was malformed.',
    cause?: unknown,
  ) {
    super({
      status: 400,
      code: 'BAD_REQUEST',
      title: 'Bad Request',
      detail,
      typeSlug: 'bad-request',
      cause,
    });
  }
}

export class ValidationError extends AppError {
  public constructor(errors: readonly ValidationIssue[], detail?: string) {
    super({
      status: 400,
      code: 'VALIDATION_ERROR',
      title: 'Validation Failed',
      detail: detail ?? `Request validation failed on ${errors.length} issue(s).`,
      typeSlug: 'validation-error',
      errors,
    });
  }
}

export class UnauthorizedError extends AppError {
  public constructor(detail = 'Authentication credentials are missing or invalid.') {
    super({
      status: 401,
      code: 'UNAUTHORIZED',
      title: 'Unauthorized',
      detail,
      typeSlug: 'unauthorized',
    });
  }
}

export class ForbiddenError extends AppError {
  public constructor(detail = 'You do not have permission to access this resource.') {
    super({
      status: 403,
      code: 'FORBIDDEN',
      title: 'Forbidden',
      detail,
      typeSlug: 'forbidden',
    });
  }
}

export class NotFoundError extends AppError {
  public constructor(detail = 'The requested resource was not found.') {
    super({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not Found',
      detail,
      typeSlug: 'not-found',
    });
  }
}

export class RequestTimeoutError extends AppError {
  public constructor(timeoutMs: number) {
    super({
      status: 408,
      code: 'REQUEST_TIMEOUT',
      title: 'Request Timeout',
      detail: `Request exceeded the configured timeout of ${timeoutMs}ms.`,
      typeSlug: 'request-timeout',
    });
  }
}

export class ConflictError extends AppError {
  public constructor(detail = 'The request conflicts with the current state of the resource.') {
    super({
      status: 409,
      code: 'CONFLICT',
      title: 'Conflict',
      detail,
      typeSlug: 'conflict',
    });
  }
}

export class PayloadTooLargeError extends AppError {
  public constructor(limitDescription = 'configured limit') {
    super({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      title: 'Payload Too Large',
      detail: `Request payload exceeds the ${limitDescription}.`,
      typeSlug: 'payload-too-large',
    });
  }
}

export class UnprocessableEntityError extends AppError {
  public constructor(detail = 'The request was well-formed but violated a domain rule.') {
    super({
      status: 422,
      code: 'UNPROCESSABLE_ENTITY',
      title: 'Unprocessable Entity',
      detail,
      typeSlug: 'unprocessable-entity',
    });
  }
}

export class RateLimitExceededError extends AppError {
  public constructor(
    retryAfterSeconds: number,
    detail = 'Rate limit exceeded. Please retry later.',
  ) {
    super({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      title: 'Too Many Requests',
      detail,
      typeSlug: 'rate-limit-exceeded',
      retryAfterSeconds,
    });
  }
}

/** Canonical HTTP 429 status-phrase alias for `RateLimitExceededError`. */
export const TooManyRequestsError = RateLimitExceededError;
export type TooManyRequestsError = RateLimitExceededError;

export class InternalServerError extends AppError {
  public constructor(detail = 'An unexpected internal error occurred.', cause?: unknown) {
    super({
      status: 500,
      code: 'INTERNAL_ERROR',
      title: 'Internal Server Error',
      detail,
      typeSlug: 'internal-error',
      cause,
    });
  }
}

export class ServiceUnavailableError extends AppError {
  public constructor(detail = 'The service is temporarily unavailable.') {
    super({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      title: 'Service Unavailable',
      detail,
      typeSlug: 'service-unavailable',
    });
  }
}
