import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadScanView } from '../../src/api/read-model.js';
import { completeScan, createScan, startAttempt } from '../../src/db/scans-repo.js';
import type { Finding } from '../../src/scan/types.js';
import type { Summary } from '../../src/summarize/contract.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

const f = (fingerprint: string): Finding => ({ fingerprint, category: 'code', severity: 'high', ruleId: 'r', title: fingerprint, description: '', recommendation: '', location: 'x:1', referenceId: null, referenceUrl: null, evidence: null, metadata: {} });
const summary: Summary = { riskLevel: 'high', headline: 'h', overview: 'o', topRisks: [], nextActions: [] };
const base = { repoOwner: 'o', repoName: 'r', repoUrl: 'https://github.com/o/r', refRequested: null, refResolved: 'refs/heads/main', maxAttempts: 3 };

describe.skipIf(!TEST_DATABASE_URL)('comparison', () => {
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

  it('diffs against the previous done scan and flags same-commit rescans', async () => {
    const first = await createScan(t.db, { ...base, commitSha: '1'.repeat(40) });
    await startAttempt(t.db, first.id, 1);
    await completeScan(t.db, first.id, { findings: [f('a'), f('b')], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: null });

    const second = await createScan(t.db, { ...base, commitSha: '2'.repeat(40) });
    await startAttempt(t.db, second.id, 1);
    await completeScan(t.db, second.id, { findings: [f('b'), f('c')], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: first.id });

    const view = await loadScanView(t.db, second.id);
    expect(view?.comparison).toMatchObject({ previousScanId: first.id, previousSha: '1'.repeat(40), sameCommit: false });
    expect(view?.comparison?.new.map((x) => x.fingerprint)).toEqual(['c']);
    expect(view?.comparison?.fixed.map((x) => x.fingerprint)).toEqual(['a']);
    expect(view?.comparison?.stillOpen.map((x) => x.fingerprint)).toEqual(['b']);

    const third = await createScan(t.db, { ...base, commitSha: '2'.repeat(40) });
    await startAttempt(t.db, third.id, 1);
    await completeScan(t.db, third.id, { findings: [f('b'), f('c')], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: second.id });
    expect((await loadScanView(t.db, third.id))?.comparison?.sameCommit).toBe(true);
    expect((await loadScanView(t.db, first.id))?.comparison).toBeNull();
  });
});
