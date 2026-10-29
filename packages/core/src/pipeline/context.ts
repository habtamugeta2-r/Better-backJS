import type { Request, Response } from 'express';
import type { Logger } from '../logging/logger.js';

const W3C_TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const ALL_ZERO_TRACE_ID = '00000000000000000000000000000000';
const ALL_ZERO_SPAN_ID = '0000000000000000';

/**
 * Parses a valid W3C Trace Context `traceparent` header (`00-<traceId>-<spanId>-<flags>`)
 * and returns the 32-char lowercase hex `traceId` (or `undefined` when absent/invalid).
 */
export function extractW3cTraceId(req: Request): string | undefined {
  const raw = req.headers['traceparent'];
  if (typeof raw !== 'string' || raw.length !== 55) {
    return undefined;
  }
  const match = W3C_TRACEPARENT_RE.exec(raw);
  if (!match) return undefined;
  const traceId = match[1]!.toLowerCase();
  const spanId = match[2]!.toLowerCase();
  if (traceId === ALL_ZERO_TRACE_ID || spanId === ALL_ZERO_SPAN_ID) {
    return undefined;
  }
  return traceId;
}

export interface RequestMeta {
  readonly requestId: string;
  readonly traceId: string | undefined;
  readonly startedAt: number;
  readonly log: Logger;
  timedOut: boolean;
  getSignal(req: Request, res: Response): AbortSignal;
  abort(reason?: unknown): void;
}

const REQUEST_META_MAP = new WeakMap<Request, RequestMeta>();

class RequestMetaImpl implements RequestMeta {
  public readonly requestId: string;
  public readonly traceId: string | undefined;
  public readonly startedAt: number;
  public timedOut = false;
  private readonly baseLogger: Logger;
  private cachedChild: Logger | undefined;
  private abortController: AbortController | undefined;
  private abortReason: unknown;
  private isAborted = false;

  public constructor(
    requestId: string,
    traceId: string | undefined,
    baseLogger: Logger,
    startedAt: number,
  ) {
    this.requestId = requestId;
    this.traceId = traceId;
    this.baseLogger = baseLogger;
    this.startedAt = startedAt;
  }

  public get log(): Logger {
    if (this.cachedChild === undefined) {
      this.cachedChild = this.traceId
        ? this.baseLogger.child({ requestId: this.requestId, traceId: this.traceId })
        : this.baseLogger.child({ requestId: this.requestId });
    }
    return this.cachedChild;
  }

  public getSignal(req: Request, res: Response): AbortSignal {
    if (this.abortController === undefined) {
      const ctrl = new AbortController();
      this.abortController = ctrl;
      if (this.isAborted) {
        ctrl.abort(this.abortReason);
      } else if (req.destroyed && !res.writableFinished) {
        ctrl.abort(new Error('Client disconnected'));
      } else {
        res.once('close', () => {
          if (!res.writableFinished && !ctrl.signal.aborted) {
            ctrl.abort(new Error('Client disconnected'));
          }
        });
      }
    }
    return this.abortController.signal;
  }

  public abort(reason?: unknown): void {
    this.isAborted = true;
    this.abortReason = reason;
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort(reason);
    }
  }
}

export function readResponseRequestId(res: Response, fallback = 'direct'): string {
  const headerVal = res.getHeader('x-request-id');
  return typeof headerVal === 'string' && headerVal.length > 0 ? headerVal : fallback;
}

export function setRequestMeta(
  req: Request,
  requestId: string,
  baseLogger: Logger,
  startedAt = 0,
): RequestMeta {
  const meta = new RequestMetaImpl(requestId, extractW3cTraceId(req), baseLogger, startedAt);
  REQUEST_META_MAP.set(req, meta);
  return meta;
}

export function getRequestMeta(req: Request): RequestMeta | undefined {
  return REQUEST_META_MAP.get(req);
}

export function getOrCreateRequestMeta(
  req: Request,
  res: Response,
  baseLogger: Logger,
): RequestMeta {
  const existing = REQUEST_META_MAP.get(req);
  if (existing !== undefined) return existing;
  return setRequestMeta(req, readResponseRequestId(res, 'unknown'), baseLogger, 0);
}
