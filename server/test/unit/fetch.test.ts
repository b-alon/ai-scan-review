import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecError, type Exec } from '../../src/github/exec.js';
import { NonRetryableScanError } from '../../src/scan/errors.js';
import { CommitNotFoundError, fetchRepo } from '../../src/scan/fetch.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

interface Call {
  args: string[];
  cwd: string | undefined;
  env: NodeJS.ProcessEnv | undefined;
}

function recordingExec(behavior: (args: string[], cwd: string | undefined) => Promise<{ stdout: string; stderr: string }>): Exec & { calls: Call[] } {
  const calls: Call[] = [];
  const exec: Exec = async (_cmd, args, opts) => {
    calls.push({ args, cwd: opts.cwd, env: opts.env });
    return behavior(args, opts.cwd);
  };
  return Object.assign(exec, { calls });
}

describe('fetchRepo', () => {
  let tmpRoot: string;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'fetch-test-'));
  });
  afterEach(() => rm(tmpRoot, { recursive: true, force: true }));

  it('runs init, remote add, shallow fetch by sha, checkout and rev-parse, then cleans up', async () => {
    const exec = recordingExec(async (args, cwd) => {
      if (args.includes('checkout')) await writeFile(path.join(cwd!, 'index.js'), 'console.log(1)');
      if (args.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const result = await fetchRepo({ repoUrl: 'https://github.com/o/r', commitSha: SHA, exec, signal: new AbortController().signal, tmpRoot });
    expect(exec.calls.map((c) => c.args)).toEqual([
      ['init', '-q'],
      ['remote', 'add', 'origin', 'https://github.com/o/r'],
      ['fetch', '-q', '--depth', '1', 'origin', SHA],
      ['checkout', '-q', 'FETCH_HEAD'],
      ['rev-parse', 'HEAD'],
    ]);
    expect(exec.calls.every((c) => c.cwd === result.dir)).toBe(true);
    expect(result.commitSha).toBe(SHA);
    expect(result.fileCount).toBe(1);
    await result.cleanup();
    await expect(access(result.dir)).rejects.toThrow();
  });

  it('passes the auth header through the environment of every git call when a token is set', async () => {
    const exec = recordingExec(async () => ({ stdout: SHA, stderr: '' }));
    const result = await fetchRepo({ repoUrl: 'https://github.com/o/r', commitSha: SHA, token: 'tok', exec, signal: new AbortController().signal, tmpRoot });
    expect(exec.calls.every((c) => c.env?.GIT_CONFIG_KEY_0 === 'http.extraHeader' && c.env?.GIT_CONFIG_VALUE_0?.startsWith('Authorization: Basic '))).toBe(true);
    expect(exec.calls.every((c) => !JSON.stringify(c.args).includes('tok'))).toBe(true);
    await result.cleanup();
  });

  it('maps a missing commit to a non-retryable error and cleans up', async () => {
    const exec = recordingExec(async (args) => {
      if (args.includes('fetch')) throw new ExecError('git', 128, 'fatal: remote error: upload-pack: not our ref 0123', false);
      return { stdout: '', stderr: '' };
    });
    await expect(fetchRepo({ repoUrl: 'https://github.com/o/r', commitSha: SHA, exec, signal: new AbortController().signal, tmpRoot })).rejects.toBeInstanceOf(CommitNotFoundError);
    const auth = recordingExec(async () => {
      throw new ExecError('git', 128, 'remote: Repository not found.', false);
    });
    await expect(fetchRepo({ repoUrl: 'https://github.com/o/r', commitSha: SHA, exec: auth, signal: new AbortController().signal, tmpRoot })).rejects.toBeInstanceOf(NonRetryableScanError);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it('aborts a hanging fetch at the timeout with a retryable error and cleans up', async () => {
    const hanging: Exec = (_cmd, args, opts) =>
      new Promise((resolve, reject) => {
        if (!args.includes('fetch')) {
          resolve({ stdout: '', stderr: '' });
          return;
        }
        opts.signal?.addEventListener('abort', () => reject(new ExecError('git', null, '', true)), { once: true });
      });
    const signal = AbortSignal.timeout(100);
    const promise = fetchRepo({ repoUrl: 'https://github.com/o/r', commitSha: SHA, exec: hanging, signal, tmpRoot, timeoutMs: 5000 });
    await expect(promise).rejects.toThrow(/timed out/);
    await expect(promise).rejects.not.toBeInstanceOf(NonRetryableScanError);
    expect(await readdir(tmpRoot)).toEqual([]);
  });
});
