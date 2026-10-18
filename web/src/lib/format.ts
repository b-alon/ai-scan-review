import type { RiskLevel, Severity } from '../types';

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function severityColor(severity: Severity): string {
  return { critical: 'red', high: 'orange', medium: 'yellow', low: 'blue' }[severity];
}

export function riskColor(risk: RiskLevel): string {
  return risk === 'none' ? 'green' : severityColor(risk);
}

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
