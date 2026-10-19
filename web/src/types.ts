export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'dependency' | 'code' | 'config';
export type RiskLevel = Severity | 'none';
export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';
export type Stage = 'fetching' | 'dependencies' | 'code' | 'summarizing' | 'persisting';

export interface Finding {
  fingerprint: string;
  category: Category;
  severity: Severity;
  ruleId: string;
  title: string;
  description: string;
  recommendation: string;
  location: string;
  referenceId: string | null;
  referenceUrl: string | null;
  evidence: string | null;
  metadata: Record<string, unknown>;
}

export interface Summary {
  riskLevel: RiskLevel;
  headline: string;
  overview: string;
  topRisks: Array<{ fingerprint: string; title: string; whyItMatters: string }>;
  nextActions: Array<{ action: string; effort: 'minutes' | 'hours' | 'days'; resolves: string[] }>;
}

export interface Comparison {
  previousScanId: string;
  previousSha: string;
  sameCommit: boolean;
  new: Finding[];
  fixed: Finding[];
  stillOpen: Finding[];
}

export interface ScanEvent {
  stage: string;
  message: string;
  createdAt: string;
}

export interface ScanStats {
  files?: number;
  packages?: number;
  advisories?: number;
  stageDurationsMs?: Partial<Record<Stage, number>>;
  totalMs?: number;
}

export interface ScanView {
  id: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  refRequested: string | null;
  refResolved: string | null;
  commitSha: string;
  status: ScanStatus;
  stage: string | null;
  progressPct: number;
  progressMessage: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  warnings: Array<{ code: string; message: string }>;
  summary: Summary | null;
  summarizer: string | null;
  summarizerNote: string | null;
  stats: ScanStats;
  previousScanId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  events: ScanEvent[];
  findings: Finding[] | null;
  comparison: Comparison | null;
}

export type ReusedReason = 'in_progress' | 'recent' | null;
export type CreateScanResponse = ScanView & { reused: ReusedReason };

export interface ScanListItem {
  id: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  commitSha: string;
  refResolved: string | null;
  status: ScanStatus;
  riskLevel: RiskLevel | null;
  counts: Record<Severity, number> | null;
  summarizer: string | null;
  createdAt: string;
  finishedAt: string | null;
}
