import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { compareSeverity, type Finding, type ScanStats, type ScanWarning, type Severity, type Stage } from '../scan/types.js';
import type { Summary } from '../summarize/contract.js';
import type { Queryable } from './client.js';
import { findings, scanEvents, scans, type EventRow, type FindingRow, type ScanRow } from './schema.js';

export interface NewScan {
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  refRequested: string | null;
  refResolved: string | null;
  commitSha: string;
  maxAttempts: number;
}

export interface ProgressUpdate {
  stage: Stage;
  pct: number;
  message: string;
}

export interface ScanCompletion {
  findings: Finding[];
  summary: Summary;
  summarizer: 'claude' | 'deterministic';
  summarizerNote: string | null;
  warnings: ScanWarning[];
  stats: ScanStats;
  previousScanId: string | null;
  commitSha?: string;
}

export type SeverityCounts = Record<Severity, number>;

export async function notifyScanUpdate(q: Queryable, scanId: string): Promise<void> {
  await q.execute(sql`select pg_notify('scan_updates', ${scanId})`);
}

export async function createScan(q: Queryable, input: NewScan): Promise<ScanRow> {
  const [row] = await q.insert(scans).values(input).returning();
  if (!row) throw new Error('insert returned no row');
  return row;
}

export async function getScan(q: Queryable, id: string): Promise<ScanRow | undefined> {
  const rows = await q.select().from(scans).where(eq(scans.id, id)).limit(1);
  return rows[0];
}

export async function listScans(q: Queryable, limit: number): Promise<ScanRow[]> {
  return q.select().from(scans).orderBy(desc(scans.createdAt)).limit(limit);
}

export async function findActiveScanByCommit(q: Queryable, repoUrl: string, commitSha: string, maxAgeMs: number): Promise<ScanRow | undefined> {
  const since = new Date(Date.now() - maxAgeMs);
  const rows = await q
    .select()
    .from(scans)
    .where(and(eq(scans.repoUrl, repoUrl), eq(scans.commitSha, commitSha), inArray(scans.status, ['queued', 'running']), gte(scans.createdAt, since)))
    .orderBy(desc(scans.createdAt))
    .limit(1);
  return rows[0];
}

export async function findRecentDoneScanByCommit(
  q: Queryable,
  repoUrl: string,
  commitSha: string,
  since: Date,
  summarizer: string,
): Promise<ScanRow | undefined> {
  const rows = await q
    .select()
    .from(scans)
    .where(
      and(
        eq(scans.repoUrl, repoUrl),
        eq(scans.commitSha, commitSha),
        eq(scans.status, 'done'),
        eq(scans.summarizer, summarizer),
        gte(scans.finishedAt, since),
      ),
    )
    .orderBy(desc(scans.finishedAt))
    .limit(1);
  return rows[0];
}

export async function findPreviousDoneScan(q: Queryable, repoUrl: string, before: Date, excludeId: string): Promise<ScanRow | undefined> {
  const rows = await q
    .select()
    .from(scans)
    .where(and(eq(scans.repoUrl, repoUrl), eq(scans.status, 'done'), lt(scans.createdAt, before), ne(scans.id, excludeId)))
    .orderBy(desc(scans.createdAt))
    .limit(1);
  return rows[0];
}

export async function startAttempt(db: Queryable, scanId: string, attempt: number): Promise<ScanRow | undefined> {
  return db.transaction(async (tx) => {
    await tx.delete(findings).where(eq(findings.scanId, scanId));
    const [row] = await tx
      .update(scans)
      .set({
        status: 'running',
        stage: 'fetching',
        progressPct: 0,
        progressMessage: 'Starting scan',
        attempts: attempt,
        error: null,
        summary: null,
        summarizer: null,
        summarizerNote: null,
        warnings: [],
        stats: {},
        previousScanId: null,
        startedAt: new Date(),
        finishedAt: null,
      })
      .where(eq(scans.id, scanId))
      .returning();
    if (!row) return undefined;
    await tx.insert(scanEvents).values({ scanId, stage: 'fetching', message: attempt > 1 ? `Attempt ${attempt} started` : 'Scan started' });
    await notifyScanUpdate(tx, scanId);
    return row;
  });
}

