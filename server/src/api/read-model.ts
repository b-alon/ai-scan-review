import type { Queryable } from '../db/client.js';
import { countFindingsBySeverity, getScan, listEvents, listFindings, listScans, type SeverityCounts } from '../db/scans-repo.js';
import type { FindingRow, ScanRow } from '../db/schema.js';
import type { Finding, ScanStats, ScanWarning } from '../scan/types.js';
import type { RiskLevel, Summary } from '../summarize/contract.js';

export interface ScanEventView {
  stage: string;
  message: string;
  createdAt: string;
}

export interface Comparison {
  previousScanId: string;
  previousSha: string;
  sameCommit: boolean;
  new: Finding[];
  fixed: Finding[];
  stillOpen: Finding[];
}

export interface ScanView {
  id: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  refRequested: string | null;
  refResolved: string | null;
  commitSha: string;
  status: ScanRow['status'];
  stage: string | null;
  progressPct: number;
  progressMessage: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  warnings: ScanWarning[];
  summary: Summary | null;
  summarizer: string | null;
  summarizerNote: string | null;
  stats: ScanStats;
  previousScanId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  events: ScanEventView[];
  findings: Finding[] | null;
  comparison: Comparison | null;
}

export interface ScanListItem {
  id: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  commitSha: string;
  refResolved: string | null;
  status: ScanRow['status'];
  riskLevel: RiskLevel | null;
  counts: SeverityCounts | null;
  summarizer: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function toFinding(row: FindingRow): Finding {
  const { id: _id, scanId: _scanId, ...rest } = row;
  return rest;
}

export async function loadScanView(q: Queryable, id: string): Promise<ScanView | undefined> {
  const scan = await getScan(q, id);
  if (!scan) return undefined;
  const events = await listEvents(q, id);
  const findingsList = scan.status === 'done' ? (await listFindings(q, id)).map(toFinding) : null;
  return {
    id: scan.id,
    repoOwner: scan.repoOwner,
    repoName: scan.repoName,
    repoUrl: scan.repoUrl,
    refRequested: scan.refRequested,
    refResolved: scan.refResolved,
    commitSha: scan.commitSha,
    status: scan.status,
    stage: scan.stage,
    progressPct: scan.progressPct,
    progressMessage: scan.progressMessage,
    attempts: scan.attempts,
    maxAttempts: scan.maxAttempts,
    error: scan.error,
    warnings: scan.warnings,
    summary: scan.summary,
    summarizer: scan.summarizer,
    summarizerNote: scan.summarizerNote,
    stats: scan.stats,
    previousScanId: scan.previousScanId,
    createdAt: scan.createdAt.toISOString(),
    startedAt: scan.startedAt?.toISOString() ?? null,
    finishedAt: scan.finishedAt?.toISOString() ?? null,
    events: events.map((e) => ({ stage: e.stage, message: e.message, createdAt: e.createdAt.toISOString() })),
    findings: findingsList,
    comparison: null,
  };
}

export async function listScanItems(q: Queryable, limit: number): Promise<ScanListItem[]> {
  const rows = await listScans(q, limit);
  const counts = await countFindingsBySeverity(
    q,
    rows.filter((r) => r.status === 'done').map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    repoOwner: r.repoOwner,
    repoName: r.repoName,
    repoUrl: r.repoUrl,
    commitSha: r.commitSha,
    refResolved: r.refResolved,
    status: r.status,
    riskLevel: r.summary?.riskLevel ?? null,
    counts: r.status === 'done' ? (counts.get(r.id) ?? { critical: 0, high: 0, medium: 0, low: 0 }) : null,
    summarizer: r.summarizer,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));
}
