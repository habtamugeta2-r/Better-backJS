import { isLoadedConfig, type LoadedConfig } from '../config/config.js';
import {
  BootstrapError,
  CircularDependencyError,
  DuplicateProviderError,
  MissingProviderError,
} from '../errors/startup-errors.js';
import { getInjectableMetadata } from './decorators.js';
import {
  formatTokenName,
  isInjectionToken,
  type ConcreteConstructor,
  type OnApplicationShutdown,
  type OnModuleInit,
  type Provider,
  type Scope,
  type Token,
} from './tokens.js';

type TokenKey = symbol | Token;

function toTokenKey(token: Token): TokenKey {
  return isInjectionToken(token) ? token.id : token;
}

function includesToken(list: readonly Token[], target: Token): boolean {
  const key = toTokenKey(target);
  return list.some((item) => toTokenKey(item) === key);
}

interface RegisteredBinding<T = unknown> {
  readonly token: Token<T>;
  readonly moduleName: string;
  readonly consumerName: string;
  readonly scope: Scope;
  promotedToRequestScope: boolean;
  readonly create: () => T;
}

interface InjectionFrame {
  readonly container: Container;
  readonly binding: RegisteredBinding;
  readonly requestCache: Map<RegisteredBinding, unknown> | undefined;
  readonly stack: RegisteredBinding[];
  readonly stackSet: Set<RegisteredBinding>;
  touchedRequestScope: boolean;
  readonly parent: InjectionFrame | undefined;
}

let activeInjectionFrame: InjectionFrame | undefined;

/**
 * Resolves a dependency inside an `@Injectable()` service, `@Controller()` class,
 * or `useFactory` provider with 100% static TypeScript inference and zero `reflect-metadata`:
 *
 * ```ts
 * @Controller('/users')
 * export class UsersController {
 *   private readonly users = inject(UsersService);
 * }
 * ```
 */
export function inject<T>(token: Token<T>): T {
  const frame = activeInjectionFrame;
  if (!frame) {
    throw new BootstrapError(
      'DI_CONTEXT_ERROR',
      `inject(${formatTokenName(token)}) can only be called during DI instantiation (inside a class field initializer, constructor, or useFactory). In unit tests, use resolveForTest(...) or Container.`,
    );
  }
  return frame.container._resolveFromFrame(token, frame);
}

export interface ModuleProviderRegistration {
  readonly name: string;
  readonly imports: readonly string[];
  readonly providers: readonly Provider[];
  readonly exports: readonly Token[];
  readonly global: boolean;
}

function hasOnModuleInit(value: unknown): value is OnModuleInit {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<OnModuleInit>).onModuleInit === 'function'
  );
}

function hasOnApplicationShutdown(value: unknown): value is OnApplicationShutdown {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<OnApplicationShutdown>).onApplicationShutdown === 'function'
  );
}

function normalizeProvider(moduleName: string, provider: Provider): RegisteredBinding {
  if (typeof provider === 'function') {
    const meta = getInjectableMetadata(provider);
    const scope = meta?.scope ?? 'singleton';
    return {
      token: provider,
      moduleName,
      consumerName: provider.name || '<AnonymousClass>',
      scope,
      promotedToRequestScope: false,
      create: () => new provider(),
    };
  }

  if ('useValue' in provider) {
    return {
      token: provider.provide,
      moduleName,
      consumerName: formatTokenName(provider.provide),
      scope: 'singleton',
      promotedToRequestScope: false,
      create: () => provider.useValue,
    };
  }

  if ('useClass' in provider) {
    const ctor: ConcreteConstructor = provider.useClass;
    const meta = getInjectableMetadata(ctor);
    const scope = provider.scope ?? meta?.scope ?? 'singleton';
    return {
      token: provider.provide,
      moduleName,
      consumerName: ctor.name || formatTokenName(provider.provide),
      scope,
      promotedToRequestScope: false,
      create: () => new ctor(),
    };
  }

  return {
    token: provider.provide,
    moduleName,
    consumerName: formatTokenName(provider.provide),
    scope: provider.scope ?? 'singleton',
    promotedToRequestScope: false,
    create: () => provider.useFactory(),
  };
}

