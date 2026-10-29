# ADR-010: Testing Architecture — Vitest, Supertest, One-Line DI Overrides & Compile-Time Type Tests

- **Status**: Accepted
- **Date**: 2026-10-29

## Context
Pain P11 and Measurable Success Criteria require:
1. Pure domain services testable with **zero HTTP server booted**.
2. Controllers, services, and guards mockable via the DI container in **one line**, without `vi.mock` module monkey-patching.
3. HTTP integration tests verifying happy paths, validation errors, `401`, `404`, async handler throws (never hanging), timeouts, Express middleware interop, and graceful shutdown.
4. **Type-level tests** proving compile-time safety (e.g., renaming or mistyping a schema field breaks compilation).

## Alternatives Considered

### Option A: Jest + `ts-jest`
- **Rejected**: Complex ESM configuration (`--experimental-vm-modules`), slower startup, requires separate `tsd` tool for type-level assertions.

### Option B: Node Native `node:test` Runner
- **Pros**: Built into Node 20.
- **Cons**: Lacks built-in `expectTypeOf` type-level assertion integration and integrated V8 coverage tables out of the box compared to Vitest.

### Option C: `vitest` (`^4.1.12`) + `@vitest/coverage-v8` + `supertest` (`^7.3.1`) + `tsc --noEmit` Type Tests
- **Pros**:
  - Native ESM + TypeScript execution, fast parallel worker execution, built-in V8 coverage reporting.
  - First-class `expectTypeOf` + `@ts-expect-error` verified directly by `tsc --noEmit` so broken type inference fails the build immediately.
  - `supertest` mounts `app.express` directly in-memory without requiring fragile fixed TCP ports (except explicit lifecycle/shutdown/benchmark tests which bind ephemeral port `0`).
  - Framework provides `resolveForTest(ServiceClass, [[Token, mock]])` for 1-line zero-HTTP service unit tests and `createTestingApp(RootModuleOrController, { overrides: [[Token, mock]] })` for HTTP integration tests.

## Decision
Adopt **Vitest + `@vitest/coverage-v8` + `supertest` + `tsc --noEmit` type-level test suites**, paired with `resolveForTest` and `createTestingApp` in `better-back`.

## Consequences
- **Positive**: Fast (< 3s) full suite execution, real code coverage metrics, zero monkey-patching in unit or integration tests, and mathematically verified TypeScript inference.
- **Negative / Watch-outs**: None for runtime consumers (`vitest` and `supertest` are strictly `devDependencies`).
