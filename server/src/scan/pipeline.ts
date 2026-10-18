import type { ScanRow } from '../db/schema.js';
import type { Logger } from '../logger.js';
import type { Summary } from '../summarize/contract.js';
import type { Finding, ScanStats, ScanWarning, Stage } from './types.js';

export interface PipelineContext {
  scan: ScanRow;
  signal: AbortSignal;
  log: Logger;
  progress(stage: Stage, pct: number, message: string): Promise<void>;
}

export interface PipelineResult {
  findings: Finding[];
  warnings: ScanWarning[];
  stats: ScanStats;
  summary: Summary;
  summarizer: 'claude' | 'deterministic';
  summarizerNote: string | null;
  commitSha?: string;
}

export interface Pipeline {
  run(ctx: PipelineContext): Promise<PipelineResult>;
}
