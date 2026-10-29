# ADR-003: Unified ECMAScript Stage-3 Decorators, 1-Line `inject(Token)` & Minimal `Ctx<...>`

- **Status**: Accepted (Supersedes Hybrid Functional + Decorator Routing)
- **Date**: 2026-10-29

## Context
Early prototypes of Node.js frameworks often try to offer *both* functional builders (`defineModule`, `defineController`, `route.get`, `defineContract`, `InferContext`) *and* class decorators (`@Module`, `@Controller`, `@Get`). In practice, shipping two parallel paradigms creates cognitive friction:
1. Teams debate which style to use per module (`users/` vs `posts/`).
2. Features overlap (`@UseGuard` vs `routeOptions.guard`, `@UseMiddleware` vs `routeOptions.use`, `static readonly inject` vs `@Injectable({ inject })` vs `provideFactory`).
3. Decorator handlers without `reflect-metadata` previously suffered from 4-line constructor injection boilerplate (`static readonly inject = [...] as const` + `private readonly svc` + `constructor(...)`) and detached `defineContract` + `InferContext<typeof contract>` blocks.

## Alternatives Considered

### Option A: Legacy NestJS Decorators (`experimentalDecorators` + `reflect-metadata` + `@Body()` / `@Param()` Parameter Decorators)
- **Rejected**: Relies on non-standard legacy TypeScript compiler flags, runtime reflection overhead, and erased interface tokens.

### Option B: Hybrid Functional Builders + Stage-3 Decorators
- **Rejected**: Doubles API surface area, creates two competing mental models across the codebase, and inflates bundle and `.d.ts` size.

### Option C: Single Unified ECMAScript Stage-3 Decorator Syntax + `inject(Token)` + `Ctx<...>`
- **Pros**:
  - **One canonical way to build**: `@Module`, `@Controller`, `@Injectable`, `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`, `@Guard`, `@Public`, `@Use`.
  - **Zero `reflect-metadata`**: Built exclusively on the TC39 Stage-3 `Symbol.metadata` standard (`TypeScript >= 5.0` default).
  - **1-Line Dependency Injection (`inject(Token)`)**: Synchronous resolution context tracking (`activeInjectionFrame`) allows `private readonly users = inject(UsersService)` in class fields, constructors, or `useFactory` functions with 100% TypeScript type inference and zero constructor boilerplate.
  - **Inline `Ctx<...>` Typing**: Route schemas live directly inside `@Post('/', { body: CreateUserSchema, response: UserSchema })`, and handlers type `{ body }: Ctx<typeof CreateUserSchema>` or `{ params, body, user }: Ctx<{ params: '/:id'; body: typeof UpdateUserSchema; user: AuthUser }>` inline — checked bidirectionally by the decorator signature at compile time.
  - **Single-Controller Microservice Shorthand**: `BetterBack.create(TasksController)` and `createTestingApp(TasksController)` accept a standalone `@Controller` directly when a full `@Module` graph isn't needed yet.

## Decision
Adopt **Option C** across the entire framework and remove all hybrid functional builders (`defineModule`, `defineController`, `route.*`, `defineContract`, `InferContext`) and overlapping options.

## Consequences
- **Positive**: Dramatically cleaner user-facing code (~45% fewer lines in controllers/services/guards), lean ESM/CJS/`.d.ts` bundles (`111.7 KB` ESM, `46.2 KB` `.d.ts`), zero paradigm split, unified Stage-3 `Symbol.metadata` across both DI and routing, and fast monomorphic route execution (`8,812 req/s` Engine Core vs `9,199 req/s` Raw Express = `-4.20%`, with `0.90 ms` cold boot).
- **Negative / Watch-outs**: `inject(Token)` must be called synchronously during class construction or `useFactory` execution (calling it inside a request handler throws an explicit `BootstrapError` immediately). Pure unit tests instantiate services in 1 line via `resolveForTest(UsersService, [[UserRepositoryToken, mockRepo]])`.
