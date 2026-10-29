import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, {
  Router,
  type Application,
  type IRouter,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { LoadedConfig } from './config/config.js';
import { Container, type ModuleProviderRegistration, type Resolver } from './di/container.js';
import {
  isInjectionToken,
  type ConcreteConstructor,
  type Provider,
  type Token,
} from './di/tokens.js';
import { createGlobalErrorFilter, createNotFoundHandler } from './errors/problem-details.js';
import {
  BootstrapError,
  CircularDependencyError,
  DuplicateRouteError,
} from './errors/startup-errors.js';
import {
  createLogger,
  LoggerToken,
  type CreateLoggerOptions,
  type Logger,
} from './logging/logger.js';
import { mountOpenApiDocs } from './openapi/docs-ui.js';
import {
  generateOpenApiDocument,
  type OpenApiDocument,
  type OpenApiOptions,
  type RegisteredRouteMeta,
} from './openapi/generator.js';
import { createSafeBodyParser } from './pipeline/body-parser.js';
import { executeCachedRoute, sendJsonWithEtag } from './pipeline/cache.js';
import {
  extractW3cTraceId,
  getOrCreateRequestMeta,
  getRequestMeta,
  readResponseRequestId,
  type RequestMeta,
} from './pipeline/context.js';
import {
  createCorrelationAndLoggingMiddleware,
  type LifecycleState,
} from './pipeline/correlation.js';
import {
  createLivenessHandler,
  createReadinessHandler,
  type HealthCheck,
} from './pipeline/health.js';
import { createRateLimitMiddleware } from './pipeline/rate-limit.js';
import { createSecurityMiddleware, type SecurityPipelineOptions } from './pipeline/security.js';
import { isSseStream, pipeSseStream, SseStreamImpl, type SseStream } from './pipeline/sse.js';
import { createTimeoutMiddleware } from './pipeline/timeout.js';
import { compileRouteValidator } from './pipeline/validation.js';
import {
  CacheToken,
  InMemoryCache,
  InMemoryMetrics,
  InMemoryRateLimiter,
  MetricsToken,
  RateLimiterToken,
  type CachePort,
  type MetricsPipelineOptions,
  type MetricsPort,
  type RateLimiterPort,
  type RateLimitPolicy,
} from './ports/index.js';
import {
  extractControllerMetadata,
  extractModuleMetadata,
  isDynamicModule,
  type ExtractedControllerMetadata,
} from './routing/decorators.js';
import type {
  AuthGuard,
  AuthGuardInput,
  GuardContext,
  ModuleImport,
  ModuleMetadata,
  RouteContext,
} from './routing/types.js';
import { normalizeRouteSignature, resolveRoutePath } from './routing/versioning.js';

export type TrustProxySetting = boolean | number | string | readonly string[];

export interface BetterBackOptions<TConfig = Record<string, unknown>> {
  /** Validated configuration produced by `defineConfig(...)` (directly injectable via `inject(AppConfig)`). */
  readonly config?: LoadedConfig<TConfig>;
  /** Optional existing Express 5 application to mount onto. */
  readonly expressApp?: Application;
  /**
   * Configures Express `trust proxy` (`true`, hop count `1`, CIDR `'loopback'`, or subnet array)
   * so `req.ip` and rate-limiting honor `X-Forwarded-For` safely behind reverse proxies/load balancers.
   */
  readonly trustProxy?: TrustProxySetting;
  /** Global URI prefix for module controllers (e.g. `"/api/v1"`). */
  readonly apiPrefix?: string;
  /** Structured Pino logger options or pre-built `Logger`. */
  readonly logger?: Logger | CreateLoggerOptions;
  /** Whether to emit info logs for every completed request (default: `true` when log level <= info). */
  readonly logRequests?: boolean;
  /** Security headers & strict CORS configuration (secure-by-default with zero config). */
  readonly security?: SecurityPipelineOptions;
  /** JSON request body size limit (default: `"100kb"`). */
  readonly bodyLimit?: string;
  /** Global request timeout in milliseconds (default: `30_000`; set `0` to disable). */
  readonly timeoutMs?: number;
  /** Emit RFC 9110 weak `ETag` and respond `304 Not Modified` on `GET`/`HEAD` JSON responses. */
  readonly etag?: boolean;
  /** Optional global rate-limit policy. */
  readonly rateLimit?: RateLimitPolicy;
  /** Optional custom `RateLimiterPort` implementation (defaults to bounded `InMemoryRateLimiter`). */
  readonly rateLimiter?: RateLimiterPort;
  /** Optional custom `CachePort` implementation (defaults to bounded LRU `InMemoryCache`). */
  readonly cache?: CachePort;
  /** Opt-in `/metrics` OpenMetrics / Prometheus & JSON telemetry endpoint. */
  readonly metrics?: MetricsPipelineOptions;
  /** Optional custom `MetricsPort` implementation (defaults to bounded `InMemoryMetrics`). */
  readonly metricsCollector?: MetricsPort;
  /** Global `AuthGuard` (or chain of guards) applied to all routes not decorated with `@Public()`. */
  readonly guard?: AuthGuardInput<unknown, never> | readonly AuthGuardInput<unknown, never>[];
  /** Native Express middlewares (`cors()`, `helmet()`, `morgan()`, ...) mounted globally with zero adapters. */
  readonly middleware?: readonly RequestHandler[];
  /** Direct raw `express.Application` setup hook invoked before terminal 404/error handlers. */
  readonly setup?: (expressApp: Application, container: Container) => void;
  /** Readiness probes checked by `GET /ready`. */
  readonly healthChecks?: readonly HealthCheck[];
  /** OpenAPI 3.1 auto-generation & `/docs` options. */
  readonly openapi?: OpenApiOptions;
  /** Graceful shutdown drain deadline in milliseconds (default: `10_000`). */
  readonly shutdownTimeoutMs?: number;
  /** Automatically attach SIGTERM/SIGINT graceful shutdown listeners on `listen()` (default: `true`). */
  readonly enableShutdownHooks?: boolean;
  /** Test mock overrides applied before singleton initialization (`[[Token, mock]]`). */
  readonly overrides?: readonly (readonly [Token, unknown])[];
}

export interface BetterBackApp<TConfig = Record<string, unknown>> {
  /** Direct, unproxied access to the underlying Express 5 `Application`. */
  readonly express: Application;
  /** Explicit DI container instance. */
  readonly container: Container;
  /** Structured JSON logger. */
  readonly logger: Logger;
  /** Active `MetricsPort` collector (`InMemoryMetrics` by default). */
  readonly metrics: MetricsPort;
  /** Validated, frozen configuration values (if `config` was provided). */
  readonly config: Readonly<TConfig>;
  /** Auto-generated OpenAPI 3.1.0 specification object. */
  readonly openApiDocument: OpenApiDocument;
  /** Bound TCP port once `listen()` resolves (`undefined` before `listen()` or after `close()`). */
  readonly port: number | undefined;
  /** Starts listening on `port` (defaults to `config.PORT` or `3000`) and `host` (`"0.0.0.0"`). */
  listen(port?: number, host?: string): Promise<Server>;
  /** Returns the bound base URL (e.g. `"http://127.0.0.1:3000"`) after `listen()`. */
  getUrl(): string;
  /** Drains in-flight HTTP requests, closes the server, and runs `OnApplicationShutdown` hooks. */
  close(signal?: string): Promise<void>;
  /** Explicit Resource Management (`await using app = await BetterBack.create(...)`). */
  [Symbol.asyncDispose](): Promise<void>;
}

interface NormalizedModuleNode {
  readonly name: string;
  readonly metadata: ModuleMetadata;
  readonly importNames: readonly string[];
  readonly isSyntheticControllerModule: boolean;
}

function isLoggerInstance(value: Logger | CreateLoggerOptions | undefined): value is Logger {
  return (
    typeof value === 'object' &&
    value !== null &&
    'info' in value &&
    typeof value.info === 'function'
  );
}

function mergeDynamicMetadata(
  base: ModuleMetadata | undefined,
  dyn: ModuleMetadata,
): ModuleMetadata {
  if (!base) return dyn;
  return {
    imports: [...(base.imports ?? []), ...(dyn.imports ?? [])],
    controllers: [...(base.controllers ?? []), ...(dyn.controllers ?? [])],
    providers: [...(base.providers ?? []), ...(dyn.providers ?? [])],
    exports: [...(base.exports ?? []), ...(dyn.exports ?? [])],
    global: dyn.global ?? base.global,
  };
}

function getModuleInfo(input: ModuleImport): {
  ctor: ConcreteConstructor;
  name: string;
  metadata: ModuleMetadata;
  isSyntheticControllerModule: boolean;
} {
  if (isDynamicModule(input)) {
    const ctor = input.module;
    const baseMeta = extractModuleMetadata(ctor);
    return {
      ctor,
      name: ctor.name || 'DynamicModule',
      metadata: mergeDynamicMetadata(baseMeta, input),
      isSyntheticControllerModule: false,
    };
  }

  const modMeta = extractModuleMetadata(input);
  if (modMeta) {
    return {
      ctor: input,
      name: input.name || 'RootModule',
      metadata: modMeta,
      isSyntheticControllerModule: false,
    };
  }
  const ctrlMeta = extractControllerMetadata(input);
  if (ctrlMeta) {
    return {
      ctor: input,
      name: `${input.name || 'Controller'}Module`,
      metadata: { controllers: [input] },
      isSyntheticControllerModule: true,
    };
  }
  throw new BootstrapError(
    'INVALID_MODULE_ERROR',
    `Class "${input.name || '<Anonymous>'}" is missing @Module(...) (or @Controller(...) for single-controller apps).`,
  );
}

function flattenModuleGraph(root: ModuleImport): readonly NormalizedModuleNode[] {
  const nodes = new Map<ConcreteConstructor, NormalizedModuleNode>();
  const ownerByName = new Map<string, ConcreteConstructor>();
  const visiting = new Set<ConcreteConstructor>();
  const visitStack: string[] = [];
  const ordered: NormalizedModuleNode[] = [];

  const dfs = (current: ModuleImport): string => {
    const info = getModuleInfo(current);
    if (visiting.has(info.ctor)) {
      const idx = visitStack.indexOf(info.name);
      const cycle = [...visitStack.slice(idx >= 0 ? idx : 0), info.name];
      throw new CircularDependencyError('module', cycle, info.name);
    }
    const existing = nodes.get(info.ctor);
    if (existing) {
      return existing.name;
    }

    const collidingCtor = ownerByName.get(info.name);
    if (collidingCtor && collidingCtor !== info.ctor) {
      throw new BootstrapError(
        'DUPLICATE_MODULE_NAME_ERROR',
        `Multiple distinct @Module classes share the name "${info.name}". Give each @Module class a unique identifier.`,
      );
    }
    ownerByName.set(info.name, info.ctor);

    visiting.add(info.ctor);
    visitStack.push(info.name);

    const importNames: string[] = [];
    for (const imp of info.metadata.imports ?? []) {
      importNames.push(dfs(imp));
    }

    visiting.delete(info.ctor);
    visitStack.pop();

    const node: NormalizedModuleNode = {
      name: info.name,
      metadata: info.metadata,
      importNames,
      isSyntheticControllerModule: info.isSyntheticControllerModule,
    };
    nodes.set(info.ctor, node);
    ordered.push(node);
    return node.name;
  };

  dfs(root);
  return ordered;
}

class FastRouteContext implements RouteContext<
  string,
  undefined,
  undefined,
  undefined,
  undefined,
  unknown
> {
  public readonly params: Record<string, string>;
  public readonly query: Record<string, string | readonly string[] | undefined>;
  public readonly body: unknown;
  public readonly headers: Record<string, string | readonly string[] | undefined>;
  public readonly user: unknown;
  public readonly req: Request;
  public readonly res: Response;
  private meta: RequestMeta | undefined;
  private readonly fallbackLogger: Logger;

  public constructor(
    req: Request,
    res: Response,
    meta: RequestMeta | undefined,
    fallbackLogger: Logger,
    params: Record<string, string>,
    query: Record<string, string | readonly string[] | undefined>,
    body: unknown,
    headers: Record<string, string | readonly string[] | undefined>,
    user: unknown,
  ) {
    this.req = req;
    this.res = res;
    this.meta = meta;
    this.fallbackLogger = fallbackLogger;
    this.params = params;
    this.query = query;
    this.body = body;
    this.headers = headers;
    this.user = user;
  }

  public get requestId(): string {
    return this.meta ? this.meta.requestId : readResponseRequestId(this.res, 'direct');
  }

  public get traceId(): string | undefined {
    return this.meta ? this.meta.traceId : extractW3cTraceId(this.req);
  }

  public get signal(): AbortSignal {
    if (!this.meta) {
      this.meta = getOrCreateRequestMeta(this.req, this.res, this.fallbackLogger);
    }
    return this.meta.getSignal(this.req, this.res);
  }

  public get log(): Logger {
    if (!this.meta) {
      this.meta = getOrCreateRequestMeta(this.req, this.res, this.fallbackLogger);
    }
    return this.meta.log;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value instanceof Promise ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { then?: unknown }).then === 'function')
  );
}

