# ADR-011: Zero-Overhead CLI & Explicit Codegen Architecture

- **Status**: Accepted
- **Date**: 2026-10-29

## Context

Developers building modular TypeScript APIs need fast project initialization (`npm create`), 4-layer CRUD scaffolding (`schema`, `repository`, `service`, `controller`, `module`, `test`), route & `@Module` graph inspection, and CI-ready OpenAPI 3.1 contract export/drift checks.

In existing ecosystems, framework CLIs frequently introduce two costly trade-offs:
1. **Dependency & bundle bloat** (shipping dozens of CLI transitive dependencies — `commander`, `inquirer`, `chalk`, `glob`, AST compilers — inside the core package or forcing global installs that drift out of sync with the project's framework version).
2. **Hidden runtime magic** (replacing explicit module graphs with convention-based directory scanning).

## Decision

1. **Isolated Subpath & Binary Entry (`better-back/cli`, `better-back`, `bb`)**:
   - Package the CLI inside `packages/core/src/cli/` as separate `tsup` entries (`dist/cli.js`, `dist/cli.cjs`, and a `163 B` `dist/bin.js` wrapper) that externalize `./index.js`.
   - `dist/index.js` incurs **`0 bytes`** of CLI overhead.
   - Provide `packages/create-better-back` (`332 B`) delegating `npm create better-back@latest` directly to `runCli(['new', ...])`.
2. **Node.js 20+ Standard Library Only**:
   - Implement argument parsing (`node:util` `parseArgs`), filesystem planning (`node:fs/promises`), and process execution (`node:child_process`) with **zero extra runtime dependencies**, preserving the strict 3-dependency cap (`express`, `zod`, `pino`).
3. **Deterministic Explicit `@Module` Source Wiring**:
   - `bb generate` scaffolds explicit Stage-3 `@Module` / `@Controller` / `@Injectable` files and updates parent `@Module` imports/arrays deterministically (`wireSymbolIntoModuleSource`) rather than introducing runtime directory scanning.
4. **Zero-Build `.ts` Introspection via Optional `tsx/esm/api`**:
   - Resolve `tsx/esm/api` (`tsImport`) dynamically from the consumer's `node_modules` when inspecting `.ts` entrypoints, falling back to `dist/*.js` in production containers where `devDependencies` are pruned.

## Consequences

- **Positive**: Version-locked CLI in every project (`npx bb ...`), `0 B` runtime bundle impact, `0` added runtime dependencies, instant route/graph/OpenAPI inspection on unbuilt `.ts` projects, and CI contract drift verification (`bb openapi --check`).
- **Trade-off**: `@Module` auto-wiring expects standard `@Module({ ... })` decorator formatting; unconventional macro-wrapped module declarations can pass `--no-wire` and add the import manually.
