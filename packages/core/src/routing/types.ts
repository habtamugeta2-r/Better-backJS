import type { Request, RequestHandler, Response } from 'express';
import type {
  InferSchemaInput,
  InferSchemaOutput,
  StandardSchemaV1,
} from '../common/standard-schema.js';
import type { ConcreteConstructor, Provider, Token } from '../di/tokens.js';
import type { Logger } from '../logging/logger.js';
import type { RouteCachePolicy } from '../pipeline/cache.js';
import type { SseStream } from '../pipeline/sse.js';
import type { RateLimitPolicy } from '../ports/rate-limiter.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

export type MaybePromise<T> = T | Promise<T>;

export type DocumentedErrorStatus = 400 | 401 | 403 | 404 | 408 | 409 | 413 | 422 | 429 | 503;

type CleanParamSegment<Segment extends string> = Segment extends `${infer Name}?`
  ? Name
  : Segment extends `${infer Name}(${string}`
    ? Name
    : Segment;

/**
 * Extracts `:param` names from a route path literal (`"/users/:id/posts/:postId"` -> `"id" | "postId"`).
 */
export type ExtractRouteParamNames<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? CleanParamSegment<Param> | ExtractRouteParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? CleanParamSegment<Param>
      : never;

export type PathParams<Path extends string> = [ExtractRouteParamNames<Path>] extends [never]
  ? Record<string, string>
  : { readonly [K in ExtractRouteParamNames<Path>]: string };

export type DeepReadonly<T> = T extends (...args: never) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type InferSchemaOr<
  TSchema extends StandardSchemaV1 | undefined,
  TFallback,
> = TSchema extends StandardSchemaV1 ? InferSchemaOutput<TSchema> : TFallback;

export type InferResponseOutput<
  TRes extends StandardSchemaV1 | undefined,
  TSse extends StandardSchemaV1 | undefined = undefined,
> = TSse extends StandardSchemaV1
  ? SseStream<InferSchemaInput<TSse> | InferSchemaOutput<TSse>>
  : TRes extends StandardSchemaV1
    ? DeepReadonly<InferSchemaInput<TRes>> | DeepReadonly<InferSchemaOutput<TRes>>
    : unknown;

/**
 * Context passed into an `AuthGuard` before route schema validation or handler execution.
 * `user` carries any principal already resolved by an upstream global or controller `@Guard`.
 */
export interface GuardContext<TUser = unknown> {
  readonly req: Request;
  readonly res: Response;
  readonly requestId: string;
  readonly traceId?: string | undefined;
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly user: TUser;
}

export interface AuthGuard<TUser = unknown, TUpstreamUser = unknown> {
  canActivate(ctx: GuardContext<TUpstreamUser>): MaybePromise<TUser>;
}

export type AuthGuardFn<TUser = unknown, TUpstreamUser = unknown> = (
  ctx: GuardContext<TUpstreamUser>,
) => MaybePromise<TUser>;

export type AuthGuardInput<TUser = unknown, TUpstreamUser = never> =
  | AuthGuardFn<TUser, TUpstreamUser>
  | AuthGuard<TUser, TUpstreamUser>
  | Token<AuthGuard<TUser, TUpstreamUser>>;

export type InferSingleGuardUser<TGuard> =
  TGuard extends Token<AuthGuard<infer U, never>>
    ? U
    : TGuard extends AuthGuard<infer U, never>
      ? U
      : TGuard extends (ctx: GuardContext<never>) => MaybePromise<infer U>
        ? U
        : unknown;

type NonVoidGuardUser<U, TFallback> = [U] extends [void | undefined] ? TFallback : U;

/**
 * Computes the effective `user` type produced by a tuple of chained guards.
 * Pure authorization guards returning `void` / `undefined` preserve the upstream `user` type.
 */
export type EffectiveGuardsUser<
  TGuards extends readonly unknown[],
  TAcc = never,
> = TGuards extends readonly [infer Head, ...infer Tail]
  ? EffectiveGuardsUser<Tail, NonVoidGuardUser<InferSingleGuardUser<Head>, TAcc>>
  : TAcc;

/**
 * Probe context used by `@Guard(...)` on controller methods to enforce at compile time
 * that a handler's `Ctx<{ user: ... }>` annotation matches the guard's returned `TUser`.
 */
export interface GuardProbeContext<TGuardUser> {
  readonly params: never;
  readonly query: never;
  readonly body: never;
  readonly headers: never;
  readonly user: TGuardUser;
  readonly requestId: string;
  readonly traceId: string | undefined;
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly req: Request;
  readonly res: Response;
}

/**
 * Single-Source-of-Truth Route Options passed to `@Get`, `@Post`, `@Put`, `@Patch`, or `@Delete`.
 * Drives runtime Zod v4 / Standard Schema v1 validation, static TypeScript verification, and OpenAPI 3.1 docs.
 */
export interface RouteOptions<
  TBody extends StandardSchemaV1 | undefined = undefined,
  TQuery extends StandardSchemaV1 | undefined = undefined,
  TParams extends StandardSchemaV1 | undefined = undefined,
  THeaders extends StandardSchemaV1 | undefined = undefined,
  TRes extends StandardSchemaV1 | undefined = undefined,
  TSse extends StandardSchemaV1 | undefined = undefined,
