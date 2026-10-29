import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node20',
    splitting: false,
    treeshake: true,
  },
  {
    entry: {
      cli: 'src/cli/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    sourcemap: true,
    target: 'node20',
    splitting: false,
    treeshake: true,
    esbuildPlugins: [
      {
        name: 'externalize-better-back-core',
        setup(build) {
          const outExt = build.initialOptions.define?.['TSUP_FORMAT'] === '"cjs"' ? '.cjs' : '.js';
          build.onResolve({ filter: /^\.\.\/index\.js$/ }, () => ({
            path: `./index${outExt}`,
            external: true,
          }));
        },
      },
    ],
  },
  {
    entry: {
      bin: 'src/cli/bin.ts',
    },
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: false,
    target: 'node20',
    splitting: false,
    treeshake: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
    esbuildPlugins: [
      {
        name: 'externalize-better-back-cli',
        setup(build) {
          build.onResolve({ filter: /^\.\/index\.js$/ }, () => ({
            path: './cli.js',
            external: true,
          }));
        },
      },
    ],
  },
]);
