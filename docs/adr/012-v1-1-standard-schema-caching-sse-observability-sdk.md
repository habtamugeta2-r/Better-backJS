# ADR-012: v1.1 Architecture — Standard Schema v1, Configurable Modules, HTTP Caching/ETag/SWR, Typed SSE, Telemetry & Zero-Dep SDK Generation

- **Status**: Accepted
- **Date**: 2026-10-29

## Context

Following the `v1.0.0` release of `better-back`, six high-leverage production capabilities emerged from real-world TypeScript API teams:
1. Schema portability across the Standard Schema v1 ecosystem (Zod v4, Valibot, ArkType, Effect Schema) without per-library adapter packages.
2. Configurable reusable modules (`DynamicModule`) and optional/default dependency injection (`inject(Token, { optional: true })`).
3. Built-in declarative HTTP caching (`@Cache`), conditional `ETag` (`304 Not Modified`), `stale-while-revalidate` (SWR), LRU eviction, and cache-stampede coalescing.
4. Native typed Server-Sent Events (`sse()`) for real-time AI/event streaming with automatic contract validation and clean graceful-shutdown termination.
5. Distributed tracing correlation (`traceparent` W3C Trace Context) and vendor-neutral Prometheus/OpenMetrics scraping (`/metrics`) without heavy OpenTelemetry SDK lock-in.
6. Zero-dependency end-to-end TypeScript client SDK generation (`bb sdk`) from the single-source-of-truth OpenAPI 3.1 contract.

Every addition had to honor Better Back's non-negotiable constraints: **strictly 3 runtime dependencies** (`express`, `zod`, `pino`), **zero `reflect-metadata`**, **zero `any` in public APIs**, and **`<= 5%` Engine Core HTTP throughput delta vs bare Express 5**.

## Decisions

1. **Flat Structural `StandardSchemaV1` (`packages/core/src/common/standard-schema.ts`)**:
   - Model Standard Schema v1 (`~standard.validate`) and Standard JSON Schema v1 (`~standard.jsonSchema`) as pure TypeScript interfaces (`typeof value === 'object' || typeof value === 'function'` to support callable schemas such as ArkType).
   - Detect Zod v4 schemas via `'toJSONSchema' in schema` first (preserving `.meta({ id })` `$ref` component hoisting), falling back seamlessly to `~standard.jsonSchema.output({ target: 'draft-2020-12' })` for non-Zod libraries.

2. **`DynamicModule` & Optional `inject()` (`packages/core/src/di/`, `packages/core/src/routing/`)**:
   - Introduce `DynamicModule` (`{ module, imports?, controllers?, providers?, exports?, global? }`) accepted anywhere a `@Module` constructor is accepted, merging static `@Module` metadata with dynamic `register()` configuration.
   - Add overloaded `inject(Token, { optional: true })` and `inject(Token, { defaultValue })` backed by `Container.resolveOptional()`.

3. **LRU `InMemoryCache`, Stampede Coalescing & `@Cache` / ETag / SWR (`packages/core/src/ports/cache.ts`, `packages/core/src/pipeline/cache.ts`)**:
   - Upgrade `InMemoryCache` to evict least-recently-used entries (`Map` re-insertion on hit) rather than FIFO.
   - Implement `cacheGetOrSet()` with synchronous registration in `GLOBAL_STAMPEDE_MAP` *before* `await cache.get(key)` so concurrent `Promise.all` callers coalesce onto a single producer execution even across async `CachePort` adapters (e.g. Redis).
   - Provide `@Cache({ ttlMs, swrMs, varyByUser, key })` and weak SHA-1 `ETag` (`W/"<len>-<hash>"`) conditional `304 Not Modified` handling (`If-None-Match` wildcard and weak/strong list matching per RFC 9110), passing an explicit `computeBackgroundRefresh` callback so SWR revalidation writes fresh envelopes even after foreground headers are sent.

4. **Zero-Overhead Hot-Path `sse()` Streaming (`packages/core/src/pipeline/sse.ts`)**:
   - Represent SSE streams via a concrete class `SseStreamImpl` (`instanceof SseStreamImpl` on the synchronous fast path + `Symbol.for('better-back.sse-stream')` cross-realm fallback) and lift `pipeRouteSse` out of the per-route closure scope. This preserves V8 TurboFan inlining and keeps Engine Core at **`-1.08%` vs bare Express 5**.
   - Combine per-request client-disconnect `AbortSignal` with an application-level shutdown `AbortController` (`AbortSignal.any`) so `app.close()` immediately aborts long-lived SSE generators instead of stalling until `shutdownTimeoutMs`.

5. **W3C `traceparent` & Symmetrical `MetricsPort` (`packages/core/src/ports/metrics.ts`)**:
   - Parse W3C `traceparent` (`00-<32-hex>-<16-hex>-<2-hex>`, rejecting all-zero trace/span IDs) lazily on `Ctx.traceId` and inside `RequestMeta` so non-logging, non-metrics routes incur zero overhead.
   - Provide `MetricsPort` + `MetricsToken` + `InMemoryMetrics` (`Prometheus 0.0.4` text exposition and JSON `snapshot()`), keeping the `/metrics` middleware completely bypassed unless `metrics: { enabled: true }` is set.

6. **CLI `bb sdk` Generator (`packages/core/src/cli/sdk.ts`)**:
   - Compile OpenAPI 3.1 paths and `#/components/schemas/*` directly into a standalone, zero-dependency, strict-TypeScript `fetch` client (`createApiClient`) inside `dist/cli.js` (adding `0 bytes` to `dist/index.js`), including typed `AsyncGenerator<SseClientMessage<T>>` streaming for `text/event-stream` endpoints and `--check` drift verification for CI.

## Consequences

- **Positive**: Framework consumers gain multi-validator freedom, configurable plugin modules, sub-millisecond HTTP caching/ETag/SWR, real-time SSE streaming, Prometheus/W3C observability, and 1-command typed SDK generation with **0 new runtime dependencies** and **`-1.08%` Engine Core overhead**.
- **Trade-offs**: Built-in `InMemoryCache` and `InMemoryMetrics` remain per-process adapters by design; multi-replica deployments swap `CacheToken` (Redis) or `MetricsToken` (prom-client / OpenTelemetry) via 1-line DI overrides without changing controller or service code.
