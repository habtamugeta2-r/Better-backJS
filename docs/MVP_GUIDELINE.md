# Better Back (`Better-backJS`) — Start-to-Finish MVP Guideline

This document is the end-to-end blueprint for **Better Back** (`better-back`), grounded directly in the current workspace implementation. It covers **both sides** of shipping an MVP from start to finish:

- **Part I — Building & Deploying a Production API MVP *with* Better Back** *(Steps 0 → 10: from an empty directory to a tested, documented, containerized JSON API in production).*
- **Part II — Building, Verifying & Releasing the `Better-backJS` Framework MVP Monorepo** *(Phases 1 → 6: how this workspace is structured, verified, benchmarked, published to npm, and deployed with its documentation site).*

---

## 1. MVP Scope & Core Non-Negotiables

Better Back was designed around a strict MVP boundary so neither framework authors nor application teams drown in accidental complexity:

| Pillar | MVP Guarantee in This Workspace |
|---|---|
| **Transport Foundation** | Real **Express 5** (`express@^5.3.0`) — `app.express` is unproxied; `(req, res, next)` middlewares (`cors`, `helmet`, `morgan`) work with zero adapters; `toExpressRouter()` mounts into legacy Express apps. |
| **Unified Syntax** | Standard ECMAScript **Stage-3 decorators** (`@Module`, `@Controller`, `@Injectable`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@Guard`, `@Public`, `@Use`) + 1-line **`inject(Token)`** + **`Ctx<...>`**. Zero `reflect-metadata`, zero `experimentalDecorators`. |
| **Single Source of Truth** | One **Zod v4** (`zod@^4.6.7`, or any Standard Schema v1 library) contract drives runtime validation, static TypeScript inference, and **OpenAPI 3.1.0** `$ref` schemas at `/docs`. |
| **Database Agnostic** | Zero ORM lock-in. Persistence, caching (`CacheToken`), and rate limiting (`RateLimiterToken`) sit behind typed `createToken<T>()` ports — start with in-memory adapters on Day 1 and swap to PostgreSQL / Prisma / Drizzle / Redis in one module line. |
| **Secure & Observable on Line 1** | 7 OWASP API Security Top 10 headers, deny-by-default CORS, `100kb` safe JSON parser (prototype-pollution guard), `30s` request timeout, RFC 7807 `application/problem+json` errors, `X-Request-Id` correlation, secret-redacted **Pino** (`pino@^10.4.0`) logs, `/health` + `/ready`, and graceful `SIGTERM`/`SIGINT` drain. |
| **Runtime Footprint** | Exactly **3 runtime dependencies** (`express`, `zod`, `pino`), **`~1 ms`** cold boot, and **`<= 5%` Engine Core overhead** vs bare Express 5. |

### Deliverables Present in This Workspace

```text
Better-backJS/
├── packages/
│   ├── core/                 # "better-back" npm package: runtime + "better-back"/"bb" CLI (Dual ESM/CJS + DTS)
│   └── create-better-back/   # "create-better-back" npm initializer ("npm create better-back@latest")
├── examples/
│   └── user-api/             # Complete reference MVP API (Users + Posts, WAL/InMemory swap, Auth, Tests)
├── docs-site/                # Next.js 16 + React 19 documentation website (@better-back/docs-site)
├── benchmarks/               # Multi-process autocannon throughput & cold-boot suite + results.json
└── docs/                     # Pain map, architecture design, CLI docs, migration guides, ADRs (001–011)
```

---

# Part I — Building an API MVP from Scratch with Better Back

Follow **Steps 0 through 10** below to go from an empty folder to a production-hardened, OpenAPI-documented, integration-tested backend MVP. We use an **Orders & Customers API** vertical slice (mirroring `examples/user-api` in the workspace) to show every layer concretely.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                        Better Back MVP Request Flow                        │
│                                                                            │
│  HTTP Request                                                              │
│    ─▶ Correlation ID (X-Request-Id) + Secret-Redacted Pino Child Logger    │
│    ─▶ OWASP Security Headers + Strict CORS + 30s Timeout + 100kb Safe JSON │
│    ─▶ RateLimiterPort (Global or Per-Route) + Native Express @Use(...)     │
│    ─▶ @Guard Chain (BearerAuthGuard ─▶ requireScope) ─▶ ctx.user           │
│    ─▶ Compiled Zod v4 Validator (params / query / headers / body)          │
│    ─▶ @Controller Handler (Ctx<...>)                                       │
│         └─▶ @Injectable Domain Service (Pure TS, zero Express imports)     │
│               └─▶ Injected Repository Port (InMemory ⇄ Postgres/Prisma)    │
│    ─▶ Response Schema Validation + Serialization  OR  RFC 7807 Problem JSON│
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 0 — Prerequisites

Ensure your development machine and target runtime have:

- **Node.js `>= 20.0.0` LTS** (Node 20, 22, or 24 LTS)
- **npm `>= 10`** (or pnpm / yarn)
- **TypeScript `>= 5.4`** (`^5.9.3` scaffolded by default; native Stage-3 decorators require `"target": "ES2022"` and **must not** enable legacy `experimentalDecorators`)

Verify your environment:

```bash
node -v   # v20.x, v22.x, or v24.x
npm -v    # 10.x+
```

---

## Step 1 — Scaffold the Project (`create-better-back` / `bb new`)

### Option A — Full Modular MVP Architecture *(Recommended)*

```bash
npm create better-back@latest my-mvp-api
cd my-mvp-api
npm install
```

*(Inside this monorepo before npm publish, run `npm run cli -- new my-mvp-api --dir /tmp` to test locally.)*

### Option B — Single-File Microservice MVP (`--minimal`)

For an ultra-small webhook, internal worker API, or prototype:

```bash
npm create better-back@latest my-webhook -- --minimal
```

### Generated Modular Directory Layout

`create-better-back` generates a strict-TypeScript project with zero dead boilerplate:

```text
my-mvp-api/
├── .env.example              # Safe template for required environment variables
├── .gitignore                # Ignores node_modules, dist, coverage, .env
├── package.json              # Scripts: dev, build, start, typecheck, test, routes, graph, openapi, doctor
├── tsconfig.json             # "strict": true, "noUncheckedIndexedAccess": true, Stage-3 decorators
├── tsconfig.build.json       # Production emission into dist/ (.js + .d.ts + .map)
├── vitest.config.ts          # Preconfigured Stage-3 TypeScript transform for Vitest 4
├── src/
│   ├── main.ts               # 4-line entrypoint (BetterBack.create + app.listen)
│   ├── app.module.ts         # Root @Module + shared BetterBackOptions builder
│   ├── config/
│   │   └── env.ts            # Zod-validated environment schema + profiles + secret redaction
│   ├── common/
│   │   ├── auth.guard.ts     # BearerAuthGuard + composable requireScope(...) guard
│   │   └── auth.module.ts    # Exports BearerAuthGuard across feature modules
│   └── modules/
│       └── items/            # Starter vertical slice (schema, repo port, service, controller, module)
└── tests/
    └── items.test.ts         # Unit test (resolveForTest) + HTTP E2E test (createTestingApp + Supertest)
```

Verify the scaffolded baseline immediately:

```bash
npx bb doctor --verify-app
npm test
npm run dev
```

---

## Step 2 — Configure Typed Environment & Secret Redaction (`src/config/env.ts`)

Never read raw `process.env.SOMETHING` inside services or controllers. Define a single `AppConfig` contract using `defineConfig(...)`:

- **Import-safe in unit tests**: Importing `AppConfig` does not crash Vitest when production variables are unset; validation triggers deterministically inside `BetterBack.create(...)` before any TCP socket opens.
- **Automatic log redaction**: Any key matching `/secret|token|password|key|dsn|authorization/i` (plus custom `redactKeys`) is automatically added to Pino's redaction list so secrets cannot leak into logs.
- **Profile defaults**: Built-in `development`, `test`, and `production` defaults reduce `.env` sprawl.

```ts
// src/config/env.ts
import { defineConfig } from 'better-back';
import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  API_BEARER_TOKEN: z.string().min(12),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().url().optional(),
});

