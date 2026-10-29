import { Writable } from 'node:stream';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { Module, type BetterBackOptions } from 'better-back';
import { AppConfig, type AppEnv } from './config/env.js';
import { PostsModule } from './modules/posts/posts.module.js';
import { PostRepositoryToken } from './modules/posts/posts.repository.js';
import { UsersModule } from './modules/users/users.module.js';
import { UserRepositoryToken } from './modules/users/users.repository.js';

@Module({
  imports: [UsersModule, PostsModule],
})
export class AppModule {}

const silentStream = new Writable({
  write(_chunk, _encoding, cb) {
    cb();
  },
});

/**
 * Shared production bootstrap options demonstrating:
 * 1. Untouched native Express middleware (`cors`, `helmet`, `morgan`) with ZERO adapters
 * 2. Deliberate raw `express.Application` escape hatch (`setup`)
 * 3. Readiness probes resolving `UserRepositoryToken` & `PostRepositoryToken` from DI
 * 4. Auto-generated OpenAPI 3.1 spec + interactive explorer at `/docs`
 */
export function buildUserApiOptions(
  env: Record<string, string | undefined> = process.env,
): BetterBackOptions<AppEnv> {
  const config = env === process.env ? AppConfig : AppConfig.from(env);
  const isTest = config.profile === 'test';
  const userStoreMode = config.values.USERS_WAL_PATH
    ? 'wal store operational'
    : 'in-memory store operational';

  return {
    config,
    apiPrefix: '/api/v1',
    etag: true,
    metrics: {
      enabled: true,
      path: '/metrics',
    },
    security: {
      headers: {
        frameOptions: config.values.ALLOW_FRAME_EMBED ? false : 'DENY',
      },
    },
    middleware: [
      cors({ origin: config.values.CORS_ORIGIN }),
      helmet({
        contentSecurityPolicy: false,
        frameguard: config.values.ALLOW_FRAME_EMBED ? false : { action: 'deny' },
      }),
      morgan('tiny', { stream: isTest ? silentStream : process.stdout }),
    ],
    healthChecks: [
      {
        name: 'userRepository',
        check: async (container) => ({
          healthy: await container.resolve(UserRepositoryToken, 'UsersModule').ping(),
          detail: userStoreMode,
        }),
      },
      {
        name: 'postRepository',
        check: async (container) => ({
          healthy: await container.resolve(PostRepositoryToken, 'PostsModule').ping(),
          detail: 'in-memory store operational',
        }),
      },
    ],
    setup: (rawExpress) => {
      // Root discovery endpoint / interactive OpenAPI explorer redirect
      rawExpress.get('/', (req, res) => {
        const accept = req.headers.accept ?? '';
        if (accept.includes('text/html') && !accept.startsWith('application/json')) {
          res.redirect(302, '/docs');
          return;
        }
        res.status(200).json({
          service: 'Better Back User & Posts API',
          version: '1.1.0',
          docs: '/docs',
          openapi: '/docs/openapi.json',
          health: '/health',
          ready: '/ready',
          metrics: '/metrics',
        });
      });

      // Deliberate raw Express 5 escape hatch — zero framework lock-in
      rawExpress.get('/raw-express-ping', (_req, res) => {
        res.status(200).json({ source: 'raw-express-escape-hatch', ok: true });
      });
    },
    openapi: {
      title: 'Better Back User & Posts API',
      version: '1.1.0',
      description:
        'Reference consumer API built exclusively with the unified decorator-based better-back v1.1 package (Bearer token in dev: dev-secret-token-2026).',
    },
  };
}
