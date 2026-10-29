# Better Back — Architecture & Design Document

> **Tagline**: *Express 5 clarity. Unified Stage-3 decorators. Zod v4 single-source-of-truth safety. Secure and observable on line one.*

---

## 1. Architectural Philosophy

**Better Back (`better-back`)** sits deliberately between raw Express 5 (unstructured, unsafe by default) and NestJS (heavy reflection, `class-validator` DTO duplication, 5 overlapping pipeline abstractions):

1. **One Unified Syntax — Zero Overlap**: Everything uses standard ECMAScript Stage-3 decorators (`@Module`, `@Controller`, `@Injectable`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Guard`, `@Public`, `@Use`), 1-line `inject(Token)` dependency injection, and inline `Ctx<...>` route typing. There are no competing functional builders or duplicate ways to configure the same feature.
2. **Express-Transparent, Never Express-Hostile**: `app.express` is a genuine, unproxied `express.Application` (`express@5.3.0`). Standard Express middleware (`cors()`, `helmet()`, `morgan()`) mounts via `options.middleware` or `@Use(...)` with **zero adapter wrappers**, and any module or controller converts to a plain `express.Router()` via `toExpressRouter()`.
3. **Single Source of Truth**: One Zod v4 schema per endpoint produces runtime validation, static TypeScript inference via `Ctx<...>`, and live OpenAPI 3.1.0 documentation at `/docs`.
4. **Zero `reflect-metadata` Magic**: Built exclusively on TC39 Stage-3 `Symbol.metadata` and synchronous resolution frame tracking (`inject(Token)`).
5. **Fail Fast at Startup**: Invalid environment variables, circular module/provider dependencies, unexported cross-module tokens, duplicate routes (`/users/:id` vs `/users/:userId`), and unsafe CORS settings (`origins: '*'` + `credentials: true`) crash immediately during `BetterBack.create()` before opening a TCP socket.
6. **Secure & Observable by Default**: OWASP API Security Top 10 headers, strict deny-by-default CORS, `100kb` JSON body limit, prototype-pollution key stripping, `30s` request timeouts, sanitized `x-request-id` correlation, Pino JSON logging with secret redaction, `/health` + `/ready` probes, graceful connection draining, and RFC 7807 `application/problem+json` errors ship active with zero configuration.

---

## 2. Clean 4-Layer Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: HTTP TRANSPORT & EXPRESS 5 SUBSTRATE                                │
│  • Raw express.Application (`app.express`), options.middleware, options.setup│
│  • Correlation ID -> Pino Logger -> OWASP Headers/CORS -> Timeout -> Body    │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: UNIFIED STAGE-3 DECORATORS & ZOD v4 CONTRACTS                       │
│  • @Module, @Controller, @Get/@Post/@Put/@Patch/@Delete, @Guard, @Public, @Use│
│  • Single Zod v4 schema -> Runtime validator + Ctx<...> + OpenAPI 3.1 /docs  │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: APPLICATION / DOMAIN SERVICES (`@Injectable` + `inject(Token)`)     │
│  • Pure TypeScript classes (`UsersService`, `PostsService`)                  │
│  • ZERO `express` imports (`req`/`res` never cross into business logic)      │
│  • Throws typed `AppError` subclasses (`NotFoundError`, `ConflictError`)     │
│  • Testable in 1 line via `resolveForTest(UsersService, [[RepoToken, mock]])`│
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ LAYER 4: DATA & INFRASTRUCTURE PORTS (Database / Cache / RateLimit Agnostic) │
│  • TypeScript interfaces + `createToken<UserRepository>('UserRepository')`   │
│  • Core ships zero ORM/driver coupling; swap InMemory / Prisma / Drizzle / pg│
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Request Lifecycle — Deterministic 8-Stage Pipeline

Every incoming HTTP request traverses **one** predictable linear sequence (replacing NestJS's 5 overlapping Middleware / Guard / Interceptor / Pipe / ExceptionFilter concepts):

```
Incoming HTTP Request
  │
  ├─► [Stage 1: Correlation & Drain Gate]
  │     • Validates incoming `x-request-id` (`^[A-Za-z0-9._:-]{1,128}$`) or generates fast ID
  │     • Echoes `X-Request-Id` response header; returns 503 if server is draining for shutdown
  │
  ├─► [Stage 2: Security Headers & CORS]
  │     • Sets 7 OWASP API security headers (`nosniff`, `X-Frame-Options`, `CSP`, `HSTS`, ...)
  │     • Enforces strict origin allowlist & short-circuits preflight `OPTIONS` (204)
  │
  ├─► [Stage 3: Timeout & Rate Limit]
  │     • Starts request deadline timer (default 30s -> 408 Problem Details + `ctx.signal` abort)
  │     • Checks global / route `RateLimiterPort` (exceeded -> 429 + `Retry-After`)
  │
  ├─► [Stage 4: Safe Body Parsing (POST/PUT/PATCH/DELETE)]
  │     • Enforces `100kb` JSON payload cap (exceeded -> 413 Problem Details)
  │     • Strips `__proto__`, `constructor`, and `prototype` keys recursively
  │
  ├─► [Stage 5: Express Middleware (`options.middleware` & `@Use(...)`)]
  │     • Runs standard Express `(req, res, next)` middlewares with zero adapters
  │
  ├─► [Stage 6: AuthGuard (`options.guard` / `@Guard(...)` unless `@Public()`)]
  │     • Executes `AuthGuard<TUser>`, populating strongly-typed `ctx.user`
  │
  ├─► [Stage 7: Zod v4 Input Validation -> Controller Handler -> Output Validation]
  │     • Validates `params`, `query`, `headers`, and `body` via Zod v4 (sync fast path + async support)
  │     • Invokes controller method (zero-allocation sync fast path when unguarded/unvalidated)
  │     • Validates & strips response payload when `response` schema is declared
  │
  └─► [Stage 8: Terminal RFC 7807 Problem Details Error Filter]
        • Express 5 natively forwards all sync throws and rejected Promises here
        • Maps `AppError` subclasses to exact HTTP status + `application/problem+json`
        • Redacts unknown 500 errors (`InternalServerError`) — stack traces NEVER leak
```

---

## 4. OWASP API Security Top 10 (2023) Coverage Matrix

| OWASP API Top 10 (2023) | Built-In Mitigation in `better-back` |
|---|---|
| **API1:2023 Broken Object Level Authorization** | Strongly typed `ctx.user` from `@Guard(...)` + branded ID schemas (`z.uuid().brand<'UserId'>()`) passed explicitly to domain services. |
| **API2:2023 Broken Authentication** | First-class `@Guard(...)` pipeline stage before handler execution; `Authorization` & `Cookie` headers automatically redacted from logs; startup secret validation via `defineConfig`. |
| **API3:2023 Broken Object Property Level Authorization** | Zod v4 object schemas strip undeclared input fields (`mass assignment` defense) AND strip undeclared response fields (`excessive data exposure` defense). |
| **API4:2023 Unrestricted Resource Consumption** | Default `100kb` JSON limit (`413`), `30s` request timeout (`408`), bounded `PaginationQuerySchema` (`limit <= 100`), and built-in `RateLimiterPort` (`429` + `Retry-After`). |
| **API5:2023 Broken Function Level Authorization** | Declarative controller-level and method-level `@Guard(...)` with explicit `@Public()` opt-out when controller or global guards are active. |
| **API6:2023 Unrestricted Access to Sensitive Business Flows** | Per-route `rateLimit: { max, windowMs, keyGenerator }` option in `@Post('/', { rateLimit })`. |
| **API7:2023 Server Side Request Forgery (SSRF)** | Outbound URL validation via strict Zod URL/host allowlist schemas + `ctx.signal` propagation for immediate upstream cancellation on timeout. |
| **API8:2023 Security Misconfiguration** | `x-powered-by` disabled; `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'`, `Referrer-Policy: no-referrer`, `HSTS` enabled by default; deny-by-default CORS; wildcard + credentials rejected at startup; zero stack trace leaks. |
| **API9:2023 Improper Inventory Management** | Explicit `@Module` registration (zero hidden filesystem route scanning), URI versioning (`version: '1'`), and live auto-generated OpenAPI 3.1 inventory at `/docs/openapi.json`. |
| **API10:2023 Unsafe Consumption of APIs** | Zod v4 schemas reusable for validating third-party webhook/upstream payloads before domain ingestion. |

---

## 5. Minimal CRUD Example (Unified Decorator Syntax)

```ts
// posts.controller.ts — 1 unified syntax across every module
import { Controller, Delete, Get, Guard, inject, Patch, Post, type Ctx } from 'better-back';
import { BearerAuthGuard, requireScope, type AuthUser } from '../../common/auth.guard.js';
import { CreatePostSchema, PostIdParamsSchema, PostSchema, UpdatePostSchema } from './posts.schema.js';
import { PostsService } from './posts.service.js';

@Controller({ prefix: '/posts', tags: ['Posts'] })
export class PostsController {
  private readonly postsService = inject(PostsService);

  @Get('/', { response: PostSchema.array() })
  list() {
    return this.postsService.listPosts();
  }

  @Get('/:id', { params: PostIdParamsSchema, response: PostSchema, errors: [404] })
  getById({ params }: Ctx<{ params: typeof PostIdParamsSchema }>) {
    return this.postsService.getPostById(params.id);
  }

  @Post('/', { status: 201, body: CreatePostSchema, response: PostSchema, errors: [403, 404] })
  @Guard(BearerAuthGuard, requireScope('posts:write'))
  create({ body, user }: Ctx<{ body: typeof CreatePostSchema; user: AuthUser }>) {
    return this.postsService.createPost(body);
  }

  @Patch('/:id', { params: PostIdParamsSchema, body: UpdatePostSchema, response: PostSchema, errors: [403, 404] })
  @Guard(BearerAuthGuard, requireScope('posts:write'))
  update({ params, body }: Ctx<{ params: typeof PostIdParamsSchema; body: typeof UpdatePostSchema }>) {
    return this.postsService.updatePost(params.id, body);
  }

  @Delete('/:id', { status: 204, params: PostIdParamsSchema, errors: [403, 404] })
  @Guard(BearerAuthGuard, requireScope('posts:write'))
  async remove({ params }: Ctx<{ params: typeof PostIdParamsSchema }>): Promise<void> {
    await this.postsService.deletePost(params.id);
  }
}
```