export type AppEnv = z.output<typeof EnvSchema>;

export const AppConfig = defineConfig({
  name: 'AppConfig',
  schema: EnvSchema,
  profiles: {
    development: {
      PORT: 3000,
      API_BEARER_TOKEN: 'dev-secret-token-2026',
    },
    test: {
      PORT: 0,
      API_BEARER_TOKEN: 'test-secret-token-2026',
    },
    production: {
      PORT: 8080,
    },
  },
});
```

Copy `.env.example` to `.env` for local runs:

```bash
cp .env.example .env
```

---

## Step 3 — Generate or Write Domain Contracts (`orders.schema.ts`)

You can scaffold an entire new MVP feature module in one command:

```bash
npx bb g resource orders
```

Or craft each file explicitly. Start with **one Zod v4 file** per feature (`src/modules/orders/orders.schema.ts`). Attaching `.meta({ id: 'Order' })` hoists the schema into `#/components/schemas/Order` in OpenAPI 3.1 automatically:

```ts
// src/modules/orders/orders.schema.ts
import { createPaginatedResponseSchema, PaginationQuerySchema } from 'better-back';
import { z } from 'zod';

// Branded ID prevents accidentally passing a UserId where an OrderId is expected
export const OrderIdSchema = z.uuid().brand<'OrderId'>().describe('Unique UUIDv4 order ID');
export type OrderId = z.output<typeof OrderIdSchema>;

export const OrderStatusSchema = z.enum(['pending', 'paid', 'cancelled']);

export const OrderSchema = z
  .object({
    id: OrderIdSchema,
    customerEmail: z.email().describe('Buyer email address'),
    totalCents: z.number().int().min(100).describe('Order total in minor currency units'),
    status: OrderStatusSchema,
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Order', title: 'Order', description: 'Customer order record' });

export type Order = z.output<typeof OrderSchema>;

export const CreateOrderSchema = z
  .object({
    customerEmail: z.email(),
    totalCents: z.number().int().min(100),
  })
  .meta({ id: 'CreateOrderInput' });

export type CreateOrderInput = z.output<typeof CreateOrderSchema>;

export const UpdateOrderStatusSchema = z
  .object({
    status: OrderStatusSchema,
  })
  .meta({ id: 'UpdateOrderStatusInput' });

export type UpdateOrderStatusInput = z.output<typeof UpdateOrderStatusSchema>;

export const OrderIdParamsSchema = z.object({
  id: OrderIdSchema,
});

export const ListOrdersQuerySchema = PaginationQuerySchema.extend({
  status: OrderStatusSchema.optional(),
});
export type ListOrdersQuery = z.output<typeof ListOrdersQuerySchema>;

export const PaginatedOrdersResponseSchema = createPaginatedResponseSchema(OrderSchema).meta({
  id: 'PaginatedOrdersResponse',
});
```

