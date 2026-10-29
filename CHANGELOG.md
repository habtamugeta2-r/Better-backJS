# Changelog

All notable changes to **`better-back`** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-10-29

### Added
- **Unified Stage-3 Decorator Engine** (`@Module`, `@Controller`, `@Injectable`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@Guard`, `@Public`, `@Use`) built on native `Symbol.metadata` with zero `reflect-metadata`.
- **1-Line Dependency Injection (`inject(Token)`)** supporting `singleton`, `request`, and `transient` scopes, explicit module `imports`/`exports` encapsulation, `OnModuleInit` / `OnApplicationShutdown` lifecycle hooks, and startup cycle/missing/duplicate detection.
- **Single-Source-of-Truth Zod v4 Pipeline**: compile-time `Ctx<...>` route typing + sync/async input & output validation + automatic OpenAPI 3.1.0 specification and SHA-256 CSP `/docs` interactive explorer (including `#/components/schemas` hoisting via `.meta({ id })` and `errors` documentation).
- **Composable & Compile-Time Type-Checked `@Guard` Pipeline** (`global -> @Controller -> method`, bypassed by `@Public()`, forwarding upstream `ctx.user` to downstream role/permission guards).
- **Import-Safe, Fail-Fast `defineConfig`** with profile defaults, deep-freezing, `[REDACTED]` secret masking, and direct `inject(AppConfig)` token identity.
- **Secure-by-Default & Proxy-Safe HTTP Pipeline**: 7 OWASP API Security Top 10 headers, strict deny-by-default CORS, `trustProxy`, per-route isolated rate-limit buckets, `100kb` JSON payload cap, prototype-pollution key stripping, `30s` timeouts (`AbortSignal`), sanitized `x-request-id` correlation, `/health` + `/ready` probes, graceful connection draining, and RFC 7807 `application/problem+json` error handling.
- **Symmetrical Infrastructure Ports**: `LoggerToken`, `RateLimiterToken` (`InMemoryRateLimiter`), and `CacheToken` (`InMemoryCache`).
- **Testing & Express Interop Utilities**: `createTestingApp` (`Symbol.asyncDispose`), `resolveForTest`, and `toExpressRouter`.