export async function updateProgress(db: Queryable, scanId: string, update: ProgressUpdate): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(scans)
      .set({ stage: update.stage, progressPct: update.pct, progressMessage: update.message })
      .where(eq(scans.id, scanId));
    await tx.insert(scanEvents).values({ scanId, stage: update.stage, message: update.message });
    await notifyScanUpdate(tx, scanId);
  });
}

export async function markRetrying(db: Queryable, scanId: string, error: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(scans)
      .set({ status: 'queued', stage: null, error, progressMessage: `Retrying after error: ${error}` })
      .where(eq(scans.id, scanId));
    await tx.insert(scanEvents).values({ scanId, stage: 'retry', message: `Attempt failed: ${error}` });
    await notifyScanUpdate(tx, scanId);
  });
}

export async function markFailed(db: Queryable, scanId: string, error: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(scans)
      .set({ status: 'failed', stage: null, error, progressMessage: 'Scan failed', finishedAt: new Date() })
      .where(eq(scans.id, scanId));
    await tx.insert(scanEvents).values({ scanId, stage: 'failed', message: error });
    await notifyScanUpdate(tx, scanId);
  });
}

export const INTERRUPTED_MESSAGE = 'The scan was interrupted and did not finish. Submit it again.';

/** Fails queued or running scans older than the given time, which no worker will ever pick up. */
export async function markStaleScansFailed(db: Queryable, olderThan: Date): Promise<number> {
  const stale = await db
    .select({ id: scans.id })
    .from(scans)
    .where(and(inArray(scans.status, ['queued', 'running']), lt(scans.createdAt, olderThan)));
  for (const row of stale) await markFailed(db, row.id, INTERRUPTED_MESSAGE);
  return stale.length;
}

export async function completeScan(db: Queryable, scanId: string, c: ScanCompletion): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < c.findings.length; i += 500) {
      const chunk = c.findings.slice(i, i + 500).map((f) => ({ ...f, scanId }));
      await tx.insert(findings).values(chunk);
    }
    await tx
      .update(scans)
      .set({
        status: 'done',
        stage: null,
        progressPct: 100,
        progressMessage: 'Scan complete',
        summary: c.summary,
        summarizer: c.summarizer,
        summarizerNote: c.summarizerNote,
        warnings: c.warnings,
        stats: c.stats,
        previousScanId: c.previousScanId,
        finishedAt: new Date(),
        ...(c.commitSha ? { commitSha: c.commitSha } : {}),
      })
      .where(eq(scans.id, scanId));
    await tx.insert(scanEvents).values({ scanId, stage: 'done', message: `Scan complete: ${c.findings.length} findings` });
    await notifyScanUpdate(tx, scanId);
  });
}

export async function listFindings(q: Queryable, scanId: string): Promise<FindingRow[]> {
  const rows = await q.select().from(findings).where(eq(findings.scanId, scanId));
  return rows.sort((a, b) => compareSeverity(a.severity, b.severity) || a.title.localeCompare(b.title));
}

export async function listEvents(q: Queryable, scanId: string): Promise<EventRow[]> {
  return q.select().from(scanEvents).where(eq(scanEvents.scanId, scanId)).orderBy(asc(scanEvents.id));
}

export async function countFindingsBySeverity(q: Queryable, scanIds: string[]): Promise<Map<string, SeverityCounts>> {
  const out = new Map<string, SeverityCounts>();
  if (scanIds.length === 0) return out;
  const rows = await q
    .select({ scanId: findings.scanId, severity: findings.severity, count: sql<number>`count(*)::int` })
    .from(findings)
    .where(inArray(findings.scanId, scanIds))
    .groupBy(findings.scanId, findings.severity);
  for (const r of rows) {
    const counts = out.get(r.scanId) ?? { critical: 0, high: 0, medium: 0, low: 0 };
    counts[r.severity] = r.count;
    out.set(r.scanId, counts);
  }
  return out;
}

export async function countQueued(q: Queryable): Promise<number> {
  const [row] = await q.select({ count: sql<number>`count(*)::int` }).from(scans).where(eq(scans.status, 'queued'));
  return row?.count ?? 0;
}