---

## Step 4 — Create the Database-Agnostic Repository Port (`orders.repository.ts`)

For an MVP, shipping velocity and clean architecture reinforce each other when you separate the **Repository Port** (`interface` + `createToken`) from the **Storage Adapter**:

1. **Day 1 (Prototype & Fast CI)**: Bind `InMemoryOrderRepository` — zero Docker dependencies required to build endpoints, validate OpenAPI contracts, or run sub-second tests.
2. **Day 2 (Production Persistence)**: Implement `PostgresOrderRepository` (using `pg`, Drizzle, Prisma, or Kysely) + `OnModuleInit` / `OnApplicationShutdown`, and swap a single line in `OrdersModule`!

```ts
// src/modules/orders/orders.repository.ts
import { randomUUID } from 'node:crypto';
import {
  createToken,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from 'better-back';
import {
  OrderIdSchema,
  type CreateOrderInput,
  type ListOrdersQuery,
  type Order,
  type OrderId,
  type UpdateOrderStatusInput,
} from './orders.schema.js';

export interface OrderRepository {
  findMany(
    query: ListOrdersQuery,
  ): Promise<{ readonly items: readonly Order[]; readonly total: number }>;
  findById(id: OrderId): Promise<Order | undefined>;
  create(input: CreateOrderInput): Promise<Order>;
  updateStatus(id: OrderId, input: UpdateOrderStatusInput): Promise<Order | undefined>;
  ping(): Promise<boolean>;
}

export const OrderRepositoryToken = createToken<OrderRepository>('OrderRepository');

@Injectable()
export class InMemoryOrderRepository
  implements OrderRepository, OnModuleInit, OnApplicationShutdown
{
  private readonly store = new Map<OrderId, Order>();

  public async onModuleInit(): Promise<void> {
    // In a Postgres/Prisma adapter: open pool / verify connectivity here
  }

  public async onApplicationShutdown(): Promise<void> {
    // In a Postgres/Prisma adapter: drain connection pool cleanly on SIGTERM/SIGINT
  }

  public async findMany(query: ListOrdersQuery) {
    const filtered = [...this.store.values()].filter((o) =>
      query.status ? o.status === query.status : true,
    );
    const offset = (query.page - 1) * query.limit;
    return {
      items: filtered.slice(offset, offset + query.limit),
      total: filtered.length,
    };
  }

  public async findById(id: OrderId): Promise<Order | undefined> {
    return this.store.get(id);
  }

  public async create(input: CreateOrderInput): Promise<Order> {
    const id = OrderIdSchema.parse(randomUUID());
    const order: Order = {
      id,
      customerEmail: input.customerEmail.toLowerCase(),
      totalCents: input.totalCents,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.store.set(id, order);
    return order;
  }

  public async updateStatus(id: OrderId, input: UpdateOrderStatusInput): Promise<Order | undefined> {
    const existing = this.store.get(id);
    if (!existing) return undefined;
    const updated: Order = { ...existing, status: input.status };
    this.store.set(id, updated);
    return updated;
  }

  public async ping(): Promise<boolean> {
    return true;
  }
}
```

