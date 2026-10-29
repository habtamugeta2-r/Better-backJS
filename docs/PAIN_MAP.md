# Better Back — Phase 0: Deep Research & Pain Map (`PAIN_MAP.md`)

- **Status**: Phase 0 Complete (Approved to proceed with Unified Stage-3 Decorators + `inject(Token)` + Zod v4 + Express 5 + Pino + Dual ESM/CJS)
- **Author Role**: Principal Backend Architect / Senior TypeScript & Node.js Engineer / Framework Researcher
- **Research Date**: 2026-10-29 (`Africa/Addis_Ababa`)
- **Runtime Baseline Verified**: Node.js `v20.20.2` LTS, npm `10.8.2`, `express@5.3.0`, `zod@4.6.7`, `pino@10.4.0`, `fastify@5.12.7`, `@nestjs/core@12.3.2`, `typescript@5.9.3`

---

## 0.1 Research Method & Verified Source Registry

Research followed primary-source precedence:
1. Official framework documentation, release notes, and changelogs
2. Primary GitHub repositories, issues, and maintainer discussions
3. Industry developer surveys and npm registry metadata
4. Reproducible benchmark suites (TechEmpower, academic measurements, and local validation)
5. Community engineering reports (strictly labeled `COMMUNITY OPINION`, never treated as standalone technical proof)

Every claim below is tagged:
- **[FACT]** — Directly verifiable from primary documentation, source code, release notes, or npm registry metadata.
- **[COMMUNITY OPINION]** — Recurring developer sentiment from engineering postmortems, GitHub discussions, or forums.
- **[YOUR INFERENCE]** — Architectural synthesis derived from first-principles decomposition of the facts above.

| ID | Source Title | URL | Type | Verified Date | Used For |
|---:|---|---|---|---|---|
| 1 | Express@5.1.0: Now the Default on npm with LTS Timeline | https://expressjs.com/en/blog/2025-03-31-v5-1-latest-release/ | Official Blog / Docs | 2026-10-29 | Express 5 default on npm (Mar 31, 2025), Node 18+ baseline, v4 LTS/EOL schedule |
| 2 | `expressjs/express` `History.md` & npm `express@5.3.0` | https://github.com/expressjs/express/blob/master/History.md | Primary Changelog | 2026-10-29 | Native rejected-Promise forwarding in Express 5 router; `path-to-regexp` modernization; current `5.3.0` release |
| 3 | `nestjs/nest` Issue #15988 — Develop `@nestjs/zod` package | https://github.com/nestjs/nest/issues/15988 | Primary GitHub Issue | 2026-10-29 | `class-validator` / `class-transformer` reflection split ("types and validation rules are two separate systems"), maintenance lag |
| 4 | `nestjs/nest` Issue #10974 — Zod first-class support | https://github.com/nestjs/nest/issues/10974 | Primary GitHub Issue | 2026-10-29 | `class-validator` DTOs provide zero TypeScript inference; closed as not planned |
| 5 | `nestjs/nest` Issue #15837 — Swagger with Zod schemas | https://github.com/nestjs/nest/issues/15837 | Primary GitHub Issue | 2026-10-29 | NestJS `@nestjs/swagger` requires decorator classes, forcing duplicate DTO definitions when teams use Zod |
| 6 | Zod v4 Release Notes & Native `z.toJSONSchema()` | https://zod.dev/json-schema | Official Docs | 2026-10-29 | First-party `z.toJSONSchema()` in Zod 4 (`4.6.7`), JSON Schema Draft 2020-12 / OpenAPI 3.1 output, `.meta()` registry, compiled fast path |
| 7 | Fastify Reference — Encapsulation & Type Providers | https://fastify.dev/docs/latest/Reference/Encapsulation/ | Official Docs | 2026-10-29 | Directed-acyclic plugin encapsulation contexts, `fastify-plugin` scope breaking, scoped Type Providers not propagating globally |
| 8 | Fastify Reference — Type Providers | https://fastify.dev/docs/latest/Reference/Type-Providers/ | Official Docs | 2026-10-29 | `as const` widening pitfalls, scoped type-provider remapping complexity |
| 9 | OWASP API Security Top 10 (2023 Edition) | https://owasp.org/API-Security/editions/2023/en/0x11-t10/ | Official Standard | 2026-10-29 | API1 BOLA, API3 Property-Level Auth, API4 Unrestricted Resource Consumption, API8 Security Misconfiguration, API9 Improper Inventory |
| 10 | RFC 9457 / RFC 7807 — Problem Details for HTTP APIs | https://www.rfc-editor.org/rfc/rfc9457 | IETF Standard | 2026-10-29 | Standard `application/problem+json` error envelope (`type`, `title`, `status`, `detail`, `instance`) |
| 11 | `typestack/class-transformer` & `class-validator` repositories | https://github.com/typestack/class-transformer | Primary GitHub Repo | 2026-10-29 | Long maintenance gaps, hundreds of unresolved issues/PRs, legacy `reflect-metadata` coupling |
| 12 | State of JS Backend Framework Usage | https://stateofjs.com/ | Developer Survey | 2026-10-29 | Express (~73%) remains dominant runtime substrate ahead of NestJS (~29%) and Fastify (~17%) |
| 13 | TechEmpower Web Framework Benchmarks (Round 22/23) | https://www.techempower.com/benchmarks/ | Benchmark Suite | 2026-10-29 | Fastify leads Node JSON serialization via precompiled schemas; Express ~30–40k single-core plaintext/JSON baseline; NestJS adds DI/interceptor overhead |
| 14 | Hono Official Documentation | https://hono.dev/ | Official Docs | 2026-10-29 | Ultra-small Web-Standard router, end-to-end TypeScript route & schema type inference |
| 15 | ASP.NET Core Fundamentals (Middleware, `IOptions<T>`, ProblemDetails) | https://learn.microsoft.com/en-us/aspnet/core/fundamentals/ | Official Docs | 2026-10-29 | Deterministic middleware pipeline ordering, startup-validated `IOptions<T>`, built-in Problem Details and health/readiness probes |
| 16 | Spring Boot Actuator & Externalized Configuration | https://docs.spring.io/spring-boot/reference/ | Official Docs | 2026-10-29 | Profile-based configuration (`dev`/`prod`/`test`), lifecycle hooks, `/health` liveness vs readiness separation |

