import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SummarizerMode } from '../../config.js';
import type { Queryable } from '../../db/client.js';
import { createScan, findActiveScanByCommit, findRecentDoneScanByCommit, markFailed } from '../../db/scans-repo.js';
import { ACTIVE_SCAN_MAX_AGE_MS } from '../../queue/boss.js';
import { InvalidRepoUrlError, parseGitHubUrl, type ParsedRepo } from '../../github/parse-url.js';
import { GitUnavailableError, RefNotFoundError, RepoNotFoundError, type RefResolver, type ResolvedRef } from '../../github/resolve-ref.js';
import { HttpError } from '../errors.js';
import { listScanItems, loadScanView, type ScanView } from '../read-model.js';

export interface ScanRouteDeps {
  db: Queryable;
  resolver: RefResolver;
  enqueue: (scanId: string) => Promise<void>;
  freshnessMinutes: number;
  readonly summarizerMode: SummarizerMode;
  maxAttempts: number;
  activeMaxAgeMs?: number;
}

export type ReusedReason = 'in_progress' | 'recent' | null;
export type CreateScanResponse = ScanView & { reused: ReusedReason };

const CreateScanBody = z.object({
  repoUrl: z.string().min(1).max(500),
  ref: z.string().max(200).optional(),
  force: z.boolean().optional(),
});

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

const NOT_FOUND = () => new HttpError(404, 'scan_not_found', 'No scan with that id.');

export function registerScanRoutes(app: FastifyInstance, deps: ScanRouteDeps): void {
  async function respond(id: string, reused: ReusedReason): Promise<CreateScanResponse> {
    const view = await loadScanView(deps.db, id);
    if (!view) throw new HttpError(500, 'internal_error', 'The scan could not be loaded after it was created.');
    return { ...view, reused };
  }

  app.post('/api/scans', async (req, reply) => {
    const body = CreateScanBody.safeParse(req.body);
    if (!body.success) {
      throw new HttpError(400, 'invalid_body', 'Send a JSON body with a repoUrl string and optional ref and force fields.');
    }

    let parsed: ParsedRepo;
    try {
      parsed = parseGitHubUrl(body.data.repoUrl, body.data.ref ?? null);
    } catch (err) {
      if (err instanceof InvalidRepoUrlError) throw new HttpError(400, 'invalid_repo_url', err.message);
      throw err;
    }

    let resolved: ResolvedRef;
    try {
      resolved = await deps.resolver.resolve(parsed);
    } catch (err) {
      if (err instanceof RepoNotFoundError) throw new HttpError(404, 'repo_not_found', err.message);
      if (err instanceof RefNotFoundError) throw new HttpError(400, 'ref_not_found', err.message);
      if (err instanceof GitUnavailableError) throw new HttpError(502, 'github_unavailable', err.message);
      throw err;
    }

    if (!body.data.force) {
      const active = await findActiveScanByCommit(deps.db, parsed.repoUrl, resolved.commitSha, deps.activeMaxAgeMs ?? ACTIVE_SCAN_MAX_AGE_MS);
      if (active) return reply.code(200).send(await respond(active.id, 'in_progress'));
    }

    if (!body.data.force && deps.freshnessMinutes > 0) {
      const since = new Date(Date.now() - deps.freshnessMinutes * 60_000);
      const recent = await findRecentDoneScanByCommit(deps.db, parsed.repoUrl, resolved.commitSha, since, deps.summarizerMode);
      if (recent) return reply.code(200).send(await respond(recent.id, 'recent'));
    }

    const scan = await createScan(deps.db, {
      repoOwner: parsed.owner,
      repoName: parsed.repo,
      repoUrl: parsed.repoUrl,
      refRequested: parsed.ref,
      refResolved: resolved.refResolved,
      commitSha: resolved.commitSha,
      maxAttempts: deps.maxAttempts,
    });
    try {
      await deps.enqueue(scan.id);
    } catch (err) {
      req.log.error({ err, scanId: scan.id }, 'could not enqueue scan');
      await markFailed(deps.db, scan.id, 'The scan could not be queued.');
      throw new HttpError(503, 'queue_unavailable', 'The scan queue is not available right now. Try again in a moment.');
    }
    req.log.info({ scanId: scan.id, repoUrl: scan.repoUrl, commitSha: scan.commitSha }, 'scan queued');
    return reply.code(201).send(await respond(scan.id, null));
  });

  app.get('/api/scans/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!z.uuid().safeParse(id).success) throw NOT_FOUND();
    const view = await loadScanView(deps.db, id);
    if (!view) throw NOT_FOUND();
    return view;
  });

  app.get('/api/scans', async (req) => {
    const query = ListQuery.safeParse(req.query);
    const limit = query.success ? query.data.limit : 50;
    return { scans: await listScanItems(deps.db, limit) };
  });
}
