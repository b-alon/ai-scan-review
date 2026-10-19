import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { metrics, registerMetricsRoute } from '../../src/metrics.js';

describe('metrics', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: pino({ level: 'silent' }), webDistDir: null, routes: [registerMetricsRoute] });
    await app.ready();
  });
  afterAll(() => app.close());

  it('exposes counters and histograms in prometheus format', async () => {
    metrics.scansTotal.inc({ status: 'done' });
    metrics.scanStageDuration.observe({ stage: 'fetching' }, 1.5);
    metrics.summarizerRunsTotal.inc({ mode: 'deterministic', fallback: 'false' });
    metrics.osvRequestsTotal.inc({ outcome: 'ok' });
    metrics.scanQueueDepth.set(3);
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    for (const name of ['scans_total{status="done"} 1', 'scan_stage_duration_seconds_bucket', 'scan_queue_depth 3', 'osv_requests_total{outcome="ok"} 1', 'summarizer_runs_total{mode="deterministic",fallback="false"} 1', 'process_cpu_user_seconds_total']) {
      expect(res.body).toContain(name);
    }
  });
});
