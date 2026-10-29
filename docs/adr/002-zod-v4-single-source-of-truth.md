# ADR-002: Zod v4 (`^4.6.7`) as Single Source of Truth Schema Engine

- **Status**: Accepted
- **Date**: 2026-10-29

## Context
Hard Constraint 4 mandates a Single Source of Truth: **one schema per DTO** must generate (1) runtime request/response validation, (2) inferred static TypeScript handler types (`strict: true`, no `any`), and (3) OpenAPI 3.1.0 schema definitions — without describing any field twice. Phase 0 (`PAIN_MAP.md` P3) proved that `class-validator` + `class-transformer` + `@ApiProperty` splits validation, types, and OpenAPI across three drifting systems and suffers from upstream maintenance stagnation.

## Alternatives Considered

### Option A: `class-validator` + `class-transformer` + `@nestjs/swagger`-style Decorators
- **Rejected**: Violates Hard Constraints 3, 4, and 6. Requires `reflect-metadata`, fails to infer TypeScript types from validation rules, forces triple declaration, and relies on stagnant upstream packages.

### Option B: TypeBox (`@sinclair/typebox`)
- **Pros**: Emits raw JSON Schema objects directly; very fast when paired with `ajv` codegen compilation.
- **Cons**: Requires bundling `ajv` + `ajv-formats` for runtime validation (adding heavy dependencies and `new Function` CSP considerations), awkward ergonomics for transforms/refinements/branded types compared to Zod, and steeper learning curve for mainstream TypeScript developers.

### Option C: Valibot
- **Pros**: Modular, tree-shakable functional API (valuable in browser bundles).
- **Cons**: Tree-shaking bundle size matters far less on Node.js servers; requires separate `@valibot/to-json-schema` package for OpenAPI generation; smaller ecosystem mindshare than Zod.

### Option D: Zod v4 (`zod@^4.6.7`)
- **Pros**:
  - Industry-standard TypeScript schema ergonomics (`z.object`, `.brand()`, `z.coerce`, refinements, unions, `.meta({ description, examples })`).
  - **Built-in first-party `z.toJSONSchema()`** in Zod v4 (`draft-2020-12`, which OpenAPI 3.1 uses natively) — eliminating any external `zod-to-openapi` or `zod-to-json-schema` runtime dependency.
  - Zod v4 compiled fast-path validation substantially narrows the runtime throughput gap with JSON Schema compilers while remaining 100% CSP-safe.
  - First-class `z.infer<T>` static inference for inputs and outputs.
- **Cons**: Slightly slower raw micro-benchmark validation than `ajv` precompiled schemas (~microseconds per request, negligible relative to HTTP/network I/O).

## Decision
Adopt **Zod v4 (`zod@^4.6.7`)** as Better Back's single-source-of-truth schema library for route contracts (`params`, `query`, `body`, `headers`, `response`), environment configuration (`defineConfig`), and OpenAPI 3.1 generation (`z.toJSONSchema`).

## Consequences
- **Positive**: Zero schema duplication; zero extra OpenAPI-converter dependencies; branded IDs (`z.uuid().brand<'UserId'>()`) work seamlessly across validation, TypeScript types, and OpenAPI 3.1 output.
- **Negative / Watch-outs**: `z.transform()` schemas have distinct input vs output types; Better Back's OpenAPI generator uses `{ io: 'input' }` for request schemas (`params`/`query`/`headers`/`body`) and default output mode for `response` schemas so OpenAPI always matches wire payloads.
