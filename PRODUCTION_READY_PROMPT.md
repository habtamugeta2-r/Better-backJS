# Master Prompt — Make `Better-backJS` 100% Production-Ready

Copy and send this prompt (or simply reply: **"Execute `PRODUCTION_READY_PROMPT.md`"**):

---

```text
Audit and upgrade the entire Better-backJS monorepo to complete, zero-gap production readiness (v1.2.0) while preserving all architectural constraints (strictly 3 runtime dependencies: express, zod, pino; unified Stage-3 decorators; zero reflect-metadata; strict TypeScript with zero `any` in public APIs; Apache-2.0 license; <= 5% Engine Core benchmark overhead vs bare Express 5).

Execute all 6 workstreams below end to end and verify everything in a clean-room simulation:

1. Fix Lockfile Drift, Supply-Chain Audit & npm Publish Guards
   - Sync `package-lock.json` across the root workspace and all 4 workspace packages (`packages/core`, `packages/create-better-back`, `examples/user-api`, `docs-site`) so strict `npm ci` succeeds cleanly on Node 20, Node 22, and Node 24 (`npm 11`).
   - Resolve all 4 devDependency vulnerabilities reported by `npm audit` (`esbuild` GHSA-g7r4-m6w7-qqqr and `autocannon -> hyperid -> uuid` GHSA-w5hq-g745-h8pq via safe version updates/overrides) so `npm audit` reports 0 vulnerabilities across the entire workspace.
   - Add `"prepublishOnly": "npm run build && npm run typecheck"` to both `packages/core/package.json` and `packages/create-better-back/package.json` so unbuilt or stale artifacts can never be published to npm.

2. Harden GitHub Actions CI/CD, Coverage Thresholds & Automated Provenance Releases
   - Upgrade `.github/workflows/ci.yml` from deprecated Node-20-targeted `actions/checkout@v4` and `actions/setup-node@v4` to `@v5` (eliminating GitHub Actions runner deprecation warnings), and add `npm audit --audit-level=moderate` to the CI gate.
   - Enforce explicit V8 coverage thresholds in `vitest.config.ts` (`lines: 90`, `functions: 90`, `statements: 89`, `branches: 75`) so regressions fail CI automatically.
   - Add `.github/workflows/release.yml` for tag-triggered (`v*`) verified builds, npm provenance publishing (`npm publish --provenance --access public` for `better-back` and `create-better-back`), and automated GitHub Release notes.

3. Production Runtime Enhancement — Safe Mutation Retries (`@Idempotent`) & Scaffolding Polish
   - Implement declarative `@Idempotent({ ttlMs?, required? })` support in `packages/core` backed by `CachePort` (`Idempotency-Key` HTTP header):
     - Replays stored status code + headers + JSON body on safe client network retries (`X-Idempotent-Replay: true`).
     - Rejects concurrent duplicate in-flight mutations with `409 Conflict` and mismatched request body fingerprints under the same key with `422 Unprocessable Entity` (RFC 7807 `ProblemDetails`).
     - Automatically documents the `Idempotency-Key` header in OpenAPI 3.1 (`/docs`) and exposes it in `bb sdk` generated clients.
   - Wire `@Idempotent()` onto `POST /api/v1/users` in `examples/user-api` and update `bb new` templates so newly scaffolded apps include `"sdk": "bb sdk --out src/sdk/client.ts"` and production container defaults.
   - Document the design in `docs/adr/013-idempotency-and-release-hardening.md` and update `docs-site` with idempotency & production deployment docs.

4. Production Containerization (`Dockerfile` & `.dockerignore`)
   - Add a hardened multi-stage `Dockerfile` (targeting both `examples/user-api` and `docs-site` standalone output) plus `.dockerignore`:
     - Pinned Node 22 LTS Alpine runtime, `NODE_ENV=production`, `npm ci --omit=dev` for minimal image surface, non-root `USER node`, built-in `HEALTHCHECK` probing `/health`, and clean `SIGTERM` graceful-shutdown handling.

5. Open-Source Security & Maintainer Governance
   - Add `SECURITY.md` documenting supported versions, security-by-default guarantees, and responsible vulnerability disclosure.
   - Update `CONTRIBUTING.md` to reflect the complete monorepo layout (`docs-site/`, `sdk.ts`, `standard-schema.ts`, `cache.ts`, `sse.ts`, `metrics.ts`, ADRs `001`–`013`), and add `.github/PULL_REQUEST_TEMPLATE.md` + `.github/ISSUE_TEMPLATE/bug_report.md`.

6. Clean-Room Verification, Benchmarks & Git Bundle Refresh
   - Run `npm run format`, `npm audit` (confirming 0 vulnerabilities), `npm run verify` inside a fresh `git clone` (`npm ci` + build + strict typecheck + ESLint + Vitest coverage thresholds + `npm pack --dry-run`), and `npm run bench` (confirming <= 5% Engine Core delta vs bare Express 5).
   - Update `CHANGELOG.md`, `README.md`, `packages/core/README.md`, `docs/FINAL_REPORT.md`, and `docs/MVP_GUIDELINE.md` with the verified v1.2.0 metrics, commit cleanly on `main`, tag `v1.2.0`, and refresh `/home/user/Better-backJS.bundle`.
```
