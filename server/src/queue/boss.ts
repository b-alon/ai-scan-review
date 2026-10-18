import { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';

export const SCAN_QUEUE = 'scan';

export interface ScanJobData {
  scanId: string;
}

export interface ScanJob {
  id: string;
  data: ScanJobData;
  retryCount: number;
  retryLimit: number;
  signal: AbortSignal;
}

export type ScanJobHandler = (job: ScanJob) => Promise<void>;

export const SCAN_JOB_OPTIONS = { retryLimit: 2, retryDelay: 2, retryBackoff: true, expireInSeconds: 600 } as const;
export const MAX_ATTEMPTS = SCAN_JOB_OPTIONS.retryLimit + 1;

export interface BossOptions {
  testSpies?: boolean;
}

export async function createBoss(connectionString: string, logger: Logger, opts: BossOptions = {}): Promise<PgBoss> {
  const options = {
    connectionString,
    max: 5,
    useListenNotify: true,
    ...(opts.testSpies ? { __test__enableSpies: true } : {}),
  } as ConstructorParameters<typeof PgBoss>[0];
  const boss = new PgBoss(options);
  boss.on('error', (err: unknown) => logger.error({ err }, 'pg-boss error'));
  boss.on('warning', (warning: unknown) => logger.warn({ warning }, 'pg-boss warning'));
  await boss.start();
  if (!(await boss.getQueue(SCAN_QUEUE))) {
    await boss.createQueue(SCAN_QUEUE, { ...SCAN_JOB_OPTIONS, notify: true });
  }
  return boss;
}

export interface EnqueueOverrides {
  retryDelay?: number;
  retryBackoff?: boolean;
}

export async function enqueueScan(boss: PgBoss, scanId: string, overrides: EnqueueOverrides = {}): Promise<string | null> {
  return boss.send(SCAN_QUEUE, { scanId }, overrides);
}

export async function registerScanWorker(boss: PgBoss, concurrency: number, handler: ScanJobHandler): Promise<string> {
  return boss.work<ScanJobData>(
    SCAN_QUEUE,
    { localConcurrency: concurrency, includeMetadata: true, pollingIntervalSeconds: 1, notifyPollingIntervalSeconds: 2 },
    async (jobs) => {
      for (const job of jobs) await handler(job as unknown as ScanJob);
    },
  );
}
