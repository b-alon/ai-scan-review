import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { createDb, createPool, type Db } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

export const TEST_DATABASE_URL = process.env.DATABASE_URL;

export interface TestDb {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export async function setupTestDb(): Promise<TestDb> {
  if (!TEST_DATABASE_URL) throw new Error('DATABASE_URL is required for integration tests');
  await runMigrations(TEST_DATABASE_URL);
  const pool = createPool(TEST_DATABASE_URL);
  const db = createDb(pool);
  return { db, pool, close: () => pool.end() };
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE findings, scan_events, scans, osv_vulns RESTART IDENTITY CASCADE`);
}
