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
import { realExec } from './github/exec.js';
import { createGitRefResolver } from './github/resolve-ref.js';
import { createLogger } from './logger.js';
import { createBoss, enqueueScan, MAX_ATTEMPTS, registerScanWorker } from './queue/boss.js';
import { createFakePipeline } from './scan/fake-pipeline.js';
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

  const boss = await createBoss(config.DATABASE_URL, logger);
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
          isQueueReady: () => true,
        }),
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

  if (runsWorker) {
    const handler = createScanJobHandler({ db, pipeline: createFakePipeline(), logger });
    await registerScanWorker(boss, config.WORKER_CONCURRENCY, handler);
    logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'scan worker registered');
  }

  await app.listen({ port: config.PORT, host: '0.0.0.0' });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
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
