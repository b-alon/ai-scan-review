import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scans } from '../../src/db/schema.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('database', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await setupTestDb();
    await resetDb(t.db);
  });

  afterAll(async () => {
    await t.close();
  });

  it('applies migrations and round-trips a scan row', async () => {
    const [row] = await t.db
      .insert(scans)
      .values({ repoOwner: 'o', repoName: 'r', repoUrl: 'https://github.com/o/r', commitSha: 'a'.repeat(40) })
      .returning();
    expect(row?.status).toBe('queued');
    expect(row?.warnings).toEqual([]);
    const found = await t.db.select().from(scans).where(eq(scans.id, row!.id));
    expect(found).toHaveLength(1);
    expect(found[0]?.progressMessage).toBe('Queued');
  });
});
