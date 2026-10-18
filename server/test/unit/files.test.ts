import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { walkFiles } from '../../src/scan/files.js';

describe('walkFiles', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'walk-'));
    await mkdir(path.join(root, 'src/deep/deeper'), { recursive: true });
    await mkdir(path.join(root, 'node_modules/x'), { recursive: true });
    await writeFile(path.join(root, 'src/a.ts'), 'a');
    await writeFile(path.join(root, 'src/deep/deeper/b.ts'), 'b');
    await writeFile(path.join(root, 'node_modules/x/index.js'), 'ignored');
    await writeFile(path.join(root, 'big.bin'), Buffer.alloc(600 * 1024));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('skips ignored directories and large files, returns posix relative paths', async () => {
    const { files, truncated } = await walkFiles(root);
    expect(files.map((f) => f.relPath).sort()).toEqual(['src/a.ts', 'src/deep/deeper/b.ts']);
    expect(truncated).toBe(false);
  });

  it('honors depth and file caps', async () => {
    expect((await walkFiles(root, { maxDepth: 1 })).files.map((f) => f.relPath)).toEqual(['src/a.ts']);
    const capped = await walkFiles(root, { maxFiles: 1 });
    expect(capped.files).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });
});