---

## 0.2 Ten-Framework First-Principles Analysis (`a–d`)

### 1. Express.js (`5.3.0`)
- **a) Solves brilliantly -> STEAL THIS**:
  - **[FACT]** Minimal, universal `(req, res, next)` middleware chain backed by the largest HTTP ecosystem in Node.js (~73% developer usage) [12].
  - **[FACT]** Express 5 (`5.1.0` default on npm since March 2025; `5.3.0` current) natively catches rejected Promises returned by async route handlers and forwards them to `(err, req, res, next)` error middleware [1][2].
  - **[FACT]** Zero vendor lock-in: thin wrapper over `node:http`.
- **b) Structural gap / hidden cost -> FIX OR AVOID THIS**:
  - **[FACT]** Zero architectural primitives: no module boundaries, no DI, no schema validation, untyped `req.body` (`any`), no security defaults, no correlation IDs, no graceful shutdown, and default HTML/text error responses.
  - **[YOUR INFERENCE]** Every team using raw Express builds an ad-hoc, undocumented mini-framework in-house within 6 months.
- **c) Forces that TS/Node must NOT copy -> REJECT THIS**:
  - Unstructured "bring your own everything" defaults where security, validation, and error envelopes are opt-in chores.
- **d) Why teams leave**:
  - **[COMMUNITY OPINION]** Codebases degrade into coupled route handlers importing database clients directly, inconsistent JSON error shapes across endpoints, and untestable singletons as headcount grows.

### 2. Fastify (`5.12.7`)
- **a) Solves brilliantly -> STEAL THIS**:
  - **[FACT]** Deterministic lifecycle stages and startup-time schema compilation [7][8][13].
  - **[FACT]** Type Providers (`@fastify/type-provider-typebox` / Zod) prove that route schemas can infer handler types without decorators [8].
