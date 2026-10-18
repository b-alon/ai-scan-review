import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { registerHealthRoutes } from '../../src/api/routes/health.js';

describe('health routes', () => {
  let app: FastifyInstance;
  let dbOk = true;

  beforeAll(async () => {
    app = await buildApp({
      logger: pino({ level: 'silent' }),
      routes: [
        (a) =>
          registerHealthRoutes(a, {
            role: 'api',
            version: 'test',
            summarizerMode: 'deterministic',
            checkDb: async () => {
              if (!dbOk) throw new Error('connection refused');
            },
            isQueueReady: () => true,
          }),
      ],
    });
    await app.ready();
  });

  afterAll(() => app.close());

  it('reports liveness', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, role: 'api', version: 'test', summarizer: 'deterministic' });
  });

  it('reports readiness and fails when the database is down', async () => {
    let res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, checks: { db: 'ok', queue: 'ok' } });
    dbOk = false;
    res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.db).toMatch(/connection refused/);
    dbOk = true;
  });

  it('returns a JSON 404 envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});
