import { execFileSync } from 'node:child_process';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deriveEntityNames, normalizePackageSlug } from './naming.js';
import {
  renderAuthModuleTemplate,
  renderGuardTemplate,
  renderMinimalMain,
  renderProjectAppModule,
  renderProjectEnvConfig,
  renderProjectEnvExample,
  renderProjectGitignore,
  renderProjectMain,
  renderProjectPackageJson,
  renderProjectTsconfig,
  renderProjectTsconfigBuild,
  renderProjectVitestConfig,
  renderResourceControllerTemplate,
  renderResourceModuleTemplate,
  renderResourceRepositoryTemplate,
  renderResourceSchemaTemplate,
  renderResourceServiceTemplate,
  renderResourceTestTemplate,
  renderStandaloneControllerTemplate,
  renderStandaloneModuleTemplate,
  renderStandaloneRepositoryTemplate,
  renderStandaloneServiceTemplate,
} from './templates.js';
import { wireSymbolIntoModuleSource } from './wiring.js';

export interface CliOutput {
  stdout(line: string): void;
  stderr(line: string): void;
}

export interface FilePlanEntry {
  readonly kind: 'create' | 'update';
  readonly absPath: string;
  readonly relPath: string;
  readonly content: string;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function applyPlan(
  entries: readonly FilePlanEntry[],
  options: { readonly dryRun: boolean; readonly force: boolean },
  io: CliOutput,
): Promise<void> {
  for (const entry of entries) {
    if (entry.kind === 'create' && !options.force && (await fileExists(entry.absPath))) {
      throw new Error(
        `Refusing to overwrite existing file "${entry.relPath}". Re-run with --force to overwrite.`,
      );
    }
  }

  for (const entry of entries) {
    const badge = entry.kind === 'create' ? 'CREATE' : 'UPDATE';
    if (options.dryRun) {
      io.stdout(
        `  [DRY-RUN] ${badge} ${entry.relPath} (${Buffer.byteLength(entry.content)} bytes)`,
      );
      continue;
    }
    await mkdir(path.dirname(entry.absPath), { recursive: true });
    await writeFile(entry.absPath, entry.content, 'utf8');
    io.stdout(`  ${badge} ${entry.relPath}`);
  }
}

export interface NewProjectOptions {
  readonly projectName: string;
  readonly parentDir: string;
  readonly minimal: boolean;
  readonly git: boolean;
  readonly install: boolean;
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly coreVersionSpecifier?: string;
}

export async function scaffoldNewProject(
  options: NewProjectOptions,
  io: CliOutput,
): Promise<string> {
  const slug = normalizePackageSlug(options.projectName);
  const projectDir = path.resolve(options.parentDir, slug);

  if (!options.force && !options.dryRun && (await fileExists(projectDir))) {
    const existingEntries = await readdir(projectDir);
    if (existingEntries.length > 0) {
      throw new Error(
        `Target directory "${projectDir}" already exists and is not empty. Choose a new name or pass --force.`,
      );
    }
  }

  const projectTitle = `${deriveEntityNames(slug).singularPascal} API`;
  const starterResource = deriveEntityNames('items');
  const entries: FilePlanEntry[] = [];

  const addFile = (relFromProject: string, content: string): void => {
    const absPath = path.join(projectDir, relFromProject);
    entries.push({
      kind: 'create',
      absPath,
      relPath: path.join(slug, relFromProject).replace(/\\/g, '/'),
      content,
    });
  };

  addFile('package.json', renderProjectPackageJson(slug, options.coreVersionSpecifier));
  addFile('tsconfig.json', renderProjectTsconfig());
  addFile('tsconfig.build.json', renderProjectTsconfigBuild());
  addFile('.gitignore', renderProjectGitignore());
  addFile('.env.example', renderProjectEnvExample());

  if (options.minimal) {
    addFile('src/main.ts', renderMinimalMain(projectTitle));
  } else {
    addFile('vitest.config.ts', renderProjectVitestConfig());
    addFile('src/config/env.ts', renderProjectEnvConfig());
    addFile('src/common/auth.guard.ts', renderGuardTemplate(deriveEntityNames('bearer'), true));
    addFile('src/common/auth.module.ts', renderAuthModuleTemplate());
    addFile(
      `src/modules/${starterResource.pluralKebab}/${starterResource.pluralKebab}.schema.ts`,
      renderResourceSchemaTemplate(starterResource),
    );
    addFile(
      `src/modules/${starterResource.pluralKebab}/${starterResource.pluralKebab}.repository.ts`,
      renderResourceRepositoryTemplate(starterResource),
    );
    addFile(
      `src/modules/${starterResource.pluralKebab}/${starterResource.pluralKebab}.service.ts`,
      renderResourceServiceTemplate(starterResource),
    );
    addFile(
      `src/modules/${starterResource.pluralKebab}/${starterResource.pluralKebab}.controller.ts`,
      renderResourceControllerTemplate(starterResource, true),
    );
    addFile(
      `src/modules/${starterResource.pluralKebab}/${starterResource.pluralKebab}.module.ts`,
      renderResourceModuleTemplate(starterResource, true),
    );
    addFile('src/app.module.ts', renderProjectAppModule(projectTitle, starterResource));
    addFile('src/main.ts', renderProjectMain());
    addFile(
      `tests/${starterResource.pluralKebab}.test.ts`,
      renderResourceTestTemplate(starterResource, true),
    );
  }

  io.stdout(`\nScaffolding Better Back project "${slug}"...`);
  await applyPlan(entries, { dryRun: options.dryRun, force: options.force }, io);

  if (!options.dryRun && options.git) {
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: projectDir, stdio: 'ignore' });
      io.stdout(`  INIT   ${slug}/.git (branch: main)`);
    } catch {
      // Ignore if git binary is unavailable in minimal container environments
    }
  }

  if (!options.dryRun && options.install) {
    io.stdout(`  INSTALL running npm install in ${slug}...`);
    execFileSync('npm', ['install'], { cwd: projectDir, stdio: 'inherit' });
  }

  io.stdout(`\nDone! Next steps:`);
  io.stdout(`  cd ${slug}`);
  if (!options.install) {
    io.stdout(`  npm install`);
  }
  io.stdout(`  npm run dev\n`);

  return projectDir;
}

