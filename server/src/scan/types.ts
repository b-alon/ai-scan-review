export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'dependency' | 'code' | 'config';
export type Stage = 'fetching' | 'dependencies' | 'code' | 'summarizing' | 'persisting';

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

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

export interface ScanWarning {
  code: string;
  message: string;
}

export interface ScanStats {
  files?: number;
  packages?: number;
  advisories?: number;
  stageDurationsMs?: Partial<Record<Stage, number>>;
  totalMs?: number;
}

export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
}
