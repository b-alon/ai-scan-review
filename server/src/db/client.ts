import pg from 'pg';
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

export function createDb(pool: pg.Pool) {
  return drizzle({ client: pool, schema });
}

export type Db = ReturnType<typeof createDb>;
// Accepts both the database and a transaction handle (PgTransaction extends PgDatabase).
export type Queryable = PgDatabase<NodePgQueryResultHKT, typeof schema>;
