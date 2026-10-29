import type { EntityNames } from './naming.js';

export function renderProjectPackageJson(
  projectSlug: string,
  coreVersionSpecifier = '^1.0.0',
): string {
  return `${JSON.stringify(
    {
      name: projectSlug,
      version: '0.1.0',
      private: true,
      type: 'module',
      engines: {
        node: '>=20.0.0',
      },
      scripts: {
        dev: 'better-back dev src/main.ts',
        build: 'better-back build',
        start: 'node dist/main.js',
        typecheck: 'tsc --noEmit',
        test: 'vitest run',
        routes: 'better-back routes src/app.module.ts',
        graph: 'better-back graph src/app.module.ts',
        openapi: 'better-back openapi src/app.module.ts --out openapi.json',
        doctor: 'better-back doctor',
      },
      dependencies: {
        'better-back': coreVersionSpecifier,
        express: '^5.3.0',
        pino: '^10.4.0',
        zod: '^4.6.7',
      },
      devDependencies: {
        '@types/express': '^5.0.6',
        '@types/node': '^20.19.43',
        '@types/supertest': '^7.2.1',
        supertest: '^7.3.1',
        tsx: '^4.23.15',
        typescript: '^5.9.3',
        vitest: '^4.1.12',
      },
    },
    null,
    2,
  )}\n`;
}

export function renderProjectTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2022', 'ESNext.Disposable'],
        strict: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        exactOptionalPropertyTypes: false,
        skipLibCheck: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        isolatedModules: true,
        noEmit: true,
      },
      include: ['src/**/*.ts', 'tests/**/*.ts'],
    },
    null,
    2,
  )}\n`;
}

export function renderProjectTsconfigBuild(): string {
  return `${JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: {
        noEmit: false,
        rootDir: 'src',
        outDir: 'dist',
        declaration: true,
        sourceMap: true,
      },
      include: ['src/**/*.ts'],
    },
    null,
    2,
  )}\n`;
}

export function renderProjectVitestConfig(): string {
  return `import ts from 'typescript';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: false,
  plugins: [
    {
      name: 'typescript-stage3-decorators',
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('.ts') || id.includes('node_modules')) {
          return null;
        }
        const out = ts.transpileModule(code, {
          fileName: id,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            sourceMap: true,
          },
        });
        return {
          code: out.outputText,
          map: out.sourceMapText ? JSON.parse(out.sourceMapText) : null,
        };
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
`;
}

export function renderProjectGitignore(): string {
  return `node_modules/
dist/
coverage/
*.tsbuildinfo
.env
.env.*
!.env.example
`;
}

export function renderProjectEnvExample(): string {
  return `NODE_ENV=development
PORT=3000
API_BEARER_TOKEN=dev-secret-token-2026
CORS_ORIGIN=http://localhost:5173
`;
}

export function renderProjectEnvConfig(): string {
  return `import { defineConfig } from 'better-back';
import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  API_BEARER_TOKEN: z.string().min(12).default('dev-secret-token-2026'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export type AppEnv = z.output<typeof EnvSchema>;

export const AppConfig = defineConfig({
  name: 'AppConfig',
  schema: EnvSchema,
  profiles: {
    development: { PORT: 3000 },
    test: { PORT: 0 },
    production: { PORT: 8080 },
  },
});
`;
}

export function renderGuardTemplate(guardNames: EntityNames, withAppConfig = false): string {
  if (withAppConfig) {
    return `import {
  ForbiddenError,
  inject,
  Injectable,
  UnauthorizedError,
  type AuthGuard,
  type AuthGuardFn,
  type GuardContext,
} from 'better-back';
import { AppConfig } from '../config/env.js';

export interface AuthUser {
  readonly subject: string;
  readonly scopes: readonly string[];
}

@Injectable()
export class BearerAuthGuard implements AuthGuard<AuthUser> {
  private readonly config = inject(AppConfig);

  public canActivate({ req }: GuardContext): AuthUser {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing Bearer authorization header.');
    }
    const token = header.slice('Bearer '.length).trim();
    if (token !== this.config.API_BEARER_TOKEN) {
      throw new UnauthorizedError('Invalid Bearer token.');
    }
    return {
      subject: 'operator',
      scopes: ['write'],
    };
  }
}

