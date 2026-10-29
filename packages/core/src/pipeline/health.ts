import type { RequestHandler } from 'express';
import type { Resolver } from '../di/container.js';
import { ServiceUnavailableError } from '../errors/app-error.js';
import type { LifecycleState } from './correlation.js';

export interface HealthCheckStatus {
  readonly healthy: boolean;
  readonly detail?: string;
}

/**
 * Readiness probe check for databases, caches, or upstream services (`/ready`).
 * Receives the active DI `Resolver` so checks can resolve repositories or pools directly.
 */
export interface HealthCheck {
  readonly name: string;
  check(container: Resolver): Promise<HealthCheckStatus> | HealthCheckStatus;
}

/**
 * `/health` liveness endpoint — lightweight check confirming the Node event loop is responsive.
 */
export function createLivenessHandler(): RequestHandler {
  return (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
    });
  };
}

/**
 * `/ready` readiness endpoint — verifies graceful-shutdown drain state and all registered
 * `HealthCheck` probes before routing traffic to this instance.
 */
export function createReadinessHandler(
  lifecycle: LifecycleState,
  container: Resolver,
  checksList: readonly HealthCheck[],
): RequestHandler {
  return async (_req, res) => {
    if (lifecycle.isShuttingDown) {
      throw new ServiceUnavailableError('Instance is draining connections for shutdown.');
    }

    const checks: Record<string, { status: 'up' | 'down'; detail?: string }> = {};
    let allHealthy = true;

    for (const item of checksList) {
      try {
        const result = await item.check(container);
        checks[item.name] = {
          status: result.healthy ? 'up' : 'down',
          ...(result.detail ? { detail: result.detail } : {}),
        };
        if (!result.healthy) {
          allHealthy = false;
        }
      } catch (err) {
        allHealthy = false;
        checks[item.name] = {
          status: 'down',
          detail: err instanceof Error ? err.message : 'Health check failed',
        };
      }
    }

    if (!allHealthy) {
      const failedNames = Object.entries(checks)
        .filter(([, v]) => v.status === 'down')
        .map(([k]) => k)
        .join(', ');
      throw new ServiceUnavailableError(`Readiness check failed for: ${failedNames}`);
    }

    res.status(200).json({
      status: 'ready',
      checks,
    });
  };
}
