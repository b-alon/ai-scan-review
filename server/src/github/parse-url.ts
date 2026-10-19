export type RefKind = 'default' | 'named' | 'sha' | 'pull';

export interface ParsedRepo {
  owner: string;
  repo: string;
  repoUrl: string;
  ref: string | null;
  refKind: RefKind;
}

export class InvalidRepoUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRepoUrlError';
  }
}

const NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/i;
const SHORT_SHA = /^[0-9a-f]{7,39}$/i;
const UNSAFE_REF = /\s|\.\.|[~^:?*[\\]|^-|\/$|^\/|@\{/;

export function classifyRef(ref: string): RefKind {
  if (SHA.test(ref)) return 'sha';
  if (/^refs\/pull\/\d+\/head$/.test(ref)) return 'pull';
  return 'named';
}

function assertSafeRef(ref: string): void {
  if (SHORT_SHA.test(ref)) {
    throw new InvalidRepoUrlError('Use the full 40 character commit SHA, or a branch or tag name.');
  }
  if (UNSAFE_REF.test(ref) || ref.length > 200) {
    throw new InvalidRepoUrlError('The ref contains characters git does not allow.');
  }
}

export function parseGitHubUrl(input: string, explicitRef?: string | null): ParsedRepo {
  const raw = input.trim();
  if (!raw) throw new InvalidRepoUrlError('Enter a GitHub repository URL.');

  let pathPart: string;
  const ssh = /^git@github\.com:(.+)$/i.exec(raw);
  if (ssh) {
    pathPart = ssh[1]!;
  } else {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      throw new InvalidRepoUrlError('That does not look like a valid URL.');
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') {
      throw new InvalidRepoUrlError('Only github.com repositories are supported.');
    }
    pathPart = url.pathname;
  }

  const segments = pathPart.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new InvalidRepoUrlError('The URL must include an owner and a repository, like github.com/owner/repo.');
  }
  const owner = segments[0]!.toLowerCase();
  const repo = segments[1]!.replace(/\.git$/i, '').toLowerCase();
  if (!NAME.test(owner) || !NAME.test(repo)) {
    throw new InvalidRepoUrlError('The owner or repository name contains unsupported characters.');
  }

  let ref: string | null = null;
  let refKind: RefKind = 'default';
  const explicit = explicitRef?.trim();
  if (explicit) {
    refKind = classifyRef(explicit);
    ref = refKind === 'sha' ? explicit.toLowerCase() : explicit;
  } else {
    const [kind, ...more] = segments.slice(2);
    const first = more[0];
    if ((kind === 'tree' || kind === 'blob') && first) {
      ref = kind === 'tree' ? more.join('/') : first;
      refKind = classifyRef(ref);
    } else if (kind === 'commit' && first && /^[0-9a-f]{7,40}$/i.test(first)) {
      ref = first.toLowerCase();
      refKind = 'sha';
    } else if (kind === 'releases' && first === 'tag' && more[1]) {
      ref = more.slice(1).join('/');
      refKind = 'named';
    } else if (kind === 'pull' && first && /^\d+$/.test(first)) {
      ref = `refs/pull/${first}/head`;
      refKind = 'pull';
    }
  }
  if (ref) assertSafeRef(ref);

  return { owner, repo, repoUrl: `https://github.com/${owner}/${repo}`, ref, refKind };
}
