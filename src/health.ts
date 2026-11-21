import type { IRouter } from 'express';

export interface HealthChecks {
  database: () => boolean;
}

/**
 * GET /health: 200 when the process and database are fine, 503 otherwise.
 * Unauthenticated by design (for load balancers and uptime checks), so it reports
 * nothing beyond up/down.
 */
export function registerHealthRoute(router: IRouter, checks: HealthChecks): void {
  router.get('/health', (_req, res) => {
    const database = checks.database() ? 'ok' : 'error';
    const ok = database === 'ok';
    res
      .status(ok ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json({
        status: ok ? 'ok' : 'error',
        checks: { database },
        uptimeSeconds: Math.round(process.uptime()),
      });
  });
}
