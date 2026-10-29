import {
  isStandardSchema,
  type InferSchemaOutput,
  type StandardSchemaV1,
} from '../common/standard-schema.js';
import { TOKEN_BRAND, type InjectionToken } from '../di/tokens.js';
import { ConfigValidationError } from '../errors/startup-errors.js';

export type EnvironmentProfile = 'development' | 'production' | 'test';

export const CONFIG_BRAND: unique symbol = Symbol.for('better-back.loaded-config');

const SECRET_NAME_PATTERN =
  /(secret|password|passwd|token|api[_-]?key|private[_-]?key|database[_-]?url|jwt|credential)/i;

export interface DefineConfigOptions<TSchema extends StandardSchemaV1> {
  readonly schema: TSchema;
  /** Optional display name for DI diagnostics (default: `"AppConfig"`). */
  readonly name?: string;
  /** Raw environment map (defaults to `process.env`, validated lazily until `.values` or `BetterBack.create()`). */
  readonly env?: Record<string, string | undefined>;
  /** Profile-specific default overrides merged underneath raw `env` variables. */
  readonly profiles?: Partial<Record<EnvironmentProfile, Record<string, unknown>>>;
  /** Additional exact key names to treat as redacted secrets in startup errors and Pino logs. */
  readonly secretKeys?: readonly string[];
}

/**
 * Validated, frozen configuration object that ALSO acts directly as a `better-back` `InjectionToken<Readonly<T>>`.
 * Pass `AppConfig` straight to `BetterBack.create(AppModule, { config: AppConfig })` AND `inject(AppConfig)`!
 */
export interface LoadedConfig<T> extends InjectionToken<Readonly<T>> {
  readonly [CONFIG_BRAND]: true;
  readonly values: Readonly<T>;
  readonly profile: EnvironmentProfile;
  readonly secretKeys: readonly string[];
  /** Re-validates eagerly against a custom `env` map (e.g. in tests) while preserving the exact same DI token identity. */
  from(env: Record<string, string | undefined>): LoadedConfig<T>;
}

export function isLoadedConfig(value: unknown): value is LoadedConfig<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    CONFIG_BRAND in value &&
    (value as Record<symbol, unknown>)[CONFIG_BRAND] === true
  );
}

function detectProfile(env: Record<string, string | undefined>): EnvironmentProfile {
  const raw = env['NODE_ENV'];
  if (raw === 'production' || raw === 'test' || raw === 'development') {
    return raw;
  }
  return 'development';
}

function deepFreeze<T>(obj: T): Readonly<T> {
  if (typeof obj !== 'object' || obj === null || Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (typeof val === 'object' && val !== null) {
      deepFreeze(val);
    }
  }
  return obj;
}

function sanitizeIssueMessage(message: string, rawSecretValue: unknown): string {
  if (typeof rawSecretValue === 'string' && rawSecretValue.length > 0) {
    return message.split(rawSecretValue).join('[REDACTED]');
  }
  return message;
}

function formatIssuePath(
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined,
): { readonly pathStr: string; readonly topKey: string } {
  if (!path || path.length === 0) {
    return { pathStr: '', topKey: '' };
  }
  const parts = path.map((seg) =>
    typeof seg === 'object' && seg !== null && 'key' in seg ? String(seg.key) : String(seg),
  );
  return {
    pathStr: parts.join('.'),
    topKey: parts[0] ?? '',
  };
}

interface ValidatedSnapshot<T> {
  readonly values: Readonly<T>;
  readonly profile: EnvironmentProfile;
  readonly secretKeys: readonly string[];
}

