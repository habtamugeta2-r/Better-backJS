# ADR-006: Structured JSON Logging (`pino`) & End-to-End Correlation IDs

- **Status**: Accepted
- **Date**: 2026-10-29

## Context
Phase 0 (`PAIN_MAP.md` P8, P10, P12) identified three tightly linked observability and performance challenges:
1. Unstructured `console.log` calls cannot be queried in log aggregators and block the Node event loop synchronously under high load.
2. Distributed requests lack automatic correlation IDs tying incoming HTTP requests, domain logs, and RFC 7807 error responses together.
3. Sensitive credentials (`Authorization` headers, cookies, JWT secrets, API keys, passwords) frequently leak into request or error logs.

## Alternatives Considered

### Option A: `winston`
- **Rejected**: Heavy transport abstraction, significantly higher CPU/allocation overhead per log line than `pino`, slower startup.

### Option B: Custom `JSON.stringify` Console Logger
- **Pros**: Zero dependencies.
- **Cons**: Synchronous `process.stdout.write(JSON.stringify(...))` throws on circular references or `BigInt`, lacks battle-tested fast path redaction (`fast-redact`), and adds measurable latency under `autocannon` load.

### Option C: `pino` (`^10.4.0`) + Built-in Sanitized Correlation-ID Middleware
- **Pros**:
  - Lowest per-line JSON serialization overhead in the Node ecosystem.
  - Native `redact` configuration censoring `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.secret`, `*.token`, `*.apiKey`, plus any secret keys declared in Better Back's config module.
  - Lightweight child loggers (`logger.child({ requestId })`) propagate `x-request-id` end-to-end into `RouteContext.log` and RFC 7807 error logs.
  - Defaults to `'silent'` in `NODE_ENV=test` (clean test output) and `'info'` in production, with configurable log levels (`'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'`).

## Decision
Adopt **`pino` (`^10.4.0`)** wrapped behind Better Back's `Logger` interface and `LoggerToken`, paired with a correlation-ID pipeline stage that validates incoming `x-request-id` headers (`^[A-Za-z0-9._-]{1,128}$` to block CRLF/log-injection attacks) or generates a `crypto.randomUUID()` when absent or malformed.

## Consequences
- **Positive**: Structured JSON logs out of the box, end-to-end request correlation (`res.getHeader('x-request-id') === problemDetails.requestId === log.requestId`), automatic secret redaction, and minimal throughput impact.
- **Negative / Watch-outs**: When benchmarking raw HTTP routing overhead against raw Express (which performs zero request logging), log level configuration must be explicitly documented and tested in both `warn` (errors/warnings only) and `info` (every request logged) modes for full honesty.