*(See `examples/user-api/src/modules/users/users.wal-repository.ts` and `users.module.ts` in this workspace for a complete working example of switching adapters dynamically via `useFactory` and `AppConfig`!)*

---

## Step 5 — Implement Pure Business Logic (`orders.service.ts`)

Services use `@Injectable()` and `inject(Token)` and **never import `express`**. Throw typed domain subclasses of `AppError` (`NotFoundError`, `ConflictError`, `BadRequestError`, `ForbiddenError`, `UnprocessableEntityError`), which Better Back automatically converts into RFC 7807 `application/problem+json` responses with `requestId` correlation:

```ts
// src/modules/orders/orders.service.ts
import {
  ConflictError,
  inject,
  Injectable,
  NotFoundError,
  paginate,
  type PaginatedResult,
} from 'better-back';
import { OrderRepositoryToken } from './orders.repository.js';
import type {
  CreateOrderInput,
  ListOrdersQuery,
  Order,
  OrderId,
  UpdateOrderStatusInput,
} from './orders.schema.js';

@Injectable()
export class OrdersService {
  private readonly repo = inject(OrderRepositoryToken);

  public async list(query: ListOrdersQuery): Promise<PaginatedResult<Order>> {
    const { items, total } = await this.repo.findMany(query);
    return paginate(items, total, query);
  }

  public async getById(id: OrderId): Promise<Order> {
    const order = await this.repo.findById(id);
    if (!order) {
      throw new NotFoundError(`Order "${id}" was not found.`);
    }
    return order;
  }

  public async create(input: CreateOrderInput): Promise<Order> {
    return this.repo.create(input);
  }

  public async updateStatus(id: OrderId, input: UpdateOrderStatusInput): Promise<Order> {
    const current = await this.getById(id);
    if (current.status === 'cancelled' && input.status === 'paid') {
      throw new ConflictError('A cancelled order cannot transition to paid.');
    }
    const updated = await this.repo.updateStatus(id, input);
    if (!updated) {
      throw new NotFoundError(`Order "${id}" was not found.`);
    }
    return updated;
  }
}
```

---

## Step 6 — Add Authentication & Permission Guards (`src/common/auth.guard.ts`)

Guards run **before** route handlers, compose in strict order (`global guard -> @Controller @Guard -> method @Guard`), and propagate a strongly typed `user` object into downstream guards and `Ctx<{ user }>`:

```ts
// src/common/auth.guard.ts
import {
  ForbiddenError,
  inject,
  Injectable,
  UnauthorizedError,
  type AuthGuard,
  type AuthGuardFn,
  type GuardContext,
} from 'better-back';
import { AppConfig } from '../config/env.js';

export interface AuthUser {
  readonly subject: string;
  readonly scopes: readonly string[];
}

@Injectable()
export class BearerAuthGuard implements AuthGuard<AuthUser> {
  private readonly config = inject(AppConfig);

  public canActivate({ req }: GuardContext): AuthUser {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing Bearer authorization header.');
    }
    const token = header.slice('Bearer '.length).trim();
    if (token !== this.config.API_BEARER_TOKEN) {
      throw new UnauthorizedError('Invalid Bearer token.');
    }
    return { subject: 'operator', scopes: ['orders:write'] };
  }
}

export function requireScope(scope: string): AuthGuardFn<void, AuthUser | undefined> {
  return ({ user }) => {
    if (!user) throw new UnauthorizedError('Authentication required.');
    if (!user.scopes.includes(scope)) {
      throw new ForbiddenError(`Missing required permission scope "${scope}".`);
    }
  };
}
```

Wrap shared guards in an explicit `AuthModule` (`src/common/auth.module.ts`) so feature modules declare their auth dependency explicitly:

```ts
// src/common/auth.module.ts
import { Module } from 'better-back';
import { BearerAuthGuard } from './auth.guard.js';

@Module({
  providers: [BearerAuthGuard],
  exports: [BearerAuthGuard],
})
export class AuthModule {}
```

---

