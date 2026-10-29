import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: false,
  target: 'node20',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['better-back', 'better-back/cli'],
});
