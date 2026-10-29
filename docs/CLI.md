# Better Back CLI (`better-back` / `bb`)

Better Back ships a zero-extra-dependency CLI (`better-back` and shorthand `bb`) plus the standalone `create-better-back` initializer.

- **Zero Runtime Bundle Overhead**: Compiled into isolated `dist/cli.js` + `dist/bin.js` entries (`0 bytes` added to `dist/index.js` and still strictly **3 runtime dependencies**: `express`, `zod`, `pino`).
- **Explicit Over Magical**: Every schematic generates clean ECMAScript Stage-3 decorators, 1-line `inject(Token)` DI, Zod v4 `.meta({ id })` OpenAPI component schemas, and deterministic `@Module` ES imports — zero hidden runtime filesystem scanning.
- **Zero-Build `.ts` Introspection**: `bb routes`, `bb graph`, `bb openapi`, and `bb doctor --verify-app` inspect `.ts` entrypoints directly via `tsx/esm/api` during development (before `dist/` is built) and seamlessly load compiled `dist/*.js` in production containers.

---

## 1. Scaffolding a New Project (`new` / `create-better-back`)

```bash
# Scaffold via npm initializer
npm create better-back@latest my-api

# Or directly via the CLI
npx better-back new my-api
npx bb new my-service --minimal
```

| Flag | Description |
|---|---|
| `--minimal` | Scaffolds a single-file microservice (`src/main.ts`) instead of the full 4-layer modular starter |
| `--install` | Automatically runs `npm install` in the created directory |
| `--no-git` | Skips `git init -b main` |
| `--dry-run` | Prints every planned file creation without writing to disk |
| `--force`, `-f` | Allows scaffolding into a non-empty target directory |

---

## 2. Code Generation (`generate` / `g`)

```bash
# Full 4-layer CRUD vertical slice + unit/HTTP test + AppModule wiring
npx bb g resource orders

# Individual schematics
npx bb g module notifications
npx bb g service notifications
npx bb g controller notifications
npx bb g repository audit-logs
npx bb g guard api-key
```

| Schematic | Aliases | Generated Files & Auto-Wiring |
|---|---|---|
| `resource` | `res`, `r` | `schema.ts`, `repository.ts`, `service.ts`, `controller.ts`, `module.ts`, `tests/<plural>.test.ts` + wires `<Plural>Module` into `src/app.module.ts` |
| `module` | `mod`, `m` | `src/modules/<plural>/<plural>.module.ts` + wires into `src/app.module.ts` |
| `controller` | `ctrl`, `co`, `c` | `src/modules/<plural>/<plural>.controller.ts` + wires into `<plural>.module.ts` |
| `service` | `svc`, `s` | `src/modules/<plural>/<plural>.service.ts` + wires into `providers` & `exports` of `<plural>.module.ts` |
| `repository` | `repo`, `port` | `src/modules/<plural>/<plural>.repository.ts` (`createToken<Repo>` + `InMemory` adapter) |
| `guard` | `gu`, `g` | `src/common/<singular>.guard.ts` (typed `AuthGuard<Principal>`) |

**Flags**: `--no-auth` (public write endpoints), `--no-tests` (skip test file), `--no-wire` (skip `@Module` auto-wiring), `--dry-run`, `--force`.

---

## 3. Architecture & Contract Introspection (`routes`, `graph`, `openapi`)

All introspection commands boot your module graph in memory **without binding a TCP socket**:

```bash
# Print aligned HTTP route table (or machine-readable JSON)
npx bb routes
npx bb routes src/app.module.ts --json --prefix /api/v2

# Print explicit @Module dependency, controller, provider & export tree
npx bb graph
npx bb graph --json

# Export OpenAPI 3.1.0 JSON specification
npx bb openapi --out openapi.json

# Verify in CI that committed openapi.json has not drifted from code
npx bb openapi --check openapi.json
```

---

## 4. Build, Diagnostics & Watch Mode (`build`, `doctor`, `dev`)

```bash
# Compile TypeScript + verify compiled dist/app.module.js DI/routing graph + emit dist/openapi.json
npx bb build --openapi

# Audit Node >= 20 LTS, ESM mode, strict tsconfig, Stage-3 decorators, .env hygiene & live DI graph
npx bb doctor --verify-app

# Run watch-mode dev server (uses tsx watch for .ts or node --watch for .js, auto-loads .env)
npx bb dev
```

---

## 5. Programmatic API (`better-back/cli`)

Every CLI capability is exported with full TypeScript types from `better-back/cli` for custom build pipelines and internal platform tooling:

```ts
import {
  buildProjectCommand,
  deriveEntityNames,
  doctorCommand,
  exportOpenApiCommand,
  generateSchematic,
  inspectGraphCommand,
  inspectRoutesCommand,
  runCli,
  scaffoldNewProject,
  wireSymbolIntoModuleSource,
} from 'better-back/cli';
```
