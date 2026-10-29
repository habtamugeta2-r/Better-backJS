import type { Request } from 'express';
import type {
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
} from '../common/standard-schema.js';
import { InternalServerError, ValidationError, type ValidationIssue } from '../errors/app-error.js';
import { sanitizeUntrustedObject } from './body-parser.js';

export interface RouteValidationSchemas {
  readonly params?: StandardSchemaV1;
  readonly query?: StandardSchemaV1;
  readonly headers?: StandardSchemaV1;
  readonly body?: StandardSchemaV1;
  readonly response?: StandardSchemaV1;
}

export interface ValidatedRequestParts {
  readonly params: unknown;
  readonly query: unknown;
  readonly headers: unknown;
  readonly body: unknown;
}

export interface CompiledRouteValidator {
  readonly hasRequestSchemas: boolean;
  readonly hasResponseSchema: boolean;
  validateRequest(req: Request): ValidatedRequestParts | Promise<ValidatedRequestParts>;
  validateResponse(payload: unknown): unknown | Promise<unknown>;
}

function isPromise(value: unknown): value is Promise<StandardSchemaResult<unknown>> {
  return (
    value instanceof Promise || (typeof value === 'object' && value !== null && 'then' in value)
  );
}

function formatPath(
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined,
): string {
  if (!path || path.length === 0) return '';
  return path
    .map((seg) =>
      typeof seg === 'object' && seg !== null && 'key' in seg ? String(seg.key) : String(seg),
    )
    .join('.');
}

function mapIssues(
  location: ValidationIssue['location'],
  issues: ReadonlyArray<StandardSchemaIssue>,
): ValidationIssue[] {
  return issues.map((issue) => ({
    location,
    path: formatPath(issue.path),
    code: typeof issue.code === 'string' && issue.code.length > 0 ? issue.code : 'invalid_value',
    message: issue.message,
  }));
}

/**
 * Compiles a route's Standard Schema v1 / Zod v4 contracts once at startup.
 * Synchronous schemas run with zero Promise overhead; async schemas (`z.refine(async ...)`)
 * automatically transition to async validation.
 */
export function compileRouteValidator(schemas: RouteValidationSchemas): CompiledRouteValidator {
  const paramsSchema = schemas.params;
  const querySchema = schemas.query;
  const headersSchema = schemas.headers;
  const bodySchema = schemas.body;
  const responseSchema = schemas.response;

  const hasRequestSchemas = Boolean(paramsSchema || querySchema || headersSchema || bodySchema);
  const hasResponseSchema = Boolean(responseSchema);

  return {
    hasRequestSchemas,
    hasResponseSchema,

    validateRequest(req: Request): ValidatedRequestParts | Promise<ValidatedRequestParts> {
      if (!hasRequestSchemas) {
        return {
          params: req.params,
          query: req.query,
          headers: req.headers,
          body: req.body,
        };
      }

      const pRes = paramsSchema
        ? paramsSchema['~standard'].validate(sanitizeUntrustedObject(req.params))
        : undefined;
      const qRes = querySchema
        ? querySchema['~standard'].validate(sanitizeUntrustedObject(req.query))
        : undefined;
      const hRes = headersSchema
        ? headersSchema['~standard'].validate(sanitizeUntrustedObject(req.headers))
        : undefined;
      const bRes = bodySchema ? bodySchema['~standard'].validate(req.body ?? {}) : undefined;

      if (isPromise(pRes) || isPromise(qRes) || isPromise(hRes) || isPromise(bRes)) {
        return (async (): Promise<ValidatedRequestParts> => {
          const [rp, rq, rh, rb] = await Promise.all([pRes, qRes, hRes, bRes]);
          return finalizeRequest(req, rp, rq, rh, rb);
        })();
      }

      return finalizeRequest(req, pRes, qRes, hRes, bRes);
    },

    validateResponse(payload: unknown): unknown | Promise<unknown> {
      if (!responseSchema) return payload;
      const res = responseSchema['~standard'].validate(payload);
      if (isPromise(res)) {
        return res.then((r) => finalizeResponse(r));
      }
      return finalizeResponse(res);
    },
  };
}

function finalizeRequest(
  req: Request,
  pRes: StandardSchemaResult<unknown> | undefined,
  qRes: StandardSchemaResult<unknown> | undefined,
  hRes: StandardSchemaResult<unknown> | undefined,
  bRes: StandardSchemaResult<unknown> | undefined,
): ValidatedRequestParts {
  const issues: ValidationIssue[] = [];
  let paramsOut: unknown = req.params;
  let queryOut: unknown = req.query;
  let headersOut: unknown = req.headers;
  let bodyOut: unknown = req.body;

  if (pRes) {
    if (pRes.issues) issues.push(...mapIssues('params', pRes.issues));
    else paramsOut = pRes.value;
  }
  if (qRes) {
    if (qRes.issues) issues.push(...mapIssues('query', qRes.issues));
    else queryOut = qRes.value;
  }
  if (hRes) {
    if (hRes.issues) issues.push(...mapIssues('headers', hRes.issues));
    else headersOut = hRes.value;
  }
  if (bRes) {
    if (bRes.issues) issues.push(...mapIssues('body', bRes.issues));
    else bodyOut = bRes.value;
  }

  if (issues.length > 0) {
    throw new ValidationError(issues);
  }

  return {
    params: paramsOut,
    query: queryOut,
    headers: headersOut,
    body: bodyOut,
  };
}

function finalizeResponse(res: StandardSchemaResult<unknown>): unknown {
  if (res.issues) {
    throw new InternalServerError(
      'Response payload failed contract validation.',
      mapIssues('response', res.issues),
    );
  }
  return res.value;
}