export type SchematicKind =
  'resource' | 'module' | 'controller' | 'service' | 'guard' | 'repository';

const SCHEMATIC_ALIASES: Readonly<Record<string, SchematicKind>> = {
  resource: 'resource',
  res: 'resource',
  r: 'resource',
  module: 'module',
  mod: 'module',
  m: 'module',
  controller: 'controller',
  ctrl: 'controller',
  co: 'controller',
  c: 'controller',
  service: 'service',
  svc: 'service',
  s: 'service',
  guard: 'guard',
  gu: 'guard',
  g: 'guard',
  repository: 'repository',
  repo: 'repository',
  port: 'repository',
};

export function resolveSchematicKind(raw: string): SchematicKind {
  const hit = SCHEMATIC_ALIASES[raw.trim().toLowerCase()];
  if (!hit) {
    throw new Error(
      `Unknown schematic "${raw}". Expected one of: resource (res), module (mod), controller (co), service (s), guard (gu), repository (repo).`,
    );
  }
  return hit;
}

export interface GenerateOptions {
  readonly schematic: SchematicKind;
  readonly rawName: string;
  readonly projectDir: string;
  readonly withAuth: boolean;
  readonly withTests: boolean;
  readonly wire: boolean;
  readonly dryRun: boolean;
  readonly force: boolean;
}