function evaluateConfig<TSchema extends StandardSchemaV1>(
  options: DefineConfigOptions<TSchema>,
): ValidatedSnapshot<InferSchemaOutput<TSchema>> {
  const sourceEnv = options.env ?? process.env;
  const profile = detectProfile(sourceEnv);
  const profileDefaults = options.profiles?.[profile] ?? {};

  const mergedInput: Record<string, unknown> = { ...profileDefaults };
  for (const [key, val] of Object.entries(sourceEnv)) {
    if (val !== undefined) {
      mergedInput[key] = val;
    }
  }

  const secretKeySet = new Set<string>(options.secretKeys ?? []);
  for (const key of Object.keys(mergedInput)) {
    if (SECRET_NAME_PATTERN.test(key)) {
      secretKeySet.add(key);
    }
  }

  const result = options.schema['~standard'].validate(mergedInput);
  if (
    result instanceof Promise ||
    (typeof result === 'object' && result !== null && 'then' in result)
  ) {
    throw new ConfigValidationError([
      {
        path: '',
        message: 'defineConfig(...) requires a synchronous Standard Schema v1 validator.',
      },
    ]);
  }

  if (result.issues) {
    const issues = result.issues.map((issue) => {
      const { pathStr, topKey } = formatIssuePath(issue.path);
      const isSecret = secretKeySet.has(topKey) || SECRET_NAME_PATTERN.test(pathStr);
      const safeMsg = isSecret
        ? `${sanitizeIssueMessage(issue.message, mergedInput[topKey])} (value: [REDACTED])`
        : issue.message;
      return {
        path: pathStr,
        message: safeMsg,
      };
    });
    throw new ConfigValidationError(issues);
  }

  const frozenValues = deepFreeze(result.value as InferSchemaOutput<TSchema>);
  if (typeof frozenValues === 'object' && frozenValues !== null) {
    for (const key of Object.keys(frozenValues as Record<string, unknown>)) {
      if (SECRET_NAME_PATTERN.test(key)) {
        secretKeySet.add(key);
      }
    }
  }

  return {
    values: frozenValues,
    profile,
    secretKeys: Object.freeze([...secretKeySet]),
  };
}

function buildLoadedConfig<TSchema extends StandardSchemaV1>(
  options: DefineConfigOptions<TSchema>,
  tokenId: symbol,
  eager: boolean,
): LoadedConfig<InferSchemaOutput<TSchema>> {
  const description = options.name ?? 'AppConfig';
  let cachedSnapshot: ValidatedSnapshot<InferSchemaOutput<TSchema>> | undefined = eager
    ? evaluateConfig(options)
    : undefined;

  const ensureEvaluated = (): ValidatedSnapshot<InferSchemaOutput<TSchema>> => {
    if (cachedSnapshot === undefined) {
      cachedSnapshot = evaluateConfig(options);
    }
    return cachedSnapshot;
  };

  const tokenObj: LoadedConfig<InferSchemaOutput<TSchema>> = {
    [TOKEN_BRAND]: true as const,
    [CONFIG_BRAND]: true as const,
    description,
    id: tokenId,
    get values(): Readonly<InferSchemaOutput<TSchema>> {
      return ensureEvaluated().values;
    },
    get profile(): EnvironmentProfile {
      return ensureEvaluated().profile;
    },
    get secretKeys(): readonly string[] {
      return ensureEvaluated().secretKeys;
    },
    from(customEnv: Record<string, string | undefined>): LoadedConfig<InferSchemaOutput<TSchema>> {
      return buildLoadedConfig({ ...options, env: customEnv }, tokenId, true);
    },
  };

  return Object.freeze(tokenObj);
}

/**
 * Defines startup-validated environment configuration using Zod v4 (or any synchronous Standard Schema v1),
 * merges optional profile defaults, deep-freezes the result, and redacts sensitive fields from error reports and logs.
 */
export function defineConfig<TSchema extends StandardSchemaV1>(
  schemaOrOptions: TSchema | DefineConfigOptions<TSchema>,
): LoadedConfig<InferSchemaOutput<TSchema>> {
  const options: DefineConfigOptions<TSchema> = isStandardSchema(schemaOrOptions)
    ? { schema: schemaOrOptions }
    : schemaOrOptions;
  const description = options.name ?? 'AppConfig';
  const eager = options.env !== undefined;
  return buildLoadedConfig(options, Symbol(description), eager);
}
