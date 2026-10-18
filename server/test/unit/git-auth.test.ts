import { describe, expect, it } from 'vitest';
import { gitAuthArgs, gitEnv } from '../../src/github/git-auth.js';

describe('git auth', () => {
  it('returns no args without a token', () => {
    expect(gitAuthArgs(undefined)).toEqual([]);
  });

  it('passes the token as a basic auth header, never in a URL', () => {
    const args = gitAuthArgs('ghp_secret');
    expect(args[0]).toBe('-c');
    expect(args[1]).toBe(`http.extraHeader=Authorization: Basic ${Buffer.from('x-access-token:ghp_secret').toString('base64')}`);
    expect(args.join(' ')).not.toContain('ghp_secret');
  });

  it('disables prompts and lfs downloads', () => {
    const env = gitEnv();
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_LFS_SKIP_SMUDGE).toBe('1');
  });
});