export function requireScope(scope: string): AuthGuardFn<void, AuthUser | undefined> {
  return ({ user }) => {
    if (!user) {
      throw new UnauthorizedError('Authentication required before checking scope.');
    }
    if (!user.scopes.includes(scope)) {
      throw new ForbiddenError(\`Missing required permission scope "\${scope}".\`);
    }
  };
}
`;
  }

  return `import {
  Injectable,
  UnauthorizedError,
  type AuthGuard,
  type GuardContext,
} from 'better-back';

export interface ${guardNames.singularPascal}Principal {
  readonly subject: string;
}

@Injectable()
export class ${guardNames.singularPascal}Guard implements AuthGuard<${guardNames.singularPascal}Principal> {
  public canActivate({ req }: GuardContext): ${guardNames.singularPascal}Principal {
    const header = req.headers['x-${guardNames.singularKebab}'];
    if (typeof header !== 'string' || header.trim().length === 0) {
      throw new UnauthorizedError('Missing X-${guardNames.singularPascal} authentication header.');
    }
    return { subject: header.trim() };
  }
}
`;
}

export function renderAuthModuleTemplate(): string {
  return `import { Module } from 'better-back';
import { BearerAuthGuard } from './auth.guard.js';

@Module({
  providers: [BearerAuthGuard],
  exports: [BearerAuthGuard],
})
export class AuthModule {}
`;
}

export function renderResourceSchemaTemplate(names: EntityNames): string {
  const P = names.singularPascal;
  const PP = names.pluralPascal;
  return `import { createPaginatedResponseSchema, PaginationQuerySchema } from 'better-back';
import { z } from 'zod';

export const ${P}IdSchema = z
  .uuid()
  .brand<'${P}Id'>()
  .describe('Unique UUIDv4 ${names.singularKebab} identifier');
export type ${P}Id = z.output<typeof ${P}IdSchema>;

export const ${P}Schema = z
  .object({
    id: ${P}IdSchema,
    name: z.string().trim().min(2).max(120).describe('Display name'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: '${P}', title: '${P}', description: '${P} resource entity' });

export type ${P} = z.output<typeof ${P}Schema>;

export const Create${P}Schema = z
  .object({
    name: z.string().trim().min(2).max(120),
  })
  .meta({ id: 'Create${P}Input', title: 'Create${P}Input' });

export type Create${P}Input = z.output<typeof Create${P}Schema>;

export const Update${P}Schema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update a ${names.singularKebab}.',
  })
  .meta({ id: 'Update${P}Input', title: 'Update${P}Input' });

export type Update${P}Input = z.output<typeof Update${P}Schema>;

export const ${P}IdParamsSchema = z.object({
  id: ${P}IdSchema,
});

export const List${PP}QuerySchema = PaginationQuerySchema;
export type List${PP}Query = z.output<typeof List${PP}QuerySchema>;

export const Paginated${PP}ResponseSchema = createPaginatedResponseSchema(${P}Schema).meta({
  id: 'Paginated${PP}Response',
  title: 'Paginated${PP}Response',
});
`;
}

export function renderResourceRepositoryTemplate(names: EntityNames): string {
  const P = names.singularPascal;
  const PP = names.pluralPascal;
  return `import { randomUUID } from 'node:crypto';
import { createToken, Injectable } from 'better-back';
import {
  ${P}IdSchema,
  ${P}Schema,
  type Create${P}Input,
  type List${PP}Query,
  type ${P},
  type ${P}Id,
  type Update${P}Input,
} from './${names.pluralKebab}.schema.js';

export interface ${P}Repository {
  findMany(query: List${PP}Query): Promise<{ readonly items: readonly ${P}[]; readonly total: number }>;
  findById(id: ${P}Id): Promise<${P} | undefined>;
  create(input: Create${P}Input): Promise<${P}>;
  update(id: ${P}Id, input: Update${P}Input): Promise<${P} | undefined>;
  delete(id: ${P}Id): Promise<boolean>;
  ping(): Promise<boolean>;
}

export const ${P}RepositoryToken = createToken<${P}Repository>('${P}Repository');

@Injectable()
export class InMemory${P}Repository implements ${P}Repository {
  private readonly store = new Map<${P}Id, ${P}>();

  public async findMany(
    query: List${PP}Query,
  ): Promise<{ readonly items: readonly ${P}[]; readonly total: number }> {
    const sorted = [...this.store.values()].sort((a, b) => {
      const cmp = a.createdAt.localeCompare(b.createdAt);
      return query.order === 'desc' ? -cmp : cmp;
    });
    const offset = (query.page - 1) * query.limit;
    return {
      items: sorted.slice(offset, offset + query.limit),
      total: sorted.length,
    };
  }

  public async findById(id: ${P}Id): Promise<${P} | undefined> {
    return this.store.get(id);
  }

  public async create(input: Create${P}Input): Promise<${P}> {
    const id = ${P}IdSchema.parse(randomUUID());
    const entity: ${P} = ${P}Schema.parse({
      id,
      name: input.name,
      createdAt: new Date().toISOString(),
    });
    this.store.set(id, entity);
    return entity;
  }

  public async update(id: ${P}Id, input: Update${P}Input): Promise<${P} | undefined> {
    const existing = this.store.get(id);
    if (!existing) return undefined;
    const updated: ${P} = ${P}Schema.parse({
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
    });
    this.store.set(id, updated);
    return updated;
  }

  public async delete(id: ${P}Id): Promise<boolean> {
    return this.store.delete(id);
  }

  public async ping(): Promise<boolean> {
    return true;
  }
}
`;
}

export function renderResourceServiceTemplate(names: EntityNames): string {
  const P = names.singularPascal;
  const PP = names.pluralPascal;
  return `import { inject, Injectable, NotFoundError, paginate, type PaginatedResult } from 'better-back';
import { ${P}RepositoryToken } from './${names.pluralKebab}.repository.js';
import type {
  Create${P}Input,
  List${PP}Query,
  ${P},
  ${P}Id,
  Update${P}Input,
} from './${names.pluralKebab}.schema.js';

@Injectable()
export class ${PP}Service {
  private readonly repo = inject(${P}RepositoryToken);

  public async list${PP}(query: List${PP}Query): Promise<PaginatedResult<${P}>> {
    const { items, total } = await this.repo.findMany(query);
    return paginate(items, total, query);
  }

  public async get${P}ById(id: ${P}Id): Promise<${P}> {
    const item = await this.repo.findById(id);
    if (!item) {
      throw new NotFoundError(\`${P} "\${id}" was not found.\`);
    }
    return item;
  }

  public async create${P}(input: Create${P}Input): Promise<${P}> {
    return this.repo.create(input);
  }

  public async update${P}(id: ${P}Id, input: Update${P}Input): Promise<${P}> {
    const updated = await this.repo.update(id, input);
    if (!updated) {
      throw new NotFoundError(\`${P} "\${id}" was not found.\`);
    }
    return updated;
  }

  public async delete${P}(id: ${P}Id): Promise<void> {
    const deleted = await this.repo.delete(id);
    if (!deleted) {
      throw new NotFoundError(\`${P} "\${id}" was not found.\`);
    }
  }
}
`;
}

export function renderResourceControllerTemplate(names: EntityNames, withAuth = false): string {
  const P = names.singularPascal;
  const PP = names.pluralPascal;
  const guardImports = withAuth ? 'Guard, ' : '';
  const authImportLine = withAuth
    ? `import { BearerAuthGuard, requireScope } from '../../common/auth.guard.js';\n`
    : '';
  const guardDecorator = withAuth ? `\n  @Guard(BearerAuthGuard, requireScope('write'))` : '';
  const authErrors = withAuth ? '403, ' : '';

  return `import { Controller, Delete, Get, ${guardImports}inject, Patch, Post, type Ctx } from 'better-back';
${authImportLine}import {
  Create${P}Schema,
  List${PP}QuerySchema,
  Paginated${PP}ResponseSchema,
  ${P}IdParamsSchema,
  ${P}Schema,
  Update${P}Schema,
} from './${names.pluralKebab}.schema.js';
import { ${PP}Service } from './${names.pluralKebab}.service.js';

@Controller({ prefix: '/${names.pluralKebab}', tags: ['${PP}'] })
export class ${PP}Controller {
  private readonly service = inject(${PP}Service);

  @Get('/', {
    summary: 'List ${names.pluralKebab} with pagination',
    query: List${PP}QuerySchema,
    response: Paginated${PP}ResponseSchema,
  })
  public list({ query }: Ctx<{ query: typeof List${PP}QuerySchema }>) {
    return this.service.list${PP}(query);
  }

  @Get('/:id', {
    summary: 'Get ${names.singularKebab} by UUID',
    params: ${P}IdParamsSchema,
    response: ${P}Schema,
    errors: [404],
  })
  public getById({ params }: Ctx<{ params: typeof ${P}IdParamsSchema }>) {
    return this.service.get${P}ById(params.id);
  }

  @Post('/', {
    summary: 'Create a new ${names.singularKebab}',
    status: 201,
    body: Create${P}Schema,
    response: ${P}Schema,${withAuth ? '\n    errors: [403],' : ''}
  })${guardDecorator}
  public create({ body }: Ctx<typeof Create${P}Schema>) {
    return this.service.create${P}(body);
  }

  @Patch('/:id', {
    summary: 'Update ${names.singularKebab} fields',
    params: ${P}IdParamsSchema,
    body: Update${P}Schema,
    response: ${P}Schema,
    errors: [${authErrors}404],
  })${guardDecorator}
  public update({
    params,
    body,
  }: Ctx<{ params: typeof ${P}IdParamsSchema; body: typeof Update${P}Schema }>) {
    return this.service.update${P}(params.id, body);
  }

  @Delete('/:id', {
    summary: 'Delete ${names.singularKebab} by UUID',
    status: 204,
    params: ${P}IdParamsSchema,
    errors: [${authErrors}404],
  })${guardDecorator}
  public async remove({ params }: Ctx<{ params: typeof ${P}IdParamsSchema }>): Promise<void> {
    await this.service.delete${P}(params.id);
  }
}
`;
}

export function renderResourceModuleTemplate(names: EntityNames, withAuth = false): string {
  const P = names.singularPascal;
  const PP = names.pluralPascal;
  const authImport = withAuth ? `import { AuthModule } from '../../common/auth.module.js';\n` : '';
  const importsLine = withAuth ? `\n  imports: [AuthModule],` : '';

  return `import { Module } from 'better-back';
${authImport}import { ${PP}Controller } from './${names.pluralKebab}.controller.js';
import { InMemory${P}Repository, ${P}RepositoryToken } from './${names.pluralKebab}.repository.js';
import { ${PP}Service } from './${names.pluralKebab}.service.js';

@Module({${importsLine}
  controllers: [${PP}Controller],
  providers: [
    { provide: ${P}RepositoryToken, useClass: InMemory${P}Repository },
    ${PP}Service,
  ],
  exports: [${PP}Service, ${P}RepositoryToken],
})
export class ${PP}Module {}
`;
}

export function renderStandaloneModuleTemplate(names: EntityNames): string {
  return `import { Module } from 'better-back';

@Module({})
export class ${names.pluralPascal}Module {}
`;
}

export function renderStandaloneServiceTemplate(names: EntityNames): string {
  return `import { Injectable } from 'better-back';

@Injectable()
export class ${names.pluralPascal}Service {
  public status(): { readonly module: string; readonly ok: boolean } {
    return { module: '${names.pluralKebab}', ok: true };
  }
}
`;
}

export function renderStandaloneControllerTemplate(names: EntityNames): string {
  return `import { Controller, Get } from 'better-back';
import { z } from 'zod';

const StatusResponseSchema = z.object({
  resource: z.string(),
  ok: z.boolean(),
});

@Controller({ prefix: '/${names.pluralKebab}', tags: ['${names.pluralPascal}'] })
export class ${names.pluralPascal}Controller {
  @Get('/', { summary: '${names.pluralPascal} status', response: StatusResponseSchema })
  public status() {
    return { resource: '${names.pluralKebab}', ok: true };
  }
}
`;
}

export function renderProjectAppModule(projectTitle: string, starterResource: EntityNames): string {
  const P = starterResource.singularPascal;
  const PP = starterResource.pluralPascal;
  return `import { Module, type BetterBackOptions } from 'better-back';
import { AppConfig, type AppEnv } from './config/env.js';
import { ${PP}Module } from './modules/${starterResource.pluralKebab}/${starterResource.pluralKebab}.module.js';
import { ${P}RepositoryToken } from './modules/${starterResource.pluralKebab}/${starterResource.pluralKebab}.repository.js';

@Module({
  imports: [${PP}Module],
})
export class AppModule {}

export function buildAppOptions(
  env: Record<string, string | undefined> = process.env,
): BetterBackOptions<AppEnv> {
  const config = env === process.env ? AppConfig : AppConfig.from(env);

  return {
    config,
    apiPrefix: '/api/v1',
    trustProxy: 1,
    security: {
      cors: {
        origins: [config.values.CORS_ORIGIN],
      },
    },
    healthChecks: [
      {
        name: '${starterResource.singularCamel}Repository',
        check: async (container) => ({
          healthy: await container.resolve(${P}RepositoryToken, '${PP}Module').ping(),
          detail: 'repository operational',
        }),
      },
    ],
    openapi: {
      title: '${projectTitle}',
      version: '0.1.0',
    },
  };
}
`;
}

export function renderProjectMain(): string {
  return `import { BetterBack } from 'better-back';
import { AppModule, buildAppOptions } from './app.module.js';

const app = await BetterBack.create(AppModule, buildAppOptions());
await app.listen();
`;
}

export function renderMinimalMain(projectTitle: string): string {
  return `import { BetterBack, Controller, Get, inject, Injectable, Module, Post, type Ctx } from 'better-back';
import { z } from 'zod';

const CreateNoteSchema = z.object({ title: z.string().trim().min(2).max(120) }).meta({ id: 'CreateNoteInput' });
const NoteSchema = z.object({ id: z.string(), title: z.string() }).meta({ id: 'Note' });

@Injectable()
export class NotesService {
  private readonly notes: z.output<typeof NoteSchema>[] = [];

  public list() {
    return this.notes;
  }

  public create(title: string) {
    const note = { id: crypto.randomUUID(), title };
    this.notes.push(note);
    return note;
  }
}

@Controller({ prefix: '/notes', tags: ['Notes'] })
export class NotesController {
  private readonly notes = inject(NotesService);

  @Get('/', { summary: 'List notes', response: NoteSchema.array() })
  public list() {
    return this.notes.list();
  }

  @Post('/', { summary: 'Create note', body: CreateNoteSchema, response: NoteSchema })
  public create({ body }: Ctx<typeof CreateNoteSchema>) {
    return this.notes.create(body.title);
  }
}

@Module({ controllers: [NotesController], providers: [NotesService] })
export class AppModule {}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const app = await BetterBack.create(AppModule, {
    apiPrefix: '/api/v1',
    openapi: { title: '${projectTitle}', version: '0.1.0' },
  });
  await app.listen(Number(process.env['PORT'] ?? 3000));
}
`;
}

export function renderResourceTestTemplate(names: EntityNames, withAuth = false): string {
  const P = names.singularPascal;
  const PP = names.pluralPascal;
  const authHeaderLine = withAuth
    ? `\n      .set('Authorization', 'Bearer test-secret-token-2026')`
    : '';

  return `import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestingApp, NotFoundError, resolveForTest } from 'better-back';
import { AppModule, buildAppOptions } from '../src/app.module.js';
import {
  ${P}RepositoryToken,
  type ${P}Repository,
} from '../src/modules/${names.pluralKebab}/${names.pluralKebab}.repository.js';
import { ${P}IdSchema } from '../src/modules/${names.pluralKebab}/${names.pluralKebab}.schema.js';
import { ${PP}Service } from '../src/modules/${names.pluralKebab}/${names.pluralKebab}.service.js';

describe('${PP} Module', () => {
  it('unit-tests ${PP}Service in 1 line with resolveForTest()', async () => {
    const sampleId = ${P}IdSchema.parse('550e8400-e29b-41d4-a716-446655440000');
    const mockRepo: ${P}Repository = {
      findMany: async () => ({ items: [], total: 0 }),
      findById: async (id) =>
        id === sampleId ? { id: sampleId, name: 'Sample ${P}', createdAt: '2026-10-29T00:00:00.000Z' } : undefined,
      create: async (input) => ({ id: sampleId, name: input.name, createdAt: '2026-10-29T00:00:00.000Z' }),
      update: async () => undefined,
      delete: async () => false,
      ping: async () => true,
    };

    const service = resolveForTest(${PP}Service, [[${P}RepositoryToken, mockRepo]]);
    const found = await service.get${P}ById(sampleId);
    expect(found.name).toBe('Sample ${P}');

    const missing = ${P}IdSchema.parse('660e8400-e29b-41d4-a716-446655440001');
    await expect(service.get${P}ById(missing)).rejects.toThrowError(NotFoundError);
  });

  it('completes end-to-end CRUD over HTTP', async () => {
    await using app = await createTestingApp(
      AppModule,
      buildAppOptions({
        NODE_ENV: 'test',
        API_BEARER_TOKEN: 'test-secret-token-2026',
      }),
    );

    const created = await request(app.express)
      .post('/api/v1/${names.pluralKebab}')${authHeaderLine}
      .send({ name: 'First ${P}' });
    expect(created.status).toBe(201);

    const listed = await request(app.express).get('/api/v1/${names.pluralKebab}');
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
  });
});
`;
}

export function renderStandaloneRepositoryTemplate(names: EntityNames): string {
  const P = names.singularPascal;
  const c = names.singularCamel;
  return `import { randomUUID } from 'node:crypto';
import { createToken, Injectable } from 'better-back';

export interface ${P}Record {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface ${P}Repository {
  findById(id: string): Promise<${P}Record | undefined>;
  findAll(): Promise<readonly ${P}Record[]>;
  save(name: string): Promise<${P}Record>;
  delete(id: string): Promise<boolean>;
}

export const ${P}RepositoryToken = createToken<${P}Repository>('${P}Repository');

@Injectable()
export class InMemory${P}Repository implements ${P}Repository {
  private readonly store = new Map<string, ${P}Record>();

  public async findById(id: string): Promise<${P}Record | undefined> {
    return this.store.get(id);
  }

  public async findAll(): Promise<readonly ${P}Record[]> {
    return [...this.store.values()];
  }

  public async save(name: string): Promise<${P}Record> {
    const ${c}: ${P}Record = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };
    this.store.set(${c}.id, ${c});
    return ${c};
  }

  public async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }
}
`;
}
