import { describe, expect, it } from 'vitest';
import { gitEnv } from '../../src/github/git-auth.js';

describe('git auth', () => {
  it('disables prompts and lfs downloads and adds no auth without a token', () => {
    const env = gitEnv(undefined);
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_LFS_SKIP_SMUDGE).toBe('1');
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
  });

  it('passes the token as a basic auth header through git config env vars, never in argv or a URL', () => {
    const env = gitEnv('ghp_secret');
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from('x-access-token:ghp_secret').toString('base64')}`);
    expect(JSON.stringify(env)).not.toContain('ghp_secret');
  });
});
