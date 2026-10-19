import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { createScanNotifier, type ScanNotifier } from '../../src/api/notifier.js';
import { registerStreamRoute } from '../../src/api/routes/stream.js';
import { completeScan, createScan, markFailed, startAttempt, updateProgress } from '../../src/db/scans-repo.js';
import type { Summary } from '../../src/summarize/contract.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';
import { readSse, type SseEvent } from './sse.js';

const summary: Summary = { riskLevel: 'none', headline: 'h', overview: 'o', topRisks: [], nextActions: [] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!TEST_DATABASE_URL)('scan stream', () => {
  let t: TestDb;
  let app: FastifyInstance;
  let notifier: ScanNotifier;
  let baseUrl: string;

  beforeAll(async () => {
    t = await setupTestDb();
    notifier = createScanNotifier(TEST_DATABASE_URL!, pino({ level: 'silent' }));
    await notifier.start();
    app = await buildApp({
      logger: pino({ level: 'silent' }),
      webDistDir: null,
      routes: [(a) => registerStreamRoute(a, { db: t.db, notifier, pollMs: 300, heartbeatMs: 200 })],
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });
  afterAll(async () => {
    await app.close();
    await notifier.stop();
    await t.close();
  });

  const newScan = () =>
    createScan(t.db, { repoOwner: 'o', repoName: 'r', repoUrl: 'https://github.com/o/r', refRequested: null, refResolved: 'refs/heads/main', commitSha: 'a'.repeat(40), maxAttempts: 3 });

  it('streams snapshot, progress and done, then closes', async () => {
    const scan = await newScan();
    const reading = readSse(`${baseUrl}/api/scans/${scan.id}/stream`);
    await sleep(150);
    await startAttempt(t.db, scan.id, 1);
    await sleep(50);
    await updateProgress(t.db, scan.id, { stage: 'code', pct: 70, message: 'Scanning code' });
    await sleep(50);
    await completeScan(t.db, scan.id, { findings: [], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: null });
    const events: SseEvent[] = await reading;
    expect(events[0]?.event).toBe('snapshot');
    expect(events.some((e) => e.event === 'progress' && (e.data as { progressMessage: string }).progressMessage === 'Scanning code')).toBe(true);
    expect(events.at(-1)?.event).toBe('done');
    expect((events.at(-1)?.data as { findings: unknown[] }).findings).toEqual([]);
  });

  it('sends snapshot and the terminal event for an already finished scan', async () => {
    const scan = await newScan();
    await startAttempt(t.db, scan.id, 1);
    await markFailed(t.db, scan.id, 'boom');
    const events = await readSse(`${baseUrl}/api/scans/${scan.id}/stream`);
    expect(events.map((e) => e.event)).toEqual(['snapshot', 'failed']);
    expect((events[1]?.data as { error: string }).error).toBe('boom');
  });

  it('falls back to polling when notifications are unavailable', async () => {
    await notifier.stop();
    try {
      const scan = await newScan();
      const reading = readSse(`${baseUrl}/api/scans/${scan.id}/stream`, { until: (ev) => ev.some((e) => e.event === 'progress') });
      await sleep(100);
      await startAttempt(t.db, scan.id, 1);
      const events = await reading;
      expect(events.some((e) => e.event === 'progress')).toBe(true);
    } finally {
      await notifier.start();
    }
  });

  it('returns 404 for an unknown scan', async () => {
    const res = await fetch(`${baseUrl}/api/scans/00000000-0000-0000-0000-000000000000/stream`);
    expect(res.status).toBe(404);
  });
});
