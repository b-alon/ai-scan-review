import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client.js';

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = createPool(connectionString);
  try {
    const db = createDb(pool);
    const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('migrations applied');
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
