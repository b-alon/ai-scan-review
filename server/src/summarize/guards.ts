import { compareSeverity, type Finding } from '../scan/types.js';
import type { RiskLevel, Summary } from './contract.js';

export function highestSeverity(findings: Finding[]): RiskLevel {
  if (findings.length === 0) return 'none';
  return [...findings].sort((a, b) => compareSeverity(a.severity, b.severity))[0]!.severity;
}

export function sanitizeSummary(summary: Summary, findings: Finding[]): Summary {
  const known = new Set(findings.map((f) => f.fingerprint));
  const topRisks = summary.topRisks.filter((r) => known.has(r.fingerprint)).slice(0, 5);
  const nextActions = summary.nextActions
    .map((a) => ({ ...a, action: a.action.trim(), resolves: a.resolves.filter((fp) => known.has(fp)) }))
    .filter((a) => a.action.length > 0)
    .slice(0, 20);
  const floor = highestSeverity(findings);
  const order: RiskLevel[] = ['critical', 'high', 'medium', 'low', 'none'];
  const riskLevel: RiskLevel = findings.length === 0 ? 'none' : order.indexOf(summary.riskLevel) < order.indexOf(floor) ? summary.riskLevel : floor;
  return {
    riskLevel,
    headline: summary.headline.trim().slice(0, 300),
    overview: summary.overview.trim().slice(0, 2000),
    topRisks,
    nextActions,
  };
}
