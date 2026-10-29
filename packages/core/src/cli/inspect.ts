import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BetterBack,
  formatTokenName,
  isDynamicModule,
  isLoadedConfig,
  type BetterBackApp,
  type BetterBackOptions,
  type ConcreteConstructor,
  type ModuleImport,
  type ModuleMetadata,
  type Token,
} from '../index.js';
import type { CliOutput } from './scaffolder.js';
import { generateTypeScriptSdk, type SdkGeneratorOptions } from './sdk.js';

const MODULE_META_KEY = Symbol.for('better-back.module');
const CONTROLLER_META_KEY = Symbol.for('better-back.controller');

function getStage3MetaObject(ctor: ConcreteConstructor): Record<PropertyKey, unknown> | undefined {
  const existingMeta: unknown = Reflect.get(Symbol, 'metadata');
  const metaKey: symbol =
    typeof existingMeta === 'symbol' ? existingMeta : Symbol.for('Symbol.metadata');
  const raw: unknown = Reflect.get(ctor, metaKey);
  if (typeof raw === 'object' && raw !== null) {
    return raw as Record<PropertyKey, unknown>;
  }
  return undefined;
}

function hasDecoratorKey(ctor: ConcreteConstructor, key: symbol): boolean {
  const meta = getStage3MetaObject(ctor);
  return meta !== undefined && Object.prototype.hasOwnProperty.call(meta, key);
}

