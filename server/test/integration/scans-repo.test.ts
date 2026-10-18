import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  completeScan,
  countFindingsBySeverity,
  countQueued,
  createScan,
  findActiveScanByCommit,
  findPreviousDoneScan,
  findRecentDoneScanByCommit,
  getScan,
  listEvents,
  listFindings,
  listScans,
  markFailed,
  markRetrying,
  startAttempt,
  updateProgress,
} from '../../src/db/scans-repo.js';
import type { Finding } from '../../src/scan/types.js';
import type { Summary } from '../../src/summarize/contract.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

const SHA = 'f'.repeat(40);
const newScan = (over: Partial<Parameters<typeof createScan>[1]> = {}) => ({
  repoOwner: 'o',
  repoName: 'r',
  repoUrl: 'https://github.com/o/r',
  refRequested: null,
  refResolved: 'refs/heads/main',
  commitSha: SHA,
  maxAttempts: 3,
  ...over,
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  fingerprint: 'dep:npm:lodash:GHSA-1',
  category: 'dependency',
  severity: 'high',
  ruleId: 'osv.advisory',
  title: 'Prototype pollution in lodash',
  description: 'desc',
  recommendation: 'Upgrade lodash',
  location: 'lodash@4.17.15 (npm)',
  referenceId: 'GHSA-1',
  referenceUrl: 'https://osv.dev/vulnerability/GHSA-1',
  evidence: null,
  metadata: { package: 'lodash' },
  ...over,
});

const summary: Summary = { riskLevel: 'high', headline: 'h', overview: 'o', topRisks: [], nextActions: [] };

describe.skipIf(!TEST_DATABASE_URL)('scans repository', () => {
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

  it('creates and finds active scans by commit', async () => {
    const scan = await createScan(t.db, newScan());
    expect(scan.status).toBe('queued');
    expect(await findActiveScanByCommit(t.db, scan.repoUrl, SHA)).toMatchObject({ id: scan.id });
    expect(await findActiveScanByCommit(t.db, scan.repoUrl, 'e'.repeat(40))).toBeUndefined();
    expect(await countQueued(t.db)).toBe(1);
  });

  it('starts an attempt, records progress and events, and notifies', async () => {
    const scan = await createScan(t.db, newScan());
    const started = await startAttempt(t.db, scan.id, 1);
    expect(started).toMatchObject({ status: 'running', stage: 'fetching', attempts: 1 });
    await updateProgress(t.db, scan.id, { stage: 'dependencies', pct: 40, message: 'Checked 10 packages' });
    const after = await getScan(t.db, scan.id);
    expect(after).toMatchObject({ stage: 'dependencies', progressPct: 40, progressMessage: 'Checked 10 packages' });
    const events = await listEvents(t.db, scan.id);
    expect(events.map((e) => e.message)).toEqual(['Scan started', 'Checked 10 packages']);
  });

  it('completes a scan with findings and summary, then a retry resets it', async () => {
    const scan = await createScan(t.db, newScan());
    await startAttempt(t.db, scan.id, 1);
    await completeScan(t.db, scan.id, {
      findings: [finding(), finding({ fingerprint: 'code:x', category: 'code', severity: 'critical', title: 'AWS key' })],
      summary,
      summarizer: 'deterministic',
      summarizerNote: null,
      warnings: [{ code: 'w', message: 'm' }],
      stats: { files: 3 },
      previousScanId: null,
    });
    const done = await getScan(t.db, scan.id);
    expect(done).toMatchObject({ status: 'done', progressPct: 100, summarizer: 'deterministic', warnings: [{ code: 'w', message: 'm' }] });
    expect(done?.finishedAt).toBeInstanceOf(Date);
    const rows = await listFindings(t.db, scan.id);
    expect(rows.map((r) => r.severity)).toEqual(['critical', 'high']);
    const counts = await countFindingsBySeverity(t.db, [scan.id]);
    expect(counts.get(scan.id)).toEqual({ critical: 1, high: 1, medium: 0, low: 0 });

    const again = await startAttempt(t.db, scan.id, 2);
    expect(again).toMatchObject({ status: 'running', attempts: 2, summary: null, warnings: [] });
    expect(await listFindings(t.db, scan.id)).toEqual([]);
  });

  it('marks retrying and failed with events', async () => {
    const scan = await createScan(t.db, newScan());
    await startAttempt(t.db, scan.id, 1);
    await markRetrying(t.db, scan.id, 'boom');
    expect(await getScan(t.db, scan.id)).toMatchObject({ status: 'queued', error: 'boom' });
    await markFailed(t.db, scan.id, 'gave up');
    expect(await getScan(t.db, scan.id)).toMatchObject({ status: 'failed', error: 'gave up' });
    expect((await listEvents(t.db, scan.id)).at(-1)?.stage).toBe('failed');
  });

  it('finds recent done scans inside the window for the same summarizer only', async () => {
    const scan = await createScan(t.db, newScan());
    await startAttempt(t.db, scan.id, 1);
    await completeScan(t.db, scan.id, { findings: [], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: null });
    const since = new Date(Date.now() - 60_000);
    expect(await findRecentDoneScanByCommit(t.db, scan.repoUrl, SHA, since, 'deterministic')).toMatchObject({ id: scan.id });
    expect(await findRecentDoneScanByCommit(t.db, scan.repoUrl, SHA, since, 'claude')).toBeUndefined();
    expect(await findRecentDoneScanByCommit(t.db, scan.repoUrl, SHA, new Date(Date.now() + 1000), 'deterministic')).toBeUndefined();
  });

  it('finds the previous done scan of the same repo and lists recent scans', async () => {
    const first = await createScan(t.db, newScan({ commitSha: '1'.repeat(40) }));
    await startAttempt(t.db, first.id, 1);
    await completeScan(t.db, first.id, { findings: [], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: null });
    const second = await createScan(t.db, newScan({ commitSha: '2'.repeat(40) }));
    const other = await createScan(t.db, newScan({ repoUrl: 'https://github.com/o/other', repoName: 'other' }));
    expect(await findPreviousDoneScan(t.db, second.repoUrl, second.createdAt, second.id)).toMatchObject({ id: first.id });
    expect(await findPreviousDoneScan(t.db, other.repoUrl, other.createdAt, other.id)).toBeUndefined();
    const list = await listScans(t.db, 10);
    expect(list.map((s) => s.id)).toEqual([other.id, second.id, first.id]);
  });
});
