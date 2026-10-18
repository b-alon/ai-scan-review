import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverManifests } from '../../src/scan/parsers/discover.js';
import { parseGemfileLock } from '../../src/scan/parsers/gemfile-lock.js';
import { parseGoMod } from '../../src/scan/parsers/go-mod.js';
import { parsePackageJson } from '../../src/scan/parsers/package-json.js';
import { parsePackageLock } from '../../src/scan/parsers/package-lock.js';
import { parseRequirements } from '../../src/scan/parsers/requirements.js';

describe('parsePackageLock', () => {
  it('reads v3 packages including scoped and nested, skipping root and links', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'app', version: '1.0.0' },
        'node_modules/lodash': { version: '4.17.15' },
        'node_modules/@babel/core': { version: '7.0.0' },
        'node_modules/a/node_modules/lodash': { version: '4.17.21' },
        'node_modules/local': { link: true, resolved: 'packages/local' },
        'packages/local': { version: '0.0.1' },
      },
    });
    expect(parsePackageLock(lock)).toEqual([
      { ecosystem: 'npm', name: 'lodash', version: '4.17.15' },
      { ecosystem: 'npm', name: '@babel/core', version: '7.0.0' },
      { ecosystem: 'npm', name: 'lodash', version: '4.17.21' },
    ]);
  });

  it('reads v1 nested dependencies', () => {
    const lock = JSON.stringify({
      lockfileVersion: 1,
      dependencies: { minimist: { version: '1.2.0', dependencies: { lodash: { version: '4.17.15' } } } },
    });
    expect(parsePackageLock(lock)).toEqual([
      { ecosystem: 'npm', name: 'minimist', version: '1.2.0' },
      { ecosystem: 'npm', name: 'lodash', version: '4.17.15' },
    ]);
  });
});

describe('parsePackageJson', () => {
  it('keeps only exact versions', () => {
    const text = JSON.stringify({ dependencies: { lodash: '4.17.15', express: '^4.0.0', left: '=1.2.3' }, devDependencies: { vitest: '~5.0.0', tsx: 'v4.1.0' } });
    expect(parsePackageJson(text)).toEqual([
      { ecosystem: 'npm', name: 'lodash', version: '4.17.15' },
      { ecosystem: 'npm', name: 'left', version: '1.2.3' },
      { ecosystem: 'npm', name: 'tsx', version: '4.1.0' },
    ]);
  });
});

describe('parseRequirements', () => {
  it('reads pinned requirements only', () => {
    const text = ['Django==2.2.0  # old', 'requests[security]==2.20.0', 'flask>=1.0', '-r other.txt', '', 'numpy == 1.21.0'].join('\n');
    expect(parseRequirements(text)).toEqual([
      { ecosystem: 'PyPI', name: 'django', version: '2.2.0' },
      { ecosystem: 'PyPI', name: 'requests', version: '2.20.0' },
      { ecosystem: 'PyPI', name: 'numpy', version: '1.21.0' },
    ]);
  });
});

describe('parseGoMod', () => {
  it('reads single and block requires without the v prefix', () => {
    const text = ['module example.com/x', '', 'go 1.21', '', 'require golang.org/x/text v0.3.0', 'require (', '\tgithub.com/gin-gonic/gin v1.6.3 // indirect', '\tgolang.org/x/net v0.0.0-20200101000000-abcdef', ')'].join('\n');
    expect(parseGoMod(text)).toEqual([
      { ecosystem: 'Go', name: 'golang.org/x/text', version: '0.3.0' },
      { ecosystem: 'Go', name: 'github.com/gin-gonic/gin', version: '1.6.3' },
      { ecosystem: 'Go', name: 'golang.org/x/net', version: '0.0.0-20200101000000-abcdef' },
    ]);
  });
});

describe('parseGemfileLock', () => {
  it('reads direct specs and strips platform suffixes', () => {
    const text = ['GEM', '  remote: https://rubygems.org/', '  specs:', '    rack (2.0.1)', '    nokogiri (1.13.0-x86_64-linux)', '      racc (~> 1.4)', '    racc (1.6.0)', '', 'PLATFORMS', '  ruby', '', 'DEPENDENCIES', '  rack', ''].join('\n');
    expect(parseGemfileLock(text)).toEqual([
      { ecosystem: 'RubyGems', name: 'rack', version: '2.0.1' },
      { ecosystem: 'RubyGems', name: 'nokogiri', version: '1.13.0' },
      { ecosystem: 'RubyGems', name: 'racc', version: '1.6.0' },
    ]);
  });
});

describe('discoverManifests', () => {
  it('finds supported manifests up to three directories deep, skipping node_modules', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'manifests-'));
    try {
      await mkdir(path.join(root, 'services/api'), { recursive: true });
      await mkdir(path.join(root, 'a/b/c/d'), { recursive: true });
      await mkdir(path.join(root, 'node_modules/x'), { recursive: true });
      await writeFile(path.join(root, 'package.json'), '{}');
      await writeFile(path.join(root, 'package-lock.json'), '{}');
      await writeFile(path.join(root, 'services/api/requirements.txt'), '');
      await writeFile(path.join(root, 'a/b/c/go.mod'), '');
      await writeFile(path.join(root, 'a/b/c/d/Gemfile.lock'), '');
      await writeFile(path.join(root, 'node_modules/x/package.json'), '{}');
      const found = await discoverManifests(root);
      expect(found.map((m) => `${m.kind}:${m.relPath}`).sort()).toEqual(['go-mod:a/b/c/go.mod', 'package-json:package.json', 'package-lock:package-lock.json', 'requirements:services/api/requirements.txt']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