function isAuthGuardObject(value: unknown): value is AuthGuard<unknown, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<AuthGuard<unknown, unknown>>).canActivate === 'function'
  );
}

function isTokenGuard(
  guard: AuthGuardInput<unknown, never>,
): guard is Token<AuthGuard<unknown, unknown>> {
  if (isInjectionToken(guard)) return true;
  if (typeof guard === 'function') {
    const proto = (guard as { prototype?: { canActivate?: unknown } }).prototype;
    return Boolean(proto && typeof proto.canActivate === 'function');
  }
  return false;
}

async function executeGuard(
  guard: AuthGuardInput<unknown, never>,
  resolver: Resolver,
  moduleName: string,
  ctx: GuardContext<unknown>,
): Promise<unknown> {
  if (isAuthGuardObject(guard)) {
    return (guard as AuthGuard<unknown, unknown>).canActivate(ctx);
  }
  if (isTokenGuard(guard)) {
    const instance = resolver.resolve(guard as Token<AuthGuard<unknown, unknown>>, moduleName);
    return instance.canActivate(ctx);
  }
  return (guard as (c: GuardContext<unknown>) => unknown)(ctx);
}

function normalizeGlobalGuards(
  input: AuthGuardInput<unknown, never> | readonly AuthGuardInput<unknown, never>[] | undefined,
): readonly AuthGuardInput<unknown, never>[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input as readonly AuthGuardInput<unknown, never>[];
  }
  return [input as AuthGuardInput<unknown, never>];
}

