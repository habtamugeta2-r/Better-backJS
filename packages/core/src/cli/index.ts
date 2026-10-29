import { parseArgs } from 'node:util';
import {
  buildProjectCommand,
  devCommand,
  doctorCommand,
  exportOpenApiCommand,
  inspectGraphCommand,
  inspectRoutesCommand,
  type DoctorCheckResult,
  type ModuleGraphNode,
  type RouteSummaryRow,
} from './inspect.js';
import { deriveEntityNames, normalizePackageSlug, type EntityNames } from './naming.js';
import {
  generateSchematic,
  resolveSchematicKind,
  scaffoldNewProject,
  type CliOutput,
  type FilePlanEntry,
  type GenerateOptions,
  type NewProjectOptions,
  type SchematicKind,
} from './scaffolder.js';
import { wireSymbolIntoModuleSource } from './wiring.js';

export const CLI_VERSION = '1.0.0';

export {
  buildProjectCommand,
  deriveEntityNames,
  doctorCommand,
  exportOpenApiCommand,
  generateSchematic,
  inspectGraphCommand,
  inspectRoutesCommand,
  normalizePackageSlug,
  resolveSchematicKind,
  scaffoldNewProject,
  wireSymbolIntoModuleSource,
  type CliOutput,
  type DoctorCheckResult,
  type EntityNames,
  type FilePlanEntry,
  type GenerateOptions,
  type ModuleGraphNode,
  type NewProjectOptions,
  type RouteSummaryRow,
  type SchematicKind,
};

const HELP_TEXT = `Better Back CLI (v${CLI_VERSION}) — Unified Stage-3 Decorator & Zod v4 Backend Toolkit

Usage:
  better-back <command> [arguments] [options]
  bb <command> [arguments] [options]

Commands:
  new <project-name>               Scaffold a strict-TypeScript Better Back project
  generate | g <schematic> <name>  Generate resource (res), module (mod), controller (co), service (s), guard (gu), or repository (repo)
  routes [entry]                   Inspect registered routes, auth guards & status codes (works directly on .ts or .js)
  graph [entry]                    Print the explicit @Module dependency, controller, provider & export tree
  openapi [entry]                  Export or CI-check (--check) the OpenAPI 3.1.0 specification JSON
  build                            Compile TypeScript, verify startup DI/route graph & optionally emit dist/openapi.json
  doctor [dir]                     Audit Node LTS, strict tsconfig, Stage-3 decorators, .env hygiene & DI graph (--verify-app)
  dev [entry]                      Start watch-mode development server (tsx watch / node --watch)

Options:
  --dir <path>                     Target working / project directory (default: process.cwd())
  --out, -o <file>                 Output file path for "openapi" command
  --check <file>                   Verify committed OpenAPI spec matches live app in CI ("openapi --check openapi.json")
  --prefix <uri>                   Override global apiPrefix for "routes" / "openapi"
  --project, -p <tsconfig>         Custom tsconfig path for "build"
  --openapi                        Emit dist/openapi.json during "build"
  --verify-app / --no-verify       Enable/skip in-memory startup graph verification in "doctor" / "build"
  --minimal                        Scaffold a single-file microservice in "new"
  --auth / --no-auth               Include @Guard(BearerAuthGuard, ...) in generated resource (default: true)
  --no-tests                       Skip generating unit + Supertest test file in "generate resource"
  --no-wire                        Skip auto-wiring generated class into parent @Module
  --no-git                         Skip "git init" when running "new"
  --install                        Run "npm install" after scaffolding in "new"
  --json                           Emit machine-readable JSON in "routes", "graph", or "doctor"
  --dry-run                        Preview file creations/updates without writing to disk
  --force, -f                      Overwrite existing files if present
  -v, --version                    Print CLI version
  -h, --help                       Print this help message
`;

const defaultIo: CliOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

/**
 * Programmatic & binary entrypoint for the Better Back CLI.
 * Returns POSIX exit code (`0` on success, `1` on validation/execution failure).
 */
