export type DocSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  code?: string;
  note?: string;
};

export type DocPage = {
  slug: string;
  title: string;
  description: string;
  sections: DocSection[];
};

export const docs: DocPage[] = [
  {
    slug: 'quick-start',
    title: 'Quick start',
    description: 'Build your first API with Better Back, Express 5, and Zod.',
    sections: [
      {
        title: 'Install',
        paragraphs: [
          'Better Back requires Node.js 20 or later and TypeScript with strict mode enabled.',
        ],
        code: 'npm install better-back express zod pino\nnpm install -D typescript @types/express @types/node tsx',
      },
      {
        title: 'Create a controller',
        paragraphs: [
          'Define your request contract once with Zod, then use it to validate input and infer handler types.',
        ],
        code: "import { Controller, Get, Post, type Ctx } from 'better-back';\nimport { z } from 'zod';\n\nconst CreateTask = z.object({\n  title: z.string().trim().min(2).max(120),\n});\n\n@Controller('/tasks')\nexport class TasksController {\n  @Get('/')\n  list() {\n    return [{ id: 'task-1', title: 'Ship the API' }];\n  }\n\n  @Post('/')\n  create({ body }: Ctx<typeof CreateTask>) {\n    return { id: crypto.randomUUID(), ...body };\n  }\n}",
      },
      {
        title: 'Boot the application',
        paragraphs: ['Register the controller in a module, then start the application.'],
        code: "import { BetterBack, Module } from 'better-back';\nimport { TasksController } from './tasks.controller.js';\n\n@Module({ controllers: [TasksController] })\nclass AppModule {}\n\nconst app = await BetterBack.create(AppModule);\nawait app.listen(3000);",
      },
      {
        title: 'Try it',
        bullets: [
          'GET /tasks returns the list of tasks.',
          'POST /tasks accepts a validated JSON body.',
          'Open /docs for the generated OpenAPI explorer.',
        ],
      },
    ],
  },
  {
    slug: 'architecture',
    title: 'Architecture',
    description: 'A practical overview of the layers and request lifecycle.',
    sections: [
      {
        title: 'Express-transparent by design',
        paragraphs: [
          'Better Back builds on Express 5 rather than hiding it. app.express is a regular Express application, and existing middleware can be mounted directly.',
        ],
        code: "const app = await BetterBack.create(AppModule, {\n  middleware: [cors(), helmet()],\n});\n\napp.express.use('/legacy', existingRouter);",
      },
      {
        title: 'Keep responsibilities clear',
        bullets: [
          'Controllers adapt HTTP input to application operations.',
          'Services contain application and domain behavior without Express request objects.',
          'Ports express infrastructure needs as interfaces and injection tokens.',
          'Adapters implement ports for databases, caches, and external services.',
        ],
      },
      {
        title: 'Request lifecycle',
        paragraphs: [
          'Requests flow through correlation and drain handling, security headers and CORS, timeout and rate limiting, body parsing, middleware, guards, schema validation and controller execution, then centralized problem-details error handling.',
        ],
      },
    ],
  },
  {
    slug: 'routing',
    title: 'Routing & validation',
    description:
      'Declare endpoints with decorators and keep schemas, types, and API docs together.',
    sections: [
      {
        title: 'Describe a route',
        paragraphs: [
          'Use method decorators to define paths, request schemas, response schemas, and OpenAPI metadata.',
        ],
        code: "const CreateUser = z.object({ email: z.email() });\nconst User = z.object({ id: z.string(), email: z.email() });\n\n@Controller({ prefix: '/users', tags: ['Users'] })\nclass UsersController {\n  @Post('/', {\n    body: CreateUser,\n    response: User,\n    status: 201,\n    summary: 'Create a user',\n  })\n  create({ body }: Ctx<typeof CreateUser>) {\n    return userService.create(body);\n  }\n}",
      },
      {
        title: 'Type handler context',
        paragraphs: [
          'Ctx derives handler input from schemas and route paths, so refactoring a field or parameter is checked by TypeScript.',
        ],
        code: "@Get('/:userId')\nfindOne({ params }: Ctx<'/:userId'>) {\n  return userService.find(params.userId);\n}",
      },
      {
        title: 'Generated API documentation',
        bullets: [
          'An OpenAPI 3.1 document is generated from route metadata.',
          "Zod schemas can define reusable components with `.meta({ id: 'User' })`.",
          'The interactive docs are served by the application at /docs.',
        ],
      },
    ],
  },
  {
    slug: 'dependency-injection',
    title: 'Dependency injection',
    description: 'Compose modules and services with explicit tokens and no reflection metadata.',
    sections: [
      {
        title: 'Inject a service',
        paragraphs: [
          'The inject helper resolves registered providers without constructor parameter reflection.',
        ],
        code: '@Injectable()\nexport class UsersService {\n  private readonly users = inject(UserRepositoryToken);\n\n  find(id: string) {\n    return this.users.findById(id);\n  }\n}',
      },
      {
        title: 'Define a token and provider',
        code: "interface UserRepository {\n  findById(id: string): Promise<User | null>;\n}\n\nconst UserRepositoryToken = createToken<UserRepository>('UserRepository');\n\n@Module({\n  providers: [\n    UsersService,\n    { provide: UserRepositoryToken, useClass: SqlUserRepository },\n  ],\n  exports: [UsersService],\n})\nclass UsersModule {}",
      },
      {
        title: 'Module boundaries',
        bullets: [
          'Register providers in the module that owns them.',
          'Export only providers other modules should consume.',
          'The container validates dependency graphs and reports missing or circular providers during startup.',
        ],
      },
    ],
  },
  {
    slug: 'configuration',
    title: 'Configuration',
    description: 'Validate environment configuration at startup and keep secrets out of logs.',
    sections: [
      {
        title: 'Declare the environment schema',
        code: "const config = defineConfig({\n  schema: z.object({\n    NODE_ENV: z.enum(['development', 'test', 'production']),\n    PORT: z.coerce.number().int().positive().default(3000),\n    API_SECRET: z.string().min(32),\n  }),\n});",
      },
      {
        title: 'Fail early',
        paragraphs: [
          'Configuration is validated when the app starts. Invalid values raise a configuration error before the server begins accepting requests. Inject the loaded config where it is needed instead of reading process.env throughout the application.',
        ],
      },
      {
        title: 'Operational settings',
        bullets: [
          'Set trustProxy deliberately when deploying behind a reverse proxy.',
          'Use explicit CORS origins for browser-facing APIs.',
          'Configure structured logging and secret redaction for the environment.',
        ],
      },
    ],
  },
  {
    slug: 'security-errors',
    title: 'Security & errors',
    description: 'Use secure defaults and consistent RFC 7807 responses.',
    sections: [
      {
        title: 'Secure defaults',
        paragraphs: [
          'The framework provides security headers, deny-by-default CORS behavior, bounded JSON parsing, request timeouts, request ID correlation, and rate-limiter ports. Review settings against your deployment and threat model.',
        ],
      },
      {
        title: 'Protect endpoints with guards',
        code: "@Controller('/admin')\n@Guard(requireSignedInUser)\nclass AdminController {\n  @Get('/reports')\n  reports() {\n    return reportService.list();\n  }\n}",
      },
      {
        title: 'Return typed HTTP errors',
        paragraphs: [
          'Throw an AppError subclass for expected client-facing failures. Unexpected internal errors are normalized to a generic server response.',
        ],
        code: "import { NotFoundError } from 'better-back';\n\nconst user = await users.findById(id);\nif (!user) {\n  throw new NotFoundError('User not found.');\n}",
      },
    ],
  },
  {
    slug: 'testing',
    title: 'Testing',
    description: 'Test services without HTTP and exercise routes in memory.',
    sections: [
      {
        title: 'Unit-test a service',
        paragraphs: [
          'resolveForTest builds a small provider container and lets you replace infrastructure ports with focused test doubles.',
        ],
        code: "const service = resolveForTest(UsersService, [\n  [UserRepositoryToken, fakeUserRepository],\n]);\n\nexpect(await service.find('user-1')).toEqual(expectedUser);",
      },
      {
        title: 'Test an HTTP route',
        paragraphs: [
          'createTestingApp prepares an Express application that Supertest can call without binding a TCP port.',
        ],
        code: "await using app = await createTestingApp(AppModule, {\n  overrides: [[UserRepositoryToken, fakeUserRepository]],\n});\n\nconst response = await request(app.express)\n  .get('/users/user-1');\n\nexpect(response.status).toBe(200);",
      },
      {
        title: 'Check types and behavior',
        bullets: [
          'Use TypeScript checks to verify Ctx inference and schema contracts.',
          'Cover validation, authorization, error responses, and middleware integration.',
          'Dispose test apps with await using to exercise graceful cleanup.',
        ],
      },
    ],
  },
  {
    slug: 'cli',
    title: 'CLI & scaffolding',
    description:
      'Scaffold projects, generate 4-layer resources, inspect module graphs, and export OpenAPI specs with zero runtime overhead.',
    sections: [
      {
        title: 'Scaffold a project',
        paragraphs: [
          'Create a modular strict-TypeScript API or a single-file microservice in one command.',
        ],
        code: 'npm create better-back@latest my-api\ncd my-api\nnpm install\nnpm run dev',
      },
      {
        title: 'Generate explicit vertical slices',
        paragraphs: [
          'Generate complete 4-layer CRUD resources (Zod schemas, repository port, domain service, controller, module, and Vitest + Supertest tests) with deterministic @Module wiring.',
        ],
        code: 'npx bb g resource orders\nnpx bb g repository audit-logs\nnpx bb g guard api-key',
      },
      {
        title: 'Inspect routes, module graphs, OpenAPI & TypeScript SDKs',
        bullets: [
          'npx bb routes prints every registered HTTP method, path, guard state, and status code without opening a TCP port.',
          'npx bb graph prints the explicit @Module and DynamicModule dependency, controller, provider, and export tree.',
          'npx bb openapi --out openapi.json exports the OpenAPI 3.1.0 specification (or --check openapi.json in CI).',
          'npx bb sdk --out src/sdk/client.ts generates a zero-dependency, strict-TypeScript fetch client SDK directly from your routes (or --check in CI).',
          'npx bb build --openapi compiles TypeScript and verifies the compiled DI/routing graph at build time.',
          'npx bb doctor --verify-app audits Node LTS, strict tsconfig, Stage-3 decorators, .env hygiene, and DI startup.',
        ],
      },
    ],
  },
  {
    slug: 'caching-and-sse',
    title: 'Caching, ETag & SSE',
    description:
      'Declarative @Cache with stale-while-revalidate, conditional RFC 9110 ETag (304 Not Modified), and typed Server-Sent Events.',
    sections: [
      {
        title: 'Declarative HTTP caching & ETag',
        paragraphs: [
          'Decorate GET/HEAD routes or controllers with @Cache(...) to serve responses from CachePort (LRU InMemoryCache by default, or Redis/Valkey in multi-node clusters) with automatic weak ETag, If-None-Match 304 Not Modified, Cache-Control, X-Cache, and optional stale-while-revalidate.',
        ],
        code: "import { Cache, CacheToken, Controller, Get, inject, Post } from 'better-back';\n\n@Controller('/catalog')\nexport class CatalogController {\n  private readonly cache = inject(CacheToken);\n\n  @Get('/featured')\n  @Cache({ ttlMs: 30_000, swrMs: 60_000 })\n  featured() {\n    return { items: ['ts-handbook'] };\n  }\n\n  @Post('/invalidate')\n  async invalidate() {\n    await this.cache.delByPrefix?.('http:GET:/catalog');\n    return { ok: true };\n  }\n}",
      },
      {
        title: 'Typed Server-Sent Events (sse)',
        paragraphs: [
          'Stream AI tokens, job progress, or live events over text/event-stream using sse(). Payloads validate against your route schema, document automatically in OpenAPI 3.1, and abort cleanly when clients disconnect or when app.close() drains.',
        ],
        code: "import { Controller, Get, sse } from 'better-back';\nimport { z } from 'zod';\n\nconst ProgressEvent = z.object({ step: z.number(), status: z.string() }).meta({ id: 'ProgressEvent' });\n\n@Controller('/jobs')\nexport class JobsController {\n  @Get('/stream', { sse: ProgressEvent })\n  stream() {\n    return sse(async function* ({ signal }) {\n      yield { id: '1', event: 'progress', data: { step: 1, status: 'running' } };\n    });\n  }\n}",
      },
    ],
  },
  {
    slug: 'observability',
    title: 'Metrics & tracing',
    description:
      'Built-in W3C traceparent propagation, OpenMetrics / Prometheus /metrics endpoint, and vendor-agnostic MetricsToken.',
    sections: [
      {
        title: 'Enable /metrics and custom counters',
        paragraphs: [
          'Turn on metrics: { enabled: true } in BetterBack.create(...) to expose RED request metrics (requests total, errors, latency histogram buckets, and in-flight gauge) in both Prometheus text and JSON formats with zero extra dependencies.',
        ],
        code: "const app = await BetterBack.create(AppModule, {\n  metrics: { enabled: true, path: '/metrics' },\n});",
      },
      {
        title: 'W3C Trace Context (traceparent)',
        bullets: [
          'Incoming W3C traceparent headers (00-<traceId>-<spanId>-<flags>) are validated automatically.',
          'Ctx.traceId exposes the 32-hex trace identifier directly in handlers and guards.',
          'Structured Pino child loggers (ctx.log) automatically attach both requestId and traceId.',
        ],
      },
    ],
  },
];

export const docNavigation = [
  { label: 'Getting started', slug: 'quick-start' },
  { label: 'Architecture', slug: 'architecture' },
  { label: 'Routing & validation', slug: 'routing' },
  { label: 'Dependency injection', slug: 'dependency-injection' },
  { label: 'Configuration', slug: 'configuration' },
  { label: 'Security & errors', slug: 'security-errors' },
  { label: 'Caching, ETag & SSE', slug: 'caching-and-sse' },
  { label: 'Metrics & tracing', slug: 'observability' },
  { label: 'Testing', slug: 'testing' },
  { label: 'CLI & SDK codegen', slug: 'cli' },
];

export function getDoc(slug: string): DocPage | undefined {
  return docs.find((doc) => doc.slug === slug);
}
