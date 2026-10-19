import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createScan, getScan, listEvents, listFindings } from '../../src/db/scans-repo.js';
import type { ScanJob } from '../../src/queue/boss.js';
import { NonRetryableScanError } from '../../src/scan/errors.js';
import { createFakePipeline } from '../../src/scan/fake-pipeline.js';
import type { Pipeline } from '../../src/scan/pipeline.js';
import { createScanJobHandler } from '../../src/scan/run-scan.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

const job = (scanId: string, retryCount = 0): ScanJob => ({ id: 'job-1', data: { scanId }, retryCount, retryLimit: 2, signal: new AbortController().signal });
const logger = pino({ level: 'silent' });

describe.skipIf(!TEST_DATABASE_URL)('scan job handler', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await setupTestDb();
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  const newScan = () =>
    createScan(t.db, { repoOwner: 'o', repoName: 'r', repoUrl: 'https://github.com/o/r', refRequested: null, refResolved: 'refs/heads/main', commitSha: 'a'.repeat(40), maxAttempts: 3 });

  it('walks the stages and completes the scan', async () => {
    const scan = await newScan();
    const handler = createScanJobHandler({ db: t.db, pipeline: createFakePipeline({ stepMs: 5 }), logger });
    await handler(job(scan.id));
    const done = await getScan(t.db, scan.id);
    expect(done).toMatchObject({ status: 'done', attempts: 1, summarizer: 'deterministic', progressPct: 100 });
    expect(done?.summary?.riskLevel).toBe('none');
    expect(done?.stats.totalMs).toBeGreaterThanOrEqual(0);
    const stages = (await listEvents(t.db, scan.id)).map((e) => e.stage);
    expect(stages).toEqual(['fetching', 'fetching', 'dependencies', 'code', 'summarizing', 'persisting', 'done']);
    expect(await listFindings(t.db, scan.id)).toEqual([]);
  });

  it('marks non-retryable errors as failed without throwing', async () => {
    const scan = await newScan();
    const pipeline: Pipeline = { run: async () => { throw new NonRetryableScanError('Commit not found in this repository.'); } };
    await createScanJobHandler({ db: t.db, pipeline, logger })(job(scan.id));
    expect(await getScan(t.db, scan.id)).toMatchObject({ status: 'failed', error: 'Commit not found in this repository.' });
  });

  it('marks retryable errors as queued and rethrows, then failed on the final attempt', async () => {
    const scan = await newScan();
    const pipeline: Pipeline = { run: async () => { throw new Error('OSV timed out'); } };
    const handler = createScanJobHandler({ db: t.db, pipeline, logger });
    await expect(handler(job(scan.id, 0))).rejects.toThrow('OSV timed out');
    expect(await getScan(t.db, scan.id)).toMatchObject({ status: 'queued', error: 'OSV timed out', attempts: 1 });
    await expect(handler(job(scan.id, 2))).rejects.toThrow('OSV timed out');
    expect(await getScan(t.db, scan.id)).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('skips a job whose scan row no longer exists', async () => {
    const handler = createScanJobHandler({ db: t.db, pipeline: createFakePipeline({ stepMs: 5 }), logger });
    await expect(handler(job('00000000-0000-0000-0000-000000000000'))).resolves.toBeUndefined();
  });
});
