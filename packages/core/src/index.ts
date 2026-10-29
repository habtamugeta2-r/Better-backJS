/**
 * Better Back (`better-back`) v1.1 — Unified Decorator-First Public API
 *
 * Minimal syntax, high performance, zero overlap:
 * - Standard ECMAScript Stage-3 decorators (`@Module`, `@Controller`, `@Injectable`, `@Get`, `@Post`, `@Cache`, `@Guard`, `@Use`)
 * - 1-line type-safe DI via `inject(Token)` + optional/default injection + `DynamicModule`
 * - Single-Source-of-Truth Zod v4 / Standard Schema v1 contracts + `Ctx<...>` + auto OpenAPI 3.1 at `/docs`
 * - Declarative HTTP caching & conditional `ETag` (`304 Not Modified`), typed SSE (`sse()`), W3C `traceparent` & `/metrics`
 * - OWASP security defaults + RFC 7807 `ProblemDetails` out of the box
 */

// Application & Express Interoperability
export {
  BetterBack,
  toExpressRouter,
  type BetterBackApp,
  type BetterBackOptions,
  type ToExpressRouterOptions,
  type TrustProxySetting,
} from './application.js';

// Standard Schema v1 (`~standard`) Interoperability
export {
  isStandardSchema,
  type InferSchemaInput,
  type InferSchemaOutput,
  type StandardJsonSchemaConverter,
  type StandardJsonSchemaOptions,
  type StandardJsonSchemaTarget,
  type StandardSchemaFailureResult,
  type StandardSchemaIssue,
  type StandardSchemaOptions,
  type StandardSchemaPathSegment,
  type StandardSchemaProps,
  type StandardSchemaResult,
  type StandardSchemaSuccessResult,
  type StandardSchemaTypes,
  type StandardSchemaV1,
} from './common/standard-schema.js';

// Testing Utilities
export {
  createTestingApp,
  resolveForTest,
  type CreateTestingAppOptions,
  type ProviderOverrideTuple,
} from './testing.js';

// Dependency Injection & 1-Line `inject(Token)`
export {
  Container,
  createToken,
  formatTokenName,
  inject,
  Injectable,
  isInjectionToken,
  TOKEN_BRAND,
  type AbstractConstructor,
  type ClassProvider,
  type ConcreteConstructor,
  type FactoryProvider,
  type InjectableOptions,
  type InjectDefaultOptions,
  type InjectionToken,
  type InjectOptionalOptions,
  type InjectOptions,
  type ModuleProviderRegistration,
  type OnApplicationShutdown,
  type OnModuleInit,
  type Provider,
  type Resolver,
  type Scope,
  type Token,
  type TokenValue,
  type ValueProvider,
} from './di/index.js';

// Unified Stage-3 Routing, Caching, Auth & Middleware Decorators
export {
  Cache,
  Controller,
  createPaginatedResponseSchema,
  createPaginationQuerySchema,
  Delete,
  Get,
  Guard,
  Head,
  isDynamicModule,
  Module,
  normalizeRouteSignature,
  Options,
  paginate,
  PaginationMetaSchema,
  PaginationQuerySchema,
  Patch,
  Post,
  Public,
  Put,
  resolveRoutePath,
  toOpenApiPath,
  Use,
  type AuthGuard,
  type AuthGuardFn,
  type AuthGuardInput,
  type ControllerOptions,
  type Ctx,
  type CtxSpec,
  type DeepReadonly,
  type DocumentedErrorStatus,
  type DynamicModule,
  type EffectiveGuardsUser,
  type ExtractRouteParamNames,
  type GuardContext,
  type GuardDecorator,
  type GuardProbeContext,
  type HttpMethod,
  type InferResponseOutput,
  type InferSchemaOr,
  type InferSingleGuardUser,
  type MaybePromise,
  type ModuleImport,
  type ModuleMetadata,
  type PaginatedResult,
  type PaginationMeta,
  type PaginationOptions,
  type PaginationQuery,
  type PathParams,
  type ResolvePathOptions,
  type RouteContext,
  type RouteDefinition,
  type RouteOptions,
} from './routing/index.js';

// Configuration & Secret Redaction (`AppConfig` is directly injectable via `inject(AppConfig)`)
export {
  CONFIG_BRAND,
  defineConfig,
  isLoadedConfig,
  type DefineConfigOptions,
  type EnvironmentProfile,
  type LoadedConfig,
} from './config/index.js';

// Errors & RFC 7807 Problem Details
export {
  AppError,
  BadRequestError,
  BootstrapError,
  CircularDependencyError,
  ConfigValidationError,
  ConflictError,
  createGlobalErrorFilter,
  createNotFoundHandler,
  DuplicateProviderError,
  DuplicateRouteError,
  ForbiddenError,
  InternalServerError,
  MissingProviderError,
  normalizeToAppError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitExceededError,
  RequestTimeoutError,
  SecurityConfigError,
  ServiceUnavailableError,
  TooManyRequestsError,
  toProblemDetails,
  UnauthorizedError,
  UnprocessableEntityError,
  ValidationError,
  type AppErrorOptions,
  type ProblemDetails,
  type ValidationIssue,
} from './errors/index.js';

// Structured Logging
export {
  createLogger,
  LoggerToken,
  type CreateLoggerOptions,
  type Logger,
  type LogLevel,
} from './logging/index.js';

// Infrastructure & Extension Ports (Database / Cache / Rate-Limiter / Metrics Agnostic)
export {
  cacheGetOrSet,
  CachePortToken,
  CacheToken,
  InMemoryCache,
  InMemoryMetrics,
  InMemoryRateLimiter,
  MetricsToken,
  RateLimiterToken,
  type CachePort,
  type HttpMetricObservation,
  type MetricLabels,
  type MetricsPipelineOptions,
  type MetricsPort,
  type MetricsSnapshot,
  type RateLimitDecision,
  type RateLimiterPort,
  type RateLimitPolicy,
} from './ports/index.js';

// Security, Caching, SSE, Tracing, Health & Rate-Limit Pipeline Utilities
export {
  computeWeakEtag,
  createRateLimitMiddleware,
  extractW3cTraceId,
  isSseStream,
  matchesIfNoneMatch,
  sse,
  SSE_STREAM_BRAND,
  type CorsOptions,
  type HealthCheck,
  type HealthCheckStatus,
  type RouteCachePolicy,
  type SecurityHeadersOptions,
  type SecurityPipelineOptions,
  type SseControl,
  type SseMessage,
  type SseOptions,
  type SseProducer,
  type SseStream,
} from './pipeline/index.js';

// OpenAPI 3.1
export {
  generateOpenApiDocument,
  type OpenApiDocument,
  type OpenApiOptions,
  type OpenApiServer,
} from './openapi/index.js';