- **b) Structural gap / hidden cost -> FIX OR AVOID THIS**:
  - **[FACT]** Plugin encapsulation is a directed tree: decorators and hooks registered inside a child plugin are invisible to sibling/parent scopes unless wrapped with `fastify-plugin`, and Type-Provider types do not propagate globally across encapsulated scopes [7][8].
  - **[FACT]** Express middleware (`cors`, `helmet`, `morgan`) cannot run directly on Fastify without `@fastify/express` / `@fastify/middie` adapters.
  - **[COMMUNITY OPINION]** Response serialization schemas act as silent allowlists — omitting a field in the response schema strips it from JSON output without a compile error.
- **c) Forces that TS/Node must NOT copy -> REJECT THIS**:
  - "Everything is an async encapsulated plugin" for straightforward domain modules.
- **d) Why teams leave**:
  - **[COMMUNITY OPINION]** Friction integrating Express-only enterprise middleware (auth SDKs, APM agents) and complex generic signatures (`FastifyInstance<RawServerDefault, RawRequestDefaultExpression, ...>`).

### 3. NestJS (`@nestjs/core@12.3.2`)
- **a) Solves brilliantly -> STEAL THIS**:
  - **[FACT]** Clear `Module -> Controller -> Service` separation of concerns with constructor DI and startup circular-dependency detection.
  - **[FACT]** First-class testing module pattern enabling provider overrides without HTTP server boot.
- **b) Structural gap / hidden cost -> FIX OR AVOID THIS**:
  - **[FACT]** Split validation/type/docs stack: `class-validator` + `class-transformer` + `@nestjs/swagger` rely on legacy TypeScript `experimentalDecorators` and `reflect-metadata`, giving zero static inference from validation rules and forcing duplicated annotations [3][4][5][11].
  - **[FACT]** Five overlapping request-pipeline concepts (`Middleware`, `Guard`, `Interceptor`, `Pipe`, `ExceptionFilter`) create steep cognitive overhead and subtle execution-order bugs.
  - **[COMMUNITY OPINION]** Cold-start overhead (~5–7x slower than raw Express) and cryptic `reflect-metadata` / `forwardRef` errors.
- **c) Forces that TS/Node must NOT copy -> REJECT THIS**:
  - Legacy `reflect-metadata` runtime type reflection, 5-tier pipeline taxonomy, and `class-validator` DTO classes.
- **d) Why teams leave**:
  - **[COMMUNITY OPINION]** Boilerplate fatigue, triple-defined DTOs, `class-transformer` stagnation [11], and fighting framework magic for simple JSON endpoints.

### 4. Koa
- **a) Solves brilliantly -> STEAL THIS**:
  - **[FACT]** Clean `async (ctx, next) => { await next(); }` onion composition and async error propagation.
- **b) Structural gap / hidden cost -> FIX OR AVOID THIS**:
  - **[FACT]** Ships without a router, body parser, validator, config loader, or OpenAPI story; incompatible with Express `(req, res, next)` middleware without adapters.
- **c) REJECT**: Context mutation (`ctx.body = ...`) replacing explicit return values, and breaking Express ecosystem compatibility.
- **d) Why teams leave**: Ecosystem stagnation and Express 5 closing Koa's historical `async/await` error-handling advantage [1][2].

### 5. Hono
- **a) Solves brilliantly -> STEAL THIS**:
  - **[FACT]** Best-in-class TypeScript route path parameter inference (`'/users/:id'` -> `{ id: string }`) and validator-inferred handler inputs with minimal surface area [14].
- **b) Structural gap / hidden cost -> FIX OR AVOID THIS**:
  - **[FACT]** Micro-router rather than an application architecture: no built-in DI container, module boundary enforcement, startup config validation, graceful shutdown, or OWASP defaults out of the box [14].
  - **[FACT]** Built on Fetch `Request`/`Response` rather than Express `req`/`res`, so native Express middleware does not run directly.
- **c) REJECT**: None on ergonomics — Hono's type inference is our DX bar — but we stay 100% native on Express 5 per Hard Constraint 2.
- **d) Why teams leave**: Growing backend teams still have to assemble architecture, DI, structured logging, health checks, and error standards manually.

