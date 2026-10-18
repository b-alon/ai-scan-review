import path from 'node:path';
import { walkFiles } from '../files.js';
import type { ManifestFile, ManifestKind } from './types.js';

const KINDS: Record<string, ManifestKind> = {
  'package-lock.json': 'package-lock',
  'package.json': 'package-json',
  'requirements.txt': 'requirements',
  'go.mod': 'go-mod',
  'Gemfile.lock': 'gemfile-lock',
  'yarn.lock': 'lock-marker',
  'pnpm-lock.yaml': 'lock-marker',
  'npm-shrinkwrap.json': 'lock-marker',
};

export async function discoverManifests(root: string, maxDepth = 3): Promise<ManifestFile[]> {
  const { files } = await walkFiles(root, { maxDepth, maxFiles: 50_000, maxFileBytes: 20 * 1024 * 1024 });
  const out: ManifestFile[] = [];
  for (const f of files) {
    const kind = KINDS[path.posix.basename(f.relPath)];
    if (kind) out.push({ kind, relPath: f.relPath, absPath: f.absPath });
  }
  return out;
}