interface CompiledControllerBundle {
  readonly moduleName: string;
  readonly controllerClass: ConcreteConstructor;
  readonly controllerName: string;
  readonly metadata: ExtractedControllerMetadata;
}

function registerClassGuardIfMissing(
  guard: AuthGuardInput<unknown, never>,
  existingProviders: readonly Provider[],
  extras: Provider[],
): void {
  if (typeof guard !== 'function' || !isTokenGuard(guard)) return;
  const ctor = guard as ConcreteConstructor;
  const alreadyPresent =
    existingProviders.some(
      (p) => p === ctor || (typeof p === 'object' && 'provide' in p && p.provide === ctor),
    ) || extras.includes(ctor);
  if (!alreadyPresent) {
    extras.push(ctor);
  }
}

function extractModuleControllers(modules: readonly NormalizedModuleNode[]): {
  readonly extraProvidersByModule: Map<string, Provider[]>;
  readonly bundles: readonly CompiledControllerBundle[];
} {
  const extraProvidersByModule = new Map<string, Provider[]>();
  const bundles: CompiledControllerBundle[] = [];

  for (const mod of modules) {
    const extras: Provider[] = [];
    const declaredProviders = mod.metadata.providers ?? [];

    for (const ctrl of mod.metadata.controllers ?? []) {
      const extracted = extractControllerMetadata(ctrl);
      if (!extracted) {
        throw new BootstrapError(
          'INVALID_CONTROLLER_ERROR',
          `Controller class "${ctrl.name}" in module "${mod.name}" is missing @Controller(...).`,
        );
      }

      const alreadyInProviders = declaredProviders.some(
        (p) => p === ctrl || (typeof p === 'object' && 'provide' in p && p.provide === ctrl),
      );
      if (!alreadyInProviders) {
        extras.push(ctrl);
      }

      if (mod.isSyntheticControllerModule) {
        for (const cg of extracted.classGuards) {
          registerClassGuardIfMissing(cg, declaredProviders, extras);
        }

        for (const r of extracted.routes) {
          for (const mg of r.guards) {
            registerClassGuardIfMissing(mg, declaredProviders, extras);
          }
        }
      }

      bundles.push({
        moduleName: mod.name,
        controllerClass: ctrl,
        controllerName: ctrl.name || 'AnonymousController',
        metadata: extracted,
      });
    }
    extraProvidersByModule.set(mod.name, extras);
  }

  return { extraProvidersByModule, bundles };
}

function createCombinedStreamSignal(
  reqSignal: AbortSignal,
  shutdownSignal: AbortSignal,
): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([reqSignal, shutdownSignal]);
  }
  const ctrl = new AbortController();
  const onAbort = (): void => {
    if (!ctrl.signal.aborted) ctrl.abort();
  };
  if (reqSignal.aborted || shutdownSignal.aborted) {
    ctrl.abort();
  } else {
    reqSignal.addEventListener('abort', onAbort, { once: true });
    shutdownSignal.addEventListener('abort', onAbort, { once: true });
  }
  return ctrl.signal;
}

