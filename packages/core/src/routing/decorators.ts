import type { RequestHandler } from 'express';
import type { z } from 'zod';
import {
  ensureOwnArray,
  ensureOwnMap,
  ensureOwnSet,
  hasOwnMetadata,
  readClassMetadata,
  type MetadataRecord,
} from '../common/metadata.js';
import type { ConcreteConstructor } from '../di/tokens.js';
import type {
  AuthGuardInput,
  ControllerOptions,
  EffectiveGuardsUser,
  GuardProbeContext,
  HttpMethod,
  InferResponseOutput,
  MaybePromise,
  ModuleMetadata,
  RouteContext,
  RouteDefinition,
  RouteOptions,
} from './types.js';

const MODULE_META_KEY = Symbol.for('better-back.module');
const CONTROLLER_META_KEY = Symbol.for('better-back.controller');
const ROUTES_META_KEY = Symbol.for('better-back.routes');
const CLASS_MIDDLEWARE_KEY = Symbol.for('better-back.class-middleware');
const METHOD_MIDDLEWARE_KEY = Symbol.for('better-back.method-middleware');
const CLASS_GUARDS_KEY = Symbol.for('better-back.class-guards');
const METHOD_GUARDS_KEY = Symbol.for('better-back.method-guards');
const METHOD_PUBLIC_KEY = Symbol.for('better-back.method-public');

interface RawPendingRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handlerName: string;
  readonly takesContext: boolean;
  readonly options: RouteDefinition['options'];
  readonly methodFn: (this: unknown, ctx?: unknown) => MaybePromise<unknown>;
}

/**
 * Declares an explicit Better Back `@Module({ imports, controllers, providers, exports })`.
 */
export function Module(metadata: ModuleMetadata = {}) {
  return function <TClass extends ConcreteConstructor>(
    _target: TClass,
    context: ClassDecoratorContext<TClass>,
  ): void {
    if (context.kind !== 'class') {
      throw new TypeError('@Module can only decorate classes.');
    }
    const meta = context.metadata as MetadataRecord;
    meta[MODULE_META_KEY] = metadata;
  };
}

/**
 * Declares an HTTP `@Controller('/users')` or `@Controller({ prefix: '/users', version: '1', tags: ['Users'] })`.
 */
export function Controller<const Prefix extends string = '/'>(
  prefixOrOptions: Prefix | ControllerOptions<Prefix> = '/' as Prefix,
) {
  return function <TClass extends ConcreteConstructor>(
    _target: TClass,
    context: ClassDecoratorContext<TClass>,
  ): void {
    if (context.kind !== 'class') {
      throw new TypeError('@Controller can only decorate classes.');
    }
    const options: ControllerOptions<string> =
      typeof prefixOrOptions === 'string'
        ? { prefix: prefixOrOptions }
        : (prefixOrOptions as ControllerOptions<string>);
    const meta = context.metadata as MetadataRecord;
    meta[CONTROLLER_META_KEY] = options;
  };
}

