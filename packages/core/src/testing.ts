import type { LoadedConfig } from './config/config.js';
import { BetterBack, type BetterBackApp, type BetterBackOptions } from './application.js';
import { Container } from './di/container.js';
import type { ConcreteConstructor, Token } from './di/tokens.js';
import { createLogger } from './logging/logger.js';
import type { ModuleImport } from './routing/types.js';

export type ProviderOverrideTuple<T = unknown> = readonly [
  token: Token<T>,
  mockValue: T | LoadedConfig<T>,
];

export interface CreateTestingAppOptions<TConfig = Record<string, unknown>> extends Omit<
  BetterBackOptions<TConfig>,
  'overrides'
> {
  /**
   * One-line DI overrides for controllers, services, repositories, or guards:
   * `overrides: [[UserRepositoryToken, mockUserRepository]]`
   */
  readonly overrides?: readonly ProviderOverrideTuple[];
}

/**
 * Boots an isolated, silent-by-default `BetterBackApp` ready for Supertest (`request(app.express)`)
 * with one-line DI mock overrides and zero signal-handler side effects.
 */
export async function createTestingApp<TConfig = Record<string, unknown>>(
  rootModuleOrController: ModuleImport,
  options: CreateTestingAppOptions<TConfig> = {},
): Promise<BetterBackApp<TConfig>> {
  return BetterBack.create(rootModuleOrController, {
    ...options,
    logger: options.logger ?? createLogger({ level: 'silent' }),
    logRequests: options.logRequests ?? false,
    enableShutdownHooks: options.enableShutdownHooks ?? false,
    overrides: options.overrides,
  });
}

/**
 * Instantiates a pure `@Injectable()` service in 1 line with mock overrides and ZERO HTTP booted:
 *
 * ```ts
 * const users = resolveForTest(UsersService, [[UserRepositoryToken, mockRepo]]);
 * ```
 */
export function resolveForTest<T>(
  target: Token<T>,
  overrides: readonly ProviderOverrideTuple[] = [],
  extraProviders: readonly ConcreteConstructor[] = [],
): T {
  const container = new Container();
  if (typeof target === 'function') {
    container.register(target as ConcreteConstructor);
  }
  for (const extra of extraProviders) {
    container.register(extra);
  }
  for (const [token, mockValue] of overrides) {
    container.override(token, mockValue);
  }
  return container.resolve(target);
}
