# ADR-008: Startup-Validated Typed Configuration, Profiles & Secret Redaction

- **Status**: Accepted
- **Date**: 2026-10-29

## Context
Pain P8 and Hard Constraints 8 & 9 require that invalid or missing configuration crash loudly **at startup** (never mid-request in production), support environment profiles (`development`, `production`, `test`), expose strictly typed config directly via DI (`inject(AppConfig)`), and prevent secrets from leaking in startup errors or runtime logs.

## Alternatives Considered

### Option A: `dotenv` + Raw `process.env` Access
- **Rejected**: Untyped (`string | undefined`), fails lazily on first code execution, adds unnecessary `dotenv` dependency when Node `>= 20.6` natively supports `node --env-file=.env`.

### Option B: Joi / `convict` Config Library
- **Rejected**: Introduces a second schema language alongside Zod, violating Hard Constraint 4 (Single Source of Truth) and Hard Constraint 6 (Minimal dependencies).

### Option C: Zod-Powered `defineConfig` with Profile Defaults, Deep Freeze & Secret Redaction
- **Pros**:
  - Uses the exact same Zod v4 engine already in core (`z.object({ NODE_ENV: z.enum(['development', 'production', 'test']).default('development'), PORT: z.coerce.number().int().min(1).max(65535).default(3000), ... })`).
  - Supports profile-specific overrides (`profiles: { development, production, test }`) merged deterministically before validation (`profile defaults <- raw env`).
  - Deep-freezes the validated config object (`Object.freeze`) so accidental runtime mutation throws immediately.
  - Automatically identifies sensitive keys via explicit `secretKeys` + safe case-insensitive naming heuristics (`/(secret|password|passwd|token|api[_-]?key|private[_-]?key|database[_-]?url|jwt)/i`):
    1. If config validation fails at startup, `ConfigValidationError` reports which variable failed and why, while **redacting raw values** of sensitive keys (`[REDACTED]`).
    2. Registers redacted key paths automatically into the Pino logger instance.

## Decision
Implement **Option C (`defineConfig(schema | options)`)** in `packages/core/src/config/`, where `LoadedConfig<T>` directly implements `InjectionToken<Readonly<T>>` (`inject(AppConfig)`) and exposes `.from(customEnv)` for test environment overrides sharing the exact same token identity.

## Consequences
- **Positive**: Zero extra dependencies; guaranteed valid, immutable, inferred configuration before `app.listen()`; defense-in-depth against secret leakage in crash reports and structured logs.
- **Negative / Watch-outs**: Developers using `.env` files in local dev run `node --env-file=.env` (native in Node 20 LTS), documented in `README.md`.
