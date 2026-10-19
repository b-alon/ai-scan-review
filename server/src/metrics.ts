import type { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const metrics = {
  registry,
  scansTotal: new Counter({ name: 'scans_total', help: 'Scans by terminal status', labelNames: ['status'] as const, registers: [registry] }),
  scanStageDuration: new Histogram({
    name: 'scan_stage_duration_seconds',
    help: 'Duration of each scan stage',
    labelNames: ['stage'] as const,
    buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
    registers: [registry],
  }),
  scanQueueDepth: new Gauge({ name: 'scan_queue_depth', help: 'Scans waiting for a worker', registers: [registry] }),
  osvRequestsTotal: new Counter({ name: 'osv_requests_total', help: 'OSV API requests by outcome', labelNames: ['outcome'] as const, registers: [registry] }),
  summarizerRunsTotal: new Counter({
    name: 'summarizer_runs_total',
    help: 'Summaries produced, by mode and whether a fallback happened',
    labelNames: ['mode', 'fallback'] as const,
    registers: [registry],
  }),
};

export function registerMetricsRoute(app: FastifyInstance): void {
  app.get('/metrics', async (_req, reply) => {
    reply.type(registry.contentType);
    return registry.metrics();
  });
}