## Step 7 — Expose HTTP Endpoints & OpenAPI Metadata (`orders.controller.ts`)

Controllers bind HTTP transport concerns (`@Get`, `@Post`, `@Patch`, `@Delete`, `@Guard`, `@Public`, `@Use`, `rateLimit`, status codes, OpenAPI tags/summaries) to pure service calls:

```ts
// src/modules/orders/orders.controller.ts
import { Controller, Get, Guard, inject, Patch, Post, type Ctx } from 'better-back';
import { BearerAuthGuard, requireScope, type AuthUser } from '../../common/auth.guard.js';
import {
  CreateOrderSchema,
  ListOrdersQuerySchema,
  OrderIdParamsSchema,
  OrderSchema,
  PaginatedOrdersResponseSchema,
  UpdateOrderStatusSchema,
} from './orders.schema.js';
import { OrdersService } from './orders.service.js';

@Controller({ prefix: '/orders', tags: ['Orders'] })
export class OrdersController {
  private readonly orders = inject(OrdersService);

  @Get('/', {
    summary: 'List orders with pagination and optional status filter',
    query: ListOrdersQuerySchema,
    response: PaginatedOrdersResponseSchema,
  })
  public list({ query }: Ctx<{ query: typeof ListOrdersQuerySchema }>) {
    return this.orders.list(query);
  }

  @Get('/:id', {
    summary: 'Fetch an order by UUID',
    params: OrderIdParamsSchema,
    response: OrderSchema,
    errors: [404],
  })
  public getById({ params }: Ctx<{ params: typeof OrderIdParamsSchema }>) {
    return this.orders.getById(params.id);
  }

  @Post('/', {
    summary: 'Create a new order',
    status: 201,
    body: CreateOrderSchema,
    response: OrderSchema,
    errors: [401, 403],
    rateLimit: { windowMs: 60_000, max: 30 }, // Optional per-route rate limit!
  })
  @Guard(BearerAuthGuard, requireScope('orders:write'))
  public create({ body, user, log }: Ctx<{ body: typeof CreateOrderSchema; user: AuthUser }>) {
    log.info({ actor: user.subject, customerEmail: body.customerEmail }, 'creating order');
    return this.orders.create(body);
  }

  @Patch('/:id/status', {
    summary: 'Transition order status',
    params: OrderIdParamsSchema,
    body: UpdateOrderStatusSchema,
    response: OrderSchema,
    errors: [401, 403, 404, 409],
  })
  @Guard(BearerAuthGuard, requireScope('orders:write'))
  public updateStatus({
    params,
    body,
  }: Ctx<{ params: typeof OrderIdParamsSchema; body: typeof UpdateOrderStatusSchema }>) {
    return this.orders.updateStatus(params.id, body);
  }
}
```

---

## Step 8 — Wire Explicit `@Module` Boundaries (`orders.module.ts` & `app.module.ts`)

Better Back enforces **explicit module encapsulation**: a module can only inject providers registered in itself, exported by an imported module, or marked global. If a provider or export is missing or circular, startup fails immediately with an actionable `MissingProviderError` or `CircularDependencyError`.

```ts
// src/modules/orders/orders.module.ts
import { Module } from 'better-back';
import { AuthModule } from '../../common/auth.module.js';
import { OrdersController } from './orders.controller.js';
import { InMemoryOrderRepository, OrderRepositoryToken } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [{ provide: OrderRepositoryToken, useClass: InMemoryOrderRepository }, OrdersService],
  exports: [OrdersService, OrderRepositoryToken],
})
export class OrdersModule {}
```

Register `OrdersModule` in `src/app.module.ts` (note: `npx bb g resource orders` performs this import wiring automatically!):

```ts
// src/app.module.ts
import { Module, type BetterBackOptions } from 'better-back';
import { AppConfig, type AppEnv } from './config/env.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { OrderRepositoryToken } from './modules/orders/orders.repository.js';

@Module({
  imports: [OrdersModule],
})
export class AppModule {}

export function buildAppOptions(
  env: Record<string, string | undefined> = process.env,
): BetterBackOptions<AppEnv> {
  const config = env === process.env ? AppConfig : AppConfig.from(env);

  return {
    config,
    apiPrefix: '/api/v1',
    trustProxy: 1, // Honors X-Forwarded-For behind 1 reverse proxy / ingress hop
    security: {
      cors: {
        origins: [config.values.CORS_ORIGIN],
        credentials: true,
      },
    },
    rateLimit: {
      windowMs: 60_000,
      max: 120,
    },
    healthChecks: [
      {
        name: 'orderRepository',
        check: async (container) => ({
          healthy: await container.resolve(OrderRepositoryToken, 'OrdersModule').ping(),
          detail: 'order store reachable',
        }),
      },
    ],
    openapi: {
      title: 'Orders MVP API',
      version: '1.0.0',
      description: 'Production MVP API powered by Better Back',
    },
  };
}
```

