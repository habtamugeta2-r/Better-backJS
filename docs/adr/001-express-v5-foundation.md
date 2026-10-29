# ADR-001: Express 5 (`^5.3.0`) as HTTP Runtime Foundation

- **Status**: Accepted
- **Date**: 2026-10-29

## Context
Better Back is mandated (Hard Constraints 2 and 10) to be built directly on top of Express.js with full transparency (`express.Application`, native `(req, res, next)` middleware, zero adapters for `cors`/`helmet`/`morgan`, and zero-rewrite ejectability), targeting Node.js `>= 20` LTS. We must choose between Express 4 (`4.21.x`) and Express 5 (`5.3.0`).

In Phase 0 (`PAIN_MAP.md` P4), unhandled rejected Promises in async Express 4 handlers were identified as a major historical source of hung HTTP connections and unhandled-rejection process crashes. Express 5.0 shipped in September 2024, `5.1.0` became the default `latest` tag on npm on March 31, 2025, and `5.3.0` is current as of October 2026, requiring Node.js `>= 18`.

## Alternatives Considered

### Option A: Express 4 (`^4.21.2`)
- **Pros**: Legacy middleware written before 2024 was tested against Express 4's `path-to-regexp@0.1.x` wildcard syntax.
- **Cons**: Does not catch rejected Promises in `async` route handlers or `async` native Express middleware without wrapping/monkey-patching `Router.prototype`; enters EOL window starting October 2026; ships older legacy compatibility shims unnecessary on Node 20+.

### Option B: Express 5 (`^5.3.0`)
- **Pros**:
  - Native Promise rejection forwarding in router and middleware (`async (req, res) => { throw new NotFoundError(...); }` automatically forwards to `(err, req, res, next)`).
  - Modernized dependencies (`router@2.x`, `body-parser@2.x`, `finalhandler@2.x`), native `Uint8Array` support, cleaned-up Node 18+ codebase.
  - Standard npm `latest` default (`5.3.0`) with active security/maintenance support.
  - Full compatibility with standard `(req, res, next)` middleware (`cors`, `helmet`, `morgan`).
- **Cons**: Stricter `path-to-regexp` syntax (named wildcards `/*splat` instead of bare `*`; `req.query` is a getter rather than a writable data property).

## Decision
Target **Express 5 (`^5.3.0`)** on **Node.js `>= 20.0.0` LTS**.

Because Express 5 makes `req.query` a read-only getter, Better Back never mutates `req.query` or `req.params` in place; instead, validated and coerced DTO outputs are passed cleanly through the typed `RouteContext` (`{ body, query, params, headers, req, res }`) and attached to a dedicated symbol/property (`res.locals.validated`) when inspected by downstream Express handlers.

## Consequences
- **Positive**: Native async error safety across both Better Back handlers and raw `app.express.get(...)` async handlers; zero monkey-patching of Express prototypes; aligned with Express's long-term supported major line.
- **Negative / Watch-outs**: Wildcard catch-all routes must use Express 5 named parameters (e.g., `/{*splat}`), which Better Back handles internally for its fallback 404 RFC 7807 handler.
