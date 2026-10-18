import type { Db } from '../db/client.js';
import { completeScan, findPreviousDoneScan, markFailed, markRetrying, startAttempt, updateProgress } from '../db/scans-repo.js';
import type { Logger } from '../logger.js';
import { metrics } from '../metrics.js';
import type { ScanJobHandler } from '../queue/boss.js';
import { NonRetryableScanError } from './errors.js';
import type { Pipeline } from './pipeline.js';

export interface ScanHandlerDeps {
  db: Db;
  pipeline: Pipeline;
  logger: Logger;
}

export function createScanJobHandler(deps: ScanHandlerDeps): ScanJobHandler {
  return async (job) => {
    const { scanId } = job.data;
    const attempt = job.retryCount + 1;
    const log = deps.logger.child({ scanId, jobId: job.id, attempt });

    const scan = await startAttempt(deps.db, scanId, attempt);
    if (!scan) {
      log.warn('scan row missing; skipping job');
      return;
    }
    log.info({ repoUrl: scan.repoUrl, commitSha: scan.commitSha }, 'scan attempt started');
    const startedAt = Date.now();

    try {
      const result = await deps.pipeline.run({
        scan,
        signal: job.signal,
        log,
        progress: (stage, pct, message) => updateProgress(deps.db, scanId, { stage, pct, message }),
      });
      await updateProgress(deps.db, scanId, { stage: 'persisting', pct: 98, message: 'Saving results' });
      const previous = await findPreviousDoneScan(deps.db, scan.repoUrl, scan.createdAt, scan.id);
      await completeScan(deps.db, scanId, {
        ...result,
        stats: { ...result.stats, totalMs: Date.now() - startedAt },
        previousScanId: previous?.id ?? null,
      });
      metrics.scansTotal.inc({ status: 'done' });
      metrics.summarizerRunsTotal.inc({ mode: result.summarizer, fallback: String(result.summarizerNote?.startsWith('fallback') ?? false) });
      for (const [stage, ms] of Object.entries(result.stats.stageDurationsMs ?? {})) metrics.scanStageDuration.observe({ stage }, ms / 1000);
      log.info({ findings: result.findings.length, ms: Date.now() - startedAt, summarizer: result.summarizer }, 'scan done');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof NonRetryableScanError) {
        log.warn({ err }, 'scan failed, not retryable');
        await markFailed(deps.db, scanId, message);
        metrics.scansTotal.inc({ status: 'failed' });
        return;
      }
      if (job.retryCount >= job.retryLimit) {
        log.error({ err }, 'scan failed on final attempt');
        await markFailed(deps.db, scanId, message);
        metrics.scansTotal.inc({ status: 'failed' });
        throw err;
      }
      log.warn({ err }, 'scan attempt failed, will retry');
      await markRetrying(deps.db, scanId, message);
      throw err;
    }
  };
}
