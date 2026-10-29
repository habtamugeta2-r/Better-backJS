import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BetterBack,
  CacheToken,
  Controller,
  createLogger,
  createPaginationQuerySchema,
  createTestingApp,
  defineConfig,
  Delete,
  Get,
  Guard,
  Head,
  inject,
  Injectable,
  InMemoryCache,
  MissingProviderError,
  Module,
  normalizeRouteSignature,
  NotFoundError,
  Options,
  paginate,
  Post,
  RateLimitExceededError,
  resolveForTest,
  resolveRoutePath,
  toExpressRouter,
  TooManyRequestsError,
  toProblemDetails,
  UnauthorizedError,
  UnprocessableEntityError,
  type AuthGuard,
  type Ctx,
  type GuardContext,
} from 'better-back';

describe('Production Edge Cases, SHA-256 Docs CSP, Versioning & Observability', () => {
  it('converts malformed JSON syntax into RFC 7807 400 BAD_REQUEST and supports 204 No Content', async () => {
    const CreateOrderBody = z.object({ sku: z.string().min(2) });

    @Controller({ prefix: '/orders', version: '2', tags: ['Orders'] })
    class OrdersController {
      @Post('/', {
        body: CreateOrderBody,
        rateLimit: { max: 50, windowMs: 60_000 },
      })
      public create({ body }: Ctx<typeof CreateOrderBody>) {
        if (body.sku === 'DISCONTINUED') {
          throw new UnprocessableEntityError('SKU is discontinued.');
        }
        return { created: body.sku };
      }

      @Delete('/:id', { status: 204 })
      public remove() {
        return undefined;
      }
    }

    await using app = await createTestingApp(OrdersController, { apiPrefix: '/api' });

    const malformed = await request(app.express)
      .post('/api/v2/orders')
      .set('Content-Type', 'application/json')
      .send('{"sku": "broken-json"');
    expect(malformed.status).toBe(400);
    expect(malformed.headers['content-type']).toContain('application/problem+json');
    expect(malformed.body.code).toBe('BAD_REQUEST');

    const unprocessable = await request(app.express)
      .post('/api/v2/orders')
      .send({ sku: 'DISCONTINUED' });
    expect(unprocessable.status).toBe(422);
    expect(unprocessable.body.code).toBe('UNPROCESSABLE_ENTITY');

    const okCreate = await request(app.express).post('/api/v2/orders').send({ sku: 'PRO-01' });
    expect(okCreate.status).toBe(201);
    expect(okCreate.body).toEqual({ created: 'PRO-01' });

    const deleted = await request(app.express).delete('/api/v2/orders/ord-1');
    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe('');

    expect(app.openApiDocument.paths['/health']).toBeDefined();
    expect(app.openApiDocument.paths['/ready']).toBeDefined();
    const postOrderOp = app.openApiDocument.paths['/api/v2/orders']?.['post'] as Record<
      string,
      unknown
    >;
    const responses = postOrderOp['responses'] as Record<string, unknown>;
    expect(responses['429']).toBeDefined();
  });

  it('serves /docs with strict SHA-256 CSP hashes (zero unsafe-inline) and configurable frameOptions', async () => {
    @Controller('/')
    class RootCtrl {
      @Get('/')
      public index() {
        return { root: true };
      }
    }

    await using sameOriginApp = await createTestingApp(RootCtrl, {
      security: { headers: { frameOptions: 'SAMEORIGIN' } },
      openapi: { title: 'Portal API', description: 'Internal docs' },
    });

    const docsRes = await request(sameOriginApp.express).get('/docs').set('Accept', 'text/html');
    expect(docsRes.status).toBe(200);
    const csp = docsRes.headers['content-security-policy'] ?? '';
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'self'");
    expect(docsRes.headers['x-frame-options']).toBe('SAMEORIGIN');

    const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(docsRes.text);
    const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(docsRes.text);
    expect(styleMatch?.[1]).toBeDefined();
    expect(scriptMatch?.[1]).toBeDefined();

    const expectedStyleHash = createHash('sha256').update(styleMatch![1]!, 'utf8').digest('base64');
    const expectedScriptHash = createHash('sha256')
      .update(scriptMatch![1]!, 'utf8')
      .digest('base64');
    expect(csp).toContain(`style-src 'sha256-${expectedStyleHash}'`);
    expect(csp).toContain(`script-src 'sha256-${expectedScriptHash}'`);

    await using embedApp = await createTestingApp(RootCtrl, {
      security: { headers: { frameOptions: false } },
    });
    const rootRes = await request(embedApp.express).get('/');
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers['x-frame-options']).toBeUndefined();
  });

  it('emits structured JSON request completion logs and exercises all Logger levels & redaction', async () => {
    const lines: string[] = [];
    const memoryStream = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        for (const line of text.split('\n')) {
          if (line.trim()) lines.push(line);
        }
        cb();
      },
    });

    const logger = createLogger({
      level: 'trace',
      name: 'audit-svc',
      redactPaths: ['payload.cardNumber'],
      destination: memoryStream,
    });

    logger.trace('trace-msg');
    logger.trace({ step: 1 }, 'trace-obj');
    logger.debug('debug-msg');
    logger.debug({ step: 2 }, 'debug-obj');
    logger.info('info-msg');
    logger.warn('warn-msg');
    logger.error('error-msg');
    logger.fatal('fatal-msg');
    logger.fatal({ payload: { cardNumber: '4111-2222-3333-4444' } }, 'card-attempt');
    const child = logger.child({ component: 'billing' });
    child.info('child-event');
    logger.flush();

    expect(lines.some((l) => l.includes('[REDACTED]') && !l.includes('4111-2222'))).toBe(true);

    @Controller('/logged')
    class LoggedCtrl {
      @Get('/')
      public ping() {
        return { logged: true };
      }
    }

    await using app = await BetterBack.create(LoggedCtrl, {
      logger: { level: 'info', destination: memoryStream },
      enableShutdownHooks: false,
    });

    const res = await request(app.express).get('/logged').set('X-Request-Id', 'req-trace-42');
    expect(res.status).toBe(200);

    const parsedLogs = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const completionLog = parsedLogs.find((entry) => entry['msg'] === 'request completed');
    expect(completionLog).toBeDefined();
    expect(completionLog?.['requestId']).toBe('req-trace-42');
    expect(completionLog?.['statusCode']).toBe(200);
    expect(typeof completionLog?.['durationMs']).toBe('number');
  });

  it('handles throwing HealthChecks, shutdown drain /health vs /ready semantics, and pagination', async () => {
    expect(resolveRoutePath({ controllerPrefix: '/', routePath: '/' })).toBe('/');
    expect(resolveRoutePath({ version: 'v1', controllerPrefix: '/a/', routePath: '/' })).toBe(
      '/v1/a',
    );
    expect(normalizeRouteSignature('get', '/')).toBe('GET /');

    const PageQuery = createPaginationQuerySchema({ defaultLimit: 10, maxLimit: 25 });
    const parsedPage = PageQuery.parse({ page: '2', limit: '10' });
    const emptyEnvelope = paginate([], 0, { page: 1, limit: 10 });
    expect(emptyEnvelope.meta.totalPages).toBe(0);
    expect(emptyEnvelope.meta.hasNextPage).toBe(false);

    const midEnvelope = paginate(['a', 'b'], 25, parsedPage);
    expect(midEnvelope.meta.totalPages).toBe(3);
    expect(midEnvelope.meta.hasPrevPage).toBe(true);
    expect(midEnvelope.meta.hasNextPage).toBe(true);

    const pd = toProblemDetails(new Error('boom'), '/orders', 'req-99');
    expect(pd.status).toBe(500);
    expect(pd.code).toBe('INTERNAL_ERROR');

    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((r) => {
      releaseSlow = r;
    });

    @Controller('/work')
    class WorkCtrl {
      @Get('/hold')
      public async hold() {
        await slowGate;
        return { done: true };
      }
    }
    @Module({ controllers: [WorkCtrl] })
    class WorkMod {}

    const app = await BetterBack.create(WorkMod, {
      logger: { level: 'silent' },
      enableShutdownHooks: false,
      shutdownTimeoutMs: 2_000,
      healthChecks: [
        {
          name: 'redis',
          check: () => {
            throw new Error('ECONNREFUSED 127.0.0.1:6379');
          },
        },
      ],
    });

    expect(() => app.getUrl()).toThrow(/not listening/);
    expect(app.port).toBeUndefined();

    const failingReady = await request(app.express).get('/ready');
    expect(failingReady.status).toBe(503);

    await app.listen(0, '127.0.0.1');
    expect(typeof app.port).toBe('number');
    expect(app.port).toBeGreaterThan(0);
    const baseUrl = app.getUrl();
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const inFlight = fetch(`${baseUrl}/work/hold`);
    await new Promise((r) => setTimeout(r, 25));

    const closeTask = app.close('SIGTERM');
    await new Promise((r) => setTimeout(r, 10));

    const healthDuringDrain = await request(app.express).get('/health');
    expect(healthDuringDrain.status).toBe(200);

    const readyDuringDrain = await request(app.express).get('/ready');
    expect(readyDuringDrain.status).toBe(503);

    const newReqDuringDrain = await request(app.express).get('/work/hold');
    expect(newReqDuringDrain.status).toBe(503);
    expect(newReqDuringDrain.headers['connection']).toBe('close');

    releaseSlow();
    const drained = await inFlight;
    expect(drained.status).toBe(200);
    await closeTask;
    expect(app.port).toBeUndefined();
  });

  it('supports CacheToken / InMemoryCache, @Head/@Options decorators, LoadedConfig overrides, and IPv6 getUrl()', async () => {
    expect(TooManyRequestsError).toBe(RateLimitExceededError);

    // Bounded TTL-aware InMemoryCache unit checks
    const cache = new InMemoryCache(2);
    cache.set('k1', 'v1', 20);
    cache.set('k2', 'v2');
    cache.set('k3', 'v3'); // evicts oldest k1/k2 when full
    expect(cache.get('k3')).toBe('v3');
    cache.del('k3');
    expect(cache.get('k3')).toBeUndefined();
    cache.set('short', 42, 15);
    await new Promise((r) => setTimeout(r, 25));
    expect(cache.get('short')).toBeUndefined();
    cache.set('temp', 'ok');
    cache.clear();
    expect(cache.get('temp')).toBeUndefined();

    // Direct LoadedConfig.from(...) passed in `resolveForTest` overrides without `.values`
    const FeatureCfg = defineConfig(z.object({ FEATURE_FLAG: z.string() }));

    @Injectable()
    class FeatureSvc {
      private readonly cfg = inject(FeatureCfg);
      public flag(): string {
        return this.cfg.FEATURE_FLAG;
      }
    }

    const svc = resolveForTest(FeatureSvc, [
      [FeatureCfg, FeatureCfg.from({ FEATURE_FLAG: 'beta' })],
    ]);
    expect(svc.flag()).toBe('beta');

    // Auto-injected CacheToken + @Head / @Options decorators + IPv6 bracketed getUrl()
    @Controller('/meta')
    class MetaCtrl {
      private readonly appCache = inject(CacheToken);

      @Head('/check', { status: 204 })
      public check({ res }: Ctx) {
        this.appCache.set('checked', true);
        res.setHeader('X-Meta-Present', '1');
      }

      @Options('/capabilities')
      public capabilities({ res }: Ctx) {
        res.setHeader('Allow', 'GET, HEAD, OPTIONS');
        return { cached: Boolean(this.appCache.get('checked')) };
      }
    }

    await using app = await createTestingApp(MetaCtrl);
    const headRes = await request(app.express).head('/meta/check');
    expect(headRes.status).toBe(204);
    expect(headRes.headers['x-meta-present']).toBe('1');

    // Note: global security middleware only short-circuits OPTIONS when CORS is enabled;
    // when CORS is disabled (default), @Options route handlers execute directly!
    const optRes = await request(app.express).options('/meta/capabilities');
    expect(optRes.status).toBe(200);
    expect(optRes.headers['allow']).toBe('GET, HEAD, OPTIONS');
    expect(optRes.body).toEqual({ cached: true });

    await app.listen(0, '::1');
    expect(app.getUrl()).toMatch(/^http:\/\/\[::1\]:\d+$/);
  });

  it('enforces @Module encapsulation + single-instance singletons on @Guard classes, preserves @Options under CORS, and powers full toExpressRouter() adoption', async () => {
    let guardInstances = 0;

    @Injectable()
    class SharedTokenGuard implements AuthGuard<{ sub: string }> {
      public constructor() {
        guardInstances += 1;
      }

      public canActivate({ req }: GuardContext): { sub: string } {
        if (req.headers.authorization !== 'Bearer ok') {
          throw new UnauthorizedError('Bad token');
        }
        return { sub: 'u-1' };
      }
    }

    // 1. Missing guard provider/import in an explicit @Module must fail fast with MissingProviderError!
    @Controller('/unwired')
    class UnwiredCtrl {
      @Get('/')
      @Guard(SharedTokenGuard)
      public get() {
        return { ok: true };
      }
    }

    @Module({ controllers: [UnwiredCtrl] })
    class BrokenModule {}

    await expect(createTestingApp(BrokenModule)).rejects.toThrowError(MissingProviderError);

    // 2. When exported from AuthMod and imported into two distinct modules, SharedTokenGuard is instantiated ONCE!
    guardInstances = 0;

    @Module({ providers: [SharedTokenGuard], exports: [SharedTokenGuard] })
    class AuthMod {}

    @Controller('/orders')
    class OrdersCtrl {
      @Get('/')
      @Guard(SharedTokenGuard)
      public list() {
        return { resource: 'orders' };
      }
    }
    @Module({ imports: [AuthMod], controllers: [OrdersCtrl] })
    class OrdersMod {}

    @Controller('/invoices')
    class InvoicesCtrl {
      @Get('/')
      @Guard(SharedTokenGuard)
      public list() {
        return { resource: 'invoices' };
      }
    }
    @Module({ imports: [AuthMod], controllers: [InvoicesCtrl] })
    class InvoicesMod {}

    @Module({ imports: [OrdersMod, InvoicesMod] })
    class RootEncapsulatedMod {}

    await using sharedGuardApp = await createTestingApp(RootEncapsulatedMod);
    expect(guardInstances).toBe(1);

    const ordersRes = await request(sharedGuardApp.express)
      .get('/orders')
      .set('Authorization', 'Bearer ok');
    const invoicesRes = await request(sharedGuardApp.express)
      .get('/invoices')
      .set('Authorization', 'Bearer ok');
    expect(ordersRes.status).toBe(200);
    expect(invoicesRes.status).toBe(200);
    expect(guardInstances).toBe(1);

    // 3. Duplicate @Module class names across distinct constructors fail fast at boot
    const makeDup = () => {
      @Module({})
      class DupMod {}
      return DupMod;
    };
    const DupA = makeDup();
    const DupB = makeDup();
    @Module({ imports: [DupA, DupB] })
    class CollidingRoot {}
    await expect(createTestingApp(CollidingRoot)).rejects.toThrow(/share the name "DupMod"/);

    // 4. @Options route executes even when CORS + Origin are active (unless Access-Control-Request-Method makes it a preflight)
    @Controller('/caps')
    class CapsCtrl {
      @Options('/info')
      public info({ res }: Ctx) {
        res.setHeader('Allow', 'GET, POST, OPTIONS');
        return { methods: ['GET', 'POST', 'OPTIONS'] };
      }
    }

    await using corsOptsApp = await createTestingApp(CapsCtrl, {
      security: { cors: { origins: ['https://portal.example.com'] } },
    });

    const directOptionsWithOrigin = await request(corsOptsApp.express)
      .options('/caps/info')
      .set('Origin', 'https://portal.example.com');
    expect(directOptionsWithOrigin.status).toBe(200);
    expect(directOptionsWithOrigin.headers['access-control-allow-origin']).toBe(
      'https://portal.example.com',
    );
    expect(directOptionsWithOrigin.body).toEqual({ methods: ['GET', 'POST', 'OPTIONS'] });

    const realPreflight = await request(corsOptsApp.express)
      .options('/caps/info')
      .set('Origin', 'https://portal.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(realPreflight.status).toBe(204);

    // 5. First-class toExpressRouter() inside a bare Express 5 app (safe JSON body parsing + config + guard + RFC 7807 errors)
    const SubConfig = defineConfig(z.object({ PREFIX_TAG: z.string() }));
    const CreateWidgetSchema = z.object({ title: z.string().min(2) });

    @Controller('/widgets')
    class WidgetsCtrl {
      private readonly cfg = inject(SubConfig);

      @Post('/', { body: CreateWidgetSchema })
      public create({ body }: Ctx<typeof CreateWidgetSchema>) {
        if (body.title === 'missing') {
          throw new NotFoundError('Widget template missing');
        }
        return { label: `${this.cfg.PREFIX_TAG}:${body.title}` };
      }
    }

    @Module({ controllers: [WidgetsCtrl] })
    class WidgetsMod {}

    const legacyExpress = express();
    const router = await toExpressRouter(WidgetsMod, {
      config: SubConfig.from({ PREFIX_TAG: 'v1' }),
      logger: createLogger({ level: 'silent' }),
      guard: ({ req }) => {
        if (req.headers['x-api-key'] !== 'secret') {
          throw new UnauthorizedError('Missing X-Api-Key');
        }
      },
    });
    legacyExpress.use('/embedded', router);

    const unauthWidget = await request(legacyExpress)
      .post('/embedded/widgets')
      .send({ title: 'Gear' });
    expect(unauthWidget.status).toBe(401);
    expect(unauthWidget.headers['content-type']).toContain('application/problem+json');

    const invalidWidget = await request(legacyExpress)
      .post('/embedded/widgets')
      .set('X-Api-Key', 'secret')
      .send({ title: 'x' });
    expect(invalidWidget.status).toBe(400);
    expect(invalidWidget.body.code).toBe('VALIDATION_ERROR');

    const okWidget = await request(legacyExpress)
      .post('/embedded/widgets')
      .set('X-Api-Key', 'secret')
      .send({ title: 'Gear' });
    expect(okWidget.status).toBe(201);
    expect(okWidget.body).toEqual({ label: 'v1:Gear' });
  });
});
