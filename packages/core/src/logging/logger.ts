import pino, { type DestinationStream, type Logger as PinoInstance } from 'pino';
import { createToken } from '../di/tokens.js';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/**
 * Framework-agnostic structured logger interface exposed via DI (`LoggerToken`) and `RouteContext.log`.
 */
export interface Logger {
  readonly level: string;
  fatal(bindings: Record<string, unknown>, message?: string): void;
  fatal(message: string): void;
  error(bindings: Record<string, unknown>, message?: string): void;
  error(message: string): void;
  warn(bindings: Record<string, unknown>, message?: string): void;
  warn(message: string): void;
  info(bindings: Record<string, unknown>, message?: string): void;
  info(message: string): void;
  debug(bindings: Record<string, unknown>, message?: string): void;
  debug(message: string): void;
  trace(bindings: Record<string, unknown>, message?: string): void;
  trace(message: string): void;
  child(bindings: Record<string, unknown>): Logger;
  flush(): void;
}

export interface CreateLoggerOptions {
  readonly level?: LogLevel;
  readonly name?: string;
  readonly redactPaths?: readonly string[];
  readonly destination?: DestinationStream;
}

const DEFAULT_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-api-key"]',
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
  'apiKey',
  'jwtSecret',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.jwtSecret',
  '*.DATABASE_URL',
  '*.JWT_SECRET',
];

function wrapPino(instance: PinoInstance): Logger {
  return {
    get level(): string {
      return instance.level;
    },
    fatal(arg1: Record<string, unknown> | string, arg2?: string): void {
      if (typeof arg1 === 'string') instance.fatal(arg1);
      else instance.fatal(arg1, arg2);
    },
    error(arg1: Record<string, unknown> | string, arg2?: string): void {
      if (typeof arg1 === 'string') instance.error(arg1);
      else instance.error(arg1, arg2);
    },
    warn(arg1: Record<string, unknown> | string, arg2?: string): void {
      if (typeof arg1 === 'string') instance.warn(arg1);
      else instance.warn(arg1, arg2);
    },
    info(arg1: Record<string, unknown> | string, arg2?: string): void {
      if (typeof arg1 === 'string') instance.info(arg1);
      else instance.info(arg1, arg2);
    },
    debug(arg1: Record<string, unknown> | string, arg2?: string): void {
      if (typeof arg1 === 'string') instance.debug(arg1);
      else instance.debug(arg1, arg2);
    },
    trace(arg1: Record<string, unknown> | string, arg2?: string): void {
      if (typeof arg1 === 'string') instance.trace(arg1);
      else instance.trace(arg1, arg2);
    },
    child(bindings: Record<string, unknown>): Logger {
      return wrapPino(instance.child(bindings));
    },
    flush(): void {
      instance.flush();
    },
  };
}

function buildSafeRedactPaths(customKeys: readonly string[] = []): string[] {
  const pathSet = new Set<string>(DEFAULT_REDACT_PATHS);
  const safeIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  for (const key of customKeys) {
    if (safeIdentifier.test(key)) {
      pathSet.add(key);
      pathSet.add(`*.${key}`);
      pathSet.add(`config.${key}`);
    } else if (key.includes('.')) {
      pathSet.add(key);
    }
  }
  return [...pathSet];
}

/**
 * Creates a structured JSON logger powered by `pino` with automatic credential redaction.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const defaultLevel: LogLevel = process.env['NODE_ENV'] === 'test' ? 'silent' : 'info';

  const pinoOptions: pino.LoggerOptions = {
    level: options.level ?? defaultLevel,
    ...(options.name ? { name: options.name } : {}),
    redact: {
      paths: buildSafeRedactPaths(options.redactPaths),
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  const instance = options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions);

  return wrapPino(instance);
}

/**
 * DI InjectionToken for the application's structured `Logger`.
 */
export const LoggerToken = createToken<Logger>('Logger');