function readModuleMeta(ctor: ConcreteConstructor): ModuleMetadata | undefined {
  const meta = getStage3MetaObject(ctor);
  if (!meta || !Object.prototype.hasOwnProperty.call(meta, MODULE_META_KEY)) {
    return undefined;
  }
  return meta[MODULE_META_KEY] as ModuleMetadata;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDefaultEntry(cwd: string): Promise<string> {
  const candidates = ['src/app.module.ts', 'dist/app.module.js', 'src/main.ts', 'dist/main.js'];
  for (const rel of candidates) {
    const abs = path.resolve(cwd, rel);
    if (await fileExists(abs)) {
      return abs;
    }
  }
  throw new Error(
    `Could not find an entry module automatically in "${cwd}". Pass an explicit path (e.g. "better-back routes src/app.module.ts").`,
  );
}

async function mapTypeScriptToBuiltSibling(absEntry: string): Promise<string | undefined> {
  if (!absEntry.endsWith('.ts')) return undefined;
  const swapped = absEntry
    .replace(`${path.sep}src${path.sep}`, `${path.sep}dist${path.sep}`)
    .replace(/\.ts$/, '.js');
  if (swapped !== absEntry && (await fileExists(swapped))) {
    return swapped;
  }
  return undefined;
}

interface TsxApiModule {
  readonly tsImport: (specifier: string, parentURL: string) => Promise<Record<string, unknown>>;
}

async function tryImportViaTsx(
  absEntry: string,
  cwd: string,
): Promise<Record<string, unknown> | undefined> {
  const searchAnchors = [path.join(cwd, 'package.json'), import.meta.url];
  for (const anchor of searchAnchors) {
    try {
      const req = createRequire(anchor.startsWith('file:') ? anchor : pathToFileURL(anchor).href);
      const tsxApiPath = req.resolve('tsx/esm/api');
      const tsxApi = (await import(pathToFileURL(tsxApiPath).href)) as TsxApiModule;
      return await tsxApi.tsImport(pathToFileURL(absEntry).href, import.meta.url);
    } catch (err) {
      // If tsx itself resolved and threw an application syntax/runtime error inside the user's module, surface it
      if (
        err instanceof Error &&
        !('code' in err && (err.code === 'MODULE_NOT_FOUND' || err.code === 'ERR_MODULE_NOT_FOUND'))
      ) {
        throw err;
      }
    }
  }
  return undefined;
}

async function loadEntryExports(
  rawEntry: string | undefined,
  cwd: string,
): Promise<{
  readonly resolvedPath: string;
  readonly rootCtor: ConcreteConstructor;
  readonly optionsFactory?: () => BetterBackOptions;
}> {
  const requestedPath = rawEntry ? path.resolve(cwd, rawEntry) : await resolveDefaultEntry(cwd);
  if (!(await fileExists(requestedPath))) {
    throw new Error(`Entry file not found: "${requestedPath}".`);
  }

  let moduleNamespace: Record<string, unknown> | undefined;

  if (requestedPath.endsWith('.ts')) {
    // 1. Prefer built dist/*.js if newer/available ONLY when tsx isn't needed? No — in dev, .ts source is the source of truth!
    // Try zero-build tsx/esm/api first so unbuilt TypeScript projects work out of the box, then built sibling, then native Node TS.
    moduleNamespace = await tryImportViaTsx(requestedPath, cwd);
    if (!moduleNamespace) {
      const builtSibling = await mapTypeScriptToBuiltSibling(requestedPath);
      if (builtSibling) {
        moduleNamespace = (await import(pathToFileURL(builtSibling).href)) as Record<
          string,
          unknown
        >;
      }
    }
  }

  if (!moduleNamespace) {
    try {
      moduleNamespace = (await import(pathToFileURL(requestedPath).href)) as Record<
        string,
        unknown
      >;
    } catch (primaryErr) {
      throw new Error(
        `Unable to import "${requestedPath}" directly (${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}). Install "tsx" in devDependencies or run "better-back build" first.`,
        { cause: primaryErr },
      );
    }
  }

  const { rootCtor, optionsFactory } = findExportedRootModule(moduleNamespace);
  return { resolvedPath: requestedPath, rootCtor, optionsFactory };
}

function findExportedRootModule(modExports: Record<string, unknown>): {
  readonly rootCtor: ConcreteConstructor;
  readonly optionsFactory?: () => BetterBackOptions;
} {
  let rootCtor: ConcreteConstructor | undefined;
  let controllerFallback: ConcreteConstructor | undefined;
  let optionsFactory: (() => BetterBackOptions) | undefined;

  for (const [exportName, value] of Object.entries(modExports)) {
    if (typeof value === 'function') {
      const candidate = value as ConcreteConstructor;
      if (hasDecoratorKey(candidate, MODULE_META_KEY)) {
        if (exportName === 'AppModule' || !rootCtor) {
          rootCtor = candidate;
        }
      } else if (hasDecoratorKey(candidate, CONTROLLER_META_KEY) && !controllerFallback) {
        controllerFallback = candidate;
      } else if (/^build.*Options$/.test(exportName)) {
        optionsFactory = value as () => BetterBackOptions;
      }
    }
  }

  const chosen = rootCtor ?? controllerFallback;
  if (!chosen) {
    throw new Error(
      'Entry file did not export any @Module() or @Controller() class. Export your root AppModule (e.g. `export class AppModule {}`).',
    );
  }
  return { rootCtor: chosen, optionsFactory };
}

async function loadInMemoryApp(
  rawEntry: string | undefined,
  cwd: string,
  apiPrefixOverride?: string,
): Promise<BetterBackApp> {
  const { rootCtor, optionsFactory } = await loadEntryExports(rawEntry, cwd);
  const baseOptions = optionsFactory ? optionsFactory() : {};

  return BetterBack.create(rootCtor, {
    ...baseOptions,
    ...(apiPrefixOverride !== undefined ? { apiPrefix: apiPrefixOverride } : {}),
    logger: { level: 'silent' },
    logRequests: false,
    enableShutdownHooks: false,
  });
}

export interface RouteSummaryRow {
  readonly method: string;
  readonly path: string;
  readonly operationId: string;
  readonly auth: boolean;
  readonly statusCodes: readonly string[];
  readonly summary: string;
}

export async function inspectRoutesCommand(
  options: {
    readonly entry?: string;
    readonly cwd: string;
    readonly json: boolean;
    readonly apiPrefix?: string;
  },
  io: CliOutput,
): Promise<readonly RouteSummaryRow[]> {
  await using app = await loadInMemoryApp(options.entry, options.cwd, options.apiPrefix);
  const rows: RouteSummaryRow[] = [];

  for (const [openApiPath, pathItem] of Object.entries(app.openApiDocument.paths)) {
    for (const [method, rawOp] of Object.entries(pathItem)) {
      const op = rawOp as Record<string, unknown>;
      const responses = (op['responses'] as Record<string, unknown> | undefined) ?? {};
      const security = op['security'];
      rows.push({
        method: method.toUpperCase(),
        path: openApiPath,
        operationId: typeof op['operationId'] === 'string' ? op['operationId'] : '-',
        auth: Array.isArray(security) && security.length > 0,
        statusCodes: Object.keys(responses).sort(),
        summary: typeof op['summary'] === 'string' ? op['summary'] : '',
      });
    }
  }

  if (options.json) {
    io.stdout(JSON.stringify(rows, null, 2));
    return rows;
  }

  const methodW = Math.max(6, ...rows.map((r) => r.method.length));
  const pathW = Math.max(4, ...rows.map((r) => r.path.length));
  const authW = 7;
  const codesW = Math.max(9, ...rows.map((r) => r.statusCodes.join(',').length));

  const pad = (s: string, w: number): string => s.padEnd(w, ' ');
  const header = `${pad('METHOD', methodW)}  ${pad('PATH', pathW)}  ${pad('AUTH', authW)}  ${pad('RESPONSES', codesW)}  HANDLER`;
  io.stdout(header);
  io.stdout('-'.repeat(header.length + 12));

  for (const row of rows) {
    io.stdout(
      `${pad(row.method, methodW)}  ${pad(row.path, pathW)}  ${pad(row.auth ? 'guarded' : 'public', authW)}  ${pad(row.statusCodes.join(','), codesW)}  ${row.operationId}`,
    );
  }
  io.stdout(`\nTotal registered operations: ${rows.length}`);
  return rows;
}

export interface ModuleGraphNode {
  readonly name: string;
  readonly controllers: readonly string[];
  readonly providers: readonly string[];
  readonly exports: readonly string[];
  readonly imports: readonly ModuleGraphNode[];
}

type AnyModuleProvider = NonNullable<ModuleMetadata['providers']>[number];

function describeProviderRegistration(reg: AnyModuleProvider): string {
  if (typeof reg === 'function') {
    const fn = reg as ConcreteConstructor;
    return fn.name || '<anonymous>';
  }
  if (isLoadedConfig(reg)) {
    return formatTokenName(reg);
  }
  if (typeof reg === 'object' && reg !== null && 'provide' in reg) {
    const rec = reg as {
      readonly provide: Token<unknown>;
      readonly useClass?: ConcreteConstructor;
      readonly useFactory?: unknown;
    };
    const tokenLabel = formatTokenName(rec.provide);
    if (typeof rec.useClass === 'function') {
      return `${tokenLabel} -> ${rec.useClass.name || '<Class>'}`;
    }
    if (typeof rec.useFactory === 'function') {
      return `${tokenLabel} (factory)`;
    }
    return `${tokenLabel} (value)`;
  }
  return '<provider>';
}

function buildModuleGraphNode(
  input: ModuleImport,
  ancestry: ReadonlySet<ConcreteConstructor> = new Set(),
): ModuleGraphNode {
  const ctor = isDynamicModule(input) ? input.module : input;
  const name = ctor.name || '<AnonymousModule>';
  if (ancestry.has(ctor)) {
    throw new Error(`Circular @Module import detected involving "${name}".`);
  }

  const baseMeta = readModuleMeta(ctor);
  const meta: ModuleMetadata | undefined = isDynamicModule(input)
    ? {
        imports: [...(baseMeta?.imports ?? []), ...(input.imports ?? [])],
        controllers: [...(baseMeta?.controllers ?? []), ...(input.controllers ?? [])],
        providers: [...(baseMeta?.providers ?? []), ...(input.providers ?? [])],
        exports: [...(baseMeta?.exports ?? []), ...(input.exports ?? [])],
      }
    : baseMeta;

  if (!meta) {
    // Standalone @Controller root
    return {
      name,
      controllers: [name],
      providers: [],
      exports: [],
      imports: [],
    };
  }

  const nextAncestry = new Set(ancestry);
  nextAncestry.add(ctor);

  return {
    name,
    controllers: (meta.controllers ?? []).map((c) => c.name || '<Controller>'),
    providers: (meta.providers ?? []).map((p) => describeProviderRegistration(p)),
    exports: (meta.exports ?? []).map((t) => formatTokenName(t)),
    imports: (meta.imports ?? []).map((child) => buildModuleGraphNode(child, nextAncestry)),
  };
}

function renderGraphTreeLines(
  node: ModuleGraphNode,
  prefix = '',
  isLast = true,
  isRoot = true,
): string[] {
  const lines: string[] = [];
  const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
  const childIndent = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

  const details: string[] = [];
  if (node.controllers.length > 0) details.push(`controllers: [${node.controllers.join(', ')}]`);
  if (node.providers.length > 0) details.push(`providers: [${node.providers.join(', ')}]`);
  if (node.exports.length > 0) details.push(`exports: [${node.exports.join(', ')}]`);

  const suffix = details.length > 0 ? `  (${details.join(' | ')})` : '';
  lines.push(`${prefix}${connector}@Module ${node.name}${suffix}`);

  node.imports.forEach((child, idx) => {
    const lastChild = idx === node.imports.length - 1;
    lines.push(...renderGraphTreeLines(child, childIndent, lastChild, false));
  });

  return lines;
}

export async function inspectGraphCommand(
  options: {
    readonly entry?: string;
    readonly cwd: string;
    readonly json: boolean;
  },
  io: CliOutput,
): Promise<ModuleGraphNode> {
  // Also boot the in-memory app so DI provider encapsulation & missing-token checks are verified
  await using _app = await loadInMemoryApp(options.entry, options.cwd);
  const { rootCtor } = await loadEntryExports(options.entry, options.cwd);
  const graph = buildModuleGraphNode(rootCtor);

  if (options.json) {
    io.stdout(JSON.stringify(graph, null, 2));
    return graph;
  }

  for (const line of renderGraphTreeLines(graph)) {
    io.stdout(line);
  }
  return graph;
}

export async function exportOpenApiCommand(
  options: {
    readonly entry?: string;
    readonly outFile?: string;
    readonly checkFile?: string;
    readonly cwd: string;
    readonly apiPrefix?: string;
  },
  io: CliOutput,
): Promise<string> {
  await using app = await loadInMemoryApp(options.entry, options.cwd, options.apiPrefix);
  const serialized = `${JSON.stringify(app.openApiDocument, null, 2)}\n`;

  if (options.checkFile) {
    const absCheck = path.resolve(options.cwd, options.checkFile);
    if (!(await fileExists(absCheck))) {
      throw new Error(
        `OpenAPI contract check failed: "${absCheck}" does not exist. Generate it with "better-back openapi --out ${options.checkFile}".`,
      );
    }
    const existingNormalized = `${JSON.stringify(JSON.parse(await readFile(absCheck, 'utf8')), null, 2)}\n`;
    if (existingNormalized !== serialized) {
      throw new Error(
        `OpenAPI contract drift detected in "${options.checkFile}". Re-run "better-back openapi --out ${options.checkFile}" and commit the updated spec.`,
      );
    }
    io.stdout(`OpenAPI 3.1.0 contract check passed: ${options.checkFile} is up to date.`);
    return serialized;
  }

  if (options.outFile) {
    const absOut = path.resolve(options.cwd, options.outFile);
    await mkdir(path.dirname(absOut), { recursive: true });
    await writeFile(absOut, serialized, 'utf8');
    const schemaCount = Object.keys(app.openApiDocument.components.schemas).length;
    const pathCount = Object.keys(app.openApiDocument.paths).length;
    io.stdout(
      `Wrote OpenAPI ${app.openApiDocument.openapi} specification (${pathCount} paths, ${schemaCount} component schemas) to ${absOut}`,
    );
  } else {
    io.stdout(serialized.trimEnd());
  }

  return serialized;
}

export async function exportSdkCommand(
  options: {
    readonly entry?: string;
    readonly outFile?: string;
    readonly checkFile?: string;
    readonly cwd: string;
    readonly apiPrefix?: string;
    readonly sdkOptions?: SdkGeneratorOptions;
  },
  io: CliOutput,
): Promise<string> {
  await using app = await loadInMemoryApp(options.entry, options.cwd, options.apiPrefix);
  const generated = generateTypeScriptSdk(app.openApiDocument, options.sdkOptions);

  if (options.checkFile) {
    const absCheck = path.resolve(options.cwd, options.checkFile);
    if (!(await fileExists(absCheck))) {
      throw new Error(
        `SDK contract check failed: "${absCheck}" does not exist. Generate it with "better-back sdk --out ${options.checkFile}".`,
      );
    }
    const existing = await readFile(absCheck, 'utf8');
    if (existing !== generated) {
      throw new Error(
        `SDK contract drift detected in "${options.checkFile}". Re-run "better-back sdk --out ${options.checkFile}" and commit the updated client.`,
      );
    }
    io.stdout(`TypeScript Client SDK check passed: ${options.checkFile} is up to date.`);
    return generated;
  }

  if (options.outFile) {
    const absOut = path.resolve(options.cwd, options.outFile);
    await mkdir(path.dirname(absOut), { recursive: true });
    await writeFile(absOut, generated, 'utf8');
    const pathCount = Object.keys(app.openApiDocument.paths).length;
    io.stdout(`Wrote strict TypeScript Client SDK (${pathCount} OpenAPI paths) to ${absOut}`);
  } else {
    io.stdout(generated.trimEnd());
  }

  return generated;
}

export async function buildProjectCommand(
  options: {
    readonly cwd: string;
    readonly tsconfig?: string;
    readonly verifyApp: boolean;
    readonly emitOpenApi?: string | boolean;
  },
  io: CliOutput,
): Promise<void> {
  const root = path.resolve(options.cwd);
  const defaultBuildConfig = path.join(root, 'tsconfig.build.json');
  const chosenTsconfig = options.tsconfig
    ? path.resolve(root, options.tsconfig)
    : (await fileExists(defaultBuildConfig))
      ? defaultBuildConfig
      : path.join(root, 'tsconfig.json');

  if (!(await fileExists(chosenTsconfig))) {
    throw new Error(`TypeScript configuration not found at "${chosenTsconfig}".`);
  }

  const tscName = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
  const candidates = [
    path.join(root, 'node_modules', '.bin', tscName),
    path.resolve(root, '../../node_modules/.bin', tscName),
  ];

  let tscBin: string | undefined;
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      tscBin = candidate;
      break;
    }
  }
  if (!tscBin) {
    throw new Error(
      `TypeScript compiler ("tsc") not found in "${root}/node_modules/.bin". Install "typescript" in devDependencies.`,
    );
  }

  io.stdout(
    `Compiling TypeScript project (${path.relative(root, chosenTsconfig) || 'tsconfig.json'})...`,
  );
  execFileSync(tscBin, ['-p', chosenTsconfig], { cwd: root, stdio: 'inherit' });
  io.stdout(`  BUILD  TypeScript compilation succeeded.`);

  const builtAppModule = path.join(root, 'dist/app.module.js');
  if (options.verifyApp && (await fileExists(builtAppModule))) {
    await using app = await loadInMemoryApp(builtAppModule, root);
    const routeCount = Object.values(app.openApiDocument.paths).reduce(
      (sum, item) => sum + Object.keys(item).length,
      0,
    );
    io.stdout(
      `  VERIFY Bootstrapped dist/app.module.js cleanly (${routeCount} operations, 0 DI/route errors).`,
    );

    if (options.emitOpenApi) {
      const targetRel =
        typeof options.emitOpenApi === 'string' ? options.emitOpenApi : 'dist/openapi.json';
      const targetAbs = path.resolve(root, targetRel);
      await mkdir(path.dirname(targetAbs), { recursive: true });
      await writeFile(targetAbs, `${JSON.stringify(app.openApiDocument, null, 2)}\n`, 'utf8');
      io.stdout(`  OPENAPI Emitted ${targetRel}`);
    }
  }
}