export async function generateSchematic(
  options: GenerateOptions,
  io: CliOutput,
): Promise<readonly FilePlanEntry[]> {
  const names = deriveEntityNames(options.rawName);
  const rootDir = path.resolve(options.projectDir);
  const entries: FilePlanEntry[] = [];

  const toRel = (abs: string): string => path.relative(rootDir, abs).replace(/\\/g, '/');

  const pushCreate = (relPath: string, content: string): void => {
    const absPath = path.join(rootDir, relPath);
    entries.push({ kind: 'create', absPath, relPath: toRel(absPath), content });
  };

  const moduleDirRel = `src/modules/${names.pluralKebab}`;
  const moduleFileAbs = path.join(rootDir, `${moduleDirRel}/${names.pluralKebab}.module.ts`);
  const appModuleAbs = path.join(rootDir, 'src/app.module.ts');

  if (options.schematic === 'resource') {
    const useAuth =
      options.withAuth && (await fileExists(path.join(rootDir, 'src/common/auth.guard.ts')));

    pushCreate(
      `${moduleDirRel}/${names.pluralKebab}.schema.ts`,
      renderResourceSchemaTemplate(names),
    );
    pushCreate(
      `${moduleDirRel}/${names.pluralKebab}.repository.ts`,
      renderResourceRepositoryTemplate(names),
    );
    pushCreate(
      `${moduleDirRel}/${names.pluralKebab}.service.ts`,
      renderResourceServiceTemplate(names),
    );
    pushCreate(
      `${moduleDirRel}/${names.pluralKebab}.controller.ts`,
      renderResourceControllerTemplate(names, useAuth),
    );
    pushCreate(
      `${moduleDirRel}/${names.pluralKebab}.module.ts`,
      renderResourceModuleTemplate(names, useAuth),
    );

    if (options.withTests && (await fileExists(appModuleAbs))) {
      pushCreate(`tests/${names.pluralKebab}.test.ts`, renderResourceTestTemplate(names, useAuth));
    }

    if (options.wire && (await fileExists(appModuleAbs))) {
      const currentAppSrc = await readFile(appModuleAbs, 'utf8');
      const wired = wireSymbolIntoModuleSource({
        source: currentAppSrc,
        symbolName: `${names.pluralPascal}Module`,
        importPath: `./modules/${names.pluralKebab}/${names.pluralKebab}.module.js`,
        arrayField: 'imports',
      });
      if (wired.changed) {
        entries.push({
          kind: 'update',
          absPath: appModuleAbs,
          relPath: toRel(appModuleAbs),
          content: wired.updated,
        });
      }
    }
  } else if (options.schematic === 'module') {
    pushCreate(
      `${moduleDirRel}/${names.pluralKebab}.module.ts`,
      renderStandaloneModuleTemplate(names),
    );
    if (options.wire && (await fileExists(appModuleAbs))) {
      const currentAppSrc = await readFile(appModuleAbs, 'utf8');
      const wired = wireSymbolIntoModuleSource({
        source: currentAppSrc,
        symbolName: `${names.pluralPascal}Module`,
        importPath: `./modules/${names.pluralKebab}/${names.pluralKebab}.module.js`,
        arrayField: 'imports',
      });
      if (wired.changed) {
        entries.push({
          kind: 'update',
          absPath: appModuleAbs,
          relPath: toRel(appModuleAbs),
          content: wired.updated,
        });
      }
    }
  } else if (options.schematic === 'service') {
    pushCreate(
      `${moduleDirRel}/${names.pluralKebab}.service.ts`,
      renderStandaloneServiceTemplate(names),
    );
    if (options.wire && (await fileExists(moduleFileAbs))) {
      const modSrc = await readFile(moduleFileAbs, 'utf8');
      const wiredProv = wireSymbolIntoModuleSource({
        source: modSrc,
        symbolName: `${names.pluralPascal}Service`,
        importPath: `./${names.pluralKebab}.service.js`,
        arrayField: 'providers',
      });
      const wiredBoth = wireSymbolIntoModuleSource({
        source: wiredProv.updated,
        symbolName: `${names.pluralPascal}Service`,
        importPath: `./${names.pluralKebab}.service.js`,
        arrayField: 'exports',
      });
      if (wiredProv.changed || wiredBoth.changed) {
        entries.push({
          kind: 'update',
          absPath: moduleFileAbs,
          relPath: toRel(moduleFileAbs),
          content: wiredBoth.updated,
        });
      }
    }
  } else if (options.schematic === 'controller') {
    pushCreate(
      `${moduleDirRel}/${names.pluralKebab}.controller.ts`,
      renderStandaloneControllerTemplate(names),
    );
    if (options.wire && (await fileExists(moduleFileAbs))) {
      const modSrc = await readFile(moduleFileAbs, 'utf8');
      const wired = wireSymbolIntoModuleSource({
        source: modSrc,
        symbolName: `${names.pluralPascal}Controller`,
        importPath: `./${names.pluralKebab}.controller.js`,
        arrayField: 'controllers',
      });
      if (wired.changed) {
        entries.push({
          kind: 'update',
          absPath: moduleFileAbs,
          relPath: toRel(moduleFileAbs),
          content: wired.updated,
        });
      }
    }
  } else if (options.schematic === 'guard') {
    pushCreate(`src/common/${names.singularKebab}.guard.ts`, renderGuardTemplate(names, false));
  } else if (options.schematic === 'repository') {
    pushCreate(
      `${moduleDirRel}/${names.pluralKebab}.repository.ts`,
      renderStandaloneRepositoryTemplate(names),
    );
  }

  await applyPlan(entries, { dryRun: options.dryRun, force: options.force }, io);
  return entries;
}
