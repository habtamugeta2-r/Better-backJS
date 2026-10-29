import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BetterBack,
  ConfigValidationError,
  Controller,
  createLogger,
  createTestingApp,
  defineConfig,
  Get,
  inject,
} from 'better-back';

describe('Import-Safe & Fail-Fast Config Validation, Direct inject(AppConfig) & Secret Redaction', () => {
  const schema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    JWT_SECRET: z.string().min(16),
    LOG_LEVEL: z.enum(['info', 'debug', 'warn']).default('info'),
  });

  it('merges profile defaults, coerces env values, deep-freezes the result, and injects directly via inject(AppConfig)', async () => {
    const cfg = defineConfig({
      schema,
      profiles: {
        production: { LOG_LEVEL: 'warn', PORT: 8080 },
        development: { LOG_LEVEL: 'debug' },
      },
      env: {
        NODE_ENV: 'production',
        JWT_SECRET: 'super-secret-jwt-signing-key-1234',
      },
    });

    expect(cfg.profile).toBe('production');
    expect(cfg.values.PORT).toBe(8080);
    expect(cfg.values.LOG_LEVEL).toBe('warn');
    expect(cfg.secretKeys).toContain('JWT_SECRET');
    expect(Object.isFrozen(cfg.values)).toBe(true);

    expect(() => {
      (cfg.values as Record<string, unknown>)['PORT'] = 9999;
    }).toThrow();

    // Direct schema shorthand + `.from()` env override preserving DI token identity
    const QuickConfig = defineConfig(
      z.object({ APP_NAME: z.string().default('better-back-demo') }),
    );

    @Controller('/cfg')
    class ConfigCtrl {
      private readonly conf = inject(QuickConfig);

      @Get('/')
      public read() {
        return { appName: this.conf.APP_NAME };
      }
    }

    await using app = await createTestingApp(ConfigCtrl, {
      config: QuickConfig.from({ APP_NAME: 'overridden-in-test' }),
    });

    const res = await request(app.express).get('/cfg');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ appName: 'overridden-in-test' });
  });

  it('is import-safe when required prod vars are absent from process.env, yet fails fast on BetterBack.create() or .values', async () => {
    // Must NOT throw when defined at module import time even though REQUIRED_PROD_DB_URL is unset!
    const StrictProdConfig = defineConfig(
      z.object({
        REQUIRED_PROD_DB_URL: z.url(),
        REQUIRED_PROD_JWT_SECRET: z.string().min(24),
      }),
    );

    @Controller('/strict-cfg')
    class StrictConfigController {
      private readonly cfg = inject(StrictProdConfig);

      @Get('/')
      public status() {
        return { dbHost: new URL(this.cfg.REQUIRED_PROD_DB_URL).hostname };
      }
    }

    // 1. Fails fast at startup if booted without valid env (both with `{ config }` and via auto-resolved DI token)
    await expect(
      BetterBack.create(StrictConfigController, { config: StrictProdConfig }),
    ).rejects.toThrowError(ConfigValidationError);

    await expect(BetterBack.create(StrictConfigController)).rejects.toThrowError(
      ConfigValidationError,
    );

    // 2. Succeeds cleanly in tests when `.from(testEnv)` supplies test config values!
    await using testApp = await createTestingApp(StrictConfigController, {
      config: StrictProdConfig.from({
        REQUIRED_PROD_DB_URL: 'postgres://db.internal:5432/app',
        REQUIRED_PROD_JWT_SECRET: 'test-only-jwt-secret-key-2026!!',
      }),
    });

    const okRes = await request(testApp.express).get('/strict-cfg');
    expect(okRes.status).toBe(200);
    expect(okRes.body).toEqual({ dbHost: 'db.internal' });
  });

  it('fails loudly at startup and redacts raw secret values from error diagnostics', () => {
    const leakedSecretCandidate = 'my-short-secret';
    let caught: unknown;

    try {
      defineConfig({
        schema: z.object({
          JWT_SECRET: z.string().refine((v) => v.length >= 32, {
            error: (iss) => `Invalid secret ${String(iss.input)}`,
          }),
        }),
        env: { JWT_SECRET: leakedSecretCandidate },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigValidationError);
    const message = (caught as Error).message;
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('[REDACTED]');
    expect(message).not.toContain(leakedSecretCandidate);
  });

  it('redacts sensitive headers and custom config secrets from structured Pino JSON logs', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString('utf8'));
        callback();
      },
    });

    const logger = createLogger({
      level: 'info',
      redactPaths: ['STRIPE_WEBHOOK_KEY'],
      destination,
    });

    const child = logger.child({ requestId: 'req-abc-123' });
    child.info(
      {
        STRIPE_WEBHOOK_KEY: 'whsec_live_999999',
        headers: {
          authorization: 'Bearer ultra-secret-jwt',
          cookie: 'sid=topsecret',
        },
        user: {
          email: 'dev@example.com',
          password: 'PlainTextPassword!',
        },
      },
      'processed payment',
    );
    child.flush();

    expect(lines.length).toBe(1);
    const rawLine = lines[0]!;
    expect(rawLine).not.toContain('whsec_live_999999');
    expect(rawLine).not.toContain('ultra-secret-jwt');
    expect(rawLine).not.toContain('topsecret');
    expect(rawLine).not.toContain('PlainTextPassword!');

    const parsed = JSON.parse(rawLine) as Record<string, unknown>;
    expect(parsed['requestId']).toBe('req-abc-123');
    expect(parsed['STRIPE_WEBHOOK_KEY']).toBe('[REDACTED]');
  });
});
