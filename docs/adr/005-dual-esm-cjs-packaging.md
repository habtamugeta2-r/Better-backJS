# ADR-005: Dual ESM/CJS Packaging with Strict `exports` Map

- **Status**: Accepted
- **Date**: 2026-10-29

## Context
Hard Constraint 10 requires `better-back` to be published as a standalone npm package targeting Node.js `>= 20` LTS, with its ESM/CJS strategy and `exports` map decided in an ADR, and consumed by `examples/user-api` strictly via its public package entrypoint.

While greenfield Node 20+ projects increasingly use `"type": "module"` (ESM), a substantial share of existing Express codebases migrating incrementally to Better Back still compile to CommonJS (`require('better-back')`).

## Alternatives Considered

### Option A: ESM-Only (`"type": "module"`, `.js` + `.d.ts`)
- **Pros**: Simplest build output; avoids dual-package state split.
- **Cons**: Blocks incremental adoption in CommonJS Express repositories that haven't enabled ESM or rely on CJS tooling.

### Option B: CJS-Only
- **Rejected**: Regressive for modern TypeScript/Node 20+ ESM consumers; poor tree-shaking and named-import ergonomics.

### Option C: Dual ESM + CJS via `tsup` with Conditional `exports` Map and `Symbol.for` Metadata Keys
- **Pros**:
  - Works seamlessly in both ESM (`import { BetterBack } from 'better-back'`) and CommonJS (`const { BetterBack } = require('better-back')`).
  - Generates separate `.d.mts` and `.d.cts` declaration files so TypeScript `"moduleResolution": "NodeNext"` and `"Bundler"` both pass `arethetypeswrong`-grade resolution rules without false-ESM hazards.
  - Dual-package hazard (if a consumer accidentally loads both ESM and CJS copies) is neutralized by keeping `better-back` stateless at module scope and keying decorator/token symbols with `Symbol.for('better-back.*')` + global `globalThis` WeakMap fallback.

## Decision
Adopt **Option C**: `"type": "module"` in `packages/core/package.json`, compiled via `tsup` into:
- ESM: `dist/index.js` + `dist/index.d.ts`
- CJS: `dist/index.cjs` + `dist/index.d.cts`

With a strict `exports` map exposing only `"."` and `"./package.json"` so internal files under `src/` cannot be deep-imported by consumers.

## Consequences
- **Positive**: Zero friction for both modern ESM TypeScript projects and legacy CJS Express apps migrating gradually; strict encapsulation of private framework internals.
- **Negative / Watch-outs**: Build step (`npm run build`) emits two JS bundles + two `.d.ts` bundles (~1 second with `tsup`). Verified in CI/tests by importing the built package from `examples/user-api`.
