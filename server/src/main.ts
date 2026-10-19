import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { buildApp } from './api/app.js';
import { createScanNotifier } from './api/notifier.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { registerScanRoutes } from './api/routes/scans.js';
import { registerStreamRoute } from './api/routes/stream.js';
import { loadConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { countQueued, markStaleScansFailed } from './db/scans-repo.js';
import { realExec } from './github/exec.js';
import { createGitRefResolver } from './github/resolve-ref.js';
import { createLogger } from './logger.js';
import { metrics, registerMetricsRoute } from './metrics.js';
import { ACTIVE_SCAN_MAX_AGE_MS, createBoss, enqueueScan, MAX_ATTEMPTS, registerScanWorker } from './queue/boss.js';
import { createDbVulnCache } from './osv/cache.js';
import { createOsvClient } from './osv/client.js';
import { sweepCloneCache } from './scan/clone-cache.js';
import { createPipeline } from './scan/pipeline.js';
import { createSummarizer } from './summarize/select.js';
import { createScanJobHandler } from './scan/run-scan.js';
import { APP_VERSION } from './version.js';

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const runsApi = config.ROLE !== 'worker';
  const runsWorker = config.ROLE !== 'api';

  let bossStarted = false;
  const boss = await createBoss(config.DATABASE_URL, logger);
  bossStarted = true;
  const notifier = runsApi ? createScanNotifier(config.DATABASE_URL, logger) : null;
  if (notifier) await notifier.start();

  const app = await buildApp({
    logger,
    webDistDir: runsApi ? WEB_DIST : null,
    routes: [
      (a) =>
        registerHealthRoutes(a, {
          role: config.ROLE,
          version: APP_VERSION,
          summarizerMode: config.summarizerMode,
          checkDb: async () => {
            await db.execute(sql`select 1 from scans limit 1`);
          },
          isQueueReady: () => bossStarted,
        }),
      registerMetricsRoute,
      ...(runsApi && notifier
        ? [
            (a: Parameters<typeof registerScanRoutes>[0]) =>
              registerScanRoutes(a, {
                db,
                resolver: createGitRefResolver({ exec: realExec, token: config.GITHUB_TOKEN }),
                enqueue: async (scanId) => {
                  await enqueueScan(boss, scanId);
                },
                freshnessMinutes: config.SCAN_FRESHNESS_MINUTES,
                summarizerMode: config.summarizerMode,
                maxAttempts: MAX_ATTEMPTS,
              }),
            (a: Parameters<typeof registerStreamRoute>[0]) => registerStreamRoute(a, { db, notifier }),
          ]
        : []),
    ],
  });

  let sampler: ReturnType<typeof setInterval> | null = null;
  let sweeper: ReturnType<typeof setInterval> | null = null;
  if (runsWorker) {
    const cacheMaxAgeMs = config.SCAN_CACHE_MAX_AGE_HOURS * 60 * 60 * 1000;
    const sweep = async (): Promise<void> => {
      const { removed } = await sweepCloneCache(config.SCAN_CACHE_DIR, cacheMaxAgeMs);
      if (removed > 0) logger.info({ removed, cacheDir: config.SCAN_CACHE_DIR }, 'swept clone cache');
    };
    await sweep();
    sweeper = setInterval(() => void sweep().catch((err: unknown) => logger.warn({ err }, 'clone cache sweep failed')), 10 * 60 * 1000);
    sweeper.unref();
    const stale = await markStaleScansFailed(db, new Date(Date.now() - ACTIVE_SCAN_MAX_AGE_MS));
    if (stale > 0) logger.warn({ stale }, 'failed scans left behind by an earlier worker');
    sampler = setInterval(() => {
      countQueued(db)
        .then((n) => metrics.scanQueueDepth.set(n))
        .catch((err: unknown) => logger.warn({ err }, 'queue depth sample failed'));
    }, 10_000);
    sampler.unref();
    const pipeline = createPipeline({
      exec: realExec,
      token: config.GITHUB_TOKEN,
      osv: createOsvClient({ onRequest: (outcome) => metrics.osvRequestsTotal.inc({ outcome }) }),
      cache: createDbVulnCache(db),
      cacheDir: config.SCAN_CACHE_DIR,
      summarizer: createSummarizer(config, logger),
    });
    const handler = createScanJobHandler({ db, pipeline, logger });
    await registerScanWorker(boss, config.WORKER_CONCURRENCY, handler);
    logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'scan worker registered');
  }

  await app.listen({ port: config.PORT, host: '0.0.0.0' });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    if (sampler) clearInterval(sampler);
    if (sweeper) clearInterval(sweeper);
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      await app.close();
      await notifier?.stop();
      await pool.end();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