function pipeRouteSse(
  req: Request,
  res: Response,
  stream: SseStream<unknown>,
  baseLog: Logger,
  shutdownSignal: AbortSignal,
  validator?: ReturnType<typeof compileRouteValidator>,
): Promise<void> {
  const reqSignal = getOrCreateRequestMeta(req, res, baseLog).getSignal(req, res);
  const combinedSignal = createCombinedStreamSignal(reqSignal, shutdownSignal);
  const lastEventHeader = req.headers['last-event-id'];
  const lastEventId = typeof lastEventHeader === 'string' ? lastEventHeader : undefined;
  return pipeSseStream({
    stream,
    res,
    signal: combinedSignal,
    lastEventId,
    validator,
  });
}

function mountBundlesOntoRouter(options: {
  readonly target: Application | Router;
  readonly bundles: readonly CompiledControllerBundle[];
  readonly container: Container;
  readonly logger: Logger;
  readonly apiPrefix?: string;
  readonly globalGuards: readonly AuthGuardInput<unknown, never>[];
  readonly rateLimiter: RateLimiterPort;
  readonly cache: CachePort;
  readonly globalEtag: boolean;
  readonly shutdownSignal: AbortSignal;
}): readonly RegisteredRouteMeta[] {
  const seenSignatures = new Map<string, string>();
  const openApiRoutes: RegisteredRouteMeta[] = [];

  for (const bundle of options.bundles) {
    const isControllerReqScoped = options.container.isRequestScoped(
      bundle.controllerClass,
      bundle.moduleName,
    );
    const singletonControllerInstance = !isControllerReqScoped
      ? options.container.resolve(bundle.controllerClass, bundle.moduleName)
      : undefined;

    const defaultTags = bundle.metadata.options.tags ?? [
      bundle.controllerName.replace(/Controller$/i, '') || bundle.controllerName,
    ];

    for (const routeDef of bundle.metadata.routes) {
      const fullPath = resolveRoutePath({
        apiPrefix: options.apiPrefix,
        version: bundle.metadata.options.version,
        controllerPrefix: bundle.metadata.options.prefix,
        routePath: routeDef.path,
      });

      const signature = normalizeRouteSignature(routeDef.method, fullPath);
      const ownerLabel = `${bundle.controllerName}.${routeDef.handlerName}`;
      const existingOwner = seenSignatures.get(signature);
      if (existingOwner !== undefined) {
        throw new DuplicateRouteError(signature, existingOwner, ownerLabel);
      }
      seenSignatures.set(signature, ownerLabel);

      const effectiveGuards: readonly AuthGuardInput<unknown, never>[] = routeDef.isPublic
        ? []
        : [...options.globalGuards, ...bundle.metadata.classGuards, ...routeDef.guards];

      const guardUsesReqScope = effectiveGuards.some(
        (g) => isTokenGuard(g) && options.container.isRequestScoped(g, bundle.moduleName),
      );

      const needsRequestScope = isControllerReqScoped || guardUsesReqScope;

      const responseOrSseSchema = routeDef.options.sse ?? routeDef.options.response;
      const validator = compileRouteValidator({
        params: routeDef.options.params,
        query: routeDef.options.query,
        headers: routeDef.options.headers,
        body: routeDef.options.body,
        response: routeDef.options.validateResponse === false ? undefined : responseOrSseSchema,
      });

      const effectiveCachePolicy = routeDef.cachePolicy;
      const enableRouteEtag =
        routeDef.options.etag ?? (effectiveCachePolicy !== undefined ? true : options.globalEtag);
      const isSseConfigured = routeDef.options.sse !== undefined;

      const defaultStatus = routeDef.options.status ?? (routeDef.method === 'post' ? 201 : 200);

      const middlewares: RequestHandler[] = [];

      if (routeDef.options.timeoutMs !== undefined) {
        middlewares.push(createTimeoutMiddleware(routeDef.options.timeoutMs, options.logger));
      }

      if (routeDef.options.rateLimit !== undefined) {
        middlewares.push(
          createRateLimitMiddleware(
            options.rateLimiter,
            routeDef.options.rateLimit,
            `${routeDef.method.toUpperCase()}:${fullPath}`,
          ),
        );
      }

      if (bundle.metadata.classMiddlewares.length > 0) {
        middlewares.push(...bundle.metadata.classMiddlewares);
      }

      if (routeDef.middlewares.length > 0) {
        middlewares.push(...routeDef.middlewares);
      }

      const baseLog = options.logger;
      const methodFn = routeDef.methodFn;
      const takesCtx = routeDef.takesContext;
      const singletonInst = singletonControllerInstance;

      const canUseSyncFastPath =
        !needsRequestScope &&
        effectiveGuards.length === 0 &&
        !validator.hasRequestSchemas &&
        !validator.hasResponseSchema &&
        effectiveCachePolicy === undefined &&
        !enableRouteEtag &&
        !isSseConfigured &&
        singletonInst !== undefined;

      const shutdownSig = options.shutdownSignal;

      const terminalHandler: RequestHandler = canUseSyncFastPath
        ? takesCtx
          ? (req, res) => {
              if (res.headersSent) return undefined;

              const routeCtx = new FastRouteContext(
                req,
                res,
                undefined,
                baseLog,
                req.params as Record<string, string>,
                req.query as Record<string, string | readonly string[] | undefined>,
                req.body,
                req.headers as Record<string, string | readonly string[] | undefined>,
                undefined,
              );

              const rawResult = methodFn.call(singletonInst, routeCtx);
              if (isPromiseLike(rawResult)) {
                return rawResult.then((resolved) => {
                  if (res.headersSent || getRequestMeta(req)?.timedOut) return undefined;
                  if (resolved instanceof SseStreamImpl) {
                    return pipeRouteSse(req, res, resolved, baseLog, shutdownSig);
                  }
                  if (defaultStatus === 204 || resolved === undefined) {
                    res.status(defaultStatus).end();
                  } else {
                    res.status(defaultStatus).json(resolved);
                  }
                  return undefined;
                });
              }

              if (rawResult instanceof SseStreamImpl) {
                return pipeRouteSse(req, res, rawResult, baseLog, shutdownSig);
              }

              if (defaultStatus === 204 || rawResult === undefined) {
                res.status(defaultStatus).end();
              } else if (defaultStatus === 200) {
                res.json(rawResult);
              } else {
                res.status(defaultStatus).json(rawResult);
              }
              return undefined;
            }
          : (_req, res) => {
              if (res.headersSent) return undefined;

              const rawResult = methodFn.call(singletonInst);
              if (isPromiseLike(rawResult)) {
                return rawResult.then((resolved) => {
                  if (res.headersSent || getRequestMeta(_req)?.timedOut) return undefined;
                  if (resolved instanceof SseStreamImpl) {
                    return pipeRouteSse(_req, res, resolved, baseLog, shutdownSig);
                  }
                  if (defaultStatus === 204 || resolved === undefined) {
                    res.status(defaultStatus).end();
                  } else {
                    res.status(defaultStatus).json(resolved);
                  }
                  return undefined;
                });
              }

              if (rawResult instanceof SseStreamImpl) {
                return pipeRouteSse(_req, res, rawResult, baseLog, shutdownSig);
              }

              if (defaultStatus === 204 || rawResult === undefined) {
                res.status(defaultStatus).end();
              } else if (defaultStatus === 200) {
                res.json(rawResult);
              } else {
                res.status(defaultStatus).json(rawResult);
              }
              return undefined;
            }
        : async (req, res) => {
            if (res.headersSent || getRequestMeta(req)?.timedOut) return;

            const resolver: Resolver = needsRequestScope
              ? options.container.createRequestScope()
              : options.container;

            let user: unknown = undefined;
            if (effectiveGuards.length > 0) {
              const guardCtx: GuardContext<unknown> = {
                req,
                res,
                get requestId() {
                  return readResponseRequestId(res, 'direct');
                },
                get traceId() {
                  return extractW3cTraceId(req);
                },
                get signal() {
                  return getOrCreateRequestMeta(req, res, baseLog).getSignal(req, res);
                },
                get log() {
                  return getOrCreateRequestMeta(req, res, baseLog).log;
                },
                get user() {
                  return user;
                },
              };

              for (let i = 0; i < effectiveGuards.length; i += 1) {
                const g = effectiveGuards[i]!;
                const nextUser = await executeGuard(g, resolver, bundle.moduleName, guardCtx);
                if (nextUser !== undefined) {
                  user = nextUser;
                }
              }
            }

            const rawValidated = validator.validateRequest(req);
            const validated = isPromiseLike(rawValidated) ? await rawValidated : rawValidated;

            const invokeAndValidate = async (isBackgroundRefresh = false): Promise<unknown> => {
              const controllerInstance = isControllerReqScoped
                ? resolver.resolve(bundle.controllerClass, bundle.moduleName)
                : singletonInst;

              const routeCtx = takesCtx
                ? new FastRouteContext(
                    req,
                    res,
                    undefined,
                    baseLog,
                    validated.params as Record<string, string>,
                    validated.query as Record<string, string | readonly string[] | undefined>,
                    validated.body,
                    validated.headers as Record<string, string | readonly string[] | undefined>,
                    user,
                  )
                : undefined;

              const rawResult = await methodFn.call(controllerInstance, routeCtx);
              if (isSseStream(rawResult)) {
                return rawResult;
              }
              if (!isBackgroundRefresh && (res.headersSent || getRequestMeta(req)?.timedOut)) {
                return undefined;
              }
              if (!isSseConfigured && validator.hasResponseSchema) {
                const rawOutput = validator.validateResponse(rawResult);
                return isPromiseLike(rawOutput) ? await rawOutput : rawOutput;
              }
              return rawResult;
            };

            if (effectiveCachePolicy && (req.method === 'GET' || req.method === 'HEAD')) {
              await executeCachedRoute({
                cache: options.cache,
                policy: effectiveCachePolicy,
                req,
                res,
                user,
                statusCode: defaultStatus,
                enableEtag: enableRouteEtag,
                computeFresh: () => invokeAndValidate(false),
                computeBackgroundRefresh: () => invokeAndValidate(true),
                onBackgroundError: (err) => {
                  baseLog.warn(
                    { err: err instanceof Error ? err.message : String(err), path: fullPath },
                    'stale-while-revalidate background refresh failed',
                  );
                },
              });
              return;
            }

            const output = await invokeAndValidate();
            if (res.headersSent || getRequestMeta(req)?.timedOut) return;

            if (isSseStream(output)) {
              await pipeRouteSse(
                req,
                res,
                output,
                baseLog,
                shutdownSig,
                isSseConfigured ? validator : undefined,
              );
              return;
            }

            if (defaultStatus === 204 || output === undefined) {
              res.status(defaultStatus).end();
            } else if (enableRouteEtag && (req.method === 'GET' || req.method === 'HEAD')) {
              sendJsonWithEtag(req, res, defaultStatus, output);
            } else {
              res.status(defaultStatus).json(output);
            }
          };

      const routerTarget: IRouter = options.target;
      const handlers: RequestHandler[] = [...middlewares, terminalHandler];
      switch (routeDef.method) {
        case 'get':
          routerTarget.get(fullPath, ...handlers);
          break;
        case 'post':
          routerTarget.post(fullPath, ...handlers);
          break;
        case 'put':
          routerTarget.put(fullPath, ...handlers);
          break;
        case 'patch':
          routerTarget.patch(fullPath, ...handlers);
          break;
        case 'delete':
          routerTarget.delete(fullPath, ...handlers);
          break;
        case 'options':
          routerTarget.options(fullPath, ...handlers);
          break;
        case 'head':
          routerTarget.head(fullPath, ...handlers);
          break;
      }

      openApiRoutes.push({
        method: routeDef.method,
        fullPath,
        controllerName: bundle.controllerName,
        handlerName: routeDef.handlerName,
        tags: defaultTags,
        requiresAuth: effectiveGuards.length > 0,
        cachePolicy: effectiveCachePolicy,
        etagEnabled: enableRouteEtag,
        options: routeDef.options,
      });
    }
  }

  return openApiRoutes;
}

