import { describe, expect, it } from 'vitest';
import { InvalidRepoUrlError, parseGitHubUrl } from '../../src/github/parse-url.js';

describe('parseGitHubUrl', () => {
  const base = { owner: 'owner', repo: 'repo', repoUrl: 'https://github.com/owner/repo' };

  it.each([
    ['https://github.com/owner/repo', null, 'default'],
    ['https://github.com/owner/repo.git', null, 'default'],
    ['https://github.com/owner/repo/', null, 'default'],
    ['http://www.github.com/owner/repo', null, 'default'],
    ['github.com/owner/repo', null, 'default'],
    ['git@github.com:owner/repo.git', null, 'default'],
    ['  https://GitHub.com/Owner/Repo.git  ', null, 'default'],
  ])('normalizes %s', (input, ref, refKind) => {
    expect(parseGitHubUrl(input)).toEqual({ ...base, ref, refKind });
  });

  it('reads refs from GitHub URL forms', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/main')).toMatchObject({ ref: 'main', refKind: 'named' });
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/release/1.0')).toMatchObject({ ref: 'release/1.0', refKind: 'named' });
    expect(parseGitHubUrl('https://github.com/owner/repo/blob/dev/src/index.ts')).toMatchObject({ ref: 'dev', refKind: 'named' });
    expect(parseGitHubUrl('https://github.com/owner/repo/releases/tag/v1.2.3')).toMatchObject({ ref: 'v1.2.3', refKind: 'named' });
    expect(parseGitHubUrl('https://github.com/owner/repo/commit/0123456789abcdef0123456789abcdef01234567')).toMatchObject({
      ref: '0123456789abcdef0123456789abcdef01234567',
      refKind: 'sha',
    });
    expect(parseGitHubUrl('https://github.com/owner/repo/pull/42/files')).toMatchObject({ ref: 'refs/pull/42/head', refKind: 'pull' });
    expect(parseGitHubUrl('https://github.com/owner/repo/issues/9')).toMatchObject({ ref: null, refKind: 'default' });
  });

  it('lets an explicit ref override the URL and classifies it', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/main', 'v2')).toMatchObject({ ref: 'v2', refKind: 'named' });
    expect(parseGitHubUrl('https://github.com/owner/repo', 'ABCDEF0123456789ABCDEF0123456789ABCDEF01')).toMatchObject({
      ref: 'abcdef0123456789abcdef0123456789abcdef01',
      refKind: 'sha',
    });
    expect(parseGitHubUrl('https://github.com/owner/repo', '  ')).toMatchObject({ ref: null, refKind: 'default' });
  });

  it.each([
    ['', /Enter a GitHub repository URL/],
    ['https://gitlab.com/owner/repo', /Only github.com/],
    ['https://github.com/owner', /owner and a repository/],
    ['https://github.com/ow ner/repo', /unsupported characters/],
    ['not a url at all', /Only github.com|valid URL/],
  ])('rejects %s', (input, message) => {
    expect(() => parseGitHubUrl(input)).toThrow(InvalidRepoUrlError);
    expect(() => parseGitHubUrl(input)).toThrow(message);
  });

  it('rejects refs git would treat as options or ranges', () => {
    expect(() => parseGitHubUrl('https://github.com/owner/repo', '--upload-pack=evil')).toThrow(InvalidRepoUrlError);
    expect(() => parseGitHubUrl('https://github.com/owner/repo', 'a..b')).toThrow(InvalidRepoUrlError);
    expect(() => parseGitHubUrl('https://github.com/owner/repo', 'bad ref')).toThrow(InvalidRepoUrlError);
  });

  it('rejects abbreviated commit shas, which git cannot fetch', () => {
    expect(() => parseGitHubUrl('https://github.com/owner/repo', 'abc1234')).toThrow(/full 40 character/);
    expect(() => parseGitHubUrl('https://github.com/owner/repo/commit/abc1234')).toThrow(/full 40 character/);
  });
});
