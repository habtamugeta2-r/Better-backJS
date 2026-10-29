import type { Request, Response } from 'express';
import type { Logger } from '../logging/logger.js';

export interface RequestMeta {
  readonly requestId: string;
  readonly startedAt: number;
  readonly log: Logger;
  timedOut: boolean;
  getSignal(req: Request, res: Response): AbortSignal;
  abort(reason?: unknown): void;
}

const REQUEST_META_MAP = new WeakMap<Request, RequestMeta>();

class RequestMetaImpl implements RequestMeta {
  public readonly requestId: string;
  public readonly startedAt: number;
  public timedOut = false;
  private readonly baseLogger: Logger;
  private cachedChild: Logger | undefined;
  private abortController: AbortController | undefined;
  private abortReason: unknown;
  private isAborted = false;

  public constructor(requestId: string, baseLogger: Logger, startedAt: number) {
    this.requestId = requestId;
    this.baseLogger = baseLogger;
    this.startedAt = startedAt;
  }

  public get log(): Logger {
    if (this.cachedChild === undefined) {
      this.cachedChild = this.baseLogger.child({ requestId: this.requestId });
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
  const meta = new RequestMetaImpl(requestId, baseLogger, startedAt);
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
