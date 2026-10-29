import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestingApp, type ConcreteConstructor } from 'better-back';
import {
  deriveEntityNames,
  normalizePackageSlug,
  runCli,
  wireSymbolIntoModuleSource,
  type CliOutput,
  type ModuleGraphNode,
  type RouteSummaryRow,
} from 'better-back/cli';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');
const tscBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
);
const vitestBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
);

interface CapturedIo {
  readonly io: CliOutput;
  readonly out: string[];
  readonly err: string[];
}

function createBufferIo(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    },
  };
}

const tempDirs: string[] = [];

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'better-back-cli-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('Better Back CLI (`better-back` / `bb`)', () => {
  it('normalizes singular, plural, irregular, and multi-word identifiers deterministically', () => {
    const blogPosts = deriveEntityNames('BlogPosts');
    expect(blogPosts).toEqual({
      singularKebab: 'blog-post',
      pluralKebab: 'blog-posts',
      singularPascal: 'BlogPost',
      pluralPascal: 'BlogPosts',
      singularCamel: 'blogPost',
      pluralCamel: 'blogPosts',
    });

    const categories = deriveEntityNames('category');
    expect(categories.singularPascal).toBe('Category');
    expect(categories.pluralPascal).toBe('Categories');
    expect(categories.pluralKebab).toBe('categories');

    const statuses = deriveEntityNames('statuses');
    expect(statuses.singularKebab).toBe('status');
    expect(statuses.pluralKebab).toBe('statuses');

    expect(normalizePackageSlug('My Billing_API!')).toBe('my-billing-api');
    expect(() => deriveEntityNames('---')).toThrow(/Invalid resource or module name/);
  });

  it('wires imports and array entries into @Module() sources idempotently', () => {
    const initialSource = `import { Module } from 'better-back';
import { ItemsModule } from './modules/items/items.module.js';

@Module({
  imports: [ItemsModule],
})
export class AppModule {}
`;

    const firstPass = wireSymbolIntoModuleSource({
      source: initialSource,
      symbolName: 'OrdersModule',
      importPath: './modules/orders/orders.module.js',
      arrayField: 'imports',
    });
    expect(firstPass.changed).toBe(true);
    expect(firstPass.updated).toContain(
      `import { OrdersModule } from './modules/orders/orders.module.js';`,
    );
    expect(firstPass.updated).toContain('imports: [ItemsModule, OrdersModule]');

    // Second pass must be a strict no-op
    const secondPass = wireSymbolIntoModuleSource({
      source: firstPass.updated,
      symbolName: 'OrdersModule',
      importPath: './modules/orders/orders.module.js',
      arrayField: 'imports',
    });
    expect(secondPass.changed).toBe(false);
    expect(secondPass.updated).toBe(firstPass.updated);

    // Inserting a missing array field (e.g., controllers) works cleanly
    const withControllers = wireSymbolIntoModuleSource({
      source: firstPass.updated,
      symbolName: 'HealthController',
      importPath: './health.controller.js',
      arrayField: 'controllers',
    });
    expect(withControllers.changed).toBe(true);
    expect(withControllers.updated).toContain('controllers: [HealthController]');
  });

  it('prints CLI version and help text cleanly', async () => {
    const vCap = createBufferIo();
    expect(await runCli(['--version'], vCap.io)).toBe(0);
    expect(vCap.out.join('\n')).toBe('1.0.0');

    const hCap = createBufferIo();
    expect(await runCli(['--help'], hCap.io)).toBe(0);
    expect(hCap.out.join('\n')).toContain('Better Back CLI');
    expect(hCap.out.join('\n')).toContain('graph [entry]');
    expect(hCap.out.join('\n')).toContain('build');
  });

  it('respects --dry-run and protects existing files unless --force is supplied', async () => {
    const tmp = await makeTempWorkspace();
    const dryCap = createBufferIo();

    expect(await runCli(['new', 'dry-api', '--no-git', '--dry-run'], dryCap.io, tmp)).toBe(0);
    expect(dryCap.out.join('\n')).toContain('[DRY-RUN] CREATE dry-api/package.json');
    await expect(access(path.join(tmp, 'dry-api'))).rejects.toThrow();

    // Real scaffold, then attempt duplicate generation without --force
    const realCap = createBufferIo();
    expect(await runCli(['new', 'safe-api', '--no-git'], realCap.io, tmp)).toBe(0);
    const projectDir = path.join(tmp, 'safe-api');

    const dupCap = createBufferIo();
    expect(await runCli(['g', 'guard', 'auth'], dupCap.io, projectDir)).toBe(1);
    expect(dupCap.err.join('\n')).toContain('Refusing to overwrite existing file');

    const forcedCap = createBufferIo();
    expect(await runCli(['g', 'guard', 'auth', '--force'], forcedCap.io, projectDir)).toBe(0);
  });

  it('scaffolds, generates all 6 schematics, inspects unbuilt .ts routes & graph, builds with --openapi, checks drift, and serves live HTTP CRUD', async () => {
    const tmp = await makeTempWorkspace();
    const cap = createBufferIo();

    // 1. Scaffold full starter project
    expect(await runCli(['new', 'commerce-api', '--no-git'], cap.io, tmp)).toBe(0);
    const projectDir = path.join(tmp, 'commerce-api');

    // Link workspace node_modules so real tsc, tsx & runtime imports resolve better-back, zod, express
    await symlink(
      path.join(repoRoot, 'node_modules'),
      path.join(projectDir, 'node_modules'),
      'dir',
    );

    // 2. Generate all 6 schematic types: resource, guard, module, service, controller, repository
    expect(await runCli(['g', 'resource', 'blog-posts'], cap.io, projectDir)).toBe(0);
    expect(await runCli(['g', 'guard', 'api-key'], cap.io, projectDir)).toBe(0);
    expect(await runCli(['g', 'module', 'webhooks'], cap.io, projectDir)).toBe(0);
    expect(await runCli(['g', 'service', 'webhooks'], cap.io, projectDir)).toBe(0);
    expect(await runCli(['g', 'controller', 'webhooks'], cap.io, projectDir)).toBe(0);
    expect(await runCli(['g', 'repository', 'audit-logs'], cap.io, projectDir)).toBe(0);

    // 3. BEFORE building dist/, verify zero-build .ts introspection (`routes` & `graph`) via tsx/esm/api!
    await expect(access(path.join(projectDir, 'dist'))).rejects.toThrow();

    const unbuiltRoutesCap = createBufferIo();
    expect(await runCli(['routes', '--json'], unbuiltRoutesCap.io, projectDir)).toBe(0);
    const unbuiltRoutes = JSON.parse(unbuiltRoutesCap.out.join('\n')) as RouteSummaryRow[];
    const routeSignatures = unbuiltRoutes.map((r) => `${r.method} ${r.path}`);
    expect(routeSignatures).toContain('GET /api/v1/items');
    expect(routeSignatures).toContain('POST /api/v1/blog-posts');
    expect(routeSignatures).toContain('GET /api/v1/webhooks');

    const graphJsonCap = createBufferIo();
    expect(await runCli(['graph', '--json'], graphJsonCap.io, projectDir)).toBe(0);
    const graph = JSON.parse(graphJsonCap.out.join('\n')) as ModuleGraphNode;
    expect(graph.name).toBe('AppModule');
    expect(graph.imports.map((m) => m.name)).toEqual([
      'ItemsModule',
      'BlogPostsModule',
      'WebhooksModule',
    ]);
    expect(graph.imports[0]?.imports.map((m) => m.name)).toEqual(['AuthModule']);

    const graphTreeCap = createBufferIo();
    expect(await runCli(['graph'], graphTreeCap.io, projectDir)).toBe(0);
    expect(graphTreeCap.out.join('\n')).toContain('@Module AppModule');
    expect(graphTreeCap.out.join('\n')).toContain('BlogPostsModule');

    // 4. Strict TypeScript typechecking (`tsc --noEmit`) across src + generated tests
    execFileSync(tscBin, ['-p', path.join(projectDir, 'tsconfig.json'), '--noEmit'], {
      cwd: projectDir,
      stdio: 'pipe',
    });

    // 4b. Execute generated Vitest unit + Supertest suites (`tests/items.test.ts` & `tests/blog-posts.test.ts`)!
    execFileSync(vitestBin, ['run', '--config', path.join(projectDir, 'vitest.config.ts')], {
      cwd: projectDir,
      stdio: 'pipe',
    });

    // 5. Run `better-back build --openapi` (compiles TS, verifies compiled DI/route graph, emits dist/openapi.json)
    const buildCap = createBufferIo();
    expect(await runCli(['build', '--openapi'], buildCap.io, projectDir)).toBe(0);
    expect(buildCap.out.join('\n')).toContain('VERIFY Bootstrapped dist/app.module.js cleanly');
    expect(buildCap.out.join('\n')).toContain('OPENAPI Emitted dist/openapi.json');

    // 6. Export OpenAPI 3.1.0 JSON & verify `--check` drift detection
    const oaCap = createBufferIo();
    const oaOutPath = path.join(projectDir, 'openapi.json');
    expect(await runCli(['openapi', '--out', 'openapi.json'], oaCap.io, projectDir)).toBe(0);

    const checkPassCap = createBufferIo();
    expect(await runCli(['openapi', '--check', 'openapi.json'], checkPassCap.io, projectDir)).toBe(
      0,
    );
    expect(checkPassCap.out.join('\n')).toContain('contract check passed');

    // Mutate openapi.json and verify `--check` fails with exit code 1
    const oaSpec = JSON.parse(await readFile(oaOutPath, 'utf8')) as {
      openapi: string;
      info: { title: string };
      components: { schemas: Record<string, unknown> };
    };
    expect(oaSpec.openapi).toBe('3.1.0');
    expect(oaSpec.components.schemas).toHaveProperty('Item');
    expect(oaSpec.components.schemas).toHaveProperty('CreateItemInput');
    expect(oaSpec.components.schemas).toHaveProperty('BlogPost');
    expect(oaSpec.components.schemas).toHaveProperty('CreateBlogPostInput');

    await writeFile(
      oaOutPath,
      JSON.stringify({ ...oaSpec, info: { ...oaSpec.info, title: 'Drifted Title' } }, null, 2),
      'utf8',
    );
    const checkFailCap = createBufferIo();
    expect(await runCli(['openapi', '--check', 'openapi.json'], checkFailCap.io, projectDir)).toBe(
      1,
    );
    expect(checkFailCap.err.join('\n')).toContain('OpenAPI contract drift detected');

    // 7. Doctor with `--verify-app` passes all static & runtime DI checks
    const docCap = createBufferIo();
    expect(await runCli(['doctor', '--verify-app'], docCap.io, projectDir)).toBe(0);
    expect(docCap.out.join('\n')).toContain('[PASS] Module & DI startup graph');

    // 8. Boot the compiled CLI-generated AppModule in-memory and verify live HTTP CRUD + Guard + Zod validation
    const builtMod = (await import(
      pathToFileURL(path.join(projectDir, 'dist/app.module.js')).href
    )) as { AppModule: ConcreteConstructor };
    await using liveApp = await createTestingApp(builtMod.AppModule, { apiPrefix: '/api/v1' });

    const unauthPost = await request(liveApp.express)
      .post('/api/v1/blog-posts')
      .send({ name: 'Hello CLI' });
    expect(unauthPost.status).toBe(401);

    const createdPost = await request(liveApp.express)
      .post('/api/v1/blog-posts')
      .set('Authorization', 'Bearer dev-secret-token-2026')
      .send({ name: 'Hello CLI' });
    expect(createdPost.status).toBe(201);
    expect(createdPost.body).toMatchObject({ name: 'Hello CLI' });

    const listPosts = await request(liveApp.express).get('/api/v1/blog-posts');
    expect(listPosts.status).toBe(200);
    expect(listPosts.body.meta.total).toBe(1);
  }, 30_000);

  it('inspects examples/user-api directly from its TypeScript source path and reports clean CLI errors on unknown commands', async () => {
    const userApiDir = path.join(repoRoot, 'examples/user-api');
    const routesCap = createBufferIo();
    expect(await runCli(['routes', 'src/app.module.ts'], routesCap.io, userApiDir)).toBe(0);
    expect(routesCap.out.join('\n')).toContain('Total registered operations: 12');

    const graphCap = createBufferIo();
    expect(await runCli(['graph', 'src/app.module.ts'], graphCap.io, userApiDir)).toBe(0);
    expect(graphCap.out.join('\n')).toContain('@Module AppModule');
    expect(graphCap.out.join('\n')).toContain('UsersModule');
    expect(graphCap.out.join('\n')).toContain('PostsModule');

    const oaStdoutCap = createBufferIo();
    expect(await runCli(['openapi', 'src/app.module.ts'], oaStdoutCap.io, userApiDir)).toBe(0);
    expect(JSON.parse(oaStdoutCap.out.join('\n')).openapi).toBe('3.1.0');

    const badCmdCap = createBufferIo();
    expect(await runCli(['nonexistent-cmd'], badCmdCap.io, userApiDir)).toBe(1);
    expect(badCmdCap.err.join('\n')).toContain('Unknown command "nonexistent-cmd"');
  });

  it('scaffolds a single-file --minimal project via create-better-back and catches legacy decorator misconfigurations in doctor', async () => {
    const tmp = await makeTempWorkspace();
    const createBin = path.join(repoRoot, 'packages/create-better-back/dist/index.js');

    execFileSync(process.execPath, [createBin, 'tiny-svc', '--minimal', '--no-git', '--dir', tmp], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    const projectDir = path.join(tmp, 'tiny-svc');
    await symlink(
      path.join(repoRoot, 'node_modules'),
      path.join(projectDir, 'node_modules'),
      'dir',
    );

    execFileSync(tscBin, ['-p', path.join(projectDir, 'tsconfig.json'), '--noEmit'], {
      cwd: projectDir,
      stdio: 'pipe',
    });

    // Break tsconfig with legacy experimentalDecorators and verify `doctor --json` fails fast with exit code 1
    await writeFile(
      path.join(projectDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: false,
          experimentalDecorators: true,
        },
      }),
      'utf8',
    );
    const badDocCap = createBufferIo();
    expect(await runCli(['doctor', '--json'], badDocCap.io, projectDir)).toBe(1);
    const parsedDoc = JSON.parse(badDocCap.out.join('\n')) as { ok: boolean };
    expect(parsedDoc.ok).toBe(false);
  });
});
