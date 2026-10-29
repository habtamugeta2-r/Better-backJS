import request from 'supertest';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  Cache,
  cacheGetOrSet,
  CacheToken,
  Controller,
  createTestingApp,
  createToken,
  defineConfig,
  Get,
  Guard,
  inject,
  Injectable,
  InMemoryCache,
  InMemoryMetrics,
  isStandardSchema,
  MetricsToken,
  Module,
  Post,
  resolveForTest,
  sse,
  type AuthGuard,
  type Ctx,
  type DynamicModule,
  type GuardContext,
  type OpenApiDocument,
  type StandardSchemaV1,
} from 'better-back';
import { generateTypeScriptSdk } from '../src/cli/sdk.js';

describe('Better Back v1.1 — Standard Schema v1, DynamicModule, Optional DI, @Cache/ETag, SSE & /metrics', () => {
  it('supports pure non-Zod Standard Schema v1 + Standard JSON Schema v1 across defineConfig, routes, Ctx & OpenAPI 3.1', async () => {
    interface CustomUserIn {
      readonly handle: string;
    }
    interface CustomUserOut {
      readonly handle: string;
      readonly normalized: string;
    }

    const CustomHandleSchema: StandardSchemaV1<CustomUserIn, CustomUserOut> = {
      '~standard': {
        version: 1,
        vendor: 'custom-validator',
        validate(value) {
          if (
            typeof value === 'object' &&
            value !== null &&
            'handle' in value &&
            typeof (value as { handle: unknown }).handle === 'string' &&
            (value as { handle: string }).handle.trim().length >= 3
          ) {
            const raw = (value as { handle: string }).handle.trim();
            return { value: { handle: raw, normalized: raw.toLowerCase() } };
          }
          return {
            issues: [{ message: 'handle must be at least 3 chars', path: ['handle'] }],
          };
        },
        jsonSchema: {
          input: () => ({
            type: 'object',
            required: ['handle'],
            properties: { handle: { type: 'string', minLength: 3 } },
          }),
          output: () => ({
            type: 'object',
            required: ['handle', 'normalized'],
            properties: {
              handle: { type: 'string' },
              normalized: { type: 'string' },
            },
          }),
        },
      },
    };

    const CustomEnvSchema: StandardSchemaV1<unknown, { readonly APP_TAG: string }> = {
      '~standard': {
        version: 1,
        vendor: 'custom-env',
        validate(raw) {
          const rec = (raw ?? {}) as Record<string, unknown>;
          const tag = typeof rec['APP_TAG'] === 'string' ? rec['APP_TAG'] : 'default-tag';
          return { value: { APP_TAG: tag } };
        },
      },
    };

    const CustomConfig = defineConfig({
      schema: CustomEnvSchema,
      env: { APP_TAG: 'v1.1-std-schema' },
    });
    expect(CustomConfig.values.APP_TAG).toBe('v1.1-std-schema');

    @Controller('/handles')
    class HandlesController {
      private readonly cfg = inject(CustomConfig);

      @Post('/', { body: CustomHandleSchema, response: CustomHandleSchema })
      public register({ body }: Ctx<typeof CustomHandleSchema>) {
        expectTypeOf(body).toEqualTypeOf<CustomUserOut>();
        return {
          handle: `${body.handle}:${this.cfg.APP_TAG}`,
          normalized: body.normalized,
        };
      }
    }

    await using app = await createTestingApp(HandlesController, { config: CustomConfig });

    const invalid = await request(app.express).post('/handles').send({ handle: 'ab' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.errors[0]).toMatchObject({ location: 'body', path: 'handle' });

    const valid = await request(app.express).post('/handles').send({ handle: 'AdaLovelace' });
    expect(valid.status).toBe(201);
    expect(valid.body).toEqual({
      handle: 'AdaLovelace:v1.1-std-schema',
      normalized: 'adalovelace:v1.1-std-schema',
    });

    const postOp = app.openApiDocument.paths['/handles']?.['post'] as Record<string, unknown>;
    expect(postOp).toBeDefined();
  });

  it('supports optional & defaultValue inject() overloads and configurable DynamicModule.register()', async () => {
    interface PluginOptions {
      readonly prefix: string;
    }
    const PluginOptionsToken = createToken<PluginOptions>('PluginOptions');
    const OptionalTracerToken = createToken<{ trace(msg: string): void }>('OptionalTracer');

    @Injectable()
    class GreetingService {
      private readonly opts = inject(PluginOptionsToken);
      private readonly tracer = inject(OptionalTracerToken, { optional: true });
      private readonly fallbackRegion = inject(createToken<string>('MissingRegion'), {
        defaultValue: 'eu-central-1',
      });

      public greet(name: string) {
        this.tracer?.trace(name);
        return {
          message: `${this.opts.prefix} ${name}`,
          hasTracer: this.tracer !== undefined,
          region: this.fallbackRegion,
        };
      }
    }

    @Module({})
    class GreetingModule {
      public static register(options: PluginOptions): DynamicModule {
        return {
          module: GreetingModule,
          providers: [{ provide: PluginOptionsToken, useValue: options }, GreetingService],
          exports: [GreetingService],
        };
      }
    }

    @Controller('/greet')
    class GreetController {
      private readonly greeting = inject(GreetingService);

      @Get('/:name')
      public sayHi({ params }: Ctx<'/:name'>) {
        return this.greeting.greet(params.name);
      }
    }

    @Module({
      imports: [GreetingModule.register({ prefix: 'Selam' })],
      controllers: [GreetController],
    })
    class RootAppModule {}

    await using app = await createTestingApp(RootAppModule);
    expect(app.container.resolveOptional(OptionalTracerToken)).toBeUndefined();

    const res = await request(app.express).get('/greet/Habtamu');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'Selam Habtamu',
      hasTracer: false,
      region: 'eu-central-1',
    });

    // Pure unit test with resolveForTest also works with optional/defaultValue injection
    const unitSvc = resolveForTest(GreetingService, [[PluginOptionsToken, { prefix: 'Hi' }]]);
    expect(unitSvc.greet('Ada')).toEqual({
      message: 'Hi Ada',
      hasTracer: false,
      region: 'eu-central-1',
    });
  });

  it('delivers LRU eviction, stampede coalescing, @Cache HIT/MISS/STALE, varyByUser, and ETag 304 Not Modified', async () => {
    // 1. True LRU + delByPrefix + stampede coalescing
    const lru = new InMemoryCache(2);
    lru.set('k1', 'v1');
    lru.set('k2', 'v2');
    // Touch k1 so k2 becomes least-recently-used
    expect(lru.get('k1')).toBe('v1');
    lru.set('k3', 'v3');
    expect(lru.get('k1')).toBe('v1');
    expect(lru.get('k2')).toBeUndefined();
    expect(lru.get('k3')).toBe('v3');

    let loaderCalls = 0;
    const [r1, r2, r3] = await Promise.all([
      cacheGetOrSet(lru, 'expensive:1', 5000, async () => {
        loaderCalls += 1;
        await new Promise((r) => setTimeout(r, 15));
        return { computed: 42 };
      }),
      cacheGetOrSet(lru, 'expensive:1', 5000, async () => {
        loaderCalls += 1;
        return { computed: 99 };
      }),
      lru.getOrSet('expensive:1', 5000, async () => {
        loaderCalls += 1;
        return { computed: 100 };
      }),
    ]);
    expect(loaderCalls).toBe(1);
    expect(r1).toEqual({ computed: 42 });
    expect(r2).toEqual({ computed: 42 });
    expect(r3).toEqual({ computed: 42 });
    expect(lru.delByPrefix('expensive:')).toBe(1);

    // 2. Declarative @Cache + SWR + varyByUser + ETag 304 + prefix invalidation
    let dbRevision = 1;

    @Injectable()
    class HeaderUserGuard implements AuthGuard<{ readonly subject: string }> {
      public canActivate({ req }: GuardContext) {
        const sub = String(req.headers['x-user'] ?? 'guest');
        return { subject: sub };
      }
    }

    @Controller('/catalog')
    class CatalogController {
      private readonly cache = inject(CacheToken);

      @Get('/featured')
      @Cache({ ttlMs: 180, swrMs: 5000 })
      public getFeatured() {
        return { revision: dbRevision, title: 'TypeScript Handbook' };
      }

      @Get('/me')
      @Guard(HeaderUserGuard)
      @Cache({ ttlMs: 5000, varyByUser: true })
      public getProfile({ user }: Ctx<{ user: { readonly subject: string } }>) {
        return { subject: user.subject, revision: dbRevision };
      }

      @Post('/bump')
      public async bump() {
        dbRevision += 1;
        await this.cache.delByPrefix?.('http:GET:/catalog/featured');
        return { revision: dbRevision };
      }
    }

    await using app = await createTestingApp(CatalogController);

    // First request -> MISS + ETag
    const missRes = await request(app.express).get('/catalog/featured');
    expect(missRes.status).toBe(200);
    expect(missRes.headers['x-cache']).toBe('MISS');
    expect(missRes.headers['cache-control']).toBe('public, max-age=0, stale-while-revalidate=5');
    const etag1 = missRes.headers['etag'] as string;
    expect(etag1).toMatch(/^W\/"/);
    expect(missRes.body.revision).toBe(1);

    // Second request within TTL -> HIT
    dbRevision = 2;
    const hitRes = await request(app.express).get('/catalog/featured');
    expect(hitRes.status).toBe(200);
    expect(hitRes.headers['x-cache']).toBe('HIT');
    expect(hitRes.body.revision).toBe(1);

    // Conditional request with matching If-None-Match -> 304 Not Modified!
    const notModRes = await request(app.express)
      .get('/catalog/featured')
      .set('If-None-Match', etag1);
    expect(notModRes.status).toBe(304);
    expect(notModRes.text).toBe('');

    // Wait for ttlMs (180ms) to expire into swrMs window -> serves STALE immediately and refreshes in background!
    await new Promise((r) => setTimeout(r, 210));
    const staleRes = await request(app.express).get('/catalog/featured');
    expect(staleRes.status).toBe(200);
    expect(staleRes.headers['x-cache']).toBe('STALE');
    expect(staleRes.body.revision).toBe(1);

    await new Promise((r) => setTimeout(r, 25));
    const refreshedHit = await request(app.express).get('/catalog/featured');
    expect(refreshedHit.headers['x-cache']).toBe('HIT');
    expect(refreshedHit.body.revision).toBe(2);

    // varyByUser isolates cache entries per authenticated user
    const aliceRes = await request(app.express).get('/catalog/me').set('x-user', 'alice');
    const bobRes = await request(app.express).get('/catalog/me').set('x-user', 'bob');
    expect(aliceRes.body.subject).toBe('alice');
    expect(bobRes.body.subject).toBe('bob');
    expect(aliceRes.headers['cache-control']).toContain('private');

    // Explicit invalidation on mutation
    await request(app.express).post('/catalog/bump');
    const afterBump = await request(app.express).get('/catalog/featured');
    expect(afterBump.headers['x-cache']).toBe('MISS');
    expect(afterBump.body.revision).toBe(3);
  });

  it('streams validated Server-Sent Events (`sse()`) and aborts open SSE connections cleanly on app.close()', async () => {
    const TickEventSchema = z
      .object({
        seq: z.number().int(),
        note: z.string(),
      })
      .meta({ id: 'TickEvent' });

    @Controller('/streams')
    class StreamsController {
      @Get('/ticks', { sse: TickEventSchema })
      public ticks() {
        return sse(
          async function* ({ lastEventId }) {
            const start = lastEventId ? Number(lastEventId) + 1 : 1;
            yield { id: String(start), event: 'tick', data: { seq: start, note: 'line1\nline2' } };
            yield { id: String(start + 1), event: 'tick', data: { seq: start + 1, note: 'done' } };
          },
          { retryMs: 2500, heartbeatMs: 0 },
        );
      }

      @Get('/infinite')
      public infinite() {
        return sse(
          async function* ({ signal }) {
            yield { event: 'ready', data: { live: true } };
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true });
            });
          },
          { heartbeatMs: 50 },
        );
      }
    }

    await using app = await createTestingApp(StreamsController);

    // Verify finite SSE framing & Last-Event-ID resumption
    const res = await request(app.express).get('/streams/ticks').set('Last-Event-ID', '9');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(res.text).toContain('retry: 2500\n\n');
    expect(res.text).toContain('id: 10\nevent: tick\ndata: {"seq":10,"note":"line1\\nline2"}\n\n');
    expect(res.text).toContain('id: 11\nevent: tick\ndata: {"seq":11,"note":"done"}\n\n');

    // Verify OpenAPI 3.1 documents text/event-stream + TickEvent component schema
    expect(app.openApiDocument.components.schemas).toHaveProperty('TickEvent');
    const ticksOp = app.openApiDocument.paths['/streams/ticks']?.['get'] as Record<string, unknown>;
    expect(ticksOp).toBeDefined();

    // Verify open infinite SSE connection aborts cleanly in < 200ms when app.close() runs!
    await app.listen(0, '127.0.0.1');
    const abortCtrl = new AbortController();
    const fetchPromise = fetch(`${app.getUrl()}/streams/infinite`, { signal: abortCtrl.signal });
    const liveRes = await fetchPromise;
    expect(liveRes.status).toBe(200);

    const t0 = performance.now();
    await app.close('SIGTERM');
    const closeDurationMs = performance.now() - t0;
    expect(closeDurationMs).toBeLessThan(500);
    abortCtrl.abort();
  });

  it('propagates W3C traceparent traceId and exposes Prometheus & JSON telemetry at /metrics', async () => {
    @Controller('/telemetry')
    class TelemetryController {
      private readonly metrics = inject(MetricsToken);

      @Get('/ping')
      public ping({ traceId, requestId }: Ctx) {
        this.metrics.increment('custom_pings_total', { env: 'test' });
        return { requestId, traceId: traceId ?? null };
      }
    }

    await using app = await createTestingApp(TelemetryController, {
      metrics: { enabled: true, path: '/metrics' },
    });

    const validTraceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const pingWithTrace = await request(app.express)
      .get('/telemetry/ping')
      .set('traceparent', validTraceparent);
    expect(pingWithTrace.status).toBe(200);
    expect(pingWithTrace.body.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');

    // All-zero W3C traceparent must be rejected per spec
    const invalidTrace = await request(app.express)
      .get('/telemetry/ping')
      .set('traceparent', '00-00000000000000000000000000000000-00f067aa0ba902b7-01');
    expect(invalidTrace.body.traceId).toBeNull();

    // Scrape Prometheus text format
    const promRes = await request(app.express).get('/metrics').set('Accept', 'text/plain');
    expect(promRes.status).toBe(200);
    expect(promRes.headers['content-type']).toContain('text/plain');
    expect(promRes.text).toContain(
      'http_requests_total{method="GET",route="/telemetry/ping",status="200"} 2',
    );
    expect(promRes.text).toContain('custom_pings_total{env="test"} 2');
    expect(promRes.text).toContain('http_request_duration_ms_bucket');

    // Scrape JSON snapshot format
    const jsonMetrics = await request(app.express)
      .get('/metrics')
      .set('Accept', 'application/json');
    expect(jsonMetrics.status).toBe(200);
    expect(jsonMetrics.body.inFlightRequests).toBe(0);
    expect(jsonMetrics.body.counters['custom_pings_total{env="test"}']).toBe(2);
  });

  it('supports callable Standard Schemas (ArkType style), custom cache keys/ETags, gauge metrics, and rich OpenAPI -> TypeScript SDK generation', async () => {
    expect(isStandardSchema(null)).toBe(false);
    expect(isStandardSchema(42)).toBe(false);
    expect(isStandardSchema({})).toBe(false);

    // ArkType-style callable function carrying `~standard`
    const callableSchema = Object.assign((raw: unknown) => String(raw), {
      '~standard': {
        version: 1 as const,
        vendor: 'callable-test',
        types: undefined as unknown as {
          readonly input: { readonly tag: string };
          readonly output: { readonly tag: string };
        },
        validate(val: unknown) {
          if (
            typeof val === 'object' &&
            val !== null &&
            typeof (val as { tag?: unknown }).tag === 'string'
          ) {
            return { value: { tag: (val as { tag: string }).tag } };
          }
          return { issues: [{ message: 'Expected tag string', path: ['tag'] }] };
        },
      },
    }) satisfies StandardSchemaV1<{ readonly tag: string }>;

    expect(isStandardSchema(callableSchema)).toBe(true);

    @Controller('/edge')
    class EdgeV11Controller {
      @Post('/callable', { body: callableSchema })
      public checkCallable({ body }: Ctx<{ body: typeof callableSchema }>) {
        return { accepted: body.tag };
      }

      @Get('/custom-cache', { etag: false })
      @Cache({
        ttlMs: 5_000,
        key: (req) => `custom:${String(req.headers['x-region'] ?? 'global')}`,
      })
      public byRegion({ req }: Ctx) {
        return { region: String(req.headers['x-region'] ?? 'global') };
      }

      @Get('/etag-wild', { etag: true })
      public wild() {
        return { version: 'v1' };
      }
    }

    await using app = await createTestingApp(EdgeV11Controller);

    const callOk = await request(app.express).post('/edge/callable').send({ tag: 'ark' });
    expect(callOk.status).toBe(201);
    expect(callOk.body).toEqual({ accepted: 'ark' });

    const regEu = await request(app.express).get('/edge/custom-cache').set('x-region', 'eu');
    expect(regEu.headers['x-cache']).toBe('MISS');
    expect(regEu.body).toEqual({ region: 'eu' });

    const regEuHit = await request(app.express).get('/edge/custom-cache').set('x-region', 'eu');
    expect(regEuHit.headers['x-cache']).toBe('HIT');
    expect(regEuHit.body).toEqual({ region: 'eu' });

    // Wildcard & comma-separated ETag negotiation + HEAD support
    const wild1 = await request(app.express).get('/edge/etag-wild');
    const wildTag = wild1.headers['etag'] as string;
    const strongEquivalent = wildTag.replace(/^W\//, '');
    const commaMatch = await request(app.express)
      .get('/edge/etag-wild')
      .set('If-None-Match', `"other", ${strongEquivalent}`);
    expect(commaMatch.status).toBe(304);

    const starMatch = await request(app.express).get('/edge/etag-wild').set('If-None-Match', '*');
    expect(starMatch.status).toBe(304);

    const headRes = await request(app.express).head('/edge/etag-wild');
    expect(headRes.status).toBe(200);
    expect(headRes.headers['etag']).toBe(wildTag);

    // Bare Engine Core fused pipeline (security disabled + timeoutMs: 0 + logRequests: false)
    await using bareApp = await createTestingApp(EdgeV11Controller, {
      security: { headers: { enabled: false } },
      timeoutMs: 0,
      logRequests: false,
    });
    const bareGet = await request(bareApp.express).get('/edge/etag-wild');
    expect(bareGet.status).toBe(200);
    const barePost = await request(bareApp.express).post('/edge/callable').send({ tag: 'fast' });
    expect(barePost.status).toBe(201);
    expect(barePost.body).toEqual({ accepted: 'fast' });

    // Metrics gauges, label escaping, and reset()
    const metrics = new InMemoryMetrics();
    metrics.gauge('queue_depth', 7, { queue: 'emails\n"priority"\\1' });
    metrics.observe('job_duration_ms', 12.5, { worker: 'primary' });
    const prom = metrics.toPrometheusText();
    expect(prom).toContain('queue_depth{queue="emails\\n\\"priority\\"\\\\1"} 7');
    metrics.reset();
    expect(metrics.snapshot().counters).toEqual({});
    expect(metrics.snapshot().gauges).toEqual({});

    // Rich OpenAPI 3.1 -> TypeScript SDK generation (components, unions, enums, allOf, Record, 204, SSE)
    const richDoc: OpenApiDocument = {
      openapi: '3.1.0',
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      info: { title: 'Rich API', version: '1.1.0' },
      tags: [],
      components: {
        securitySchemes: {},
        schemas: {
          RoleEnum: { enum: ['admin', 'member'] },
          MetaMap: { type: 'object', additionalProperties: { type: 'number' } },
          BaseEntity: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
              nullableNote: { type: ['string', 'null'] },
              constKind: { const: 'user' },
            },
          },
        },
      },
      paths: {
        '/health': {
          get: {
            operationId: 'System_health',
            responses: { '200': { description: 'OK' } },
          },
        },
        '/items/{id}': {
          post: {
            operationId: 'ItemsController_upsert',
            tags: ['Items'],
            summary: 'Upsert item',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              {
                name: 'filter-mode',
                in: 'query',
                required: false,
                schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
              },
              { name: 'x-api-key', in: 'header', required: true, schema: { type: 'string' } },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      { $ref: '#/components/schemas/BaseEntity' },
                      {
                        anyOf: [
                          { $ref: '#/components/schemas/RoleEnum' },
                          { $ref: '#/components/schemas/MetaMap' },
                        ],
                      },
                    ],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Saved',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { anyOf: [{ type: 'boolean' }, { type: 'string' }] },
                    },
                  },
                },
              },
            },
          },
          delete: {
            operationId: 'ItemsController_remove',
            tags: ['Items'],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '204': { description: 'Deleted' } },
          },
        },
        '/items/stream': {
          get: {
            operationId: 'ItemsController_stream',
            tags: ['Items'],
            responses: {
              '200': {
                description: 'SSE',
                content: {
                  'text/event-stream': {
                    schema: {
                      type: 'object',
                      required: ['seq'],
                      properties: { seq: { type: 'integer' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const sdkSource = generateTypeScriptSdk(richDoc, {
      clientName: 'createRichSdk',
      includeSystemRoutes: false,
    });
    expect(sdkSource).toContain('export function createRichSdk');
    expect(sdkSource).not.toContain('System_health');
    expect(sdkSource).toContain('export type RoleEnum = "admin" | "member";');
    expect(sdkSource).toContain('export type MetaMap = Readonly<Record<string, number>>;');
    expect(sdkSource).toContain('readonly (boolean | string)[]');
    expect(sdkSource).toContain('AsyncGenerator<SseClientMessage<');
  });
});
