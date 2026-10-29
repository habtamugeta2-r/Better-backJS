import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  oxc: false,
  plugins: [
    {
      name: 'esbuild-stage3-decorators',
      enforce: 'pre',
      async transform(code, id) {
        if (!id.endsWith('.ts') || id.includes('node_modules')) {
          return null;
        }
        const result = await transform(code, {
          loader: 'ts',
          target: 'node20',
          sourcemap: true,
          sourcefile: id,
        });
        return {
          code: result.code,
          map: result.map,
        };
      },
    },
  ],
  resolve: {
    alias: {
      'better-back': path.resolve(rootDir, 'packages/core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'examples/*/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts', 'examples/user-api/src/**/*.ts'],
      exclude: [
        'examples/user-api/src/main.ts',
        'packages/core/src/**/index.ts',
        'packages/core/src/routing/types.ts',
        '**/*.d.ts',
      ],
      reporter: ['text', 'json-summary'],
    },
  },
});
