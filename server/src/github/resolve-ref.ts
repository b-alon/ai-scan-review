import { ExecError, type Exec } from './exec.js';
import { gitAuthArgs, gitEnv } from './git-auth.js';
import type { ParsedRepo } from './parse-url.js';

export interface ResolvedRef {
  commitSha: string;
  refResolved: string;
}

export class RepoNotFoundError extends Error {
  override name = 'RepoNotFoundError';
}
export class RefNotFoundError extends Error {
  override name = 'RefNotFoundError';
}
export class GitUnavailableError extends Error {
  override name = 'GitUnavailableError';
}

export interface RefResolver {
  resolve(repo: ParsedRepo): Promise<ResolvedRef>;
}

export interface LsRemoteLine {
  sha: string;
  ref: string;
}

export function parseLsRemote(output: string): { symref: string | null; lines: LsRemoteLine[] } {
  let symref: string | null = null;
  const lines: LsRemoteLine[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const sym = /^ref:\s+(\S+)\s+HEAD$/.exec(line);
    if (sym) {
      symref = sym[1]!;
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length >= 2 && /^[0-9a-f]{40}$/.test(parts[0]!)) lines.push({ sha: parts[0]!, ref: parts[1]! });
  }
  return { symref, lines };
}

export function pickResolved(parsed: ParsedRepo, output: string): ResolvedRef | null {
  const { symref, lines } = parseLsRemote(output);
  const find = (ref: string) => lines.find((l) => l.ref === ref);
  if (parsed.refKind === 'default') {
    const head = find('HEAD');
    return head ? { commitSha: head.sha, refResolved: symref ?? 'HEAD' } : null;
  }
  if (parsed.refKind === 'pull') {
    const line = find(parsed.ref!);
    return line ? { commitSha: line.sha, refResolved: line.ref } : null;
  }
  const name = parsed.ref!;
  for (const candidate of [`refs/tags/${name}^{}`, `refs/tags/${name}`, `refs/heads/${name}`]) {
    const line = find(candidate);
    if (line) return { commitSha: line.sha, refResolved: candidate.replace(/\^\{\}$/, '') };
  }
  return null;
}

export const REPO_NOT_FOUND_MESSAGE = 'Repository not found or private. Set GITHUB_TOKEN to scan private repositories.';

export function mapGitError(err: unknown): Error {
  if (!(err instanceof ExecError)) return err instanceof Error ? err : new Error(String(err));
  const text = err.stderr;
  if (/not found|could not read Username|Authentication failed|Permission denied|403/i.test(text)) {
    return new RepoNotFoundError(REPO_NOT_FOUND_MESSAGE);
  }
  if (err.timedOut) return new GitUnavailableError('GitHub did not respond in time. Try again in a moment.');
  if (/Could not resolve host|unable to access|Connection timed out|Failed to connect|Connection refused/i.test(text)) {
    return new GitUnavailableError('Could not reach GitHub. Check network access and try again.');
  }
  return new GitUnavailableError(`git failed: ${text.split('\n')[0] || 'unknown error'}`);
}

export function createGitRefResolver(opts: { exec: Exec; token?: string | undefined; timeoutMs?: number }): RefResolver {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return {
    async resolve(parsed) {
      if (parsed.refKind === 'sha') {
        const sha = parsed.ref!.toLowerCase();
        return { commitSha: sha, refResolved: sha };
      }
      const args = [...gitAuthArgs(opts.token), 'ls-remote'];
      if (parsed.refKind === 'default') args.push('--symref', parsed.repoUrl, 'HEAD');
      else if (parsed.refKind === 'pull') args.push(parsed.repoUrl, parsed.ref!);
      else args.push(parsed.repoUrl, `refs/heads/${parsed.ref}`, `refs/tags/${parsed.ref}`);

      let stdout: string;
      try {
        ({ stdout } = await opts.exec('git', args, { env: gitEnv(), timeoutMs }));
      } catch (err) {
        throw mapGitError(err);
      }
      const resolved = pickResolved(parsed, stdout);
      if (!resolved) {
        throw new RefNotFoundError(
          parsed.refKind === 'default' ? 'The repository has no default branch.' : `Branch, tag or pull request "${parsed.ref}" was not found.`,
        );
      }
      return resolved;
    },
  };
}