### 6. AdonisJS
- **a) Solves brilliantly -> STEAL THIS**:
  - **[FACT]** Cohesive developer onboarding, clear folder conventions, and actionable error messages.
- **b) Structural gap / hidden cost -> FIX OR AVOID THIS**:
  - **[COMMUNITY OPINION]** Monolithic coupling (Lucid ORM, custom HTTP server/router, custom validator VineJS) creates high lock-in and makes incremental adoption or Express ejection impossible.
- **c) REJECT**: Full-stack MVC (views/SSR), custom non-Express HTTP router, and built-in ORM lock-in (Hard Constraints 1, 2, 5).
- **d) Why teams leave**: **[COMMUNITY OPINION]** Fear of ecosystem isolation and difficulty swapping core subsystems.

### 7. Spring Boot (Java)
- **a) Solves brilliantly -> STEAL THIS**:
  - **[FACT]** Profile-aware externalized config, lifecycle hooks, Actuator `/health` liveness vs `/ready` readiness separation, and RFC Problem Details support [16].
- **b) Structural gap / hidden cost -> FIX OR AVOID THIS**:
  - **[FACT]** Classpath component scanning and deep annotation magic make control flow invisible in source code and inflate startup time.
- **c) REJECT**: Implicit filesystem/classpath auto-scanning, runtime AOP proxies, and annotation-per-line ceremony (Hard Constraint 7).
- **d) Why teams leave**: Memory footprint, cold-start latency, and implicit auto-configuration surprises.

### 8. ASP.NET Core (.NET)
- **a) Solves brilliantly -> STEAL THIS**:
  - **[FACT]** Explicit, deterministic middleware pipeline ordering; `IOptions<T>` startup-validated configuration (`ValidateOnStart()`); native RFC 7807/9457 `ProblemDetails`; and hybrid Controller + Minimal API ergonomics [15].
- **b) Structural gap / hidden cost -> FIX OR AVOID THIS**:
  - **[FACT]** Multi-kind Filter pipeline (`AuthorizationFilter`, `ResourceFilter`, `ActionFilter`, `ExceptionFilter`, `ResultFilter`) duplicates middleware concepts.
- **c) REJECT**: Multi-filter taxonomy where a single typed middleware/guard pipeline suffices.
- **d) Why teams leave**: Language/runtime choice rather than architectural weakness; ASP.NET Core is arguably the strongest architectural reference for Better Back.

### 9. Laravel (PHP)
- **a) Solves brilliantly -> STEAL THIS**:
  - **[FACT]** Unmatched `< 5 minute` time-to-first-endpoint DX and consistent pagination/error conventions.
- **b) Structural gap / hidden cost -> FIX OR AVOID THIS**:
  - **[FACT]** Static Facades (`Auth::user()`, `Cache::get()`) hide dependencies behind global service locators and undermine static analysis.
- **c) REJECT**: Static Facade globals and Active Record ORM coupling.
- **d) Why teams leave**: Static typing ceilings and runtime concurrency models compared to TypeScript/Node.

### 10. Django + Django REST Framework (Python)
- **a) Solves brilliantly -> STEAL THIS**:
  - **[FACT]** Secure-by-default middleware posture — security headers and request protections are active immediately on a new project.
- **b) Structural gap / hidden cost -> FIX OR AVOID THIS**:
  - **[FACT]** Deeply coupled to Django ORM models and synchronous MTV assumptions; deep class-inheritance hierarchies in DRF `ModelViewSet`.
- **c) REJECT**: Deep inheritance (`GenericAPIView` -> `ModelViewSet`) over composition, and ORM-coupled serializers.
- **d) Why teams leave**: Async ergonomics, deep inheritance magic when customizing endpoints, and full-stack TypeScript consolidation.

---

## 0.3 Complete Pain Matrix (`P1–P16`)

