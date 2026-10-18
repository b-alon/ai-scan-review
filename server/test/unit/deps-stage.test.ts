import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryVulnCache } from '../../src/osv/cache.js';
import { OsvError, type OsvClient } from '../../src/osv/client.js';
import { runDependencyStage } from '../../src/scan/deps-stage.js';
import type { PackageRef } from '../../src/scan/parsers/types.js';

const log = pino({ level: 'silent' });
const signal = new AbortController().signal;

describe('runDependencyStage', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'deps-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('prefers lockfiles, flags package.json without one, and maps advisories', async () => {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/lodash': { version: '4.17.15' } } }));
    await mkdir(path.join(root, 'services/api'), { recursive: true });
    await writeFile(path.join(root, 'services/api/package.json'), JSON.stringify({ dependencies: { minimist: '1.2.0' } }));
    const osv: OsvClient = {
      queryBatch: vi.fn(async (refs: PackageRef[]) => refs.map((r) => (r.name === 'lodash' ? ['GHSA-l'] : []))),
      getVuln: vi.fn(async (id) => ({ id, summary: 'Bad', database_specific: { severity: 'HIGH' }, affected: [{ package: { ecosystem: 'npm', name: 'lodash' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] })),
    };
    const progress = vi.fn(async () => undefined);
    const result = await runDependencyStage({ dir: root, osv, cache: createMemoryVulnCache(), signal, progress, log });
    expect(result.packages).toBe(2);
    expect(result.findings.map((f) => f.ruleId).sort()).toEqual(['deps.no_lockfile', 'osv.advisory']);
    expect(result.findings.find((f) => f.ruleId === 'deps.no_lockfile')?.location).toBe('services/api/package.json');
    expect(result.warnings).toEqual([]);
    expect(progress).toHaveBeenCalledWith(60, expect.stringContaining('1 advisories found'));
  });

  it('warns and continues when there are no manifests or OSV is down', async () => {
    const osvDown: OsvClient = {
      queryBatch: async () => {
        throw new OsvError('OSV responded with status 503');
      },
      getVuln: async () => {
        throw new OsvError('x');
      },
    };
    const empty = await runDependencyStage({ dir: root, osv: osvDown, cache: createMemoryVulnCache(), signal, progress: async () => undefined, log });
    expect(empty.warnings.map((w) => w.code)).toEqual(['no_manifests']);

    await writeFile(path.join(root, 'requirements.txt'), 'django==2.2.0\n');
    const down = await runDependencyStage({ dir: root, osv: osvDown, cache: createMemoryVulnCache(), signal, progress: async () => undefined, log });
    expect(down.findings).toEqual([]);
    expect(down.packages).toBe(1);
    expect(down.warnings.map((w) => w.code)).toEqual(['osv_unavailable']);
  });

  it('reports unreadable manifests as warnings', async () => {
    await writeFile(path.join(root, 'package-lock.json'), '{not json');
    const osv: OsvClient = { queryBatch: async () => [], getVuln: async () => ({ id: 'x' }) };
    const result = await runDependencyStage({ dir: root, osv, cache: createMemoryVulnCache(), signal, progress: async () => undefined, log });
    expect(result.warnings[0]?.code).toBe('manifest_unreadable');
  });
});
