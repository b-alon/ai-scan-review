import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDbVulnCache } from '../../src/osv/cache.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('db vuln cache', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await setupTestDb();
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it('stores, returns and refreshes advisories, ignoring stale rows', async () => {
    const cache = createDbVulnCache(t.db, 1000);
    await cache.put([{ id: 'GHSA-a', summary: 'one' }]);
    expect((await cache.get(['GHSA-a', 'GHSA-b'])).get('GHSA-a')?.summary).toBe('one');
    await cache.put([{ id: 'GHSA-a', summary: 'two' }]);
    expect((await cache.get(['GHSA-a'])).get('GHSA-a')?.summary).toBe('two');
    await new Promise((r) => setTimeout(r, 1100));
    expect((await cache.get(['GHSA-a'])).size).toBe(0);
  });
});
