# Changelog

All notable changes to the **Better-backJS** monorepo (`better-back`, `create-better-back`, `@better-back/example-user-api`, and `@better-back/docs-site`) are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-10-29

### Added

- **Standard Schema v1 & Standard JSON Schema v1 (`~standard`) Across Core (`packages/core/src/common/standard-schema.ts`)**:
  - `defineConfig`, `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`/`@Options`/`@Head` (`params`, `query`, `headers`, `body`, `response`, `sse`), `Ctx<...>`, and the OpenAPI 3.1 generator now accept any **Standard Schema v1** (`StandardSchemaV1<Input, Output>`) contract — including **Zod v4**, **Valibot v1+**, **ArkType v2+** (callable schemas), **Effect Schema**, and custom validators — with zero per-library adapters and zero extra runtime dependencies.
  - Exported `StandardSchemaV1`, `InferSchemaInput`, `InferSchemaOutput`, and `isStandardSchema`.
- **Configurable `DynamicModule` & Optional / Default `inject()` (`packages/core/src/di/`, `packages/core/src/routing/`)**:
  - Added `DynamicModule` (`ModuleModule.register({ ... })`) across `BetterBack.create()`, `@Module({ imports })`, `toExpressRouter()`, `createTestingApp()`, and `bb graph` / `bb routes` / `bb openapi`.
  - Added `inject(Token, { optional: true })` (`T | undefined`), `inject(Token, { defaultValue })` (`T`), and `container.resolveOptional(Token)`.
- **Declarative `@Cache(...)`, RFC 9110 `ETag` / `304 Not Modified`, Stale-While-Revalidate (SWR) & Stampede Coalescing (`packages/core/src/ports/cache.ts`, `packages/core/src/pipeline/cache.ts`)**:
  - Added `@Cache({ ttlMs, swrMs?, varyByUser?, key? })` method decorator and `etag?: boolean` route/application option (`sendJsonWithEtag`, `computeWeakEtag`, `X-Cache: HIT | MISS | STALE`, `Cache-Control`, `Vary: Authorization`, `HEAD` & `If-None-Match` negotiation, and OpenAPI `304` + `ETag` header synthesis).
  - Upgraded `InMemoryCache` with true O(1) **LRU eviction** (`get()` promotes hot entries) and added `cacheGetOrSet(cache, key, ttlMs, compute)` with synchronous in-flight Promise coalescing to prevent cache stampedes (thundering herds).
- **Typed Server-Sent Events (`sse()`) with Contract Validation & Graceful Shutdown Drain (`packages/core/src/pipeline/sse.ts`)**:
  - Added `sse(async function* ({ signal, lastEventId }) { ... }, { heartbeatMs, retryMs, headers })` and `{ sse: EventSchema }` route option (`text/event-stream`, per-frame Standard Schema / Zod validation, `: keepalive` heartbeats, `Last-Event-ID` resume propagation, and automatic stream abort when `app.close()` initiates graceful shutdown).
- **W3C Trace Context (`traceparent`) & Opt-In OpenMetrics / Prometheus Telemetry (`packages/core/src/ports/metrics.ts`, `packages/core/src/pipeline/context.ts`)**:
  - Automatic extraction and validation of W3C `traceparent` (`00-<traceId>-<spanId>-<flags>`, rejecting all-zero IDs per spec) into `ctx.traceId`, `GuardContext.traceId`, and structured Pino request logs.
  - Added `MetricsPort`, `MetricsToken`, `InMemoryMetrics`, `app.metrics`, and `metrics: { enabled: true, path?: '/metrics' }` exposing Prometheus `0.0.4` text format (`http_requests_total`, `http_requests_in_flight`, `http_request_duration_ms_bucket`) and JSON `snapshot()` via `Accept` negotiation.
- **Zero-Dependency TypeScript Client SDK Generator (`bb sdk`) (`packages/core/src/cli/sdk.ts`)**:
  - Added `npx bb sdk [--out src/sdk/client.ts] [--name createApiClient] [--no-system] [--check]` and `generateSdkCommand` / `generateTypeScriptSdk` in `better-back/cli`.
  - Synthesizes a strict-TypeScript (`"strict": true`, zero `any`, zero external dependencies) `fetch` client directly from OpenAPI 3.1, including component `$ref` types, unions/enums/`Record`, `BetterBackClientError` (typed RFC 7807 `ProblemDetails`), Bearer token callback support, and typed `AsyncGenerator<SseClientMessage<T>>` streaming for SSE endpoints!
- **Interactive `/docs` Explorer Enhancements (`packages/core/src/openapi/docs-ui.ts`)**:
  - Added 1-click **Copy `curl`** command generation and live **`text/event-stream` SSE frame streaming** inside the built-in `/docs` Playground.
- **Reference App & Documentation Site Upgrades (`examples/user-api`, `docs-site`)**:
  - Upgraded `examples/user-api` with `etag: true`, `/metrics`, `GET /api/v1/users/events` SSE streaming, and `"sdk"` script.
  - Added `/docs/caching-and-sse`, `/docs/observability`, and `bb sdk` documentation to the Next.js 16 `docs-site` (`13/13` static SSG pages).

### Performance & Quality

- Lifted SSE helper closures out of the synchronous route fast path and replaced symbol dictionary checks with prototype comparison (`instanceof SseStreamImpl`), bringing **Better Back Engine Core** to **`-1.08%` vs bare Express 5** (`5,512.67 req/s` vs `5,572.67 req/s` median across 5 isolated runs; **`+9.44%` faster** than manual `Express 5 + helmet + cors` with Secure-by-Default active).
- Expanded test suite to **`9/9` suites (`51/51` tests)** with **`91.30%` line coverage**, **`94.39%` function coverage**, and **`90.18%` statement coverage** while preserving **strictly 3 runtime dependencies** (`express`, `zod`, `pino`).

---

## [1.0.0] - 2026-10-29

### Added

- Initial production release of `better-back` and `create-better-back`:
  - Unified ECMAScript Stage-3 decorators (`@Module`, `@Controller`, `@Injectable`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@Guard`, `@Public`, `@Use`), `inject(Token)` DI, `defineConfig`, and `Ctx<...>`.
  - OWASP API Security Top 10 defaults, RFC 7807 `ProblemDetails`, OpenAPI 3.1 + interactive `/docs`, `/health` + `/ready`, graceful shutdown, `toExpressRouter()`, CLI (`bb`), `examples/user-api`, and `docs-site`.