export interface ToExpressRouterOptions<TConfig = Record<string, unknown>> {
  /** Optional validated configuration produced by `defineConfig(...)`. */
  readonly config?: LoadedConfig<TConfig>;
  /** Optional pre-existing DI `Container` instance. */
  readonly container?: Container;
  /** Optional structured `Logger` instance. */
  readonly logger?: Logger;
  /** Optional URI prefix applied inside the returned `Router` (e.g. `"/v1"`). */
  readonly apiPrefix?: string;
  /** Emit RFC 9110 weak `ETag` and respond `304 Not Modified` on `GET`/`HEAD` JSON responses. */
  readonly etag?: boolean;
  /** Optional global `AuthGuard` (or chain of guards) applied to all non-`@Public()` routes on this router. */
  readonly guard?: AuthGuardInput<unknown, never> | readonly AuthGuardInput<unknown, never>[];
  /** Optional `RateLimiterPort` implementation (defaults to bounded `InMemoryRateLimiter`). */
  readonly rateLimiter?: RateLimiterPort;
  /** Optional `CachePort` implementation (defaults to bounded LRU `InMemoryCache`). */
  readonly cache?: CachePort;
  /** Optional `MetricsPort` implementation (defaults to bounded `InMemoryMetrics`). */
  readonly metricsCollector?: MetricsPort;
  /** Optional test mock overrides (`[[Token, mock]]`). */
  readonly overrides?: readonly (readonly [Token, unknown])[];
  /** JSON body size limit when `parseBody` is enabled (default: `"100kb"`). */
  readonly bodyLimit?: string;
  /** Safely parse JSON bodies when `req.body` has not already been parsed by the host Express app (default: `true`). */
  readonly parseBody?: boolean;
  /** Mount RFC 7807 `ProblemDetails` error handling on the returned router (default: `true`). */
  readonly handleErrors?: boolean;
}

