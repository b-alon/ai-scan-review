import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { buildApp, type RoutePlugin } from './api/app.js';
import { createScanNotifier, type ScanNotifier } from './api/notifier.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { registerScanRoutes } from './api/routes/scans.js';
import { registerStreamRoute } from './api/routes/stream.js';
import { loadConfig, type Config } from './config.js';
import { createDb, createPool, type Db } from './db/client.js';
import { countQueued, markStaleScansFailed } from './db/scans-repo.js';
import { realExec } from './github/exec.js';
import { createGitRefResolver } from './github/resolve-ref.js';
import { createLogger, type Logger } from './logger.js';
import { metrics, registerMetricsRoute } from './metrics.js';
import { ACTIVE_SCAN_MAX_AGE_MS, createBoss, enqueueScan, MAX_ATTEMPTS, registerScanWorker } from './queue/boss.js';
import { createDbVulnCache } from './osv/cache.js';
import { createOsvClient } from './osv/client.js';
import { sweepCloneCache } from './scan/clone-cache.js';
import { createPipeline } from './scan/pipeline.js';
import { createScanJobHandler } from './scan/run-scan.js';
import { createSummarizer } from './summarize/select.js';
import { APP_VERSION } from './version.js';

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const CLONE_CACHE_SWEEP_MS = 10 * 60 * 1000;
const QUEUE_DEPTH_SAMPLE_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

/** Infrastructure shared by both roles: configuration, logging, the database and the job queue. */
interface Runtime {
  config: Config;
  logger: Logger;
  pool: pg.Pool;
  db: Db;
  boss: PgBoss;
}

type StopFn = () => void;

async function createRuntime(): Promise<Runtime> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const boss = await createBoss(config.DATABASE_URL, logger);
  return { config, logger, pool, db, boss };
}

/** Liveness, readiness and metrics are served by every role; the worker's port is not published. */
function healthRoute({ config, db }: Runtime): RoutePlugin {
  return (app) =>
    registerHealthRoutes(app, {
      role: config.ROLE,
      version: APP_VERSION,
      summarizerMode: config.summarizerMode,
      checkDb: async () => {
        await db.execute(sql`select 1 from scans limit 1`);
      },
      // The queue is started before the app is built, so it is ready whenever this route exists.
      isQueueReady: () => true,
    });
}

/** The scan API: create, read, list and stream. Only the api role mounts these. */
function scanRoutes({ config, db, boss }: Runtime, notifier: ScanNotifier): RoutePlugin[] {
  return [
    (app) =>
      registerScanRoutes(app, {
        db,
        resolver: createGitRefResolver({ exec: realExec, token: config.GITHUB_TOKEN }),
        enqueue: async (scanId) => {
          await enqueueScan(boss, scanId);
        },
        freshnessMinutes: config.SCAN_FRESHNESS_MINUTES,
        summarizerMode: config.summarizerMode,
        maxAttempts: MAX_ATTEMPTS,
      }),
    (app) => registerStreamRoute(app, { db, notifier }),
  ];
}

/** Builds the HTTP app. With a notifier it is the full api (routes plus the UI); without, a health-only server for the worker. */
async function buildHttpApp(rt: Runtime, notifier: ScanNotifier | null): Promise<FastifyInstance> {
  return buildApp({
    logger: rt.logger,
    webDistDir: notifier ? WEB_DIST : null,
    routes: [healthRoute(rt), registerMetricsRoute, ...(notifier ? scanRoutes(rt, notifier) : [])],
  });
}

/** Removes cached clones older than the configured age, now and every ten minutes. */
async function startCloneCacheSweeper({ config, logger }: Runtime): Promise<StopFn> {
  const maxAgeMs = config.SCAN_CACHE_MAX_AGE_HOURS * 60 * 60 * 1000;
  const sweep = async (): Promise<void> => {
    const { removed } = await sweepCloneCache(config.SCAN_CACHE_DIR, maxAgeMs);
    if (removed > 0) logger.info({ removed, cacheDir: config.SCAN_CACHE_DIR }, 'swept clone cache');
  };
  await sweep();
  const timer = setInterval(() => void sweep().catch((err: unknown) => logger.warn({ err }, 'clone cache sweep failed')), CLONE_CACHE_SWEEP_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/** Scans left queued or running longer than any job could live were abandoned by a dead worker. */
async function failStaleScans({ db, logger }: Runtime): Promise<void> {
  const stale = await markStaleScansFailed(db, new Date(Date.now() - ACTIVE_SCAN_MAX_AGE_MS));
  if (stale > 0) logger.warn({ stale }, 'failed scans left behind by an earlier worker');
}

function startQueueDepthSampler({ db, logger }: Runtime): StopFn {
  const timer = setInterval(() => {
    countQueued(db)
      .then((n) => metrics.scanQueueDepth.set(n))
      .catch((err: unknown) => logger.warn({ err }, 'queue depth sample failed'));
  }, QUEUE_DEPTH_SAMPLE_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/** Wires the real scan pipeline to the job queue. Returns a function that stops the worker's timers. */
async function startWorker(rt: Runtime): Promise<StopFn> {
  const { config, logger, db, boss } = rt;
  const stopSweeper = await startCloneCacheSweeper(rt);
  await failStaleScans(rt);
  const stopSampler = startQueueDepthSampler(rt);

  const pipeline = createPipeline({
    exec: realExec,
    token: config.GITHUB_TOKEN,
    osv: createOsvClient({ onRequest: (outcome) => metrics.osvRequestsTotal.inc({ outcome }) }),
    cache: createDbVulnCache(db),
    cacheDir: config.SCAN_CACHE_DIR,
    summarizer: createSummarizer(config, logger),
  });
  await registerScanWorker(boss, config.WORKER_CONCURRENCY, createScanJobHandler({ db, pipeline, logger }));
  logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'scan worker registered');

  return () => {
    stopSweeper();
    stopSampler();
  };
}

interface Running {
  app: FastifyInstance;
  notifier: ScanNotifier | null;
  stopWorker: StopFn | null;
}

/** Drains the queue, closes the HTTP server and streams, then the database, on SIGTERM or SIGINT. */
function installShutdownHandlers({ logger, boss, pool }: Runtime, running: Running): void {
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    running.stopWorker?.();
    try {
      await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
      await running.app.close();
      await running.notifier?.stop();
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

async function main(): Promise<void> {
  const rt = await createRuntime();
  const runsApi = rt.config.ROLE !== 'worker';
  const runsWorker = rt.config.ROLE !== 'api';

  const notifier = runsApi ? createScanNotifier(rt.config.DATABASE_URL, rt.logger) : null;
  if (notifier) await notifier.start();

  const app = await buildHttpApp(rt, notifier);
  const stopWorker = runsWorker ? await startWorker(rt) : null;
  await app.listen({ port: rt.config.PORT, host: '0.0.0.0' });

  installShutdownHandlers(rt, { app, notifier, stopWorker });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
