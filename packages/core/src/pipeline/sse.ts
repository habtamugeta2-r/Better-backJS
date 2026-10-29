import type { Response } from 'express';
import type { CompiledRouteValidator } from './validation.js';

export const SSE_STREAM_BRAND = Symbol.for('better-back.sse-stream');

export interface SseMessage<T = unknown> {
  /** Optional event ID (`id:` field) allowing clients to resume with `Last-Event-ID`. */
  readonly id?: string;
  /** Optional event name (`event:` field, e.g. `"order.updated"`). */
  readonly event?: string;
  /** Optional client reconnection delay in milliseconds (`retry:` field). */
  readonly retry?: number;
  /** JSON-serializable event payload (`data:` field). */
  readonly data: T;
}

export interface SseControl {
  /** Aborts automatically when the HTTP client disconnects or when `app.close()` drains. */
  readonly signal: AbortSignal;
  /** `Last-Event-ID` header sent by reconnecting `EventSource` clients, if present. */
  readonly lastEventId: string | undefined;
}

export interface SseOptions {
  /** Interval in milliseconds for `: keepalive` comment frames (default: `15_000`; `0` disables). */
  readonly heartbeatMs?: number;
  /** Initial `retry:` reconnection hint in milliseconds sent at stream start. */
  readonly retryMs?: number;
  /** Additional HTTP response headers merged into the SSE response. */
  readonly headers?: Readonly<Record<string, string>>;
}

export type SseProducer<T = unknown> = (
  control: SseControl,
) => AsyncIterable<SseMessage<T> | T> | Iterable<SseMessage<T> | T>;

export interface SseStream<T = unknown> {
  readonly [SSE_STREAM_BRAND]: true;
  readonly producer: SseProducer<T>;
  readonly options: SseOptions;
}

/**
 * Creates a typed Server-Sent Events (`text/event-stream`) stream from an async generator:
 *
 * ```ts
 * @Get('/events', { sse: OrderEventSchema })
 * streamEvents() {
 *   return sse(async function* ({ signal }) {
 *     yield { event: 'connected', data: { ok: true } };
 *   });
 * }
 * ```
 */
export class SseStreamImpl<T> implements SseStream<T> {
  public readonly [SSE_STREAM_BRAND] = true as const;
  public readonly producer: SseProducer<T>;
  public readonly options: SseOptions;

  public constructor(producer: SseProducer<T>, options: SseOptions) {
    this.producer = producer;
    this.options = options;
  }
}

export function sse<T>(producer: SseProducer<T>, options: SseOptions = {}): SseStream<T> {
  return new SseStreamImpl(producer, options);
}

export function isSseStream(value: unknown): value is SseStream<unknown> {
  if (value instanceof SseStreamImpl) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const ctor = (value as { constructor?: unknown }).constructor;
  if (ctor === Object || ctor === Array) {
    return false;
  }
  return SSE_STREAM_BRAND in value && (value as Record<symbol, unknown>)[SSE_STREAM_BRAND] === true;
}

function isSseEnvelope(item: unknown): item is SseMessage<unknown> {
  return (
    typeof item === 'object' &&
    item !== null &&
    'data' in item &&
    Object.keys(item as Record<string, unknown>).every(
      (k) => k === 'data' || k === 'event' || k === 'id' || k === 'retry',
    )
  );
}

function sanitizeSingleLineField(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

export function formatSseFrame(envelope: SseMessage<unknown>, serializedData: string): string {
  let frame = '';
  if (envelope.id !== undefined) {
    frame += `id: ${sanitizeSingleLineField(envelope.id)}\n`;
  }
  if (envelope.event !== undefined) {
    frame += `event: ${sanitizeSingleLineField(envelope.event)}\n`;
  }
  if (envelope.retry !== undefined && Number.isFinite(envelope.retry) && envelope.retry >= 0) {
    frame += `retry: ${Math.floor(envelope.retry)}\n`;
  }
  const lines = serializedData.split(/\r?\n/);
  for (const line of lines) {
    frame += `data: ${line}\n`;
  }
  frame += '\n';
  return frame;
}

export async function pipeSseStream(options: {
  readonly stream: SseStream<unknown>;
  readonly res: Response;
  readonly signal: AbortSignal;
  readonly lastEventId: string | undefined;
  readonly validator?: CompiledRouteValidator;
}): Promise<void> {
  const { stream, res, signal, lastEventId, validator } = options;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (stream.options.headers) {
    for (const [k, v] of Object.entries(stream.options.headers)) {
      res.setHeader(k, v);
    }
  }

  res.flushHeaders();

  if (stream.options.retryMs !== undefined && stream.options.retryMs >= 0) {
    res.write(`retry: ${Math.floor(stream.options.retryMs)}\n\n`);
  }

  const heartbeatMs = stream.options.heartbeatMs ?? 15_000;
  const heartbeatTimer =
    heartbeatMs > 0
      ? setInterval(() => {
          if (!res.writableEnded && !signal.aborted) {
            res.write(': keepalive\n\n');
          }
        }, heartbeatMs)
      : undefined;
  heartbeatTimer?.unref();

  const iterable = stream.producer({ signal, lastEventId });
  const iterator =
    Symbol.asyncIterator in iterable
      ? (iterable as AsyncIterable<unknown>)[Symbol.asyncIterator]()
      : (iterable as Iterable<unknown>)[Symbol.iterator]();

  const abortPromise = new Promise<{ readonly done: true; readonly value: undefined }>(
    (resolve) => {
      if (signal.aborted) {
        resolve({ done: true, value: undefined });
        return;
      }
      signal.addEventListener('abort', () => resolve({ done: true, value: undefined }), {
        once: true,
      });
    },
  );

  try {
    while (!signal.aborted && !res.writableEnded) {
      const nextStep = await Promise.race([Promise.resolve(iterator.next()), abortPromise]);

      if (nextStep.done || signal.aborted || res.writableEnded) {
        break;
      }

      const rawItem = nextStep.value;
      const envelope: SseMessage<unknown> = isSseEnvelope(rawItem) ? rawItem : { data: rawItem };

      let validatedData = envelope.data;
      if (validator?.hasResponseSchema) {
        validatedData = await validator.validateResponse(envelope.data);
      }

      const serialized =
        typeof validatedData === 'string' ? validatedData : JSON.stringify(validatedData);
      res.write(formatSseFrame(envelope, serialized));
    }
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (typeof iterator.return === 'function') {
      try {
        await iterator.return(undefined);
      } catch {
        // Ignore producer cleanup errors after disconnect
      }
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
}
