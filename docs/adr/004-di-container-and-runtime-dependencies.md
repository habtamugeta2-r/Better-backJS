# ADR-004: Hand-Rolled `inject(Token)` DI Container & Complete Runtime Dependency Audit

- **Status**: Accepted
- **Date**: 2026-10-29

## Context
Hard Constraint 6 requires minimal runtime dependencies, demanding that **every single runtime dependency be justified in an ADR** and preferring a hand-rolled DI container over `inversify` or `tsyringe` unless evidence proves otherwise. Simultaneously, Better Back requires 1-line developer ergonomics (`inject(Token)`), interface tokens, `singleton`/`transient`/`request` scopes, 1-line test overrides, and startup circular-dependency + duplicate-provider + module-boundary detection.

## Alternatives Considered for Dependency Injection

### Option A: `inversify` or `tsyringe`
- **Rejected**: Both depend on `reflect-metadata` and legacy `experimentalDecorators`, add thousands of lines of abstraction, do not enforce Better Back module `imports`/`exports` boundaries natively, and incur per-resolution reflection overhead.

### Option B: Manual Constructor Arrays (`static readonly inject = [...] as const`)
- **Rejected**: Forces every service, controller, and guard to repeat every dependency 3 times (`static readonly inject`, `private readonly field`, `constructor(param)`), hurting developer comfort without adding safety over `inject(Token)`.

### Option C: Hand-Rolled Explicit DI Container Powered by `inject(Token)` (`packages/core/src/di/container.ts`)
- **Pros**:
  - Compact, strict, zero-dependency TypeScript with **one** way to inject dependencies: `private readonly repo = inject(UserRepositoryToken)`.
  - Supports three clean provider shapes:
    1. Class constructor (`UsersService` or `{ provide: UserRepositoryToken, useClass: InMemoryUserRepository }`)
    2. Factory (`{ provide: BannerToken, useFactory: () => inject(GreeterToken).greet('World') }`)
    3. Constant value (`{ provide: ApiKeyToken, useValue: 'secret' }`)
  - Supports typed interface tokens (`createToken<UserRepository>('UserRepository')`) and direct config tokens (`const AppConfig = defineConfig(EnvSchema)` -> `inject(AppConfig)`).
  - Supports three scopes: `singleton` (default, resolved eagerly at startup for zero per-request overhead), `transient` (fresh instance per resolution), and `request` (cached per HTTP request, with automatic captive-dependency promotion if a singleton injects a `'request'`-scoped token).
  - Eagerly validates all singleton, request, and transient bindings during `container.init()` at startup: catches circular chains (`ServiceA -> ServiceB -> ServiceA`), duplicate registrations in the same module, and unexported cross-module token access.
  - Supports 1-line test mocking via `resolveForTest(UsersService, [[UserRepositoryToken, mockRepo]])` and `createTestingApp(AppModule, { overrides: [[UserRepositoryToken, mockRepo]] })`.

## Complete Runtime Dependency Audit (`better-back`)

| Package | Version | Why It Earns Inclusion | Why Not Hand-Roll? |
|---|---|---|---|
| `express` | `^5.3.0` | Mandatory HTTP & middleware substrate (Hard Constraint 2) | Core requirement of the framework |
| `zod` | `^4.6.7` | Single-source-of-truth validation, TS type inference, and native `z.toJSONSchema()` OpenAPI 3.1 generation (ADR-002) | Rewriting a battle-tested schema compiler + JSON Schema generator would violate reliability and ecosystem interoperability |
| `pino` | `^10.4.0` | Low-overhead structured JSON logging with path-based secret redaction (ADR-006) | Hand-rolled `JSON.stringify` loggers mishandle circular Error causes, BigInts, high-throughput buffering, and nested path redaction |

**Total direct runtime dependencies: 3 (`express`, `zod`, `pino`).**
Packages explicitly **rejected** from runtime dependencies: `reflect-metadata`, `inversify`, `tsyringe`, `class-validator`, `class-transformer`, `cors` (built-in strict CORS; native `cors` still works unadapted), `helmet` (built-in API security headers; native `helmet` still works unadapted), `swagger-ui-express` (zero-CDN inline `/docs` explorer), `dotenv` (Node 20.6+ ships native `--env-file`).

## Decision
Build the hand-rolled `inject(Token)` DI container in `packages/core/src/di/` and cap `better-back`'s runtime dependencies at exactly `express`, `zod`, and `pino`.

## Consequences
- **Positive**: Tiny install footprint, minimal supply-chain surface, 1-line inferred dependency injection (`inject(Token)`), deterministic startup validation, and zero per-request DI overhead for singleton controllers/services.
- **Negative / Watch-outs**: `inject(Token)` must be called synchronously during class field initialization, `constructor()`, or `useFactory()`. Calling it outside container instantiation throws a clear `BootstrapError`.
