import type { Pipeline } from './pipeline.js';
import type { Stage } from './types.js';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Scan aborted'));
      },
      { once: true },
    );
  });
}

export function createFakePipeline(opts: { stepMs?: number } = {}): Pipeline {
  const stepMs = opts.stepMs ?? 800;
  return {
    async run(ctx) {
      const steps: Array<[Stage, number, string]> = [
        ['fetching', 10, `Fetching ${ctx.scan.repoOwner}/${ctx.scan.repoName} at ${ctx.scan.commitSha.slice(0, 7)}`],
        ['dependencies', 40, 'Checking dependencies'],
        ['code', 70, 'Scanning code'],
        ['summarizing', 90, 'Summarizing'],
      ];
      for (const [stage, pct, message] of steps) {
        await ctx.progress(stage, pct, message);
        await sleep(stepMs, ctx.signal);
      }
      return {
        findings: [],
        warnings: [],
        stats: { files: 0, packages: 0 },
        summary: {
          riskLevel: 'none',
          headline: 'Fake scan complete',
          overview: 'This placeholder pipeline walks the stages without scanning anything.',
          topRisks: [],
          nextActions: [],
        },
        summarizer: 'deterministic',
        summarizerNote: 'fake pipeline',
        commitSha: ctx.scan.commitSha,
      };
    },
  };
}
