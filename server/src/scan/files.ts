import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  '.next',
  'coverage',
  'target',
  '__pycache__',
  '.venv',
  'venv',
]);

export interface WalkOptions {
  maxFiles?: number;
  maxDepth?: number;
  maxFileBytes?: number;
}

export interface WalkedFile {
  absPath: string;
  relPath: string;
  size: number;
}

export async function walkFiles(root: string, opts: WalkOptions = {}): Promise<{ files: WalkedFile[]; truncated: boolean }> {
  const maxFiles = opts.maxFiles ?? 5000;
  const maxDepth = opts.maxDepth ?? 25;
  const maxFileBytes = opts.maxFileBytes ?? 512 * 1024;
  const files: WalkedFile[] = [];
  let truncated = false;

  async function visit(dir: string, depth: number): Promise<void> {
    if (truncated || depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await visit(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let size: number;
      try {
        size = (await stat(abs)).size;
      } catch {
        continue;
      }
      if (size > maxFileBytes) continue;
      files.push({ absPath: abs, relPath: path.relative(root, abs).split(path.sep).join('/'), size });
      if (files.length >= maxFiles) truncated = true;
    }
  }

  await visit(root, 0);
  return { files, truncated };
}

export async function countFiles(root: string): Promise<number> {
  const { files } = await walkFiles(root, { maxFiles: Number.MAX_SAFE_INTEGER, maxFileBytes: Number.MAX_SAFE_INTEGER });
  return files.length;
}
