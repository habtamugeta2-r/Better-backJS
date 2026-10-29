import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import {
  BetterBack,
  Controller,
  Get,
  Module,
  Post,
  type Ctx,
} from '../packages/core/dist/index.js';

const mode = process.argv[2] ?? 'raw-express';

@Controller('/hello')
class HelloController {
  @Get('/')
  public hello() {
    return { message: 'hello world' };
  }
}

@Module({ controllers: [HelloController] })
class BenchAppModule {}

const CreateInput = z.object({
  email: z.email(),
  name: z.string().min(2).max(60),
});
const CreatedOutput = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
});

@Controller('/users')
class ValidatedUsersController {
  @Post('/', { body: CreateInput, response: CreatedOutput })
  public create({ body }: Ctx<typeof CreateInput>) {
    return {
      id: 'usr_01',
      email: body.email,
      name: body.name,
    };
  }
}

async function boot(): Promise<void> {
  if (mode === 'raw-express') {
    const app = express();
    app.disable('x-powered-by');
    app.get('/hello', (_req, res) => {
      res.json({ message: 'hello world' });
    });
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      process.send?.({ port });
    });
    process.once('SIGTERM', () => server.close(() => process.exit(0)));
    return;
  }

  if (mode === 'express-secured') {
    const app = express();
    app.use((req, res, next) => {
      const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
      res.setHeader('x-request-id', id);
      next();
    });
    app.use(helmet());
    app.use(cors({ origin: false }));
    app.use(express.json({ limit: '100kb' }));
    app.get('/hello', (_req, res) => {
      res.json({ message: 'hello world' });
    });
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      process.send?.({ port });
    });
    process.once('SIGTERM', () => server.close(() => process.exit(0)));
    return;
  }

  if (mode === 'bb-minimal') {
    const app = await BetterBack.create(BenchAppModule, {
      logger: { level: 'warn' },
      logRequests: false,
      security: { headers: { enabled: false } },
      timeoutMs: 0,
      openapi: { enabled: false },
      enableShutdownHooks: true,
    });
    await app.listen(0, '127.0.0.1');
    const port = Number(new URL(app.getUrl()).port);
    process.send?.({ port });
    return;
  }

  if (mode === 'bb-default') {
    const app = await BetterBack.create(BenchAppModule, {
      logger: { level: 'warn' },
      enableShutdownHooks: true,
    });
    await app.listen(0, '127.0.0.1');
    const port = Number(new URL(app.getUrl()).port);
    process.send?.({ port });
    return;
  }

  if (mode === 'bb-info-logs') {
    const devNull = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    const app = await BetterBack.create(BenchAppModule, {
      logger: { level: 'info', destination: devNull },
      enableShutdownHooks: true,
    });
    await app.listen(0, '127.0.0.1');
    const port = Number(new URL(app.getUrl()).port);
    process.send?.({ port });
    return;
  }

  const app = await BetterBack.create(ValidatedUsersController, {
    logger: { level: 'warn' },
    enableShutdownHooks: true,
  });
  await app.listen(0, '127.0.0.1');
  const port = Number(new URL(app.getUrl()).port);
  process.send?.({ port });
}

await boot();