> {
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly status?: number;
  readonly body?: TBody;
  readonly query?: TQuery;
  readonly params?: TParams;
  readonly headers?: THeaders;
  readonly response?: TRes;
  /** Schema for Server-Sent Events (`text/event-stream`) yielded via `sse(...)`. */
  readonly sse?: TSse;
  /** Document expected RFC 7807 `ProblemDetails` error status codes in OpenAPI 3.1 (e.g. `[404, 409]`). */
  readonly errors?: readonly DocumentedErrorStatus[];
  /** Validate and strip handler return value through `response` / `sse` schema at runtime (default: `true`). */
  readonly validateResponse?: boolean;
  readonly timeoutMs?: number;
  readonly rateLimit?: RateLimitPolicy;
  /** Declarative HTTP response cache policy (`GET`/`HEAD`) backed by `CachePort` (`CacheToken`). */
  readonly cache?: RouteCachePolicy;
  /** Emit RFC 9110 weak `ETag` and respond `304 Not Modified` when `If-None-Match` matches. */
  readonly etag?: boolean;
}

/**
 * Core HTTP handler context constructed for route methods.
 */
export interface RouteContext<
  Path extends string = string,
  TBody extends StandardSchemaV1 | undefined = undefined,
  TQuery extends StandardSchemaV1 | undefined = undefined,
  TParams extends StandardSchemaV1 | undefined = undefined,
  THeaders extends StandardSchemaV1 | undefined = undefined,
  TUser = unknown,
> {
  readonly params: InferSchemaOr<TParams, PathParams<Path>>;
  readonly query: InferSchemaOr<TQuery, Record<string, string | readonly string[] | undefined>>;
  readonly body: InferSchemaOr<TBody, unknown>;
  readonly headers: InferSchemaOr<THeaders, Record<string, string | readonly string[] | undefined>>;
  readonly user: TUser;
  readonly requestId: string;
  readonly traceId: string | undefined;
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly req: Request;
  readonly res: Response;
}

/**
 * Structured specification object accepted by `Ctx<{ ... }>`.
 */
export interface CtxSpec {
  readonly params?: StandardSchemaV1 | string;
  readonly query?: StandardSchemaV1;
  readonly body?: StandardSchemaV1;
  readonly headers?: StandardSchemaV1;
  readonly user?: unknown;
}

/**
 * Minimal, ergonomic route context type for `@Controller` methods:
 *
 * - `Ctx` -> untyped route context (`req`, `res`, `log`, `requestId`, `traceId`, `signal`)
 * - `Ctx<'/:id'>` -> infers `params: { readonly id: string }`
 * - `Ctx<typeof CreateUserSchema>` -> infers `body: InferSchemaOutput<typeof CreateUserSchema>`
 * - `Ctx<{ params: typeof IdParams; body: typeof UpdateSchema; user: AuthUser }>` -> full structured inference
 */
export type Ctx<TSpec extends StandardSchemaV1 | string | CtxSpec | undefined = undefined> = [
  TSpec,
] extends [undefined]
  ? RouteContext<string, undefined, undefined, undefined, undefined, unknown>
  : TSpec extends string
    ? RouteContext<TSpec, undefined, undefined, undefined, undefined, unknown>
    : TSpec extends StandardSchemaV1
      ? RouteContext<string, TSpec, undefined, undefined, undefined, unknown>
      : TSpec extends CtxSpec
        ? RouteContext<
            TSpec['params'] extends string ? TSpec['params'] : string,
            TSpec['body'] extends StandardSchemaV1 ? TSpec['body'] : undefined,
            TSpec['query'] extends StandardSchemaV1 ? TSpec['query'] : undefined,
            TSpec['params'] extends StandardSchemaV1 ? TSpec['params'] : undefined,
            TSpec['headers'] extends StandardSchemaV1 ? TSpec['headers'] : undefined,
            'user' extends keyof TSpec ? TSpec['user'] : unknown
          >
        : never;

export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handlerName: string;
  readonly takesContext: boolean;
  readonly options: RouteOptions<
    StandardSchemaV1 | undefined,
    StandardSchemaV1 | undefined,
    StandardSchemaV1 | undefined,
    StandardSchemaV1 | undefined,
    StandardSchemaV1 | undefined,
    StandardSchemaV1 | undefined
  >;
  readonly cachePolicy: RouteCachePolicy | undefined;
  readonly guards: readonly AuthGuardInput<unknown, never>[];
  readonly isPublic: boolean;
  readonly middlewares: readonly RequestHandler[];
  readonly methodFn: (this: unknown, ctx?: unknown) => MaybePromise<unknown>;
}

export interface ControllerOptions<Prefix extends string = string> {
  readonly prefix: Prefix;
  readonly version?: string;
  readonly tags?: readonly string[];
}

export type ModuleImport = ConcreteConstructor | DynamicModule;

export interface ModuleMetadata {
  readonly imports?: readonly ModuleImport[];
  readonly controllers?: readonly ConcreteConstructor[];
  readonly providers?: readonly Provider[];
  readonly exports?: readonly Token[];
  readonly global?: boolean;
}

/**
 * Configurable explicit module descriptor (`MyModule.register(options): DynamicModule`)
 * with zero reflection magic.
 */
export interface DynamicModule extends ModuleMetadata {
  readonly module: ConcreteConstructor;
}
