import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { registerScanRoutes } from '../../src/api/routes/scans.js';
import { completeScan, startAttempt } from '../../src/db/scans-repo.js';
import type { ParsedRepo } from '../../src/github/parse-url.js';
import { RefNotFoundError, RepoNotFoundError, type RefResolver } from '../../src/github/resolve-ref.js';
import type { Summary } from '../../src/summarize/contract.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

const SHA_MAIN = '1'.repeat(40);
const SHA_V1 = '2'.repeat(40);
const summary: Summary = { riskLevel: 'none', headline: 'h', overview: 'o', topRisks: [], nextActions: [] };

const resolver: RefResolver = {
  async resolve(parsed: ParsedRepo) {
    if (parsed.repo === 'missing') throw new RepoNotFoundError('Repository not found or private.');
    if (parsed.ref === 'nope') throw new RefNotFoundError('Branch "nope" was not found.');
    if (parsed.ref === 'v1') return { commitSha: SHA_V1, refResolved: 'refs/tags/v1' };
    return { commitSha: SHA_MAIN, refResolved: 'refs/heads/main' };
  },
};

describe.skipIf(!TEST_DATABASE_URL)('scan routes', () => {
  let t: TestDb;
  let app: FastifyInstance;
  const enqueued: string[] = [];
  let summarizerMode: 'claude' | 'deterministic' = 'deterministic';

  beforeAll(async () => {
    t = await setupTestDb();
    app = await buildApp({
      logger: pino({ level: 'silent' }),
      webDistDir: null,
      routes: [
        (a) =>
          registerScanRoutes(a, {
            db: t.db,
            resolver,
            enqueue: async (id) => {
              enqueued.push(id);
            },
            freshnessMinutes: 10,
            get summarizerMode() {
              return summarizerMode;
            },
            maxAttempts: 3,
          }),
      ],
    });
    await app.ready();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    enqueued.length = 0;
    summarizerMode = 'deterministic';
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  const post = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/scans', payload: body });

  it('rejects bad input with specific codes', async () => {
    expect((await post({})).statusCode).toBe(400);
    const bad = await post({ repoUrl: 'https://gitlab.com/a/b' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_repo_url');
    const missing = await post({ repoUrl: 'https://github.com/a/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('repo_not_found');
    const ref = await post({ repoUrl: 'https://github.com/a/b', ref: 'nope' });
    expect(ref.statusCode).toBe(400);
    expect(ref.json().error.code).toBe('ref_not_found');
    expect(enqueued).toEqual([]);
  });

  it('creates a scan, enqueues it, and returns the view', async () => {
    const res = await post({ repoUrl: 'https://github.com/A/B' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ repoUrl: 'https://github.com/a/b', commitSha: SHA_MAIN, refResolved: 'refs/heads/main', status: 'queued', reused: null, findings: null, comparison: null });
    expect(enqueued).toEqual([body.id]);
    const get = await app.inject({ method: 'GET', url: `/api/scans/${body.id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json().events).toEqual([]);
  });

  it('joins an in-flight scan of the same commit', async () => {
    const first = (await post({ repoUrl: 'https://github.com/a/b' })).json();
    const second = await post({ repoUrl: 'https://github.com/a/b/tree/main' });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ id: first.id, reused: 'in_progress' });
    expect(enqueued).toHaveLength(1);
  });

  it('reuses a recent done scan unless forced or the summarizer differs', async () => {
    const first = (await post({ repoUrl: 'https://github.com/a/b' })).json();
    await startAttempt(t.db, first.id, 1);
    await completeScan(t.db, first.id, { findings: [], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: null });

    const reused = await post({ repoUrl: 'https://github.com/a/b' });
    expect(reused.statusCode).toBe(200);
    expect(reused.json()).toMatchObject({ id: first.id, reused: 'recent', status: 'done' });

    const forced = await post({ repoUrl: 'https://github.com/a/b', force: true });
    expect(forced.statusCode).toBe(201);
    expect(forced.json().id).not.toBe(first.id);

    summarizerMode = 'claude';
    const other = await post({ repoUrl: 'https://github.com/a/b', ref: 'v1' });
    expect(other.statusCode).toBe(201);
  });

  it('returns 404 for unknown or malformed ids and lists scans with counts', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/scans/not-a-uuid' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/scans/00000000-0000-0000-0000-000000000000' })).statusCode).toBe(404);
    const created = (await post({ repoUrl: 'https://github.com/a/b' })).json();
    const list = await app.inject({ method: 'GET', url: '/api/scans?limit=5' });
    expect(list.statusCode).toBe(200);
    expect(list.json().scans[0]).toMatchObject({ id: created.id, status: 'queued', riskLevel: null, counts: null });
  });
});
