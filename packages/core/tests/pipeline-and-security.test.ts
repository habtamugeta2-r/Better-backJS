import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BetterBack,
  Controller,
  createTestingApp,
  DuplicateRouteError,
  ForbiddenError,
  Get,
  Guard,
  InMemoryRateLimiter,
  Module,
  NotFoundError,
  Post,
  Public,
  SecurityConfigError,
  toExpressRouter,
  UnauthorizedError,
  Use,
  type Ctx,
  type GuardContext,
} from 'better-back';

describe('Pipeline, Composable Guards, Proxy-Safe Rate Limits, OpenAPI 3.1 & Shutdown', () => {
  it('sets OWASP security headers, disables x-powered-by, and denies cross-origin CORS by default', async () => {
    @Controller('/ping')
    class PingController {
      @Get('/', { response: z.object({ ok: z.boolean() }) })
      public ping() {
        return { ok: true };
      }
    }

    await using app = await createTestingApp(PingController);

    const res = await request(app.express).get('/ping').set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9._:-]+$/);
  });

  it('rejects wildcard CORS combined with credentials: true at startup', async () => {
    @Module()
    class BadCorsMod {}

    await expect(
      BetterBack.create(BadCorsMod, {
        security: { cors: { origins: '*', credentials: true } },
      }),
    ).rejects.toThrowError(SecurityConfigError);
  });

  it('sanitizes malicious / oversized x-request-id headers', async () => {
    @Controller('/echo-id')
    class EchoController {
      @Get('/')
      public echo({ requestId }: Ctx) {
        return { requestId };
      }
    }

    await using app = await createTestingApp(EchoController);

    const badInjectionId = '<script>alert(1)</script>;drop-table';
    const res1 = await request(app.express).get('/echo-id').set('x-request-id', badInjectionId);
    expect(res1.status).toBe(200);
    expect(res1.body.requestId).not.toBe(badInjectionId);
    expect(res1.headers['x-request-id']).toBe(res1.body.requestId);

    const oversizedId = 'a'.repeat(250);
    const res2 = await request(app.express).get('/echo-id').set('x-request-id', oversizedId);
    expect(res2.status).toBe(200);
    expect(res2.body.requestId).not.toBe(oversizedId);
    expect(res2.body.requestId.length).toBeLessThanOrEqual(128);
  });

  it('strips __proto__ / constructor / prototype keys to block prototype pollution', async () => {
    @Controller('/inspect')
    class InspectController {
      @Post('/')
      public inspect({ body }: Ctx) {
        const obj = body as Record<string, unknown>;
        return {
          ownKeys: Object.keys(obj),
          globalPolluted: ({} as Record<string, unknown>)['polluted'] ?? null,
        };
      }
    }

    await using app = await createTestingApp(InspectController);

    const rawMaliciousJson =
      '{"safe":"ok","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}';

    const res = await request(app.express)
      .post('/inspect')
      .set('Content-Type', 'application/json')
      .send(rawMaliciousJson);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ownKeys: ['safe'],
      globalPolluted: null,
    });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('returns RFC 7807 Problem Details on malformed JSON (400), oversized payloads (413), and async Zod refinements', async () => {
    const AsyncSlugBody = z.object({
      text: z.string().refine(async (val) => val !== 'reserved-async', {
        message: 'Slug is reserved asynchronously',
      }),
    });

    @Controller('/payload')
    class PayloadController {
      @Post('/', { body: AsyncSlugBody })
      public echo({ body }: Ctx<typeof AsyncSlugBody>) {
        return body;
      }
    }

    await using app = await createTestingApp(PayloadController, {
      bodyLimit: '128b',
    });

    const malformed = await request(app.express)
      .post('/payload')
      .set('Content-Type', 'application/json')
      .send('{"text": broken}');

    expect(malformed.status).toBe(400);
    expect(malformed.headers['content-type']).toContain('application/problem+json');
    expect(malformed.body.code).toBe('BAD_REQUEST');

    const asyncInvalid = await request(app.express)
      .post('/payload')
      .send({ text: 'reserved-async' });
    expect(asyncInvalid.status).toBe(400);
    expect(asyncInvalid.body.code).toBe('VALIDATION_ERROR');

    const oversized = await request(app.express)
      .post('/payload')
      .send({ text: 'x'.repeat(500) });

    expect(oversized.status).toBe(413);
    expect(oversized.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('catches async handler throws without hanging or leaking stack traces', async () => {
    @Controller('/boom')
    class BoomController {
      @Get('/domain')
      public async domainFail() {
        await Promise.resolve();
        throw new NotFoundError('Invoice 99 does not exist.');
      }

      @Get('/crash')
      public async unexpectedCrash() {
        await Promise.resolve();
        throw new Error('SELECT * FROM users WHERE secret_key = 12345 failed at /srv/db.ts:44');
      }
    }

    await using app = await createTestingApp(BoomController);

    const domainRes = await request(app.express).get('/boom/domain');
    expect(domainRes.status).toBe(404);
    expect(domainRes.body).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Invoice 99 does not exist.',
      instance: '/boom/domain',
    });
    expect(domainRes.body.stack).toBeUndefined();

    const crashRes = await request(app.express).get('/boom/crash');
    expect(crashRes.status).toBe(500);
    expect(crashRes.body.code).toBe('INTERNAL_ERROR');
    expect(crashRes.body.detail).toBe('An unexpected internal error occurred.');
    expect(JSON.stringify(crashRes.body)).not.toContain('secret_key');
    expect(JSON.stringify(crashRes.body)).not.toContain('/srv/db.ts');
  });

  it('aborts slow async handlers with 408 Request Timeout Problem Details, triggers ctx.signal, and ignores late writes', async () => {
    let lateWriteCompleted = false;
    let signalAborted = false;

    @Controller('/slow')
    class SlowController {
      @Get('/', { timeoutMs: 35 })
      public async wait({ signal }: Ctx) {
        signal.addEventListener('abort', () => {
          signalAborted = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 90));
        lateWriteCompleted = true;
        return { done: true };
      }
    }

    await using app = await createTestingApp(SlowController);

    const res = await request(app.express).get('/slow');
    expect(res.status).toBe(408);
    expect(res.body.code).toBe('REQUEST_TIMEOUT');

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(signalAborted).toBe(true);
    expect(lateWriteCompleted).toBe(true);
  });

  it('detects duplicate normalized routes across controllers at startup', async () => {
    @Controller('/items')
    class CtrlA {
      @Get('/:id')
      public byId({ params }: Ctx<'/:id'>) {
        return { id: params.id };
      }
    }

    @Controller('/items')
    class CtrlB {
      @Get('/:itemId')
      public byItemId({ params }: Ctx<'/:itemId'>) {
        return { id: params.itemId };
      }
    }

    @Module({ controllers: [CtrlA, CtrlB] })
    class DupMod {}

    await expect(createTestingApp(DupMod)).rejects.toThrowError(DuplicateRouteError);
  });

  it('isolates rate-limit buckets per route and honors trustProxy X-Forwarded-For client IPs', async () => {
    const limiter = new InMemoryRateLimiter(20);

    @Controller('/auth')
    class AuthRateController {
      @Post('/otp', {
        rateLimit: { max: 2, windowMs: 10_000 },
      })
      public sendOtp({ req }: Ctx) {
        return { sent: true, ip: req.ip };
      }

      @Post('/login', {
        rateLimit: { max: 2, windowMs: 10_000 },
      })
      public login({ req }: Ctx) {
        return { loggedIn: true, ip: req.ip };
      }
    }

    await using app = await createTestingApp(AuthRateController, {
      trustProxy: 1,
      rateLimiter: limiter,
    });

    // Client A exhausts POST /auth/otp (2 allowed, 3rd -> 429)
    const r1 = await request(app.express).post('/auth/otp').set('X-Forwarded-For', '203.0.113.10');
    expect(r1.status).toBe(201);
    expect(r1.body.ip).toBe('203.0.113.10');

    expect(
      (await request(app.express).post('/auth/otp').set('X-Forwarded-For', '203.0.113.10')).status,
    ).toBe(201);

    const blockedClientA = await request(app.express)
      .post('/auth/otp')
      .set('X-Forwarded-For', '203.0.113.10');
    expect(blockedClientA.status).toBe(429);
    expect(blockedClientA.body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(Number(blockedClientA.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    // 1. Per-route isolation: Client A can STILL call POST /auth/login (separate route bucket!)
    const loginClientA = await request(app.express)
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.10');
    expect(loginClientA.status).toBe(201);

    // 2. Reverse-proxy IP isolation: Client B (different X-Forwarded-For) can STILL call POST /auth/otp!
    const otpClientB = await request(app.express)
      .post('/auth/otp')
      .set('X-Forwarded-For', '198.51.100.42');
    expect(otpClientB.status).toBe(201);
    expect(otpClientB.body.ip).toBe('198.51.100.42');
  });

  it('hoists .meta({ id }) schemas into OpenAPI #/components/schemas, documents errors, and supports toExpressRouter()', async () => {
    let dbHealthy = true;
    const ItemSchema = z
      .object({ id: z.string(), title: z.string() })
      .meta({ id: 'CatalogItem', description: 'Catalog item entity' });

    @Controller({ prefix: '/items', version: '1', tags: ['Items'] })
    class ItemsController {
      @Get('/:id', {
        summary: 'Fetch item by ID',
        response: ItemSchema,
        errors: [404],
      })
      @Guard(({ req }) => {
        if (req.headers.authorization !== 'Bearer ok') {
          throw new UnauthorizedError();
        }
        return { sub: 'u1' };
      })
      public getItem({ params }: Ctx<{ params: '/:id'; user: { sub: string } }>) {
        return { id: params.id, title: 'Book' };
      }
    }

    @Module({ controllers: [ItemsController] })
    class ItemsMod {}

    await using app = await createTestingApp(ItemsMod, {
      apiPrefix: '/api',
      healthChecks: [
        {
          name: 'postgres',
          check: () => ({ healthy: dbHealthy, detail: dbHealthy ? 'connected' : 'timeout' }),
        },
      ],
      openapi: { title: 'Items Service', version: '2.0.0' },
    });

    expect((await request(app.express).get('/health')).status).toBe(200);
    expect((await request(app.express).get('/ready')).status).toBe(200);

    dbHealthy = false;
    const unready = await request(app.express).get('/ready');
    expect(unready.status).toBe(503);
    expect(unready.body.code).toBe('SERVICE_UNAVAILABLE');

    const specRes = await request(app.express).get('/docs').set('Accept', 'application/json');
    expect(specRes.status).toBe(200);
    expect(specRes.body.openapi).toBe('3.1.0');
    // Verify `CatalogItem` hoisted into `#/components/schemas/CatalogItem` + `$ref` + `404` ProblemDetails!
    expect(specRes.body.components.schemas.CatalogItem).toBeDefined();
    const getItemOp = specRes.body.paths['/api/v1/items/{id}'].get;
    expect(getItemOp.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CatalogItem',
    });
    expect(getItemOp.responses['404'].content['application/problem+json'].schema).toEqual({
      $ref: '#/components/schemas/ProblemDetails',
    });

    const htmlRes = await request(app.express).get('/docs').set('Accept', 'text/html');
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers['content-type']).toContain('text/html');
    expect(htmlRes.text).toContain('Items Service');

    // Zero-lock-in toExpressRouter() mounted into a plain Express app
    const plainExpress = express();
    plainExpress.use('/mounted', await toExpressRouter(ItemsMod));
    const mountedRes = await request(plainExpress)
      .get('/mounted/v1/items/abc')
      .set('Authorization', 'Bearer ok');
    expect(mountedRes.status).toBe(200);
    expect(mountedRes.body).toEqual({ id: 'abc', title: 'Book' });
  });

  it('drains in-flight requests cleanly on graceful close()', async () => {
    let finishedSlowHandler = false;
    let markEntered!: () => void;
    const enteredHandler = new Promise<void>((resolve) => {
      markEntered = resolve;
    });

    @Controller('/work')
    class DrainController {
      @Get('/')
      public async run() {
        markEntered();
        await new Promise((resolve) => setTimeout(resolve, 60));
        finishedSlowHandler = true;
        return { completed: true };
      }
    }

    const app = await BetterBack.create(DrainController, {
      logger: { level: 'silent' },
      enableShutdownHooks: false,
    });
    await app.listen(0, '127.0.0.1');
    const baseUrl = app.getUrl();

    const inFlightFetch = fetch(`${baseUrl}/work`);
    await enteredHandler;

    const closeTask = app.close('SIGTERM');
    const response = await inFlightFetch;
    const payload = (await response.json()) as { completed: boolean };
    await closeTask;

    expect(response.status).toBe(200);
    expect(payload.completed).toBe(true);
    expect(finishedSlowHandler).toBe(true);
  });

  it('chains guards in deterministic order (global -> controller -> method), passes upstream ctx.user, and honors @Public()', async () => {
    const executionOrder: string[] = [];

    interface AuthPrincipal {
      readonly tenantId: string;
      readonly roles: readonly string[];
      readonly mfaVerified?: boolean;
    }

    const globalTenantGuard = ({ req }: GuardContext): AuthPrincipal => {
      executionOrder.push('1:global');
      const tenant = req.headers['x-tenant-id'];
      if (typeof tenant !== 'string' || !tenant) {
        throw new UnauthorizedError('Missing X-Tenant-Id header.');
      }
      return {
        tenantId: tenant,
        roles: req.headers['x-role'] === 'superadmin' ? ['admin', 'superadmin'] : ['admin'],
      };
    };

    const controllerAuthGuard = ({ req, user }: GuardContext<AuthPrincipal>): void => {
      executionOrder.push(`2:controller(${user.tenantId})`);
      if (req.headers.authorization !== 'Bearer admin-key') {
        throw new ForbiddenError('Admin key required.');
      }
    };

    const requireSuperAdminGuard = ({ user }: GuardContext<AuthPrincipal>): void => {
      executionOrder.push('3:method-role');
      if (!user.roles.includes('superadmin')) {
        throw new ForbiddenError('Superadmin role required.');
      }
    };

    const mfaEnrichGuard = ({ user }: GuardContext<AuthPrincipal>): AuthPrincipal => {
      executionOrder.push('4:method-mfa');
      return { ...user, mfaVerified: true };
    };

    const methodFlagMiddleware: express.RequestHandler = (_req, res, next) => {
      res.setHeader('X-Method-Hook', 'active');
      next();
    };

    const HeadersSchema = z.object({ 'x-client-version': z.string().min(3) });

    @Controller('/admin')
    @Guard(controllerAuthGuard)
    class AdminController {
      @Get('/public-ping')
      @Public()
      @Use(methodFlagMiddleware)
      public publicPing() {
        return { public: true };
      }

      @Get('/headers-check', {
        headers: HeadersSchema,
        response: z.object({
          clientVersion: z.string(),
          tenantId: z.string(),
          mfaVerified: z.boolean(),
        }),
      })
      @Guard(requireSuperAdminGuard, mfaEnrichGuard)
      public checkHeaders({
        headers,
        user,
      }: Ctx<{ headers: typeof HeadersSchema; user: AuthPrincipal }>) {
        return {
          clientVersion: headers['x-client-version'],
          tenantId: user.tenantId,
          mfaVerified: Boolean(user.mfaVerified),
        };
      }

      // @ts-expect-error — intentionally bypassing compile-time return type check to verify runtime 500 defense
      @Get('/broken-response', {
        response: z.object({ count: z.number() }),
      })
      public brokenResponse(): unknown {
        return { count: 'not-a-number' };
      }
    }

    const limiter = new InMemoryRateLimiter(2);
    limiter.consume('ip-1', 5, 60_000);
    limiter.consume('ip-2', 5, 60_000);
    const thirdKeyDecision = limiter.consume('ip-3', 5, 60_000);
    expect(thirdKeyDecision.allowed).toBe(true);

    await using app = await createTestingApp(AdminController, {
      guard: globalTenantGuard,
      security: {
        cors: {
          origins: ['https://admin.example.com'],
          credentials: true,
        },
      },
    });

    const preflightAllowed = await request(app.express)
      .options('/admin/public-ping')
      .set('Origin', 'https://admin.example.com');
    expect(preflightAllowed.status).toBe(204);
    expect(preflightAllowed.headers['access-control-allow-origin']).toBe(
      'https://admin.example.com',
    );
    expect(preflightAllowed.headers['access-control-allow-credentials']).toBe('true');

    const preflightBlocked = await request(app.express)
      .options('/admin/public-ping')
      .set('Origin', 'https://attacker.example.com');
    expect(preflightBlocked.status).toBe(204);
    expect(preflightBlocked.headers['access-control-allow-origin']).toBeUndefined();

    // @Public() bypasses global + controller + method guards completely!
    const pubRes = await request(app.express).get('/admin/public-ping');
    expect(pubRes.status).toBe(200);
    expect(pubRes.headers['x-method-hook']).toBe('active');
    expect(pubRes.body).toEqual({ public: true });
    expect(executionOrder).toEqual([]);

    // Missing controller Bearer token -> global runs, controller throws 403 (method guards NOT reached)
    const missingBearerRes = await request(app.express)
      .get('/admin/headers-check')
      .set('X-Tenant-Id', 'acme');
    expect(missingBearerRes.status).toBe(403);
    expect(executionOrder).toEqual(['1:global', '2:controller(acme)']);

    // Valid controller Bearer token, but non-superadmin role -> method guard 1 throws 403!
    executionOrder.length = 0;
    const nonSuperAdminRes = await request(app.express)
      .get('/admin/headers-check')
      .set('X-Tenant-Id', 'acme')
      .set('Authorization', 'Bearer admin-key')
      .set('x-client-version', '1.2.0');
    expect(nonSuperAdminRes.status).toBe(403);
    expect(executionOrder).toEqual(['1:global', '2:controller(acme)', '3:method-role']);

    // Header validation failure after full guard chain passes -> 400 ValidationError
    executionOrder.length = 0;
    const badHeaderRes = await request(app.express)
      .get('/admin/headers-check')
      .set('X-Tenant-Id', 'acme')
      .set('X-Role', 'superadmin')
      .set('Authorization', 'Bearer admin-key')
      .set('x-client-version', '1');
    expect(badHeaderRes.status).toBe(400);
    expect(badHeaderRes.body.errors[0].location).toBe('headers');
    expect(executionOrder).toEqual([
      '1:global',
      '2:controller(acme)',
      '3:method-role',
      '4:method-mfa',
    ]);

    // Full guard chain + valid header -> 200 with enriched `user`!
    executionOrder.length = 0;
    const okHeaderRes = await request(app.express)
      .get('/admin/headers-check')
      .set('X-Tenant-Id', 'acme')
      .set('X-Role', 'superadmin')
      .set('Authorization', 'Bearer admin-key')
      .set('x-client-version', '1.2.0');
    expect(okHeaderRes.status).toBe(200);
    expect(okHeaderRes.body).toEqual({
      clientVersion: '1.2.0',
      tenantId: 'acme',
      mfaVerified: true,
    });
    expect(executionOrder).toEqual([
      '1:global',
      '2:controller(acme)',
      '3:method-role',
      '4:method-mfa',
    ]);

    // Response contract violation -> sanitized 500 InternalServerError
    const badOutputRes = await request(app.express)
      .get('/admin/broken-response')
      .set('X-Tenant-Id', 'acme')
      .set('Authorization', 'Bearer admin-key');
    expect(badOutputRes.status).toBe(500);
    expect(badOutputRes.body.code).toBe('INTERNAL_ERROR');
  });
});
