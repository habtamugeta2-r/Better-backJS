/**
 * Better Back (`better-back`) — Unified Decorator-First Public API
 *
 * Minimal syntax, high performance, zero overlap:
 * - Standard ECMAScript Stage-3 decorators (`@Module`, `@Controller`, `@Injectable`, `@Get`, `@Post`, `@Guard`, `@Use`)
 * - 1-line type-safe DI via `inject(Token)` (zero `reflect-metadata`, zero constructor ceremony)
 * - Single-Source-of-Truth Zod v4 contracts + `Ctx<...>` handler typing + auto OpenAPI 3.1 at `/docs`
 * - OWASP security defaults + RFC 7807 `ProblemDetails` out of the box
 */

// Application & Express Interoperability
export {
  BetterBack,
  toExpressRouter,
  type BetterBackApp,
  type BetterBackOptions,
  type TrustProxySetting,
} from './application.js';

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
  type InjectionToken,
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

// Unified Stage-3 Routing, Auth & Middleware Decorators
export {
  Controller,
  createPaginatedResponseSchema,
  createPaginationQuerySchema,
  Delete,
  Get,
  Guard,
  Head,
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

// Infrastructure & Extension Ports (Database / Cache / Rate-Limiter Agnostic)
export {
  CachePortToken,
  CacheToken,
  InMemoryCache,
  InMemoryRateLimiter,
  RateLimiterToken,
  type CachePort,
  type RateLimitDecision,
  type RateLimiterPort,
  type RateLimitPolicy,
} from './ports/index.js';

// Security, Health & Rate-Limit Pipeline Utilities
export {
  createRateLimitMiddleware,
  type CorsOptions,
  type HealthCheck,
  type HealthCheckStatus,
  type SecurityHeadersOptions,
  type SecurityPipelineOptions,
} from './pipeline/index.js';

// OpenAPI 3.1
export {
  generateOpenApiDocument,
  type OpenApiDocument,
  type OpenApiOptions,
} from './openapi/index.js';