export async function runCli(
  argv: readonly string[],
  io: CliOutput = defaultIo,
  defaultCwd: string = process.cwd(),
): Promise<number> {
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      allowNegative: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
        dir: { type: 'string' },
        out: { type: 'string', short: 'o' },
        check: { type: 'string' },
        prefix: { type: 'string' },
        project: { type: 'string', short: 'p' },
        openapi: { type: 'boolean', default: false },
        'verify-app': { type: 'boolean', default: false },
        verify: { type: 'boolean', default: true },
        minimal: { type: 'boolean', default: false },
        auth: { type: 'boolean', default: true },
        tests: { type: 'boolean', default: true },
        wire: { type: 'boolean', default: true },
        git: { type: 'boolean', default: true },
        install: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        force: { type: 'boolean', short: 'f', default: false },
      },
    });

    if (parsed.values.version) {
      io.stdout(CLI_VERSION);
      return 0;
    }

    const [command, ...rest] = parsed.positionals;
    if (parsed.values.help || !command || command === 'help') {
      io.stdout(HELP_TEXT.trimEnd());
      return 0;
    }

    const cwd = parsed.values.dir ?? defaultCwd;
    const dryRun = Boolean(parsed.values['dry-run']);
    const force = Boolean(parsed.values.force);

    if (command === 'new' || command === 'init') {
      const projectName = rest[0];
      if (!projectName) {
        throw new Error('Missing <project-name>. Usage: better-back new <project-name>');
      }
      await scaffoldNewProject(
        {
          projectName,
          parentDir: cwd,
          minimal: Boolean(parsed.values.minimal),
          git: Boolean(parsed.values.git),
          install: Boolean(parsed.values.install),
          dryRun,
          force,
        },
        io,
      );
      return 0;
    }

    if (command === 'generate' || command === 'g') {
      const rawSchematic = rest[0];
      const rawName = rest[1];
      if (!rawSchematic || !rawName) {
        throw new Error(
          'Missing arguments. Usage: better-back generate <resource|module|controller|service|guard|repository> <name>',
        );
      }
      const schematic = resolveSchematicKind(rawSchematic);
      await generateSchematic(
        {
          schematic,
          rawName,
          projectDir: cwd,
          withAuth: Boolean(parsed.values.auth),
          withTests: Boolean(parsed.values.tests),
          wire: Boolean(parsed.values.wire),
          dryRun,
          force,
        },
        io,
      );
      return 0;
    }

    if (command === 'routes') {
      await inspectRoutesCommand(
        {
          entry: rest[0],
          cwd,
          json: Boolean(parsed.values.json),
          apiPrefix: parsed.values.prefix,
        },
        io,
      );
      return 0;
    }

    if (command === 'graph') {
      await inspectGraphCommand(
        {
          entry: rest[0],
          cwd,
          json: Boolean(parsed.values.json),
        },
        io,
      );
      return 0;
    }

    if (command === 'openapi') {
      await exportOpenApiCommand(
        {
          entry: rest[0],
          outFile: parsed.values.out,
          checkFile: parsed.values.check,
          cwd,
          apiPrefix: parsed.values.prefix,
        },
        io,
      );
      return 0;
    }

    if (command === 'build') {
      await buildProjectCommand(
        {
          cwd,
          tsconfig: parsed.values.project,
          verifyApp: Boolean(parsed.values.verify),
          emitOpenApi: Boolean(parsed.values.openapi),
        },
        io,
      );
      return 0;
    }

    if (command === 'doctor') {
      const targetDir = rest[0] ? rest[0] : cwd;
      const report = await doctorCommand(targetDir, io, {
        json: Boolean(parsed.values.json),
        verifyApp: Boolean(parsed.values['verify-app']),
      });
      return report.ok ? 0 : 1;
    }

    if (command === 'dev') {
      return await devCommand({ entry: rest[0], cwd }, io);
    }

    throw new Error(
      `Unknown command "${command}". Run "better-back --help" for available commands.`,
    );
  } catch (err) {
    io.stderr(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