export interface DoctorCheckResult {
  readonly status: 'PASS' | 'WARN' | 'FAIL';
  readonly check: string;
  readonly detail: string;
}

function stripJsonComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export async function doctorCommand(
  projectDir: string,
  io: CliOutput,
  options: { readonly json?: boolean; readonly verifyApp?: boolean } = {},
): Promise<{ readonly ok: boolean; readonly results: readonly DoctorCheckResult[] }> {
  const root = path.resolve(projectDir);
  const results: DoctorCheckResult[] = [];

  // 1. Node.js LTS runtime check (>= 20)
  const major = Number(process.versions.node.split('.')[0] ?? 0);
  results.push(
    major >= 20
      ? {
          status: 'PASS',
          check: 'Node.js runtime',
          detail: `v${process.versions.node} (>= 20 LTS)`,
        }
      : {
          status: 'FAIL',
          check: 'Node.js runtime',
          detail: `v${process.versions.node} detected; Better Back requires Node.js >= 20.0.0`,
        },
  );

  // 2. package.json checks
  const pkgPath = path.join(root, 'package.json');
  if (!(await fileExists(pkgPath))) {
    results.push({ status: 'FAIL', check: 'package.json', detail: `Missing at ${pkgPath}` });
  } else {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>;
    const deps = {
      ...((pkg['dependencies'] as Record<string, string> | undefined) ?? {}),
      ...((pkg['devDependencies'] as Record<string, string> | undefined) ?? {}),
    };

    results.push(
      pkg['type'] === 'module'
        ? { status: 'PASS', check: 'ESM package mode', detail: '"type": "module" configured' }
        : {
            status: 'WARN',
            check: 'ESM package mode',
            detail: 'Consider setting "type": "module" in package.json for native ESM',
          },
    );

    if ('reflect-metadata' in deps) {
      results.push({
        status: 'WARN',
        check: 'Zero reflect-metadata',
        detail:
          '"reflect-metadata" is installed but unnecessary with Better Back Stage-3 decorators',
      });
    } else {
      results.push({
        status: 'PASS',
        check: 'Zero reflect-metadata',
        detail: 'No legacy reflection polyfill present',
      });
    }
  }

  // 3. tsconfig.json strictness & Stage-3 decorator checks
  const tsconfigPath = path.join(root, 'tsconfig.json');
  if (await fileExists(tsconfigPath)) {
    try {
      const tsRaw = JSON.parse(stripJsonComments(await readFile(tsconfigPath, 'utf8'))) as {
        readonly extends?: string;
        readonly compilerOptions?: Record<string, unknown>;
      };
      let co = tsRaw.compilerOptions ?? {};
      if (tsRaw.extends) {
        const parentPath = path.resolve(root, tsRaw.extends);
        if (await fileExists(parentPath)) {
          const parentRaw = JSON.parse(stripJsonComments(await readFile(parentPath, 'utf8'))) as {
            readonly compilerOptions?: Record<string, unknown>;
          };
          co = { ...(parentRaw.compilerOptions ?? {}), ...co };
        }
      }

      results.push(
        co['strict'] === true
          ? { status: 'PASS', check: 'TypeScript strict mode', detail: '"strict": true enabled' }
          : {
              status: 'FAIL',
              check: 'TypeScript strict mode',
              detail: 'Enable "strict": true in tsconfig.json for compile-time Ctx & Guard safety',
            },
      );

      if (co['experimentalDecorators'] === true || co['emitDecoratorMetadata'] === true) {
        results.push({
          status: 'FAIL',
          check: 'ECMAScript Stage-3 decorators',
          detail:
            'Remove "experimentalDecorators" and "emitDecoratorMetadata" from tsconfig.json — Better Back uses standard Stage-3 decorators',
        });
      } else {
        results.push({
          status: 'PASS',
          check: 'ECMAScript Stage-3 decorators',
          detail: 'Legacy decorator flags absent (standard Stage-3 active)',
        });
      }
    } catch {
      results.push({
        status: 'WARN',
        check: 'tsconfig.json',
        detail: 'Could not parse tsconfig.json',
      });
    }
  } else {
    results.push({ status: 'WARN', check: 'tsconfig.json', detail: 'No tsconfig.json found' });
  }

  // 4. .gitignore secret hygiene check
  const gitignorePath = path.join(root, '.gitignore');
  const dotEnvPath = path.join(root, '.env');
  if (await fileExists(gitignorePath)) {
    const gi = await readFile(gitignorePath, 'utf8');
    results.push(
      gi.includes('.env')
        ? { status: 'PASS', check: 'Secret file hygiene', detail: '.gitignore excludes .env' }
        : {
            status: 'WARN',
            check: 'Secret file hygiene',
            detail: 'Add ".env" to .gitignore so secrets are never committed',
          },
    );
  } else if (await fileExists(dotEnvPath)) {
    results.push({
      status: 'WARN',
      check: 'Secret file hygiene',
      detail: 'Found .env without a .gitignore file — create .gitignore and exclude .env',
    });
  }

  // 5. Optional live DI & routing startup verification
  if (options.verifyApp) {
    try {
      await using app = await loadInMemoryApp(undefined, root);
      const opCount = Object.values(app.openApiDocument.paths).reduce(
        (sum, item) => sum + Object.keys(item).length,
        0,
      );
      results.push({
        status: 'PASS',
        check: 'Module & DI startup graph',
        detail: `Bootstrapped cleanly (${opCount} registered operations)`,
      });
    } catch (err) {
      results.push({
        status: 'FAIL',
        check: 'Module & DI startup graph',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ok = results.every((r) => r.status !== 'FAIL');

  if (options.json) {
    io.stdout(JSON.stringify({ ok, results }, null, 2));
  } else {
    for (const r of results) {
      io.stdout(`  [${r.status}] ${r.check} — ${r.detail}`);
    }
  }

  return { ok, results };
}

export async function devCommand(
  options: { readonly entry?: string; readonly cwd: string },
  io: CliOutput,
): Promise<number> {
  const entry =
    options.entry ??
    ((await fileExists(path.join(options.cwd, 'src/main.ts'))) ? 'src/main.ts' : 'dist/main.js');
  const absEntry = path.resolve(options.cwd, entry);
  if (!(await fileExists(absEntry))) {
    throw new Error(`Dev entry not found: "${absEntry}".`);
  }

  const envFilePath = path.join(options.cwd, '.env');
  const envArgs = (await fileExists(envFilePath)) ? [`--env-file=${envFilePath}`] : [];
  const tsxBinName = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  const tsxCandidates = [
    path.join(options.cwd, 'node_modules', '.bin', tsxBinName),
    path.resolve(options.cwd, '../../node_modules/.bin', tsxBinName),
  ];

  if (absEntry.endsWith('.ts')) {
    for (const localTsx of tsxCandidates) {
      if (await fileExists(localTsx)) {
        io.stdout(`Starting Better Back dev watcher via tsx: ${entry}`);
        const res = spawnSync(localTsx, ['watch', ...envArgs, absEntry], {
          cwd: options.cwd,
          stdio: 'inherit',
        });
        return res.status ?? 0;
      }
    }
  }

  io.stdout(`Starting Better Back dev watcher via node --watch: ${entry}`);
  const res = spawnSync(process.execPath, ['--watch', ...envArgs, absEntry], {
    cwd: options.cwd,
    stdio: 'inherit',
  });
  return res.status ?? 0;
}
