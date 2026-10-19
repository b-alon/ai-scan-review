import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCodeStage } from '../../src/scan/code-stage.js';

describe('runCodeStage', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'code-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('scans text files, flags committed .env files but not examples, skips binaries and node_modules', async () => {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'node_modules/x'), { recursive: true });
    await writeFile(path.join(root, 'src/config.js'), 'const key = "AKIAIOSFODNN7EXAMPLE";\n');
    await writeFile(path.join(root, 'node_modules/x/index.js'), 'const key = "AKIAIOSFODNN7EXAMPLE";\n');
    await writeFile(path.join(root, '.env'), 'SECRET=abc\n');
    await writeFile(path.join(root, '.env.example'), 'SECRET=\n');
    await writeFile(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const result = await runCodeStage({ dir: root, signal: new AbortController().signal, progress: async () => undefined });
    expect(result.findings.map((f) => `${f.ruleId}@${f.location}`).sort()).toEqual(['config.env_committed@.env', 'secret.aws_access_key@src/config.js:1']);
    expect(result.files).toBe(4);
  });
});