/**
 * Converts a `@Module`, `DynamicModule`, or `@Controller` into a standard Express 5 `Router` for
 * incremental adoption inside existing Express applications or zero-lock-in ejection.
 */
export async function toExpressRouter<TConfig = Record<string, unknown>>(
  moduleOrController: ModuleImport,
  options: ToExpressRouterOptions<TConfig> = {},
): Promise<Router> {
  const configValues = (options.config?.values ?? Object.freeze({})) as Readonly<TConfig>;
  const secretKeys = options.config?.secretKeys ?? [];
  const flattened = flattenModuleGraph(moduleOrController);
  const container = options.container ?? new Container();
  const logger = options.logger ?? createLogger({ redactPaths: [...secretKeys] });
  let rateLimiter: RateLimiterPort = options.rateLimiter ?? new InMemoryRateLimiter();
  let cache: CachePort = options.cache ?? new InMemoryCache();
  const metricsCollector: MetricsPort = options.metricsCollector ?? new InMemoryMetrics();
  const globalGuards = normalizeGlobalGuards(options.guard);

  const { extraProvidersByModule, bundles } = extractModuleControllers(flattened);

  const registrations: ModuleProviderRegistration[] = flattened.map((node, index) => {
    const isRoot = index === flattened.length - 1;
    const baseProviders: Provider[] = [
      ...(node.metadata.providers ?? []),
      ...(extraProvidersByModule.get(node.name) ?? []),
    ];
    if (isRoot) {
      baseProviders.push({ provide: LoggerToken, useValue: logger });
      if (options.config) {
        baseProviders.push({ provide: options.config, useValue: configValues });
      }
      for (const gg of globalGuards) {
        registerClassGuardIfMissing(gg, baseProviders, baseProviders);
      }
      if (
        !baseProviders.some(
          (p) => typeof p === 'object' && 'provide' in p && p.provide === RateLimiterToken,
        )
      ) {
        baseProviders.push({ provide: RateLimiterToken, useValue: rateLimiter });
      }
      if (
        !baseProviders.some(
          (p) => typeof p === 'object' && 'provide' in p && p.provide === CacheToken,
        )
      ) {
        baseProviders.push({ provide: CacheToken, useValue: cache });
      }
      if (
        !baseProviders.some(
          (p) => typeof p === 'object' && 'provide' in p && p.provide === MetricsToken,
        )
      ) {
        baseProviders.push({ provide: MetricsToken, useValue: metricsCollector });
      }
    }
    return {
      name: node.name,
      imports: node.importNames,
      providers: baseProviders,
      exports: node.metadata.exports ?? [],
      global: Boolean(node.metadata.global) || isRoot,
    };
  });

  container.registerModules(registrations);
  if (options.overrides) {
    for (const [token, mockValue] of options.overrides) {
      container.override(token, mockValue);
    }
  }
  await container.init();
  rateLimiter = container.resolve(RateLimiterToken);
  cache = container.resolve(CacheToken);

  const router = Router();
  const bodyLimit = options.bodyLimit ?? '100kb';
  if (options.parseBody ?? true) {
    const safeParser = createSafeBodyParser(bodyLimit);
    router.use((req, res, next) => {
      if (
        req.body !== undefined ||
        req.method === 'GET' ||
        req.method === 'HEAD' ||
        req.method === 'OPTIONS'
      ) {
        next();
        return;
      }
      safeParser(req, res, next);
    });
  }

  const routerShutdown = new AbortController();

  mountBundlesOntoRouter({
    target: router,
    bundles,
    container,
    logger,
    apiPrefix: options.apiPrefix,
    globalGuards,
    rateLimiter,
    cache,
    globalEtag: Boolean(options.etag),
    shutdownSignal: routerShutdown.signal,
  });

  if (options.handleErrors ?? true) {
    router.use(createGlobalErrorFilter(logger, bodyLimit));
  }

  return router;
}

