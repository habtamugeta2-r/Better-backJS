export type Scope = 'singleton' | 'transient' | 'request';

export const TOKEN_BRAND = Symbol.for('better-back.injection-token');

/**
 * Strongly-typed Dependency Injection token for interfaces, ports, configuration, and values.
 * Zero runtime reflection required.
 */
export interface InjectionToken<T = unknown> {
  readonly [TOKEN_BRAND]: true;
  readonly description: string;
  readonly id: symbol;
  /** Phantom covariant type carrier — never accessed at runtime. */
  readonly __type?: () => T;
}

/**
 * Creates a unique, strongly-typed `InjectionToken<T>` for an interface or value port.
 */
export function createToken<T>(description: string): InjectionToken<T> {
  return Object.freeze({
    [TOKEN_BRAND]: true as const,
    description,
    id: Symbol(description),
  });
}

export function isInjectionToken(value: unknown): value is InjectionToken<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    TOKEN_BRAND in value &&
    (value as Record<symbol, unknown>)[TOKEN_BRAND] === true
  );
}

/**
 * Abstract or concrete class constructor usable as a DI token.
 */
export type AbstractConstructor<T = unknown> = abstract new (...args: never[]) => T;

/**
 * Zero-argument instantiable class constructor (dependencies are resolved cleanly via `inject(Token)`).
 */
export type ConcreteConstructor<T = unknown> = new () => T;

export type Token<T = unknown> = InjectionToken<T> | AbstractConstructor<T>;

export type TokenValue<T> =
  T extends InjectionToken<infer V> ? V : T extends AbstractConstructor<infer C> ? C : never;

export interface ClassProvider<T = unknown> {
  readonly provide: Token<T>;
  readonly useClass: ConcreteConstructor<NoInfer<T>>;
  readonly scope?: Scope;
}

export interface FactoryProvider<T = unknown> {
  readonly provide: Token<T>;
  readonly useFactory: () => NoInfer<T>;
  readonly scope?: Scope;
}

export interface ValueProvider<T = unknown> {
  readonly provide: Token<T>;
  readonly useValue: NoInfer<T>;
}

export type Provider<T = unknown> =
  ConcreteConstructor<T> | ClassProvider<T> | FactoryProvider<T> | ValueProvider<T>;

export interface OnModuleInit {
  onModuleInit(): Promise<void> | void;
}

export interface OnApplicationShutdown {
  onApplicationShutdown(signal?: string): Promise<void> | void;
}

export function formatTokenName(token: Token): string {
  if (isInjectionToken(token)) {
    return token.description;
  }
  return token.name || '<AnonymousClass>';
}
