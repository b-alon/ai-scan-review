import type { FastifyInstance } from 'fastify';

export interface HealthDeps {
  role: string;
  version: string;
  summarizerMode: string;
  checkDb: () => Promise<void>;
  isQueueReady: () => boolean;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get('/api/health', async () => ({
    ok: true,
    role: deps.role,
    version: deps.version,
    summarizer: deps.summarizerMode,
  }));

  app.get('/api/ready', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await deps.checkDb();
      checks.db = 'ok';
    } catch (err) {
      checks.db = err instanceof Error ? err.message : String(err);
    }
    checks.queue = deps.isQueueReady() ? 'ok' : 'not started';
    const ok = Object.values(checks).every((v) => v === 'ok');
    return reply.code(ok ? 200 : 503).send({ ok, checks });
  });
}