/**
 * Primary factory for bootstrapping a Better Back application.
 */
export class BetterBack {
  public static async create<TConfig = Record<string, unknown>>(
    rootModule: ModuleImport,
    options: BetterBackOptions<TConfig> = {},
  ): Promise<BetterBackApp<TConfig>> {
    // Reading `.values` eagerly validates `options.config` at startup before any socket opens!
    const configValues = (options.config?.values ?? Object.freeze({})) as Readonly<TConfig>;
    const secretKeys = options.config?.secretKeys ?? [];

    const logger: Logger = isLoggerInstance(options.logger)
      ? options.logger
      : createLogger({
          ...options.logger,
          redactPaths: [...(options.logger?.redactPaths ?? []), ...secretKeys],
        });

    const flattened = flattenModuleGraph(rootModule);
    const container = new Container();

    let rateLimiter: RateLimiterPort = options.rateLimiter ?? new InMemoryRateLimiter();
    let cache: CachePort = options.cache ?? new InMemoryCache();
    let metricsCollector: MetricsPort = options.metricsCollector ?? new InMemoryMetrics();
    const globalGuards = normalizeGlobalGuards(options.guard);

    const { extraProvidersByModule, bundles } = extractModuleControllers(flattened);

    const registrations: ModuleProviderRegistration[] = flattened.map((node, index) => {
      const isRoot = index === flattened.length - 1;
      const providers: Provider[] = [
        ...(node.metadata.providers ?? []),
        ...(extraProvidersByModule.get(node.name) ?? []),
      ];

      if (isRoot) {
        providers.push({ provide: LoggerToken, useValue: logger });
        if (options.config) {
          providers.push({ provide: options.config, useValue: configValues });
        }
        for (const gg of globalGuards) {
          registerClassGuardIfMissing(gg, providers, providers);
        }
        const userProvidedRateLimiter = providers.some(
          (p) => typeof p === 'object' && 'provide' in p && p.provide === RateLimiterToken,
        );
        if (!userProvidedRateLimiter) {
          providers.push({ provide: RateLimiterToken, useValue: rateLimiter });
        }
        const userProvidedCache = providers.some(
          (p) => typeof p === 'object' && 'provide' in p && p.provide === CacheToken,
        );
        if (!userProvidedCache) {
          providers.push({ provide: CacheToken, useValue: cache });
        }
        const userProvidedMetrics = providers.some(
          (p) => typeof p === 'object' && 'provide' in p && p.provide === MetricsToken,
        );
        if (!userProvidedMetrics) {
          providers.push({ provide: MetricsToken, useValue: metricsCollector });
        }
      }

      return {
        name: node.name,
        imports: node.importNames,
        providers,
        exports: node.metadata.exports ?? [],
        global: Boolean(node.metadata.global) || isRoot,
      };
    });

    container.registerModules(registrations);

    if (options.overrides) {
      for (const [token, mockValue] of options.overrides) {
        container.override(token, mockValue);
      }
    }

    await container.init();
    rateLimiter = container.resolve(RateLimiterToken);
    cache = container.resolve(CacheToken);
    metricsCollector = container.resolve(MetricsToken);

    const expressApp = options.expressApp ?? express();
    expressApp.disable('x-powered-by');
    if (options.trustProxy !== undefined) {
      expressApp.set('trust proxy', options.trustProxy);
    }

    const lifecycle: LifecycleState = {
      isShuttingDown: false,
    };
    const shutdownAbortController = new AbortController();

    const bodyLimit = options.bodyLimit ?? '100kb';
    const timeoutMs = options.timeoutMs ?? 30_000;
    const metricsEnabled = Boolean(options.metrics?.enabled);
    const metricsPath = (options.metrics?.path ?? '/metrics').replace(/\/+$/g, '') || '/metrics';

    // Fused Stages 1–4 Pipeline Entry (single Express router layer, zero per-request closures)
    const securityEnabled =
      (options.security?.headers?.enabled ?? true) || Boolean(options.security?.cors);
    const securityStep = securityEnabled ? createSecurityMiddleware(options.security) : undefined;
    const timeoutStep = timeoutMs > 0 ? createTimeoutMiddleware(timeoutMs, logger) : undefined;
    const bodyParseStep = createSafeBodyParser(bodyLimit);
    const isBareEngineFastPath =
      securityStep === undefined && timeoutStep === undefined && !metricsEnabled;

    const correlationStep = createCorrelationAndLoggingMiddleware({
      logger,
      logRequests: options.logRequests,
      lifecycle,
      metrics: metricsEnabled ? metricsCollector : undefined,
      metricsPath,
      bodyParser: isBareEngineFastPath ? bodyParseStep : undefined,
    });

    const noopNext = (): void => {};

    if (securityStep === undefined && timeoutStep === undefined) {
      if (isBareEngineFastPath && !(options.logRequests ?? true)) {
        expressApp.use(correlationStep);
      } else {
        expressApp.use((req, res, next) => {
          if (
            req.method === 'GET' ||
            req.method === 'HEAD' ||
            req.method === 'OPTIONS' ||
            lifecycle.isShuttingDown
          ) {
            correlationStep(req, res, next);
            return;
          }
          correlationStep(req, res, noopNext);
          bodyParseStep(req, res, next);
        });
      }
    } else {
      expressApp.use((req, res, next) => {
        if (lifecycle.isShuttingDown && req.path !== '/health') {
          correlationStep(req, res, next);
          return;
        }

        correlationStep(req, res, noopNext);
        if (securityStep !== undefined) {
          securityStep(req, res, noopNext);
          if (res.writableEnded) return;
        }

        if (timeoutStep !== undefined) {
          timeoutStep(req, res, noopNext);
        }

        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
          next();
          return;
        }

        bodyParseStep(req, res, next);
      });
    }

