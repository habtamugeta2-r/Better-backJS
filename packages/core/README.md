# Better Back (`better-back`)

> **Express 5 clarity. Unified Stage-3 decorators. Zod v4 single-source-of-truth safety. Production-hardened on line one.**

**Better Back** is a minimal, fast, decorator-first TypeScript backend framework built directly on **Express 5**, **Zod v4**, and **Pino**:

- **One Unified Syntax — Zero Overlap**: Standard ECMAScript Stage-3 decorators (`@Module`, `@Controller`, `@Injectable`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@Guard`, `@Public`, `@Use`), **1-line `inject(Token)`** dependency injection, and inline **`Ctx<...>`** route typing. Zero `reflect-metadata`, zero legacy compiler flags, and zero competing routing DSLs.
- **One Schema = Validation + TypeScript Types + OpenAPI 3.1 `$ref` Components**: Write **one** Zod v4 schema per endpoint (`.meta({ id: 'User' })` automatically hoists `#/components/schemas/User` in `/docs`). Runtime input/output validation, compile-time `Ctx<...>` + `@Guard` user verification, and OpenAPI 3.1 specs stay mathematically in sync.
- **Express-Transparent, Zero Lock-In**: `app.express` is a real `express.Application`. Use `cors`, `helmet`, `morgan`, or any `(req, res, next)` middleware with **zero adapters**, or mount any module into an existing Express app with `toExpressRouter()`.
- **Secure, Proxy-Safe & Observable Out of the Box**: OWASP API Security Top 10 headers, strict deny-by-default CORS, `trustProxy` + per-route rate-limit isolation, symmetrical infrastructure ports (`LoggerToken`, `RateLimiterToken` / `InMemoryRateLimiter`, `CacheToken` / `InMemoryCache`), `100kb` JSON body limit, prototype-pollution protection, `30s` timeouts, RFC 7807 `application/problem+json` errors, sanitized `x-request-id` correlation, secret-redacted Pino JSON logs, `/health` + `/ready`, and graceful shutdown ship active with zero configuration.
- **Tiny & Fast**: Only **3 runtime dependencies** (`express`, `zod`, `pino`), **`0.90 ms`** cold boot, and **`-4.20%` Engine Core delta vs bare Express 5** (`+18.2%` faster than `Express 5 + helmet + cors` with Secure-by-Default active).

---

## 5-Minute Quick-Start

### 1. Install

```bash
npm install better-back express zod pino
npm install -D typescript @types/express @types/node tsx
```

*(Requires Node.js `>= 20` LTS and TypeScript `>= 5.4` with `"strict": true` — standard Stage-3 decorators work out of the box with zero `experimentalDecorators` or `reflect-metadata`.)*

### 2. Define a Domain Service & Controller (`app.ts`)

```ts
import { z } from 'zod';
import {
  BetterBack,
  Controller,
  Get,
  inject,
  Injectable,
  NotFoundError,
  Post,
  type Ctx,
} from 'better-back';

// 1. Single Source of Truth (Zod v4 — `.meta({ id })` hoists `#/components/schemas/Task` in OpenAPI 3.1)
const CreateTaskSchema = z
  .object({ title: z.string().trim().min(2).max(120) })
  .meta({ id: 'CreateTaskInput' });
const TaskSchema = z
  .object({ id: z.string(), title: z.string() })
  .meta({ id: 'Task' });

// 2. Pure TypeScript Service (ZERO Express imports)
@Injectable()
export class TasksService {
  private readonly tasks = new Map<string, z.output<typeof TaskSchema>>();

  list() {
    return [...this.tasks.values()];
  }

  getById(id: string) {
    const task = this.tasks.get(id);
    if (!task) throw new NotFoundError(`Task "${id}" not found.`);
    return task;
  }

  create(input: z.output<typeof CreateTaskSchema>) {
    const task = { id: crypto.randomUUID(), title: input.title };
    this.tasks.set(task.id, task);
    return task;
  }
}

// 3. Minimal Unified Stage-3 Controller + 1-Line `inject()` + `Ctx<...>`
@Controller('/tasks')
export class TasksController {
  private readonly tasks = inject(TasksService);

  @Get('/', { summary: 'List all tasks', response: TaskSchema.array() })
  list() {
    return this.tasks.list();
  }

  @Get('/:id', { summary: 'Get task by ID', response: TaskSchema, errors: [404] })
  getById({ params }: Ctx<'/:id'>) {
    return this.tasks.getById(params.id);
  }

  @Post('/', { summary: 'Create task', body: CreateTaskSchema, response: TaskSchema })
  create({ body }: Ctx<typeof CreateTaskSchema>) {
    return this.tasks.create(body);
  }
}
```

### 3. Boot in 4 Lines (`main.ts`)

```ts
import { BetterBack, Module } from 'better-back';
import { TasksController, TasksService } from './app.js';

@Module({ controllers: [TasksController], providers: [TasksService] })
class AppModule {}

const app = await BetterBack.create(AppModule, { apiPrefix: '/api/v1', trustProxy: 1 });
await app.listen(3000);
```

Run `npx tsx main.ts` (or `node --env-file=.env dist/main.js` in production) and visit:
- `GET http://127.0.0.1:3000/docs` — Interactive OpenAPI 3.1 Explorer (or JSON spec with `Accept: application/json`)
- `GET http://127.0.0.1:3000/health` & `GET http://127.0.0.1:3000/ready` — Liveness & readiness probes
- `POST http://127.0.0.1:3000/api/v1/tasks` — Validated JSON endpoint with OWASP headers & `X-Request-Id`

---

## Core Ergonomics at a Glance

### Import-Safe, Fail-Fast `defineConfig` & 1-Line `inject(Token)`

```ts
import { createToken, defineConfig, inject, Injectable, Module } from 'better-back';
import { z } from 'zod';

// Import-safe in unit tests when process.env lacks required prod vars;
// validates eagerly & fails fast inside `BetterBack.create()` before startup completes!
export const AppConfig = defineConfig(
  z.object({
    PORT: z.coerce.number().default(3000),
    API_BEARER_TOKEN: z.string().min(12),
  }),
);

// Interface token keeps domain services 100% database-agnostic
export interface UserRepository {
  findById(id: string): Promise<{ id: string; email: string } | undefined>;
}
export const UserRepositoryToken = createToken<UserRepository>('UserRepository');

@Injectable()
export class UsersService {
  private readonly repo = inject(UserRepositoryToken);
  private readonly config = inject(AppConfig);
  // 100% inferred types, zero constructor boilerplate!
}

@Module({
  controllers: [UsersController],
  providers: [
    { provide: UserRepositoryToken, useClass: PostgresUserRepository },
    UsersService,
  ],
  exports: [UsersService], // Explicit module boundary — private providers cannot leak!
})
export class UsersModule {}
```

### Concise `Ctx<...>` Shorthands

`Ctx` adapts to how much context your handler actually needs — and is checked against `@Get` / `@Post` schemas and `@Guard` user types at compile time:

| Handler Signature | What You Get |
|---|---|
| `list()` | Zero-arg handler (ultra-fast zero-context hot path) |
| `ping({ requestId, log, signal }: Ctx)` | Correlation ID, Pino logger, `AbortSignal`, raw `req`/`res` |
| `getById({ params }: Ctx<'/:id'>)` | `params: { readonly id: string }` |
| `create({ body }: Ctx<typeof CreateUserSchema>)` | `body: z.output<typeof CreateUserSchema>` |
| `update(ctx: Ctx<{ params: '/:id'; body: typeof UpdateSchema; user: AuthUser }>)` | Full structured `params`, `query`, `body`, `headers`, and `user` |

### Composable, Type-Checked `@Guard` Pipeline & Native Express Middleware (`@Use`)

Guards compose cleanly in deterministic order (`options.guard -> @Controller @Guard -> method @Guard`), pass upstream `ctx.user` into downstream role/permission guards, verify handler `Ctx<{ user }>` at compile time, and skip cleanly when `@Public()` is present:

```ts
import cors from 'cors';
import {
  Controller,
  ForbiddenError,
  Get,
  Guard,
  inject,
  Injectable,
  Post,
  Public,
  UnauthorizedError,
  Use,
  type AuthGuard,
  type Ctx,
  type GuardContext,
} from 'better-back';

interface AuthPrincipal {
  readonly subject: string;
  readonly scopes: readonly string[];
}

@Injectable()
class BearerAuthGuard implements AuthGuard<AuthPrincipal> {
  private readonly config = inject(AppConfig);

  canActivate({ req }: GuardContext): AuthPrincipal {
    if (req.headers.authorization !== `Bearer ${this.config.API_BEARER_TOKEN}`) {
      throw new UnauthorizedError('Invalid Bearer token.');
    }
    return { subject: 'admin', scopes: ['billing:write'] };
  }
}

const requireBillingScope = ({ user }: GuardContext<AuthPrincipal>): void => {
  if (!user.scopes.includes('billing:write')) {
    throw new ForbiddenError('Missing billing:write scope.');
  }
};

@Controller('/billing')
@Use(cors({ origin: 'https://billing.example.com' })) // Native Express middleware — zero adapters!
@Guard(BearerAuthGuard)                               // Authenticates all routes in controller
export class BillingController {
  @Get('/public-pricing')
  @Public()                                           // Bypasses global, controller & method guards
  pricing() {
    return { plan: 'pro' };
  }

  @Post('/charge', { errors: [403] })
  @Guard(requireBillingScope)                         // Receives upstream `user: AuthPrincipal`!
  charge({ user }: Ctx<{ user: AuthPrincipal }>) {
    return { chargedBy: user.subject };
  }
}
```

### 1-Line Unit & Integration Testing (`resolveForTest` & `createTestingApp`)

```ts
import request from 'supertest';
import { createTestingApp, resolveForTest } from 'better-back';

// 1. Pure domain unit test — ZERO HTTP server booted!
const usersService = resolveForTest(UsersService, [[UserRepositoryToken, mockUserRepo]]);

// 2. Full HTTP integration test with 1-line DI mock override & automatic async disposal
await using app = await createTestingApp(AppModule, {
  config: AppConfig.from({ API_BEARER_TOKEN: 'test-secret-12345' }),
  overrides: [[UserRepositoryToken, mockUserRepo]],
});
const res = await request(app.express).get('/api/v1/users');
```

---

## Reproducible Benchmarks (`npm run bench`)

Measured across isolated child server processes (`autocannon`, 50 concurrent connections, 2s warmup + 5 interleaved 3s runs on Node `v20.20.2` Linux x64, 2 vCPUs — raw data in [`benchmarks/results.json`](./benchmarks/results.json)):

| Target Stack | Median `req/s` | Mean `req/s` | `p50` | `p99` | vs Raw Express |
|---|---:|---:|---:|---:|---:|
| **Raw Express 5 (Bare — no headers, no correlation ID, no timeout)** | `9,198.67` | `9,230.27` | `4 ms` | `16 ms` | baseline |
| **Express 5 + `helmet` + `cors` + `x-request-id` + `json` (Manual Prod Stack)** | `7,378.67` | `7,490.14` | `5 ms` | `18 ms` | `-19.79%` |
| **Better Back — Engine Core (DI + Stage-3 Routing + Correlation + RFC 7807)** | **`8,812.00`** | **`8,861.74`** | **`4 ms`** | **`15 ms`** | **`-4.20%`** |
| **Better Back — Secure-by-Default (+7 OWASP Headers + CORS + 30s Timeout)** | **`8,720.67`** | **`8,633.47`** | **`5 ms`** | **`16 ms`** | **`-5.20%`** *(+18.2% faster than Express+helmet+cors)* |
| **Better Back — Full Observability (+Pino JSON Request Logs)** | `6,355.34` | `6,403.07` | `6 ms` | `18 ms` | `-30.91%` |
| **Better Back — Validated `POST /users` (Body Parse + Zod v4 In/Out)** | `5,848.67` | `6,159.07` | `7 ms` | `20 ms` | `-36.42%` |

- **Cold Startup Median (10 runs)**: Raw Express `0.24 ms` vs Better Back `0.90 ms` (including DI graph verification, route validator compilation, and OpenAPI 3.1 synthesis).

---

## Architecture & Documentation

- [Phase 0 — Grounded Pain Map & Framework Comparative Study](./docs/PAIN_MAP.md)
- [Phase 1 — Architecture & Design Document](./docs/DESIGN.md)
- [Migration Guides (Raw Express, NestJS, Fastify)](./docs/MIGRATION.md)
- [Final Verification Report](./docs/FINAL_REPORT.md)
- [Architecture Decision Records (`docs/adr/001`–`010`)](./docs/adr/)

## License

Apache-2.0