export interface Resolver {
  resolve<T>(token: Token<T>, fromModule?: string): T;
}

/**
 * Explicit, zero-reflection Dependency Injection container powered by `inject(Token)`:
 * - Class, interface-token, factory, and value providers
 * - `singleton`, `transient`, and `request` lifetimes (with automatic captive-dependency promotion)
 * - Module encapsulation (`imports`/`exports`) & startup cycle/duplicate/missing verification
 * - One-line test overrides (`container.override(Token, mock)`)
 */
export class Container implements Resolver {
  private readonly modules = new Map<string, ModuleProviderRegistration>();
  private readonly moduleBindings = new Map<string, Map<TokenKey, RegisteredBinding>>();
  private readonly globalBindings = new Map<TokenKey, RegisteredBinding>();
  private readonly allOwnersByToken = new Map<TokenKey, string[]>();
  private readonly overrides = new Map<TokenKey, unknown>();
  private readonly singletons = new Map<RegisteredBinding, unknown>();
  private readonly initializedInstances: unknown[] = [];
  private initialized = false;

  /**
   * Registers a single standalone provider into a default global root scope (handy for unit tests).
   */
  public register(provider: Provider, moduleName = 'RootModule'): this {
    if (!this.modules.has(moduleName)) {
      this.modules.set(moduleName, {
        name: moduleName,
        imports: [],
        providers: [],
        exports: [],
        global: true,
      });
      this.moduleBindings.set(moduleName, new Map());
    }
    const table = this.moduleBindings.get(moduleName)!;
    const binding = normalizeProvider(moduleName, provider);
    const key = toTokenKey(binding.token);
    if (table.has(key)) {
      throw new DuplicateProviderError(moduleName, formatTokenName(binding.token));
    }
    table.set(key, binding);
    this.globalBindings.set(key, binding);
    this.recordOwner(key, moduleName);
    return this;
  }

  /**
   * Registers an entire explicit module graph and validates duplicate tokens immediately.
   */
  public registerModules(registrations: readonly ModuleProviderRegistration[]): this {
    for (const mod of registrations) {
      this.modules.set(mod.name, mod);
      const table = this.moduleBindings.get(mod.name) ?? new Map<TokenKey, RegisteredBinding>();
      this.moduleBindings.set(mod.name, table);

      for (const provider of mod.providers) {
        const binding = normalizeProvider(mod.name, provider);
        const key = toTokenKey(binding.token);
        if (table.has(key)) {
          throw new DuplicateProviderError(mod.name, formatTokenName(binding.token));
        }
        table.set(key, binding);
        this.recordOwner(key, mod.name);
        if (mod.global) {
          this.globalBindings.set(key, binding);
        }
      }
    }
    return this;
  }

  /**
   * One-line test mock override — replaces any token across all modules without monkey-patching.
   * Automatically unwraps `LoadedConfig.from(env)` if passed directly for a config token.
   */
  public override<T>(token: Token<T>, mockValue: NoInfer<T> | LoadedConfig<NoInfer<T>>): this {
    const resolvedMock =
      isLoadedConfig(token) && isLoadedConfig(mockValue) && token.id === mockValue.id
        ? mockValue.values
        : mockValue;
    this.overrides.set(toTokenKey(token), resolvedMock);
    return this;
  }

  /**
   * Returns true if `token` (or any transitive dependency it injected during `init()`) is `'request'`-scoped.
   */
  public isRequestScoped(token: Token, fromModule?: string): boolean {
    if (this.overrides.has(toTokenKey(token))) {
      return false;
    }
    const binding = this.lookupBinding(token, fromModule, 'RouteCompiler');
    return binding.scope === 'request' || binding.promotedToRequestScope;
  }

