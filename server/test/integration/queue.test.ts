import type { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBoss, enqueueScan, registerScanWorker, SCAN_QUEUE, type ScanJob } from '../../src/queue/boss.js';
import { TEST_DATABASE_URL } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('queue', () => {
  let boss: PgBoss;
  const seen: Array<{ scanId: string; retryCount: number; retryLimit: number }> = [];
  let flakyFailures = 0;

  beforeAll(async () => {
    boss = await createBoss(TEST_DATABASE_URL!, pino({ level: 'silent' }), { testSpies: true });
    await boss.deleteAllJobs(SCAN_QUEUE);
    await registerScanWorker(boss, 1, async (job: ScanJob) => {
      seen.push({ scanId: job.data.scanId, retryCount: job.retryCount, retryLimit: job.retryLimit });
      if (job.data.scanId === 'flaky' && flakyFailures === 0) {
        flakyFailures += 1;
        throw new Error('first attempt fails');
      }
    });
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, timeout: 5_000 });
  });

  it('runs the handler for a sent job with the job id as the handle', async () => {
    const id = await enqueueScan(boss, 'scan-1');
    expect(id).toBeTruthy();
    const job = await boss.getSpy(SCAN_QUEUE).waitForJobWithId(id!, 'completed');
    expect(job.data).toEqual({ scanId: 'scan-1' });
    expect(seen).toContainEqual({ scanId: 'scan-1', retryCount: 0, retryLimit: 2 });
  });

  it('retries a failing handler and exposes the attempt number', async () => {
    const id = await enqueueScan(boss, 'flaky', { retryDelay: 1, retryBackoff: false });
    await boss.getSpy(SCAN_QUEUE).waitForJobWithId(id!, 'completed');
    const attempts = seen.filter((s) => s.scanId === 'flaky').map((s) => s.retryCount);
    expect(attempts).toEqual([0, 1]);
  });
});
