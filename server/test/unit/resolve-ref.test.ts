import { describe, expect, it, vi } from 'vitest';
import { ExecError, type Exec, type ExecOptions } from '../../src/github/exec.js';
import { parseGitHubUrl } from '../../src/github/parse-url.js';
import {
  createGitRefResolver,
  GitUnavailableError,
  parseLsRemote,
  pickResolved,
  RefNotFoundError,
  RepoNotFoundError,
} from '../../src/github/resolve-ref.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function fakeExec(stdout: string): { exec: Exec; calls: Array<[string, string[], ExecOptions]> } {
  const fn = vi.fn(async (_cmd: string, _args: string[], _opts: ExecOptions) => ({ stdout, stderr: '' }));
  return { exec: fn as unknown as Exec, calls: fn.mock.calls as Array<[string, string[], ExecOptions]> };
}

describe('parseLsRemote', () => {
  it('reads symrefs and sha lines', () => {
    const out = `ref: refs/heads/main\tHEAD\n${SHA_A}\tHEAD\n`;
    expect(parseLsRemote(out)).toEqual({ symref: 'refs/heads/main', lines: [{ sha: SHA_A, ref: 'HEAD' }] });
  });
});

describe('pickResolved', () => {
  it('prefers the peeled tag, then the tag, then the branch', () => {
    const parsed = parseGitHubUrl('https://github.com/o/r', 'v1');
    const out = `${SHA_A}\trefs/heads/v1\n${SHA_B}\trefs/tags/v1\n${'c'.repeat(40)}\trefs/tags/v1^{}\n`;
    expect(pickResolved(parsed, out)).toEqual({ commitSha: 'c'.repeat(40), refResolved: 'refs/tags/v1' });
    const branchOnly = `${SHA_A}\trefs/heads/v1\n`;
    expect(pickResolved(parsed, branchOnly)).toEqual({ commitSha: SHA_A, refResolved: 'refs/heads/v1' });
  });

  it('resolves the default branch from HEAD', () => {
    const parsed = parseGitHubUrl('https://github.com/o/r');
    const out = `ref: refs/heads/main\tHEAD\n${SHA_A}\tHEAD\n`;
    expect(pickResolved(parsed, out)).toEqual({ commitSha: SHA_A, refResolved: 'refs/heads/main' });
  });
});

describe('createGitRefResolver', () => {
  it('calls git ls-remote with --symref for the default branch', async () => {
    const { exec, calls } = fakeExec(`ref: refs/heads/main\tHEAD\n${SHA_A}\tHEAD\n`);
    const resolver = createGitRefResolver({ exec });
    const result = await resolver.resolve(parseGitHubUrl('https://github.com/o/r'));
    expect(result).toEqual({ commitSha: SHA_A, refResolved: 'refs/heads/main' });
    const [cmd, args, opts] = calls[0]!;
    expect(cmd).toBe('git');
    expect(args).toEqual(['ls-remote', '--symref', 'https://github.com/o/r', 'HEAD']);
    expect(opts.timeoutMs).toBe(10_000);
    expect(opts.env?.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('asks for both heads and tags for a named ref and passes the auth header through the environment', async () => {
    const { exec, calls } = fakeExec(`${SHA_A}\trefs/heads/dev\n`);
    const resolver = createGitRefResolver({ exec, token: 'tok' });
    await resolver.resolve(parseGitHubUrl('https://github.com/o/r', 'dev'));
    const [, args, opts] = calls[0]!;
    expect(args).toEqual(['ls-remote', 'https://github.com/o/r', 'refs/heads/dev', 'refs/tags/dev']);
    expect(opts.env?.GIT_CONFIG_KEY_0).toBe('http.extraHeader');
    expect(opts.env?.GIT_CONFIG_VALUE_0).toContain('Authorization: Basic ');
    expect(JSON.stringify(args)).not.toContain('tok');
  });

  it('asks for the pull request head ref', async () => {
    const { exec, calls } = fakeExec(`${SHA_A}\trefs/pull/7/head\n`);
    const result = await createGitRefResolver({ exec }).resolve(parseGitHubUrl('https://github.com/o/r/pull/7'));
    expect(result).toEqual({ commitSha: SHA_A, refResolved: 'refs/pull/7/head' });
    expect(calls[0]![1]).toEqual(['ls-remote', 'https://github.com/o/r', 'refs/pull/7/head']);
  });

  it('returns a sha without calling git', async () => {
    const { exec, calls } = fakeExec('');
    const result = await createGitRefResolver({ exec }).resolve(parseGitHubUrl('https://github.com/o/r', 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'));
    expect(result).toEqual({ commitSha: 'abcdef0123456789abcdef0123456789abcdef01', refResolved: 'abcdef0123456789abcdef0123456789abcdef01' });
    expect(calls).toHaveLength(0);
  });

  it('maps git failures to typed errors without leaking the token', async () => {
    const failing = (stderr: string, timedOut = false): Exec => async () => {
      throw new ExecError('git', 128, stderr, timedOut);
    };
    const parsed = parseGitHubUrl('https://github.com/o/r');
    await expect(createGitRefResolver({ exec: failing('remote: Repository not found.'), token: 'tok' }).resolve(parsed)).rejects.toBeInstanceOf(RepoNotFoundError);
    await expect(createGitRefResolver({ exec: failing('fatal: could not read Username for https://github.com') }).resolve(parsed)).rejects.toBeInstanceOf(RepoNotFoundError);
    await expect(createGitRefResolver({ exec: failing('', true) }).resolve(parsed)).rejects.toBeInstanceOf(GitUnavailableError);
    await expect(createGitRefResolver({ exec: failing('fatal: unable to access: Could not resolve host') }).resolve(parsed)).rejects.toBeInstanceOf(GitUnavailableError);
    await expect(createGitRefResolver({ exec: failing('weird'), token: 'tok' }).resolve(parsed)).rejects.toThrow(/git failed: weird/);
    await expect(createGitRefResolver({ exec: failing('weird'), token: 'tok' }).resolve(parsed)).rejects.not.toThrow(/tok/);
  });

  it('reports a missing ref', async () => {
    const { exec } = fakeExec('');
    await expect(createGitRefResolver({ exec }).resolve(parseGitHubUrl('https://github.com/o/r', 'nope'))).rejects.toBeInstanceOf(RefNotFoundError);
  });
});
