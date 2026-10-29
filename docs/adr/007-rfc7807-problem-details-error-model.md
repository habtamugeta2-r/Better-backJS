# ADR-007: RFC 7807 / RFC 9457 Problem Details Error Model & `AppError` Hierarchy

- **Status**: Accepted
- **Date**: 2026-10-29

## Context
Phase 0 (`PAIN_MAP.md` P4, P9) showed that Express apps return inconsistent error payloads (`{ error: "msg" }`, `{ message: [...] }`, or default Express HTML stack traces), leaking internal file paths and implementation details (OWASP API8:2023 Security Misconfiguration). Every error path — domain exceptions, Zod validation failures, malformed JSON bodies, oversized payloads, timeouts, rate limits, 404 unknown routes, and unexpected runtime crashes — must emit a single, machine-readable standard without ever leaking stack traces.

## Alternatives Considered

### Option A: Custom Proprietary Envelope (`{ success: false, error: { code, message } }`)
- **Rejected**: Invents yet another non-standard format when an IETF standard (`application/problem+json`) already exists and is natively adopted by ASP.NET Core and Spring Boot 3.

### Option B: Result Monad Only (`Result<T, E>` Required in Every Handler)
- **Pros**: Explicit error channels in functional code.
- **Cons**: Forces ceremony on every simple CRUD handler and breaks ergonomics with Express middleware and async guards. (Services are still free to use Result types internally if desired.)

### Option C: IETF RFC 7807 / RFC 9457 Problem Details + Typed `AppError` Hierarchy
- **Pros**:
  - Standards-compliant `Content-Type: application/problem+json` response with canonical fields:
    - `type`: Stable URI (`https://better-back.dev/errors/validation-error`, `.../not-found`, etc.)
    - `title`: Human-readable summary matching the error category
    - `status`: HTTP status code (`400`, `401`, `403`, `404`, `408`, `409`, `413`, `422`, `429`, `500`, `503`)
    - `detail`: Safe, client-facing explanation
    - `instance`: Request path (`req.originalUrl`)
    - Extension members: `code` (stable string enum), `requestId` (correlation ID), and `errors` (structured field-level validation issues when applicable)
  - Clean `AppError` subclasses (`BadRequestError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RequestTimeoutError`, `PayloadTooLargeError`, `RateLimitExceededError`, `ServiceUnavailableError`, `InternalServerError`) usable in pure TypeScript domain services with **zero Express imports**.
  - Unknown `Error` throws default to `500 Internal Server Error` with generic `detail: "An unexpected internal error occurred"` — stack traces are logged via Pino with `requestId` on the server and **never** serialized to the HTTP client.

## Decision
Adopt **Option C (RFC 7807 / RFC 9457 Problem Details + `AppError` hierarchy)** across the terminal global error filter and fallback 404 route handler.

## Consequences
- **Positive**: 100% uniform error contract documented automatically in OpenAPI 3.1; zero stack-trace leakage in any environment; pure domain services throw `NotFoundError` / `ConflictError` cleanly without HTTP coupling.
- **Negative / Watch-outs**: Clients checking `Content-Type` receive `application/problem+json; charset=utf-8` on errors (standard JSON parsers including `fetch().json()` and `supertest` parse it natively).
