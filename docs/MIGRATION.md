# Migration Guides — Express, NestJS, and Fastify to Better Back

---

## 1. Migrating from Raw Express 4 / Express 5

Because **Better Back** mounts directly onto a genuine `express.Application` (`app.express`), you can migrate **route-by-route** without a "big bang" rewrite.

### Step 1: Mount your existing Express app inside Better Back (Day 1 — 5 minutes)
```ts
import express from 'express';
import { BetterBack, Module } from 'better-back';
import { legacyOrdersRouter } from './legacy/orders-router.js';

const existingExpress = express();
existingExpress.use('/legacy/orders', legacyOrdersRouter);

@Module({})
class AppModule {}

// Pass your existing Express app directly — all legacy routes keep working untouched,
// while gaining correlation IDs, OWASP headers, `/health`, `/ready`, and RFC 7807 errors!
const app = await BetterBack.create(AppModule, {
  expressApp: existingExpress,
});
await app.listen(3000);
```

### Step 2: Keep your existing Express middlewares with zero adapters
`cors`, `helmet`, `morgan`, `compression`, and custom `(req, res, next)` handlers work directly via `options.middleware` or `@Use(...)`:
```ts
import cors from 'cors';
import morgan from 'morgan';

const app = await BetterBack.create(AppModule, {
  middleware: [cors({ origin: 'https://app.example.com' }), morgan('tiny')],
});
```

### Step 3: Extract business logic out of `(req, res)` into `@Injectable()` services
- **Before (Express)**: SQL queries, `req.body` checks, and `res.status(400).json({ msg })` mixed in a 120-line route callback.
- **After (Better Back)**:
  1. Move inputs into a Zod v4 schema (`CreateOrderSchema`).
  2. Move business logic into `@Injectable() class OrdersService { private readonly repo = inject(OrderRepoToken); }`, throwing `NotFoundError` / `ConflictError`.
  3. Add a thin `@Controller('/orders')` method with `@Post('/', { body: CreateOrderSchema })` and `Ctx<typeof CreateOrderSchema>`.

---

## 2. Migrating from NestJS

Better Back keeps the modular `@Module` / `@Controller` / `@Injectable` organization teams enjoy in NestJS while removing `reflect-metadata`, `experimentalDecorators`, `class-validator`, constructor ceremony, and the 5-concept pipeline maze.

| NestJS Concept | Better Back Equivalent | What Improves |
|---|---|---|
| `reflect-metadata` + `experimentalDecorators` | Native TC39 Stage-3 Decorators (`@Module`, `@Controller`, `@Injectable`) | Standard TypeScript `>= 5.0` — zero polyfills or compiler flags |
| `constructor(@Inject(TOKEN) private readonly repo: Repo)` | `private readonly repo = inject(RepoToken);` | **1 line** instead of 4; 100% inferred from token type |
| `class CreateUserDto` + `@IsEmail()` + `@ApiProperty()` | `const CreateUserSchema = z.object({ email: z.email() }).meta({ id: 'CreateUserInput' })` | **1 source of truth** (auto-hoisted into `#/components/schemas/CreateUserInput`) |
| `ValidationPipe` + `ClassSerializerInterceptor` | Built-in `body` / `query` / `params` / `response` options on `@Get` / `@Post` | Automatic input & output stripping + OpenAPI 3.1 generation |
| `NestMiddleware` (`consumer.apply(...)`) | `options.middleware` or `@Use(fn)` | Runs genuine Express `(req, res, next)` middleware with zero wrapper classes |
| `CanActivate` (`@UseGuards`) | `AuthGuard<TUser>` (`@Guard(BearerAuthGuard, RoleGuard)`, `@Public()`) | Composable guard chains + compile-time verified **`ctx.user`** instead of `(req as any).user` |
| `ExceptionFilter` + `HttpException` | Built-in RFC 7807 `AppError` hierarchy (`NotFoundError`, `ConflictError`, ...) | Standardized `application/problem+json` out of the box |
| `@nestjs/config` (`ConfigService.get<string>('PORT')`) | `const AppConfig = defineConfig(EnvSchema)` + `inject(AppConfig)` | Crashes at boot on invalid env, deep-frozen, secrets auto-redacted |
| `Test.createTestingModule({...}).compile()` | `resolveForTest(Svc, [[Token, mock]])` or `createTestingApp(AppModule, { overrides })` | 1-line deterministic DI overrides; zero module boilerplate in unit tests |

### Quick NestJS Migration Checklist
1. Remove `"experimentalDecorators"` and `"emitDecoratorMetadata"` from `tsconfig.json`, and uninstall `reflect-metadata`, `class-validator`, `class-transformer`, and `@nestjs/*`.
2. Replace `class-validator` DTO classes with Zod v4 schemas (`z.object({...})`).
3. Replace constructor `@Inject(...)` parameter decorators with `private readonly dep = inject(DepToken);`.
4. Replace `@Body()`, `@Param()`, `@Query()`, `@Req()` parameter decorators with a single `{ body, params, query, user }: Ctx<...>` parameter.

---

## 3. Migrating from Fastify

Teams moving from Fastify typically do so when they need **100% native Express middleware compatibility** (e.g., Passport strategies, corporate Express SDKs, `morgan`, `multer`) or explicit `@Module` dependency boundaries instead of `fastify-plugin` (`fp`) scope trees.

| Fastify Concept | Better Back Equivalent | Notes |
|---|---|---|
| `fastify.register(plugin)` + `fastify-plugin` (`fp`) | `@Module({ imports, controllers, providers, exports })` | Explicit static `exports` array replaces Fastify's implicit parent/child plugin encapsulation tree |
| `fastify-type-provider-zod` | Built-in `@Post(path, { body, query, params, response })` + `Ctx<...>` | Built into core — no per-instance `.withTypeProvider<ZodTypeProvider>()` ceremony |
| `fastify.decorateRequest('user', null)` | `@Guard(guard)` -> `{ user }: Ctx<{ user: AuthUser }>` | Zero prototype decoration or global module declaration merging (`declare module 'fastify'`) |
| Fastify built-in `pino` logger (`request.log`) | Built-in `pino` logger (`ctx.log`) | Identical structured Pino API (`ctx.log.info({ ... }, 'message')`) with automatic `requestId` & secret redaction |
| `fastify.inject({ method, url })` | `supertest(app.express)` + `createTestingApp(...)` | Runs in-memory without binding a public network port |