---

## Step 9 — Bootstrap & Run (`src/main.ts`)

Keep `src/main.ts` to 4 lines so `AppModule` and `buildAppOptions()` remain cleanly importable by tests and the `bb` CLI without opening a TCP port:

```ts
// src/main.ts
import { BetterBack } from 'better-back';
import { AppModule, buildAppOptions } from './app.module.js';

const app = await BetterBack.create(AppModule, buildAppOptions());
await app.listen();
```

Start watch-mode development:

```bash
npm run dev
```

Out of the box, your running MVP exposes:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness probe (`200 OK` `{ "status": "ok" }`) for Kubernetes / Docker / Fly / Railway |
| `GET /ready` | Readiness probe executing all `healthChecks` (`503` automatically during graceful shutdown drain!) |
| `GET /docs` | Zero-dependency interactive OpenAPI 3.1 explorer (protected by SHA-256 CSP) |
| `GET /docs/openapi.json` | Canonical OpenAPI 3.1.0 JSON contract (also served via `GET /docs` with `Accept: application/json`) |
| `/api/v1/orders/*` | Validated, rate-limited, OWASP-hardened domain routes emitting RFC 7807 `application/problem+json` on errors |

> **Incremental Migration Tip (`toExpressRouter`)**: Already running a legacy Express 5 app? Mount any Better Back `@Module` or `@Controller` directly into it without rewriting existing routes:
> ```ts
> const ordersRouter = await toExpressRouter(OrdersModule, { config: AppConfig });
> legacyExpressApp.use('/api/v2', ordersRouter);
> ```

---

## Step 10 — Inspect, Test, Build & Deploy the API MVP

### 10.1 Static & In-Memory CLI Inspection (Zero Port Needed)

```bash
# 1. Inspect every registered HTTP method, path, guard state, and status code
npx bb routes src/app.module.ts --prefix /api/v1

# 2. Print the explicit @Module dependency, controller, provider, and export tree
npx bb graph src/app.module.ts

# 3. Export OpenAPI 3.1 JSON for frontend SDK generation — and check for drift in CI
npx bb openapi src/app.module.ts --prefix /api/v1 --out openapi.json
npx bb openapi src/app.module.ts --prefix /api/v1 --check openapi.json

# 4. Run full project health diagnostics (Node LTS, strict tsconfig, .env gitignore, DI boot)
npx bb doctor --verify-app
```

### 10.2 Two-Tier Automated Testing (`tests/orders.test.ts`)

Every MVP slice should have **both**:
1. **Pure unit tests (`resolveForTest`)** — zero Express app or HTTP socket created; runs in `< 5 ms`.
2. **HTTP integration tests (`createTestingApp` + `supertest` + `await using`)** — exercises headers, CORS, auth guards, Zod validation, RFC 7807 errors, and automatic async disposal.

```ts
// tests/orders.test.ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ConflictError, createTestingApp, resolveForTest } from 'better-back';
import { AppModule, buildAppOptions } from '../src/app.module.js';
import { OrderRepositoryToken, InMemoryOrderRepository } from '../src/modules/orders/orders.repository.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';

const TEST_ENV = {
  NODE_ENV: 'test',
  API_BEARER_TOKEN: 'test-secret-token-2026',
  CORS_ORIGIN: 'http://localhost:5173',
};

describe('Orders MVP', () => {
  it('enforces domain state transitions in pure unit tests without HTTP', async () => {
    const service = resolveForTest(OrdersService, [
      [OrderRepositoryToken, new InMemoryOrderRepository()],
    ]);
    const created = await service.create({ customerEmail: 'ada@example.com', totalCents: 2500 });
    await service.updateStatus(created.id, { status: 'cancelled' });

    await expect(service.updateStatus(created.id, { status: 'paid' })).rejects.toThrowError(
      ConflictError,
    );
  });

  it('validates payloads, enforces Bearer auth, and serves CRUD over HTTP', async () => {
    await using app = await createTestingApp(AppModule, buildAppOptions(TEST_ENV));

    // Unauthenticated request -> 401 RFC 7807 Problem Details
    const unauth = await request(app.express)
      .post('/api/v1/orders')
      .send({ customerEmail: 'ada@example.com', totalCents: 2500 });
    expect(unauth.status).toBe(401);
    expect(unauth.headers['content-type']).toContain('application/problem+json');

    // Authenticated creation -> 201 Created
    const created = await request(app.express)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${TEST_ENV.API_BEARER_TOKEN}`)
      .send({ customerEmail: 'ada@example.com', totalCents: 2500 });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
  });
});
```

Run tests and strict typechecking:

```bash
npm run typecheck
npm test
```

### 10.3 Production Build & Container Deployment

Compile TypeScript to `dist/`, verify the compiled DI + route graph at build time, and emit `dist/openapi.json`:

```bash
npx bb build --openapi
```

Minimal production `Dockerfile` (multi-stage, non-root user, built-in `/health` check):

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npx bb build --openapi && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
USER node
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/main.js"]
```

