import { describe, expect, it } from 'vitest';
import {
  BetterBack,
  BootstrapError,
  CircularDependencyError,
  Container,
  Controller,
  createToken,
  DuplicateProviderError,
  Get,
  inject,
  Injectable,
  MissingProviderError,
  Module,
  resolveForTest,
  type ConcreteConstructor,
  type OnApplicationShutdown,
  type OnModuleInit,
} from 'better-back';

interface GreeterPort {
  greet(name: string): string;
}

const GreeterPortToken = createToken<GreeterPort>('GreeterPort');

describe('DI Container, 1-Line inject(Token) & Module Encapsulation', () => {
  it('resolves 1-line inject(Token) across singleton, request, and transient scopes (including captive promotion)', async () => {
    let transientCounter = 0;
    let requestCounter = 0;

    @Injectable()
    class EnglishGreeter implements GreeterPort {
      public greet(name: string): string {
        return `Hello, ${name}!`;
      }
    }

    @Injectable({ scope: 'transient' })
    class TransientId {
      public readonly id = ++transientCounter;
    }

    @Injectable({ scope: 'request' })
    class RequestTrace {
      public readonly traceNum = ++requestCounter;
    }

    @Injectable()
    class ScopedConsumerA {
      public readonly trace = inject(RequestTrace);
    }

    @Injectable()
    class ScopedConsumerB {
      public readonly trace = inject(RequestTrace);
    }

    const GreetingBannerToken = createToken<string>('GreetingBanner');

    const container = new Container();
    container
      .register({ provide: GreeterPortToken, useClass: EnglishGreeter })
      .register(TransientId)
      .register(RequestTrace)
      .register(ScopedConsumerA)
      .register(ScopedConsumerB)
      .register({
        provide: GreetingBannerToken,
        useFactory: () => inject(GreeterPortToken).greet('World'),
      });

    await container.init();

    // Calling inject() outside DI instantiation throws a clear BootstrapError
    expect(() => inject(GreeterPortToken)).toThrowError(BootstrapError);

    // Singleton returns identical reference
    expect(container.resolve(GreeterPortToken)).toBe(container.resolve(GreeterPortToken));
    expect(container.resolve(GreetingBannerToken)).toBe('Hello, World!');

    // Transient creates a fresh instance every call (after startup validation pass)
    const t1 = container.resolve(TransientId);
    const t2 = container.resolve(TransientId);
    expect(t1.id).toBeGreaterThanOrEqual(1);
    expect(t2.id).toBe(t1.id + 1);

    // Captive request-scoped consumers are promoted to request scope automatically
    expect(container.isRequestScoped(ScopedConsumerA)).toBe(true);

    // Request scope shares instance within a single HTTP request scope, isolates across requests
    const req1 = container.createRequestScope();
    const req2 = container.createRequestScope();

    const r1a = req1.resolve(ScopedConsumerA);
    const r1b = req1.resolve(ScopedConsumerB);
    expect(r1a.trace.traceNum).toBe(r1b.trace.traceNum);

    const r2a = req2.resolve(ScopedConsumerA);
    expect(r2a.trace.traceNum).not.toBe(r1a.trace.traceNum);
  });

  it('supports one-line test overrides via resolveForTest() without monkey-patching', () => {
    @Injectable()
    class WelcomeService {
      private readonly greeter = inject(GreeterPortToken);

      public welcome(user: string): string {
        return this.greeter.greet(user);
      }
    }

    const svc = resolveForTest(WelcomeService, [
      [GreeterPortToken, { greet: (name: string) => `Mocked: ${name}` }],
    ]);
    expect(svc.welcome('Ada')).toBe('Mocked: Ada');
  });

  it('runs OnModuleInit in topological order and OnApplicationShutdown in reverse order', async () => {
    const events: string[] = [];

    @Injectable()
    class DatabasePool implements OnModuleInit, OnApplicationShutdown {
      public async onModuleInit(): Promise<void> {
        events.push('init:db');
      }
      public async onApplicationShutdown(signal?: string): Promise<void> {
        events.push(`shutdown:db:${signal ?? 'none'}`);
      }
    }

    @Injectable()
    class UserCacheWarmup implements OnModuleInit, OnApplicationShutdown {
      public readonly db = inject(DatabasePool);

      public async onModuleInit(): Promise<void> {
        events.push('init:cache');
      }
      public async onApplicationShutdown(signal?: string): Promise<void> {
        events.push(`shutdown:cache:${signal ?? 'none'}`);
      }
    }

    const container = new Container().register(UserCacheWarmup).register(DatabasePool);
    await container.init();
    expect(events).toEqual(['init:db', 'init:cache']);

    await container.shutdown('SIGTERM');
    expect(events).toEqual([
      'init:db',
      'init:cache',
      'shutdown:cache:SIGTERM',
      'shutdown:db:SIGTERM',
    ]);
  });

  it('fails loudly at startup on circular provider dependencies naming the exact cycle', async () => {
    const TokenA = createToken<unknown>('ServiceA');
    const TokenB = createToken<unknown>('ServiceB');

    const container = new Container().registerModules([
      {
        name: 'BillingModule',
        imports: [],
        providers: [
          { provide: TokenA, useFactory: () => ({ b: inject(TokenB) }) },
          { provide: TokenB, useFactory: () => ({ a: inject(TokenA) }) },
        ],
        exports: [],
        global: false,
      },
    ]);

    await expect(container.init()).rejects.toThrowError(CircularDependencyError);

    try {
      await container.init();
    } catch (err) {
      expect((err as Error).message).toContain('BillingModule');
      expect((err as Error).message).toContain('ServiceA -> ServiceB -> ServiceA');
    }
  });

  it('fails loudly at startup on circular module imports or undecorated root classes', async () => {
    const cyclicImports: ConcreteConstructor[] = [];

    @Module({ imports: cyclicImports })
    class AlphaModule {}

    @Module({ imports: [AlphaModule] })
    class BetaModule {}

    cyclicImports.push(BetaModule);

    await expect(BetterBack.create(AlphaModule)).rejects.toThrowError(CircularDependencyError);

    class UndecoratedPlainClass {}
    await expect(BetterBack.create(UndecoratedPlainClass)).rejects.toThrowError(BootstrapError);
  });

  it('fails loudly on duplicate provider tokens in the same module', () => {
    const DupToken = createToken<number>('DupToken');
    expect(() =>
      new Container().registerModules([
        {
          name: 'CoreMod',
          imports: [],
          providers: [
            { provide: DupToken, useValue: 1 },
            { provide: DupToken, useValue: 2 },
          ],
          exports: [],
          global: false,
        },
      ]),
    ).toThrowError(DuplicateProviderError);
  });

  it('enforces module boundary encapsulation when a provider is not exported', async () => {
    @Injectable()
    class InternalSecretRepo {
      public read(): string {
        return 'secret';
      }
    }

    @Module({
      providers: [InternalSecretRepo],
      exports: [], // Intentionally NOT exported!
    })
    class VaultModule {}

    @Controller('/leak')
    class LeakController {
      private readonly repo = inject(InternalSecretRepo);

      @Get('/')
      public get() {
        return { data: this.repo.read() };
      }
    }

    @Module({
      imports: [VaultModule],
      controllers: [LeakController],
    })
    class ConsumerModule {}

    await expect(BetterBack.create(ConsumerModule)).rejects.toThrowError(MissingProviderError);
    await expect(BetterBack.create(ConsumerModule)).rejects.toThrow(/VaultModule/);
  });
});
