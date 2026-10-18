import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { buildApp } from './api/app.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { loadConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { createLogger } from './logger.js';
import { APP_VERSION } from './version.js';

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);

  const app = await buildApp({
    logger,
    webDistDir: config.ROLE === 'worker' ? null : WEB_DIST,
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
    ],
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
