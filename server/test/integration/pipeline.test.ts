import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createScan, getScan, listFindings } from '../../src/db/scans-repo.js';
import type { Exec } from '../../src/github/exec.js';
import { createMemoryVulnCache } from '../../src/osv/cache.js';
import type { OsvClient } from '../../src/osv/client.js';
import type { OsvVuln } from '../../src/osv/types.js';
import { createPipeline } from '../../src/scan/pipeline.js';
import { createScanJobHandler } from '../../src/scan/run-scan.js';
import { createDeterministicSummarizer } from '../../src/summarize/deterministic.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = path.resolve(here, '../fixtures/repo-vulnerable');
const SHA = 'c'.repeat(40);

function createFixtureExec(): Exec {
  return async (_cmd, args, opts) => {
    if (args.includes('checkout')) await cp(FIXTURE_REPO, opts.cwd!, { recursive: true });
    if (args.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

describe.skipIf(!TEST_DATABASE_URL)('real pipeline', () => {
  let t: TestDb;
  let osvVuln: OsvVuln;
  beforeAll(async () => {
    t = await setupTestDb();
    osvVuln = JSON.parse(await readFile(path.resolve(here, '../fixtures/osv/GHSA-p6mc-m468-83gw.json'), 'utf8')) as OsvVuln;
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it('fetches, scans dependencies and code, summarizes and persists', async () => {
    const osv: OsvClient = {
      queryBatch: async (refs) => refs.map((r) => (r.name === 'lodash' ? [osvVuln.id] : [])),
      getVuln: async () => osvVuln,
    };
    const stages: string[] = [];
    const pipeline = createPipeline({ exec: createFixtureExec(), osv, cache: createMemoryVulnCache(), summarizer: createDeterministicSummarizer(), onStage: (s) => stages.push(s) });
    const scan = await createScan(t.db, { repoOwner: 'o', repoName: 'r', repoUrl: 'https://github.com/o/r', refRequested: null, refResolved: 'refs/heads/main', commitSha: SHA, maxAttempts: 3 });
    const handler = createScanJobHandler({ db: t.db, pipeline, logger: pino({ level: 'silent' }) });
    await handler({ id: 'j', data: { scanId: scan.id }, retryCount: 0, retryLimit: 2, signal: new AbortController().signal });

    const done = await getScan(t.db, scan.id);
    expect(done?.status).toBe('done');
    expect(done?.summary?.riskLevel).toBe('critical');
    expect(done?.stats.files).toBe(4);
    expect(done?.stats.packages).toBe(1);
    expect(Object.keys(done?.stats.stageDurationsMs ?? {}).sort()).toEqual(['code', 'dependencies', 'fetching', 'summarizing']);
    expect(stages).toEqual(['fetching', 'dependencies', 'code', 'summarizing']);
    const rules = (await listFindings(t.db, scan.id)).map((f) => f.ruleId).sort();
    expect(rules).toEqual(['code.eval', 'osv.advisory', 'secret.aws_access_key']);
    const key = (await listFindings(t.db, scan.id)).find((f) => f.ruleId === 'secret.aws_access_key');
    expect(key?.evidence).not.toContain('IOSFODNN7EXAMPLE');
    expect(done?.summary?.nextActions[0]?.action).toContain('Rotate the AWS key');
  });
});
