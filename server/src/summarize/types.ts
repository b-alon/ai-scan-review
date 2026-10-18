import type { Finding, ScanWarning } from '../scan/types.js';
import type { Summary } from './contract.js';

export interface SummaryInput {
  repo: { owner: string; name: string; commitSha: string };
  findings: Finding[];
  warnings: ScanWarning[];
  stats: { files: number; packages: number };
}

export type SummarizerMode = 'claude' | 'deterministic';

export interface SummarizeOutcome {
  summary: Summary;
  mode: SummarizerMode;
  note: string | null;
}

export interface Summarizer {
  readonly mode: SummarizerMode;
  summarize(input: SummaryInput, signal: AbortSignal): Promise<SummarizeOutcome>;
}