function methodAcceptsContext(fn: (...args: never[]) => unknown): boolean {
  if (fn.length > 0) return true;
  const src = Function.prototype.toString.call(fn);
  return /^[^{]*\(\s*\.\.\./.test(src);
}

function createHttpMethodDecorator(method: HttpMethod) {
  return function <
    const Path extends string = '/',
    TBody extends z.ZodType | undefined = undefined,
    TQuery extends z.ZodType | undefined = undefined,
    TParams extends z.ZodType | undefined = undefined,
    THeaders extends z.ZodType | undefined = undefined,
    TRes extends z.ZodType | undefined = undefined,
  >(path: Path = '/' as Path, options: RouteOptions<TBody, TQuery, TParams, THeaders, TRes> = {}) {
    return function <This extends object, TUser = unknown>(
      target: (
        this: This,
        ctx: RouteContext<Path, TBody, TQuery, TParams, THeaders, TUser>,
      ) => MaybePromise<InferResponseOutput<TRes>>,
      context: ClassMethodDecoratorContext<This>,
    ): void {
      if (context.kind !== 'method') {
        throw new TypeError(`@${method.toUpperCase()} can only decorate class methods.`);
      }
      const meta = context.metadata as MetadataRecord;
      const routes = ensureOwnArray<RawPendingRoute>(meta, ROUTES_META_KEY);
      const methodName = String(context.name);

      routes.push({
        method,
        path,
        handlerName: methodName,
        takesContext: methodAcceptsContext(target as (...args: never[]) => unknown),
        options: options as RouteDefinition['options'],
        methodFn: target as (this: unknown, ctx?: unknown) => MaybePromise<unknown>,
      });
    };
  };
}

export const Get = createHttpMethodDecorator('get');
export const Post = createHttpMethodDecorator('post');
export const Put = createHttpMethodDecorator('put');
export const Patch = createHttpMethodDecorator('patch');
export const Delete = createHttpMethodDecorator('delete');
export const Options = createHttpMethodDecorator('options');
export const Head = createHttpMethodDecorator('head');

/**
 * Attaches native Express middleware (`cors()`, `helmet()`, `morgan()`, custom `RequestHandler`)
 * to either a `@Controller` class or an individual route method with zero adapters.
 */
export function Use(...middlewares: readonly RequestHandler[]) {
  return function (
    _target: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void {
    const meta = context.metadata as MetadataRecord;
    if (context.kind === 'class') {
      const list = ensureOwnArray<RequestHandler>(meta, CLASS_MIDDLEWARE_KEY);
      list.unshift(...middlewares);
    } else if (context.kind === 'method') {
      const map = ensureOwnMap<PropertyKey, RequestHandler[]>(meta, METHOD_MIDDLEWARE_KEY);
      const current = map.get(context.name) ?? [];
      current.unshift(...middlewares);
      map.set(context.name, current);
    }
  };
}

export interface GuardDecorator<TUser> {
  <TClass extends ConcreteConstructor>(
    target: TClass,
    context: ClassDecoratorContext<TClass>,
  ): void;
  <This extends object>(
    target: (this: This, ctx: GuardProbeContext<TUser>) => unknown,
    context: ClassMethodDecoratorContext<This>,
  ): void;
}

/**
 * Attaches one or more composable `AuthGuard`s (`@Guard(BearerAuthGuard, AdminRoleGuard)`)
 * to a `@Controller` or route method.
 *
 * - Guards execute deterministically in pipeline order: `global -> @Controller -> method`
 *   (all bypassed when `@Public()` is present on the route method).
 * - Enforces at compile time that the guarded method's `Ctx<{ user: ... }>` type matches
 *   the `TUser` returned by the guard chain.
 */
export function Guard<
  const TGuards extends readonly [
    AuthGuardInput<unknown, never>,
    ...AuthGuardInput<unknown, never>[],
  ],
>(...guards: TGuards): GuardDecorator<EffectiveGuardsUser<TGuards>> {
  const applyGuard = (
    _target: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    const meta = context.metadata as MetadataRecord;
    if (context.kind === 'class') {
      const list = ensureOwnArray<AuthGuardInput<unknown, never>>(meta, CLASS_GUARDS_KEY);
      // Multiple stacked @Guard decorators on a class evaluate bottom-up in JS; prepend if stacked
      // while preserving left-to-right order within `@Guard(FirstGuard, SecondGuard)`.
      list.unshift(...guards);
    } else if (context.kind === 'method') {
      const map = ensureOwnMap<PropertyKey, AuthGuardInput<unknown, never>[]>(
        meta,
        METHOD_GUARDS_KEY,
      );
      const current = map.get(context.name) ?? [];
      // Stacked method decorators evaluate bottom-up in Stage-3 JS; unshift keeps top-to-bottom source order!
      current.unshift(...guards);
      map.set(context.name, current);
    }
  };

  return applyGuard as GuardDecorator<EffectiveGuardsUser<TGuards>>;
}

/**
 * Marks a route method as public, bypassing all global, `@Controller`, and method `@Guard`s.
 */
export function Public() {
  return function (_target: unknown, context: ClassMethodDecoratorContext): void {
    const meta = context.metadata as MetadataRecord;
    ensureOwnSet<PropertyKey>(meta, METHOD_PUBLIC_KEY).add(context.name);
  };
}

export function extractModuleMetadata(ctor: ConcreteConstructor): ModuleMetadata | undefined {
  const meta = readClassMetadata(ctor);
  if (!meta || !hasOwnMetadata(meta, MODULE_META_KEY)) {
    return undefined;
  }
  return meta[MODULE_META_KEY] as ModuleMetadata;
}

export interface ExtractedControllerMetadata {
  readonly options: ControllerOptions<string>;
  readonly classGuards: readonly AuthGuardInput<unknown, never>[];
  readonly classMiddlewares: readonly RequestHandler[];
  readonly routes: readonly RouteDefinition[];
}

export function extractControllerMetadata(
  ctor: ConcreteConstructor,
): ExtractedControllerMetadata | undefined {
  const meta = readClassMetadata(ctor);
  if (!meta || !hasOwnMetadata(meta, CONTROLLER_META_KEY)) {
    return undefined;
  }

  const baseOptions = meta[CONTROLLER_META_KEY] as ControllerOptions<string>;
  const classMiddlewares = hasOwnMetadata(meta, CLASS_MIDDLEWARE_KEY)
    ? (meta[CLASS_MIDDLEWARE_KEY] as RequestHandler[])
    : [];
  const classGuards = hasOwnMetadata(meta, CLASS_GUARDS_KEY)
    ? (meta[CLASS_GUARDS_KEY] as AuthGuardInput<unknown, never>[])
    : [];

  const methodMwMap = hasOwnMetadata(meta, METHOD_MIDDLEWARE_KEY)
    ? (meta[METHOD_MIDDLEWARE_KEY] as Map<PropertyKey, RequestHandler[]>)
    : undefined;
  const methodGuardsMap = hasOwnMetadata(meta, METHOD_GUARDS_KEY)
    ? (meta[METHOD_GUARDS_KEY] as Map<PropertyKey, AuthGuardInput<unknown, never>[]>)
    : undefined;
  const publicSet = hasOwnMetadata(meta, METHOD_PUBLIC_KEY)
    ? (meta[METHOD_PUBLIC_KEY] as Set<PropertyKey>)
    : undefined;

  const rawRoutes = hasOwnMetadata(meta, ROUTES_META_KEY)
    ? (meta[ROUTES_META_KEY] as RawPendingRoute[])
    : [];

  const mergedRoutes: RouteDefinition[] = rawRoutes.map((r) => ({
    method: r.method,
    path: r.path,
    handlerName: r.handlerName,
    takesContext: r.takesContext,
    options: r.options,
    guards: methodGuardsMap?.get(r.handlerName) ?? [],
    isPublic: publicSet?.has(r.handlerName) ?? false,
    middlewares: methodMwMap?.get(r.handlerName) ?? [],
    methodFn: r.methodFn,
  }));

  return {
    options: baseOptions,
    classGuards,
    classMiddlewares,
    routes: mergedRoutes,
  };
}