---

# Part II — Shipping & Operating the `Better-backJS` Monorepo MVP

This section covers how to develop, verify, benchmark, publish, and deploy the **`Better-backJS` repository itself** from start to finish.

---

## Phase 1 — Monorepo Architecture & Build Order

The root `package.json` orchestrates **4 npm workspaces** in strict dependency order:

```text
1. packages/core ("better-back")
      ├─ Emits Dual ESM + CJS + .d.ts/.d.cts (dist/index.*, dist/cli.*, dist/bin.js)
      ▼
2. packages/create-better-back ("create-better-back")
      ├─ Thin 332-byte CLI wrapper delegating to "better-back/cli"
      ▼
3. examples/user-api ("@better-back/example-user-api")
      ├─ Reference consumer API built via "../../packages/core/dist/bin.js build"
      │  (proves public-only exports, WAL + InMemory persistence, and DI startup verification)
      ▼
4. docs-site ("@better-back/docs-site")
      └─ Next.js 16.4 + React 19 static/standalone documentation portal (/, /docs/[slug])
```

---

## Phase 2 — Local Monorepo Setup & Live Development

```bash
# 1. Install exact locked dependencies across all 4 workspaces
npm ci

# 2. Build all workspaces (core -> create-better-back -> example-user-api -> docs-site)
npm run build
```

Run the live applications during development:

```bash
# Run the reference User & Posts API (OpenAPI UI at http://127.0.0.1:3000/docs)
npm run start:example

# Run the Next.js documentation website (http://localhost:3000)
npm run dev --workspace=@better-back/docs-site

# Invoke the local CLI against the reference API without global install
npm run cli -- routes examples/user-api/src/app.module.ts --prefix /api/v1
npm run cli -- graph examples/user-api/src/app.module.ts
npm run cli -- doctor examples/user-api --verify-app
```

---

## Phase 3 — The Full MVP Verification & Benchmark Gate

Before any merge or release, every workspace change must pass the single-command verification gate (`npm run verify`) plus the isolated multi-process benchmark suite (`npm run bench`):

```bash
# Format all TypeScript, JSON, TSX, and CSS files
npm run format

# Full CI gate (runs identically on Node 20, 22, and 24 in .github/workflows/ci.yml)
npm run verify

# Reproducible multi-process HTTP throughput & cold-startup benchmarks
npm run bench
```

### What `npm run verify` Enforces Automatically

| Step | Command | MVP Acceptance Criteria |
|---|---|---|
| **1. Formatting** | `npm run format:check` | 100% Prettier compliance across `packages/`, `examples/`, `benchmarks/`, and `docs-site/`. |
| **2. Build** | `npm run build` | `tsup` Dual ESM/CJS + DTS for `better-back` & `create-better-back`; `bb build` DI/route check on `user-api`; Next.js SSG build (`11/11` static pages) on `docs-site`. |
| **3. Strict Typecheck** | `npm run typecheck` | `tsc --noEmit` across all 5 configs (`core`, `create-better-back`, `user-api`, `bench`, `docs-site`) with `"strict": true`. |
| **4. Lint** | `npm run lint` | Zero ESLint warnings/errors; `@typescript-eslint/no-explicit-any: error` enforced everywhere. |
| **5. Tests & Coverage** | `npm run test:coverage` | All **8 test suites (45 tests)** pass — unit, DI, config/redaction, security/CORS/rate-limit, edge cases, Dual ESM/CJS packaging, end-to-end CLI scaffolding, and `user-api` E2E (`~91.9%` line coverage). |
| **6. Package Tarballs** | `npm pack --dry-run` | Verifies clean publishable file lists (`16` files in `better-back`, `4` files in `create-better-back`; zero test/temp leaks). |
| **7. Performance** | `npm run bench` | Cold boot `~1 ms`; Engine Core throughput within **`<= 5%`** of bare Express 5 and faster than `Express 5 + helmet + cors`. |