  /**
   * Eagerly constructs and validates all providers at startup (catching missing/unexported tokens
   * and circular dependencies across singleton, request, and transient scopes) and runs `OnModuleInit`
   * hooks in exact topological dependency order.
   */
  public async init(): Promise<void> {
    if (this.initialized) return;

    const initTrialRequestCache = new Map<RegisteredBinding, unknown>();

    for (const table of this.moduleBindings.values()) {
      for (const binding of table.values()) {
        if (this.overrides.has(toTokenKey(binding.token))) continue;
        this.instantiateBinding(binding, initTrialRequestCache, [], new Set(), true);
      }
    }

    for (const instance of this.initializedInstances) {
      if (hasOnModuleInit(instance)) {
        await instance.onModuleInit();
      }
    }

    this.initialized = true;
  }

  /**
   * Resolves a token from root container scope.
   */
  public resolve<T>(token: Token<T>, fromModule?: string): T {
    const key = toTokenKey(token);
    if (this.overrides.has(key)) {
      return this.overrides.get(key) as T;
    }
    const binding = this.lookupBinding(token, fromModule, 'Container.resolve');
    return this.instantiateBinding(binding, undefined, [], new Set(), false) as T;
  }

  /**
   * Creates a lightweight per-request resolver that caches `'request'`-scoped providers
   * for the duration of a single HTTP request while sharing root singletons.
   */
  public createRequestScope(): Resolver {
    const requestCache = new Map<RegisteredBinding, unknown>();
    return {
      resolve: <T>(token: Token<T>, fromModule?: string): T => {
        const key = toTokenKey(token);
        if (this.overrides.has(key)) {
          return this.overrides.get(key) as T;
        }
        const binding = this.lookupBinding(token, fromModule, 'RequestScope.resolve');
        return this.instantiateBinding(binding, requestCache, [], new Set(), false) as T;
      },
    };
  }

  /**
   * Executes `OnApplicationShutdown` hooks in reverse initialization order.
   */
  public async shutdown(signal?: string): Promise<void> {
    const instances = [...this.initializedInstances].reverse();
    this.initializedInstances.length = 0;
    for (const instance of instances) {
      if (hasOnApplicationShutdown(instance)) {
        await instance.onApplicationShutdown(signal);
      }
    }
    this.initialized = false;
  }

  /** @internal Invoked synchronously by `inject(token)`. */
  public _resolveFromFrame<T>(token: Token<T>, parentFrame: InjectionFrame): T {
    const key = toTokenKey(token);
    if (this.overrides.has(key)) {
      return this.overrides.get(key) as T;
    }

    const depBinding = this.lookupBinding(
      token,
      parentFrame.binding.moduleName,
      parentFrame.binding.consumerName,
    );

    if (depBinding.scope === 'request' || depBinding.promotedToRequestScope) {
      parentFrame.touchedRequestScope = true;
    }

    const instance = this.instantiateBinding(
      depBinding,
      parentFrame.requestCache,
      parentFrame.stack,
      parentFrame.stackSet,
      false,
    );

    if (depBinding.scope === 'request' || depBinding.promotedToRequestScope) {
      parentFrame.touchedRequestScope = true;
    }

    return instance as T;
  }

  private recordOwner(key: TokenKey, moduleName: string): void {
    const existing = this.allOwnersByToken.get(key);
    if (existing) {
      if (!existing.includes(moduleName)) existing.push(moduleName);
    } else {
      this.allOwnersByToken.set(key, [moduleName]);
    }
  }