| ID | Pain Category | Primary Evidence | Sev (1–5) | Freq (1–5) | Score | Who Suffers | Root Cause | Today's Workaround | Better Back Opportunity |
|---|---|---|---:|---:|---:|---|---|---|---|
| **P1** | **Boilerplate per CRUD resource** | NestJS requires module + controller + service + create-dto + update-dto + entity + swagger decorators [3][5] | 4 | 5 | **20** | Every feature engineer | Split DTO/type/doc artifacts + ceremony | CLI codegen (`nest g resource`) generating 6–8 files | **ADAPT**: Unified Stage-3 decorators + 1-line `inject()` + Zod v4 single-source-of-truth schemas + `bb g resource` |
| **P2** | **Type-safety holes (`any` leaks)** | Express `req.body` is `any`; `req.query` unvalidated; NestJS `@Param('id')` typos compile cleanly [4] | 5 | 4 | **20** | All TS backend teams | HTTP untyped boundary disconnected from TS compiler | Manual `req.body as CreateUserDto` casts that lie at runtime | **ADOPT**: End-to-end inferred `body`/`query`/`params`/`headers` + template-literal route params |
| **P3** | **Validation & OpenAPI 3x drift** | NestJS issues #15988, #10974, #15837 confirm TS type + `class-validator` + `@ApiProperty` drift [3][4][5] | 5 | 5 | **25** | Backend & API consumer teams | Reflection decorators cannot drive TS types | Third-party glue (`nestjs-zod`) or manual sync | **INVENT**: ONE Zod v4 schema -> runtime validation + `z.infer` + `z.toJSONSchema()` OpenAPI 3.1 [6] |
| **P4** | **Async errors & inconsistent error shapes** | Express 4 dropped rejected Promises; Express 5 fixes forwarding [1][2] but still emits HTML/ad-hoc JSON | 4 | 4 | **16** | API clients, SREs | Legacy callback router + no standard error envelope | `express-async-errors` + custom error formatters | **ADOPT**: Express 5 native async forwarding + global RFC 9457/7807 `application/problem+json` filter [10] |
| **P5** | **Architecture rot at scale** | Express lacks boundaries; NestJS circular deps (`forwardRef`) fail cryptically | 4 | 4 | **16** | Teams > 3 devs, multi-domain services | Implicit globals or unguarded cross-module imports | Lint rules, tribal PR review | **ADAPT**: Explicit module graph (`imports`/`exports`), pure TS services, ports/interfaces, startup cycle graph check |
| **P6** | **Too much magic (`reflect-metadata`)** | `class-transformer` stagnation [11], `reflect-metadata` version collisions, filesystem scanning cost | 3 | 4 | **12** | Engineers debugging startup/DI bugs | Java/C# reflection cargo-culted into JS | Pinning `reflect-metadata`, avoiding complex types | **REJECT**: Zero `reflect-metadata`, zero filesystem scanning; standard ECMAScript Stage-3 decorators + explicit `inject` |
| **P7** | **Too many pipeline concepts** | NestJS exposes 5 overlapping hooks (Middleware, Guard, Pipe, Interceptor, Filter); Fastify 8+ hooks [7] | 3 | 4 | **12** | New hires, security reviewers | Framework invents custom abstraction per step | Memorizing lifecycle execution charts | **INVENT**: ONE deterministic Chain-of-Responsibility pipeline + typed `AuthGuard` stage |
| **P8** | **Config & secret leaks** | Raw `process.env.X!` crashes hours later on first code path; env dumps leak secrets into JSON logs | 4 | 4 | **16** | Production ops, SecOps | Config treated as untyped runtime strings | `dotenv` + ad-hoc `if (!process.env.KEY)` | **ADOPT**: Startup Zod-validated frozen config + automatic secret redaction in errors and Pino logs |
| **P9** | **Security opt-in by default** | OWASP API4 (Unrestricted Resource Consumption) & API8 (Misconfiguration: permissive CORS, missing headers, stack leaks) [9] | 5 | 5 | **25** | Every public/internal API | Frameworks optimize for 3-line "hello world" over safe defaults | Remembering `helmet`, `cors`, `limit`, timeouts on every repo | **INVENT**: Secure-by-default zero-wiring pipeline mapped explicitly to OWASP API Top 10 (2023) |
| **P10** | **Missing baseline observability** | No correlation IDs, `console.log`, single `/ping` instead of liveness/readiness, dropped connections on SIGTERM | 4 | 4 | **16** | On-call engineers, Kubernetes deploys | Treated as external infra concern | Custom wrappers per microservice | **ADOPT**: Built-in `x-request-id`, Pino JSON logs, `/health` + `/ready`, SIGTERM/SIGINT connection draining |
| **P11** | **Testing friction** | Express apps wire singletons at import time; mocking requires `vi.mock` module monkey-patching | 3 | 4 | **12** | Every developer writing tests | Services coupled to Express or module globals | Slow full-server E2E tests or brittle `vi.mock` | **ADOPT**: Zero-Express pure services + `createTestingApp` 1-line `override(token, mock)` |
| **P12** | **Framework performance tax** | Reflection + per-request DI graphs + uncompiled checks add 15–50% HTTP overhead and 500ms+ cold starts [13] | 3 | 3 | **9** | High-throughput & serverless APIs | Per-request reflection and deep wrapper stacks | Dropping back to raw Express or Fastify | **ADOPT**: Startup-resolved singleton DI + route-level compiled pipeline (`<= 5%` overhead vs raw Express) |
| **P13** | **Documentation drift** | Hand-maintained OpenAPI YAML or duplicated `@ApiProperty` decorators diverge from real validation [5] | 4 | 4 | **16** | Frontend, mobile, partner teams | Spec authored separately from runtime validator | Manual PR checklists | **ADOPT**: OpenAPI 3.1 generated live from route Zod v4 schemas at `/docs` & `/docs/openapi.json` |
| **P14** | **Framework lock-in** | NestJS, Fastify, and AdonisJS own the HTTP abstraction; ejecting requires rewriting every controller | 3 | 4 | **12** | Tech leads evaluating adoption risk | Proprietary request/response wrappers | Avoiding opinionated frameworks altogether | **INVENT**: Full `app.express` transparency + `toExpressRouter()` zero-rewrite Express ejection |
| **P15** | **Learning curve & cryptic errors** | Cryptic DI failure messages, undocumented hook order, multi-hour setup | 3 | 4 | **12** | Onboarding engineers | Poor error diagnostics at bootstrap | Trial-and-error debugging | **ADOPT**: `< 5 min` quick-start + startup errors naming exact `module`, `token`, and `route` |
| **P16** | **Scope creep vs missing conventions** | Pagination, API versioning, and rate-limit hooks reinvented everywhere; bloated frameworks bundle queues/ORM/WS | 3 | 3 | **9** | API platform teams | Unclear v1 boundary between core conventions & plugins | Ad-hoc `?page=` params or monolithic frameworks | **ADAPT**: **CORE**: pagination helper, URI versioning, rate-limit port. **PLUGIN/v2**: uploads, caching adapters, jobs, WebSockets |

