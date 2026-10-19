import { createHash } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/** Written inside an entry before it is renamed into place, so an entry is complete if and only if the marker exists. */
export const READY_MARKER = '.scan-ready';

const TMP_INFIX = '.tmp-';

/** `<cacheDir>/<hash of repo url>/<commit sha>`: both parts come from validated values, never from raw user input. */
export function cacheEntryPath(cacheDir: string, repoUrl: string, commitSha: string): string {
  const repoKey = createHash('sha1').update(repoUrl).digest('hex').slice(0, 16);
  return path.join(cacheDir, repoKey, commitSha);
}

export function tempEntryPrefix(entryPath: string): string {
  return `${entryPath}${TMP_INFIX}`;
}

/** Removes complete entries and leftover temp directories whose mtime is older than maxAgeMs. */
export async function sweepCloneCache(cacheDir: string, maxAgeMs: number, now = Date.now()): Promise<{ removed: number }> {
  let removed = 0;
  let repoDirs: string[];
  try {
    repoDirs = await readdir(cacheDir);
  } catch {
    return { removed };
  }
  for (const repoKey of repoDirs) {
    const repoDir = path.join(cacheDir, repoKey);
    let entries: string[];
    try {
      entries = await readdir(repoDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = path.join(repoDir, name);
      let mtime: number;
      try {
        mtime = (await stat(full)).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtime > maxAgeMs) {
        await rm(full, { recursive: true, force: true });
        removed += 1;
      }
    }
  }
  return { removed };
}
