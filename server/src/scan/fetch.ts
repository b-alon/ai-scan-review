import { access, mkdir, mkdtemp, rename, rm, utimes, writeFile } from 'node:fs/promises';
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

  if (await isComplete(entry)) {
    const now = new Date();
    await utimes(entry, now, now).catch(() => undefined);
    return { dir: entry, commitSha: opts.commitSha, fileCount: await countFiles(entry), cached: true, cleanup: keep };
  }

  // Anything already at the entry path is an incomplete clone from a crashed attempt.
  await rm(entry, { recursive: true, force: true });
  await mkdir(path.dirname(entry), { recursive: true });
  const tmp = await mkdtemp(tempEntryPrefix(entry));
  const discard = (): Promise<void> => rm(tmp, { recursive: true, force: true });

  let commitSha: string;
  try {
    commitSha = await cloneInto(tmp, opts, timeoutMs);
    await writeFile(path.join(tmp, READY_MARKER), `${commitSha}\n`);
  } catch (err) {
    await discard();
    throw mapFetchError(err);
  }

  try {
    await rename(tmp, entry);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if ((code === 'EEXIST' || code === 'ENOTEMPTY') && (await isComplete(entry))) {
      // Another worker finished the same commit first; its copy is identical.
      await discard();
    } else {
      await discard();
      throw err;
    }
  }
  return { dir: entry, commitSha, fileCount: await countFiles(entry), cached: false, cleanup: keep };
}

export async function fetchRepo(opts: FetchOptions): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return opts.cacheDir ? fetchCached(opts, opts.cacheDir, timeoutMs) : fetchThrowaway(opts, timeoutMs);
}
