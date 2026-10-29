import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type * as BetterBackPkg from 'better-back';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const esmEntry = path.resolve(currentDir, '../dist/index.js');
const cjsEntry = path.resolve(currentDir, '../dist/index.cjs');

describe('Dual ESM / CJS Package Build Verification (ADR-005)', () => {
  it('boots and serves requests from the compiled ESM bundle (dist/index.js)', async () => {
    const esmPkg = (await import(esmEntry)) as typeof BetterBackPkg;

    @esmPkg.Controller('/esm')
    class EsmController {
      @esmPkg.Get('/')
      public ping() {
        return { format: 'esm' };
      }
    }

    await using app = await esmPkg.createTestingApp(EsmController);
    const res = await request(app.express).get('/esm');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ format: 'esm' });
  });

  it('boots and serves requests from the compiled CommonJS bundle (dist/index.cjs)', async () => {
    const requireCjs = createRequire(import.meta.url);
    const cjsPkg = requireCjs(cjsEntry) as typeof BetterBackPkg;

    @cjsPkg.Controller('/cjs')
    class CjsController {
      @cjsPkg.Get('/')
      public ping() {
        return { format: 'cjs' };
      }
    }

    await using app = await cjsPkg.createTestingApp(CjsController);
    const res = await request(app.express).get('/cjs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ format: 'cjs' });
  });
});
