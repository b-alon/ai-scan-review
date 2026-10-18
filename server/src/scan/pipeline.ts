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

import type { Exec } from '../github/exec.js';
import type { VulnCache } from '../osv/cache.js';
import type { OsvClient } from '../osv/client.js';
import type { Summarizer } from '../summarize/types.js';
import { runCodeStage } from './code-stage.js';
import { runDependencyStage } from './deps-stage.js';
import { fetchRepo } from './fetch.js';

export interface PipelineDeps {
  exec: Exec;
  token?: string | undefined;
  osv: OsvClient;
  cache: VulnCache;
  summarizer: Summarizer;
  fetchTimeoutMs?: number;
  stageTimeoutMs?: number;
  tmpRoot?: string;
  onStage?: (stage: Stage, ms: number) => void;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const stageTimeoutMs = deps.stageTimeoutMs ?? 120_000;
  const fetchTimeoutMs = deps.fetchTimeoutMs ?? 120_000;

  return {
    async run(ctx) {
      const durations: Partial<Record<Stage, number>> = {};
      const warnings: ScanWarning[] = [];
      const findings: Finding[] = [];

      const timed = async <T>(stage: Stage, fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        const started = Date.now();
        const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(stage === 'fetching' ? fetchTimeoutMs : stageTimeoutMs)]);
        try {
          return await fn(signal);
        } finally {
          const ms = Date.now() - started;
          durations[stage] = ms;
          deps.onStage?.(stage, ms);
        }
      };

      await ctx.progress('fetching', 2, `Fetching ${ctx.scan.repoOwner}/${ctx.scan.repoName} at ${ctx.scan.commitSha.slice(0, 7)}`);
      const fetched = await timed('fetching', (signal) =>
        fetchRepo({ repoUrl: ctx.scan.repoUrl, commitSha: ctx.scan.commitSha, token: deps.token, exec: deps.exec, signal, timeoutMs: fetchTimeoutMs, tmpRoot: deps.tmpRoot }),
      );

      try {
        await ctx.progress('fetching', 25, `Fetched ${fetched.fileCount} files`);

        await ctx.progress('dependencies', 30, 'Looking for dependency manifests');
        const depsResult = await timed('dependencies', (signal) =>
          runDependencyStage({ dir: fetched.dir, osv: deps.osv, cache: deps.cache, signal, log: ctx.log, progress: (pct, message) => ctx.progress('dependencies', pct, message) }),
        );
        findings.push(...depsResult.findings);
        warnings.push(...depsResult.warnings);

        await ctx.progress('code', 62, 'Scanning code for secrets and risky patterns');
        const codeResult = await timed('code', (signal) => runCodeStage({ dir: fetched.dir, signal, progress: (pct, message) => ctx.progress('code', pct, message) }));
        findings.push(...codeResult.findings);
        if (codeResult.truncated) warnings.push({ code: 'too_many_files', message: 'Only the first 5000 files were scanned for code patterns.' });

        await ctx.progress('summarizing', 88, deps.summarizer.mode === 'claude' ? 'Summarizing with Claude' : 'Summarizing');
        const outcome = await timed('summarizing', (signal) =>
          deps.summarizer.summarize(
            { repo: { owner: ctx.scan.repoOwner, name: ctx.scan.repoName, commitSha: fetched.commitSha }, findings, warnings, stats: { files: codeResult.files, packages: depsResult.packages } },
            signal,
          ),
        );

        return {
          findings,
          warnings,
          stats: { files: codeResult.files, packages: depsResult.packages, advisories: depsResult.advisories, stageDurationsMs: durations },
          summary: outcome.summary,
          summarizer: outcome.mode,
          summarizerNote: outcome.note,
          commitSha: fetched.commitSha,
        };
      } finally {
        await fetched.cleanup();
      }
    },
  };
}