---

## Phase 4 — Publishing the MVP Packages to npm

Publish in dependency order (`better-back` first, then `create-better-back`):

```bash
# 1. Ensure clean working tree and green verification gate
git status
npm run verify

# 2. Authenticate to npm (use granular access token with 2FA / provenance in CI)
npm whoami

# 3. Publish core framework + CLI ("better-back")
npm publish --workspace=better-back --access public

# 4. Publish initializer ("create-better-back")
npm publish --workspace=create-better-back --access public

# 5. Tag the git release
git tag -a v1.1.0 -m "Release better-back v1.1.0"
git push origin main --tags
```

Post-publish smoke test from an isolated temporary directory outside the monorepo:

```bash
cd "$(mktemp -d)"
npm create better-back@latest smoke-api -- --install --no-git
cd smoke-api
npx bb doctor --verify-app
npm test
```

---

## Phase 5 — Deploying the Documentation Website (`docs-site`)

`docs-site/next.config.ts` is preconfigured with `output: 'standalone'` and monorepo `turbopack.root` / `outputFileTracingRoot`:

- **Option A — Vercel / Netlify (Zero-Config)**:
  1. Import `habtamugeta2-r/Better-backJS`.
  2. Set **Root Directory** to `docs-site`.
  3. Build command: `npm run build` | Install command: `npm ci --prefix ..`.
- **Option B — Self-Hosted Node / Docker (`standalone`)**:
  ```bash
  npm run build --workspace=@better-back/docs-site
  node docs-site/.next/standalone/docs-site/server.js
  ```

---

## Phase 6 — Start-to-Finish MVP Launch Checklist

Use this final checklist to track the project from repository sync to public MVP launch:

- [x] **Core Runtime (`packages/core` v1.1.0)**: Unified Stage-3 decorators, `DynamicModule`, 1-line `inject(Token)` (`optional` / `defaultValue`), `Ctx<...>`, `defineConfig`, Zod v4 + Standard Schema v1 validation, `@Cache` + weak `ETag` (`304`) + SWR + stampede-safe `cacheGetOrSet`, typed `sse()` streaming, W3C `traceparent` + `/metrics`, OpenAPI 3.1 `/docs` (Copy `curl` + live SSE), OWASP security headers, strict CORS, rate limiting, RFC 7807 `ProblemDetails`, health/readiness probes, graceful shutdown, and `toExpressRouter` Express interop.
- [x] **First-Class CLI (`better-back` / `bb` + `create-better-back` v1.1.0)**: `new`, `generate` (`resource`, `module`, `controller`, `service`, `guard`, `repository`), `routes`, `graph`, `openapi` (`--out` / `--check`), **`sdk` (`--out` / `--check` zero-dep strict-TS `fetch` + SSE client generator)**, `build` (`--openapi`), `doctor` (`--verify-app`), and `dev` with zero extra runtime dependencies.
- [x] **Reference Application (`examples/user-api` v1.1.0)**: Complete Users & Posts CRUD + SSE + `/metrics` + ETag API using only public `better-back` exports, demonstrating `InMemory` ⇄ `WAL` repository swapping, chained guards, native Express middlewares, and unit + E2E tests.
- [x] **Documentation & ADRs (`docs/` + `docs-site/` + `CHANGELOG.md`)**: Grounded Pain Map, Design Spec, CLI Guide, Migration Guides (Express / NestJS / Fastify), ADRs `001`–`012`, `CHANGELOG.md`, and Next.js 16 documentation site (`13/13` SSG routes including `/docs/caching-and-sse`, `/docs/observability`, and `bb sdk`).
- [x] **Verification & Benchmarks**: `npm run verify` (`51/51` tests across `9/9` suites, `91.30%` line coverage, `0` lint/type errors across all 4 workspaces) and `npm run bench` (`-1.08%` Engine Core delta vs bare Express 5).
- [ ] **GitHub Push**: Push `main` to `https://github.com/habtamugeta2-r/Better-backJS` and confirm `.github/workflows/ci.yml` passes across Node `20`, `22`, and `24`.
- [ ] **npm Release**: Publish `better-back@1.1.0` and `create-better-back@1.1.0` to the npm registry and verify `npm create better-back@latest`.
- [ ] **Docs Deployment**: Deploy `docs-site` to production URL and link it in the GitHub repository description.