---

## 0.4 Top 15 Pains Ranked by `Severity × Frequency`

| Rank | Pain | Score (`S×F`) | Strategy Tag | Better Back Architectural Resolution |
|---:|---|---:|---|---|
| 1 | **P9 — Security Opt-In Exposure** | 25 | **INVENT** | Zero-wiring OWASP API Top 10 defaults: security headers, deny-by-default CORS with startup validation, `100kb` JSON limit, prototype-pollution protection, `30s` request timeout, stack-redacted RFC 7807 errors |
| 2 | **P3 — Triple DTO / Validation Drift** | 25 | **INVENT** | Single Zod v4 schema drives runtime input/output validation, static TS `z.infer` types, and native `z.toJSONSchema()` OpenAPI 3.1 generation |
| 3 | **P2 — Type-Safety Holes** | 20 | **ADOPT** | Strict TypeScript (`no-explicit-any`), template-literal path param extraction (`"/users/:id"` -> `{ id: string }`), inferred `body`/`query`/`params`/`headers`/return types |
| 4 | **P1 — CRUD Ceremony & Boilerplate** | 20 | **ADAPT** | Unified ECMAScript Stage-3 decorators (`@Module`, `@Controller`, `@Get`, `@Post`, ...) + 1-line `inject(Token)` + inline `Ctx<...>`, with `main.ts <= 5 lines` |
| 5 | **P4 — Async Errors & Ad-Hoc Error JSON** | 16 | **ADOPT** | Express 5 native rejected-Promise capture + deterministic terminal error filter emitting `application/problem+json` (RFC 9457 / 7807) |
| 6 | **P5 — Architecture Rot at Scale** | 16 | **ADAPT** | Explicit `Module` graph (`imports`/`exports` boundary enforcement), pure TS services (0 Express imports), repository ports via `InjectionToken<T>` |
| 7 | **P8 — Untyped Config & Leaked Secrets** | 16 | **ADOPT** | Startup-validated frozen Zod config (`defineConfig`), profile support (`development`/`production`/`test`), automatic secret path redaction in startup errors and Pino logs |
| 8 | **P10 — Missing Baseline Observability** | 16 | **ADOPT** | Sanitized `x-request-id` correlation IDs, Pino structured JSON request/error logs, `/health` liveness + `/ready` dependency readiness, graceful SIGTERM/SIGINT request draining |
| 9 | **P13 — OpenAPI Documentation Drift** | 16 | **ADOPT** | Live OpenAPI 3.1.0 spec synthesized directly from registered route contracts at `/docs/openapi.json` + zero-CDN interactive explorer at `/docs` |
| 10 | **P6 — Reflection & Scanning Magic** | 12 | **REJECT** | Zero `reflect-metadata`, zero `experimentalDecorators`, zero filesystem scanning; standard ECMAScript Stage-3 decorators + 1-line `inject(Token)` |
| 11 | **P7 — Pipeline Concept Overload** | 12 | **INVENT** | One unified 8-stage Chain-of-Responsibility pipeline replacing NestJS's 5 separate Middleware/Guard/Pipe/Interceptor/Filter abstractions |
| 12 | **P11 — Slow / Monkey-Patched Tests** | 12 | **ADOPT** | Pure domain services testable in 1 line via `resolveForTest(Service, [[Token, mock]])` + `createTestingApp(AppModule, { overrides })` |
| 13 | **P14 — Framework Lock-In** | 12 | **INVENT** | First-class `app.express` access, zero-adapter `cors`/`helmet`/`morgan` interop, and `toExpressRouter()` ejection helper |
| 14 | **P15 — Steep Learning Curve & Cryptic Boot Errors** | 12 | **ADOPT** | Actionable fail-fast startup errors (`CircularDependencyError`, `DuplicateRouteError`, `MissingProviderError`, `ConfigValidationError`) naming exact module/token/route |
| 15 | **P12 — Per-Request Framework Overhead** | 9 | **ADOPT** | Ahead-of-time singleton resolution and route-specific validator compilation targeting `<= 5%` throughput delta vs raw Express 5 |