    if (options.rateLimit) {
      expressApp.use(createRateLimitMiddleware(rateLimiter, options.rateLimit, 'GLOBAL'));
    }

    // Global Native Express Middlewares (cors, helmet, morgan, etc. — zero adapters)
    if (options.middleware) {
      for (const mw of options.middleware) {
        expressApp.use(mw);
      }
    }

    // Raw Express Escape Hatch Hook
    if (options.setup) {
      options.setup(expressApp, container);
    }

    // Compile & Mount Module Controllers FIRST on hot path
    const registeredRoutes = mountBundlesOntoRouter({
      target: expressApp,
      bundles,
      container,
      logger,
      apiPrefix: options.apiPrefix,
      globalGuards,
      rateLimiter,
      cache,
      globalEtag: Boolean(options.etag),
      shutdownSignal: shutdownAbortController.signal,
    });

    // Operational Health, Readiness, Metrics & OpenAPI 3.1 Probes
    expressApp.get('/health', createLivenessHandler());
    expressApp.get(
      '/ready',
      createReadinessHandler(lifecycle, container, options.healthChecks ?? []),
    );
    if (metricsEnabled) {
      expressApp.get(metricsPath, (req, res) => {
        const accept = req.headers.accept ?? '';
        if (accept.includes('application/json')) {
          res.status(200).json(metricsCollector.snapshot());
          return;
        }
        res
          .status(200)
          .type('text/plain; version=0.0.4; charset=utf-8')
          .send(metricsCollector.toPrometheusText());
      });
    }

    const openApiDocument = generateOpenApiDocument(registeredRoutes, {
      ...options.openapi,
      ...(metricsEnabled ? { metricsPath } : {}),
    });
    mountOpenApiDocs(
      expressApp,
      openApiDocument,
      options.openapi,
      options.security?.headers?.frameOptions ?? 'DENY',
    );

    // Catch-all 404 & Terminal RFC 7807 Problem Details Error Filter
    expressApp.use(createNotFoundHandler());
    expressApp.use(createGlobalErrorFilter(logger, bodyLimit));

    let httpServer: Server | undefined;
    let closePromise: Promise<void> | undefined;
    const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 10_000;
    const enableShutdownHooks = options.enableShutdownHooks ?? true;
    const signalListeners: { signal: NodeJS.Signals; handler: () => void }[] = [];

    const appInstance: BetterBackApp<TConfig> = {
      express: expressApp,
      container,
      logger,
      metrics: metricsCollector,
      config: configValues,
      openApiDocument,

      get port(): number | undefined {
        if (!httpServer) return undefined;
        const addr = httpServer.address();
        return typeof addr === 'object' && addr !== null ? addr.port : undefined;
      },

      async listen(port?: number, host = '0.0.0.0'): Promise<Server> {
        const configPort =
          typeof (configValues as Record<string, unknown>)['PORT'] === 'number'
            ? ((configValues as Record<string, unknown>)['PORT'] as number)
            : undefined;
        const resolvedPort = port ?? configPort ?? 3000;

        const server = await new Promise<Server>((resolve, reject) => {
          const srv = expressApp.listen(resolvedPort, host, () => resolve(srv));
          srv.once('error', reject);
        });

        httpServer = server;

        if (enableShutdownHooks) {
          for (const sig of ['SIGTERM', 'SIGINT'] as const) {
            const handler = (): void => {
              void appInstance.close(sig);
            };
            process.once(sig, handler);
            signalListeners.push({ signal: sig, handler });
          }
        }

        const addr = server.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : resolvedPort;
        logger.info(
          { host, port: boundPort, routes: registeredRoutes.length },
          'Better Back listening',
        );
        return server;
      },

      getUrl(): string {
        if (!httpServer) {
          throw new Error('Server is not listening yet. Call await app.listen() first.');
        }
        const addr = httpServer.address() as AddressInfo | string | null;
        if (!addr || typeof addr === 'string') {
          return String(addr ?? '');
        }
        const rawHost =
          addr.address === '0.0.0.0' || addr.address === '::' ? '127.0.0.1' : addr.address;
        const formattedHost = rawHost.includes(':') ? `[${rawHost}]` : rawHost;
        return `http://${formattedHost}:${addr.port}`;
      },

      async close(signal?: string): Promise<void> {
        if (closePromise) return closePromise;

        closePromise = (async () => {
          lifecycle.isShuttingDown = true;
          shutdownAbortController.abort(new Error('Server shutting down'));
          logger.info({ signal }, 'Initiating graceful shutdown');

          for (const { signal: s, handler } of signalListeners) {
            process.removeListener(s, handler);
          }
          signalListeners.length = 0;

          if (httpServer) {
            const serverToClose = httpServer;
            httpServer = undefined;

            serverToClose.closeIdleConnections();
            const idleSweep = setInterval(() => {
              serverToClose.closeIdleConnections();
            }, 15);
            idleSweep.unref();

            const closeServerPromise = new Promise<'closed'>((resolve) => {
              serverToClose.close(() => resolve('closed'));
            });

            const deadlineTimer = new Promise<'timeout'>((resolve) => {
              const t = setTimeout(() => resolve('timeout'), shutdownTimeoutMs);
              t.unref();
            });

            const outcome = await Promise.race([closeServerPromise, deadlineTimer]);
            clearInterval(idleSweep);

            if (outcome === 'timeout') {
              logger.warn(
                { shutdownTimeoutMs },
                'Graceful shutdown drain timed out; forcing remaining connections closed',
              );
              serverToClose.closeAllConnections();
              await closeServerPromise;
            }
          }

          await container.shutdown(signal);
          logger.info(
            { signal: signal ?? 'manual', moduleCount: flattened.length },
            'Graceful shutdown completed',
          );
          logger.flush();
        })();

        return closePromise;
      },

      async [Symbol.asyncDispose](): Promise<void> {
        await appInstance.close('dispose');
      },
    };

    return appInstance;
  }
}
