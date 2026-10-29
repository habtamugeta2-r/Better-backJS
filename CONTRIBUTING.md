# Contributing to Better Back (`better-back`)

Thank you for helping make **Better Back** faster, cleaner, and safer.

---

## Core Architectural Invariants

Every pull request must preserve the framework's core guarantees:

1. **One Unified Syntax — Zero Overlap**: Standard ECMAScript Stage-3 decorators (`@Module`, `@Controller`, `@Injectable`, `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`/`@Options`/`@Head`, `@Guard`, `@Public`, `@Use`), 1-line `inject(Token)` DI, and inline `Ctx<...>` route typing. Never introduce competing functional routing DSLs or `reflect-metadata`.
2. **Express-Transparent**: `app.express` must remain an unproxied `express.Application`, and native Express `(req, res, next)` middlewares must work with zero adapters.
3. **Strict TypeScript (`"strict": true`)**: Zero `any` (`@typescript-eslint/no-explicit-any: error`) and zero `as unknown as X` shortcuts in public APIs.
4. **Minimal Runtime Dependencies**: `packages/core` ships with only 3 runtime dependencies (`express`, `zod`, `pino`). Any new runtime dependency requires an explicit ADR under `docs/adr/`.
5. **Performance Discipline**: Engine Core overhead must stay `<= 5%` vs bare Express 5 (`npm run bench`).

---

## Workspace Layout

```text
packages/core/               # Publishable "better-back" npm package (Dual ESM + CJS + DTS + CLI)
  src/
    cli/                     # Zero-extra-dep CLI ("better-back" / "bb": new, generate/g, routes, openapi, doctor, dev)
    common/                  # Shared Stage-3 Symbol.metadata helpers
    config/                  # Import-safe, fail-fast defineConfig + secret redaction
    di/                      # Container, inject(Token), @Injectable, tokens
    errors/                  # RFC 7807 ProblemDetails + AppError & startup error hierarchy
    logging/                 # Structured Pino JSON logger + redaction
    openapi/                 # OpenAPI 3.1.0 generator + SHA-256 CSP /docs explorer UI
    pipeline/                # Correlation, OWASP security/CORS, timeout, body-parser, validation, health
    ports/                   # Vendor-agnostic CachePort/InMemoryCache & RateLimiterPort/InMemoryRateLimiter
    routing/                 # Stage-3 decorators, Ctx<...> types, pagination, URI versioning
packages/create-better-back/ # "npm create better-back@latest" project initializer
examples/user-api/           # Reference Users & Posts application (imports ONLY public "better-back" API)
benchmarks/                  # Isolated multi-process autocannon benchmark suite
docs/                        # Pain map, architecture design, migration guides, and ADRs (001–010)
```

---

## Local Development Workflow

Requires **Node.js `>= 20` LTS**:

```bash
# 1. Install workspace dependencies
npm ci

# 2. Format code with Prettier
npm run format

# 3. Run the full CI verification gate (format:check + build + typecheck + lint + coverage + npm pack)
npm run verify

# 4. Run isolated HTTP throughput & cold-boot benchmarks
npm run bench
```