*(P16 Scope Gaps also scored 9 and is explicitly bounded via Core vs Plugin vs Out-of-Scope rules below.)*

---

## 0.5 The `INVENT` List — Five Gaps No Existing Node Framework Solves Cleanly

1. **INVENT-1: Zero-Reflection Unified Stage-3 Decorators + `inject(Token)` + `Ctx<...>` (Zod v4 Single Source of Truth)**
   - **Gap**: NestJS decorators rely on `reflect-metadata`, duplicate DTOs, and verbose constructors; functional builders abandon `@Module`/`@Controller` structure or split codebases across two competing paradigms.
   - **Solution**: Standardize on **one unified ECMAScript Stage-3 Decorator syntax** (`@Module`, `@Controller`, `@Injectable`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Guard`, `@Public`, `@Use`), 1-line `inject(Token)` DI, and inline `Ctx<...>` handler typing — with **zero `reflect-metadata`**. One Zod v4 schema produces runtime validation, compile-time handler verification, and OpenAPI 3.1 JSON Schema via `z.toJSONSchema()`.

2. **INVENT-2: One Deterministic 8-Stage Pipeline Instead of Five Concepts**
   - **Gap**: Developers waste hours asking whether logic belongs in a Middleware, Guard, Interceptor, Pipe, or Filter.
   - **Solution**: Collapse request handling into one documented, deterministic Express 5 Chain-of-Responsibility: `Correlation ID -> Structured Logger -> Security/CORS -> Timeout & Rate-Limit -> Body Parse -> Schema Validation -> AuthGuard / Route Middleware -> Handler -> Global RFC 7807 Error Filter`.

3. **INVENT-3: Startup Graph Verification Engine (Fail Fast, Fail Loudly)**
   - **Gap**: Missing env vars, unexported module providers, circular dependencies, and colliding parametric routes (`/users/:id` vs `/users/:userId`) often fail only when hit in production.
   - **Solution**: During `BetterBack.create()`, validate config, verify module `exports` visibility, run DFS cycle detection across modules and constructor tokens, normalize parametric paths to detect route collisions, and crash before `listen()` with human-readable diagnostics.

4. **INVENT-4: Zero-Wiring OWASP API Top 10 Posture**
   - **Gap**: Every Node framework ships insecure by default (`Access-Control-Allow-Origin: *` tutorials, unlimited or unguarded bodies, no timeouts, leaked stack traces, `__proto__` pollution vectors).
   - **Solution**: Enable API security headers, deny-by-default CORS (with startup rejection of wildcard + credentials), `100kb` JSON limit, prototype-pollution key sanitization, `30s` request timeout, and stack-free RFC 7807 errors with zero configuration lines.

5. **INVENT-5: Lossless Express 5 Transparency & Ejectability**
   - **Gap**: Adopting NestJS, Fastify, or AdonisJS is a one-way door.
   - **Solution**: Better Back mounts directly onto a real `express.Application` (`app.express`), runs `cors`/`helmet`/`morgan` unadapted at global, controller, or route level, and ships `toExpressRouter()` so any Better Back controller/module can be mounted inside an existing plain Express app — or ejected cleanly without rewriting domain services.

---

## 0.6 Scope Classification (P16) & Explicit v1 Anti-Goals

| Capability | v1 Classification | Rationale |
|---|---|---|
| Routing, DI, Config, Pino Logging, RFC 7807 Errors, Security Defaults, `/health` + `/ready`, Graceful Shutdown, OpenAPI 3.1 `/docs` | **CORE** | Required for every production JSON API |
| Pagination helper (`paginationQuerySchema`, `paginate`), URI API Versioning (`/api/v1`), `AuthGuard` & `RateLimiterPort` + in-memory rate limiter | **CORE** | Solves ubiquitous REST conventions cleanly in < 100 lines |
| Database / ORM (`UserRepository` port), Redis Cache (`CachePort`), JWT / OAuth2 Verifiers | **EXTENSION PORT (Interface in Core, impl in userland/plugins)** | Preserves Hard Constraint 5 (DB/auth/cache agnostic) |
| Multipart file uploads (`multer`/`busboy`), Background Jobs/Queues (`BullMQ`), WebSockets/SSE | **OUT OF SCOPE v1 (v2 Plugin Roadmap)** | Avoids bloating JSON API core; raw `app.express` already supports `multer` & `http.Server` WS upgrades today |
| SSR, HTML templating, view engines, GraphQL, filesystem route scanning, `class-validator`, `reflect-metadata` | **PERMANENT ANTI-GOALS** | Directly violate Hard Constraints 1, 3, 4, 6, and 7 |

---

## 0.7 Phase 0 Questions & Recorded Architectural Decisions

All Phase 0 questions were reviewed and resolved prior to Phase 1:
1. **Execution Mode**: End-to-end implementation across Phases 1–5 with full verification at every step.
2. **Routing & Module Authoring Style**: **Unified Stage-3 Decorators** — `@Module`, `@Controller`, `@Injectable`, `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`, `@Guard`, `@Public`, `@Use`, paired with 1-line `inject(Token)` and inline `Ctx<...>` (**zero `reflect-metadata`**, zero hybrid overlap).
3. **Schema & OpenAPI `/docs`**: **Zod v4** (`zod@4.6.7`) Single Source of Truth + OpenAPI 3.1 JSON (`/docs/openapi.json` & content-negotiated `/docs`) + zero-dependency self-contained API Explorer UI at `/docs`.
4. **Core Stack**: **Express 5** (`express@5.3.0`) + **Hand-rolled ~130-line DI container** + **Pino** (`pino@10.4.0`) structured JSON logger with secret redaction + **Dual ESM/CJS** package exports + **Vitest + Supertest + autocannon**.
