# ADR-009: OpenAPI 3.1 Auto-Generation & Zero-Dependency `/docs` Explorer

- **Status**: Accepted
- **Date**: 2026-10-29

## Context
Hard Constraint 4 and Phase 3 require OpenAPI 3.1 to be auto-generated directly from the single-source-of-truth route schemas at `/docs`, eliminating documentation drift (Pain P13), while respecting Hard Constraint 1 (API-only) and Hard Constraint 6 (Minimal dependencies). Additionally, our Phase 0 stakeholder decision selected **Zod + OpenAPI 3.1 JSON & zero-dep `/docs` UI**.

## Alternatives Considered

### Option A: `swagger-ui-express` + `@asteasolutions/zod-to-openapi`
- **Rejected**: Adds multi-megabyte static asset dependencies, requires custom `.openapi()` wrapper calls on Zod schemas, and lags behind Zod v4's built-in `z.toJSONSchema()`.

### Option B: External CDN Script Tag (`unpkg.com/swagger-ui-dist` or Scalar CDN)
- **Rejected**: Breaks in offline/air-gapped environments, violates strict `Content-Security-Policy` headers without loosening CSP to external CDNs, and fails to render inside network-sandboxed preview iframes.

### Option C: Native Zod v4 `z.toJSONSchema()` OpenAPI 3.1 Generator + Content-Negotiated `/docs` & `/docs/openapi.json`
- **Pros**:
  - Uses Zod v4's built-in `z.toJSONSchema(schema, { target: 'draft-2020-12' })` directly — OpenAPI `3.1.0` uses JSON Schema Draft 2020-12 as its native schema dialect!
  - Synthesizes path parameters (from both template paths `/:id` and `params` Zod schemas), query parameters, request headers, typed JSON request bodies, typed JSON responses, Bearer/API-key `securitySchemes` when routes attach guards, and standard RFC 7807 `ProblemDetails` error responses (`400`, `401`, `404`, `408`, `429`, `500`).
  - Exposes:
    - `GET /docs/openapi.json` -> Always returns raw `application/json` OpenAPI 3.1.0 document.
    - `GET /docs` -> Content-negotiated: returns OpenAPI 3.1.0 JSON when `Accept: application/json` (or non-HTML programmatic clients) is sent, and serves a self-contained, zero-external-network interactive API Explorer (`text/html`) when opened in a browser (`Accept: text/html`)!
  - Can be disabled in locked-down environments via `{ docs: { enabled: false } }` (OWASP API9:2023 Inventory Management control).

## Decision
Implement **Option C** in `packages/core/src/openapi/`.

## Consequences
- **Positive**: Zero third-party Swagger dependencies; works completely offline and inside strict CSP environments; satisfies both programmatic `/docs` JSON consumers and interactive browser testing out of the box.
- **Negative / Watch-outs**: Highly dynamic custom `z.custom()` predicates without `.meta()` fall back to `{}` (`any` JSON schema) via `unrepresentable: 'any'`; documented in Known Limitations.
