import { access, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecError, type Exec } from '../../src/github/exec.js';
import { cacheEntryPath, READY_MARKER, sweepCloneCache } from '../../src/scan/clone-cache.js';
import { fetchRepo } from '../../src/scan/fetch.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const REPO = 'https://github.com/o/r';

function gitExec(calls: string[][]): Exec {
  return async (_cmd, args, opts) => {
    calls.push(args);
    if (args.includes('checkout')) await writeFile(path.join(opts.cwd!, 'index.js'), 'console.log(1)');
    if (args.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

const exists = (p: string) => access(p).then(() => true, () => false);

describe('clone cache', () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'clone-cache-'));
  });
  afterEach(() => rm(cacheDir, { recursive: true, force: true }));

  it('derives the entry path from the repo url and the commit only', () => {
    const p = cacheEntryPath(cacheDir, REPO, SHA);
    expect(p.startsWith(cacheDir + path.sep)).toBe(true);
    expect(path.basename(p)).toBe(SHA);
    expect(path.relative(cacheDir, p).split(path.sep)).toHaveLength(2);
    expect(cacheEntryPath(cacheDir, 'https://github.com/o/other', SHA)).not.toBe(p);
  });

  it('fetches into the cache once and reuses the complete entry without calling git', async () => {
    const calls: string[][] = [];
    const signal = new AbortController().signal;
    const first = await fetchRepo({ repoUrl: REPO, commitSha: SHA, exec: gitExec(calls), signal, cacheDir });
    expect(first.dir).toBe(cacheEntryPath(cacheDir, REPO, SHA));
    expect(await exists(path.join(first.dir, READY_MARKER))).toBe(true);
    expect(calls.some((a) => a.includes('fetch'))).toBe(true);
    await first.cleanup();
    expect(await exists(first.dir)).toBe(true);

    const neverCalled: Exec = async () => {
      throw new Error('git must not run for a cached commit');
    };
    const second = await fetchRepo({ repoUrl: REPO, commitSha: SHA, exec: neverCalled, signal, cacheDir });
    expect(second.dir).toBe(first.dir);
    expect(second.commitSha).toBe(SHA);
    expect(second.fileCount).toBe(1);
    expect((await readdir(path.dirname(first.dir))).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });

  it('re-fetches an incomplete entry and leaves nothing behind when the fetch crashes', async () => {
    const entry = cacheEntryPath(cacheDir, REPO, SHA);
    await mkdir(entry, { recursive: true });
    await writeFile(path.join(entry, 'partial.js'), 'x');
    const calls: string[][] = [];
    const result = await fetchRepo({ repoUrl: REPO, commitSha: SHA, exec: gitExec(calls), signal: new AbortController().signal, cacheDir });
    expect(calls.some((a) => a.includes('fetch'))).toBe(true);
    expect(await exists(path.join(result.dir, READY_MARKER))).toBe(true);
    expect(await exists(path.join(result.dir, 'partial.js'))).toBe(false);

    const crashing: Exec = async (_cmd, args) => {
      if (args.includes('fetch')) throw new ExecError('git', 128, 'fatal: remote error: upload-pack: not our ref', false);
      return { stdout: '', stderr: '' };
    };
    const other = 'f'.repeat(40);
    await expect(fetchRepo({ repoUrl: REPO, commitSha: other, exec: crashing, signal: new AbortController().signal, cacheDir })).rejects.toThrow(/Commit not found/);
    expect(await exists(cacheEntryPath(cacheDir, REPO, other))).toBe(false);
    expect((await readdir(path.dirname(entry))).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });

  it('serializes concurrent fetches of one commit so only one clone runs and nothing is deleted under a reader', async () => {
    const calls: string[][] = [];
    const slowGit: Exec = async (cmd, args, opts) => {
      if (args.includes('fetch')) await new Promise((r) => setTimeout(r, 150));
      return gitExec(calls)(cmd, args, opts);
    };
    const signal = new AbortController().signal;
    const [a, b] = await Promise.all([
      fetchRepo({ repoUrl: REPO, commitSha: SHA, exec: slowGit, signal, cacheDir }),
      fetchRepo({ repoUrl: REPO, commitSha: SHA, exec: slowGit, signal, cacheDir }),
    ]);
    expect(a.dir).toBe(b.dir);
    expect(calls.filter((c) => c.includes('fetch'))).toHaveLength(1);
    expect([a.cached, b.cached].sort()).toEqual([false, true]);
    expect(await exists(path.join(a.dir, READY_MARKER))).toBe(true);
    const siblings = await readdir(path.dirname(a.dir));
    expect(siblings).toEqual([SHA]);
  });

  it('breaks a stale lock left by a crashed worker', async () => {
    const entry = cacheEntryPath(cacheDir, REPO, SHA);
    await mkdir(`${entry}.lock`, { recursive: true });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(`${entry}.lock`, old, old);
    const calls: string[][] = [];
    const result = await fetchRepo({ repoUrl: REPO, commitSha: SHA, exec: gitExec(calls), signal: new AbortController().signal, cacheDir, timeoutMs: 5000 });
    expect(await exists(path.join(result.dir, READY_MARKER))).toBe(true);
    expect(await exists(`${entry}.lock`)).toBe(false);
  });

  it('sweeps entries and leftover temp directories older than the limit', async () => {
    const old = cacheEntryPath(cacheDir, REPO, 'a'.repeat(40));
    const fresh = cacheEntryPath(cacheDir, REPO, 'b'.repeat(40));
    const tmp = path.join(path.dirname(old), `${'c'.repeat(40)}.tmp-zzz`);
    for (const d of [old, fresh, tmp]) await mkdir(d, { recursive: true });
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    await utimes(old, twoDaysAgo, twoDaysAgo);
    await utimes(tmp, twoDaysAgo, twoDaysAgo);
    const result = await sweepCloneCache(cacheDir, 24 * 3600 * 1000);
    expect(result.removed).toBe(2);
    expect(await exists(old)).toBe(false);
    expect(await exists(tmp)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(await sweepCloneCache(path.join(cacheDir, 'missing'), 1000)).toEqual({ removed: 0 });
  });
});
