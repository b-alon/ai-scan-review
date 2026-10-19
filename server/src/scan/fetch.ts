import { access, mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExecError, type Exec } from '../github/exec.js';
import { gitEnv } from '../github/git-auth.js';
import { REPO_NOT_FOUND_MESSAGE } from '../github/resolve-ref.js';
import { cacheEntryPath, READY_MARKER, tempEntryPrefix } from './clone-cache.js';
import { NonRetryableScanError } from './errors.js';
import { countFiles } from './files.js';

export class CommitNotFoundError extends NonRetryableScanError {
  constructor() {
    super('Commit not found in this repository.');
    this.name = 'CommitNotFoundError';
  }
}

export interface FetchOptions {
  repoUrl: string;
  commitSha: string;
  token?: string | undefined;
  exec: Exec;
  signal: AbortSignal;
  timeoutMs?: number;
  /** Where throwaway clones go when no cache is configured. */
  tmpRoot?: string;
  /** Content-addressed clone cache. When set, a complete entry for the commit is reused and the clone is kept. */
  cacheDir?: string | undefined;
}

export interface FetchResult {
  dir: string;
  commitSha: string;
  fileCount: number;
  /** True when the clone came from the cache. */
  cached: boolean;
  cleanup(): Promise<void>;
}

export function mapFetchError(err: unknown): Error {
  if (!(err instanceof ExecError)) return err instanceof Error ? err : new Error(String(err));
  const text = err.stderr;
  if (/not our ref|couldn't find remote ref|bad object|not a valid object name/i.test(text)) return new CommitNotFoundError();
  if (/Repository not found|could not read Username|Authentication failed|Permission denied/i.test(text)) {
    return new NonRetryableScanError(REPO_NOT_FOUND_MESSAGE);
  }
  if (err.timedOut) return new Error('Fetching the repository timed out.');
  return new Error(`git failed: ${text.split('\n')[0] || err.message}`);
}

const isComplete = (dir: string): Promise<boolean> =>
  access(path.join(dir, READY_MARKER)).then(
    () => true,
    () => false,
  );

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One writer per cache entry, across every worker that shares the cache directory. `mkdir` without
 * `recursive` is atomic on every filesystem we care about, so the lock directory is the mutex. A lock
 * older than `staleMs` belongs to a worker that died mid-fetch and is taken over.
 */
async function withEntryLock<T>(entry: string, waitMs: number, staleMs: number, fn: () => Promise<T>): Promise<T> {
  const lockDir = `${entry}.lock`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const age = await stat(lockDir).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age > staleMs) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error('Timed out waiting for another worker to fetch this commit.');
      await sleep(200);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function cloneInto(dir: string, opts: FetchOptions, timeoutMs: number): Promise<string> {
  const env = gitEnv(opts.token);
  const deadline = Date.now() + timeoutMs;
  const git = (args: string[]) =>
    opts.exec('git', args, { cwd: dir, env, signal: opts.signal, timeoutMs: Math.max(1000, deadline - Date.now()) });
  await git(['init', '-q']);
  await git(['remote', 'add', 'origin', opts.repoUrl]);
  await git(['fetch', '-q', '--depth', '1', 'origin', opts.commitSha]);
  await git(['checkout', '-q', 'FETCH_HEAD']);
  const { stdout } = await git(['rev-parse', 'HEAD']);
  const resolved = stdout.trim();
  return /^[0-9a-f]{40}$/.test(resolved) ? resolved : opts.commitSha;
}

async function fetchThrowaway(opts: FetchOptions, timeoutMs: number): Promise<FetchResult> {
  const dir = await mkdtemp(path.join(opts.tmpRoot ?? os.tmpdir(), 'scan-'));
  const cleanup = (): Promise<void> => rm(dir, { recursive: true, force: true });
  try {
    const commitSha = await cloneInto(dir, opts, timeoutMs);
    return { dir, commitSha, fileCount: await countFiles(dir), cached: false, cleanup };
  } catch (err) {
    await cleanup();
    throw mapFetchError(err);
  }
}

async function fetchCached(opts: FetchOptions, cacheDir: string, timeoutMs: number): Promise<FetchResult> {
  const entry = cacheEntryPath(cacheDir, opts.repoUrl, opts.commitSha);
  const keep = async (): Promise<void> => undefined;

  const reuse = async (): Promise<FetchResult> => {
    const now = new Date();
    await utimes(entry, now, now).catch(() => undefined);
    return { dir: entry, commitSha: opts.commitSha, fileCount: await countFiles(entry), cached: true, cleanup: keep };
  };

  if (await isComplete(entry)) return reuse();
  await mkdir(path.dirname(entry), { recursive: true });

  return withEntryLock(entry, timeoutMs, timeoutMs + 60_000, async () => {
    // Another worker may have finished this commit while we waited for the lock.
    if (await isComplete(entry)) return reuse();

    // Under the lock, anything at the entry path is an incomplete clone from a crashed attempt:
    // complete entries are only ever created by a lock holder, and readers only use complete ones.
    await rm(entry, { recursive: true, force: true });
    const tmp = await mkdtemp(tempEntryPrefix(entry));
    const discard = (): Promise<void> => rm(tmp, { recursive: true, force: true });

    let commitSha: string;
    try {
      commitSha = await cloneInto(tmp, opts, timeoutMs);
      await writeFile(path.join(tmp, READY_MARKER), `${commitSha}\n`);
      await rename(tmp, entry);
    } catch (err) {
      await discard();
      throw mapFetchError(err);
    }
    return { dir: entry, commitSha, fileCount: await countFiles(entry), cached: false, cleanup: keep };
  });
}

export async function fetchRepo(opts: FetchOptions): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return opts.cacheDir ? fetchCached(opts, opts.cacheDir, timeoutMs) : fetchThrowaway(opts, timeoutMs);
}
