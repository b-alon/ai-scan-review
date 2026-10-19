import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExecError, type Exec } from '../github/exec.js';
import { gitEnv } from '../github/git-auth.js';
import { REPO_NOT_FOUND_MESSAGE } from '../github/resolve-ref.js';
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
  tmpRoot?: string;
}

export interface FetchResult {
  dir: string;
  commitSha: string;
  fileCount: number;
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

export async function fetchRepo(opts: FetchOptions): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const dir = await mkdtemp(path.join(opts.tmpRoot ?? os.tmpdir(), 'scan-'));
  const cleanup = (): Promise<void> => rm(dir, { recursive: true, force: true });
  const env = gitEnv(opts.token);
  const deadline = Date.now() + timeoutMs;

  const git = (args: string[]) =>
    opts.exec('git', args, { cwd: dir, env, signal: opts.signal, timeoutMs: Math.max(1000, deadline - Date.now()) });

  try {
    await git(['init', '-q']);
    await git(['remote', 'add', 'origin', opts.repoUrl]);
    await git(['fetch', '-q', '--depth', '1', 'origin', opts.commitSha]);
    await git(['checkout', '-q', 'FETCH_HEAD']);
    const { stdout } = await git(['rev-parse', 'HEAD']);
    const fileCount = await countFiles(dir);
    const resolved = stdout.trim();
    return { dir, commitSha: /^[0-9a-f]{40}$/.test(resolved) ? resolved : opts.commitSha, fileCount, cleanup };
  } catch (err) {
    await cleanup();
    throw mapFetchError(err);
  }
}