  private lookupBinding(
    token: Token,
    fromModule: string | undefined,
    consumerName: string,
  ): RegisteredBinding {
    const key = toTokenKey(token);
    if (fromModule !== undefined) {
      const ownTable = this.moduleBindings.get(fromModule);
      const local = ownTable?.get(key);
      if (local) return local;

      const mod = this.modules.get(fromModule);
      if (mod) {
        for (const importedName of mod.imports) {
          const importedMod = this.modules.get(importedName);
          if (importedMod && includesToken(importedMod.exports, token)) {
            const exportedBinding = this.findExportedBinding(importedName, token, new Set());
            if (exportedBinding) return exportedBinding;
          }
        }
      }

      const globalHit = this.globalBindings.get(key);
      if (globalHit) return globalHit;

      if (isLoadedConfig(token)) {
        const autoConfigBinding: RegisteredBinding = {
          token,
          moduleName: 'GlobalConfig',
          consumerName: formatTokenName(token),
          scope: 'singleton',
          promotedToRequestScope: false,
          create: () => token.values,
        };
        this.globalBindings.set(key, autoConfigBinding);
        return autoConfigBinding;
      }

      const owners = this.allOwnersByToken.get(key);
      throw new MissingProviderError({
        moduleName: fromModule,
        consumerName,
        tokenName: formatTokenName(token),
        unexportedOwnerModule: owners?.[0],
      });
    }

    const globalHit = this.globalBindings.get(key);
    if (globalHit) return globalHit;

    for (const table of this.moduleBindings.values()) {
      const hit = table.get(key);
      if (hit) return hit;
    }

    if (isLoadedConfig(token)) {
      const autoConfigBinding: RegisteredBinding = {
        token,
        moduleName: 'GlobalConfig',
        consumerName: formatTokenName(token),
        scope: 'singleton',
        promotedToRequestScope: false,
        create: () => token.values,
      };
      this.globalBindings.set(key, autoConfigBinding);
      return autoConfigBinding;
    }

    throw new MissingProviderError({
      moduleName: 'Root',
      consumerName,
      tokenName: formatTokenName(token),
    });
  }

  private findExportedBinding(
    moduleName: string,
    token: Token,
    seen: Set<string>,
  ): RegisteredBinding | undefined {
    if (seen.has(moduleName)) return undefined;
    seen.add(moduleName);

    const mod = this.modules.get(moduleName);
    if (!mod || !includesToken(mod.exports, token)) return undefined;

    const local = this.moduleBindings.get(moduleName)?.get(toTokenKey(token));
    if (local) return local;

    for (const reExportedFrom of mod.imports) {
      const nested = this.findExportedBinding(reExportedFrom, token, seen);
      if (nested) return nested;
    }
    return undefined;
  }

  private instantiateBinding(
    binding: RegisteredBinding,
    requestCache: Map<RegisteredBinding, unknown> | undefined,
    stack: RegisteredBinding[],
    stackSet: Set<RegisteredBinding>,
    isStartupValidation: boolean,
  ): unknown {
    if (this.overrides.has(binding.token)) {
      return this.overrides.get(binding.token);
    }

    if (stackSet.has(binding)) {
      const idx = stack.indexOf(binding);
      const cycle = [...stack.slice(idx), binding].map((b) => formatTokenName(b.token));
      throw new CircularDependencyError('provider', cycle, binding.moduleName);
    }

    if (binding.scope === 'singleton' && !binding.promotedToRequestScope) {
      if (this.singletons.has(binding)) {
        return this.singletons.get(binding);
      }
    }

    if (
      (binding.scope === 'request' || binding.promotedToRequestScope) &&
      requestCache?.has(binding)
    ) {
      return requestCache.get(binding);
    }

    if (isStartupValidation && binding.scope === 'transient') {
      // Validate transient binding once at startup without caching it as a singleton
    }

    const frame: InjectionFrame = {
      container: this,
      binding,
      requestCache,
      stack,
      stackSet,
      touchedRequestScope: binding.scope === 'request' || binding.promotedToRequestScope,
      parent: activeInjectionFrame,
    };

    stack.push(binding);
    stackSet.add(binding);
    activeInjectionFrame = frame;

    let instance: unknown;
    try {
      instance = binding.create();
    } finally {
      activeInjectionFrame = frame.parent;
      stack.pop();
      stackSet.delete(binding);
    }

    if (frame.touchedRequestScope && binding.scope === 'singleton') {
      binding.promotedToRequestScope = true;
    }

    if (binding.scope === 'singleton' && !binding.promotedToRequestScope) {
      this.singletons.set(binding, instance);
      this.initializedInstances.push(instance);
      return instance;
    }

    if (binding.scope === 'request' || binding.promotedToRequestScope) {
      requestCache?.set(binding, instance);
      return instance;
    }

    return instance;
  }

  /**
   * Explicit Resource Management (`await using container = new Container()`).
   */
  public async [Symbol.asyncDispose](): Promise<void> {
    await this.shutdown('dispose');
  }
}
