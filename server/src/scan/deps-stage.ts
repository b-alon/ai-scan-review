import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../logger.js';
import { fetchAdvisories, type PackageInManifest } from '../osv/advisories.js';
import type { VulnCache } from '../osv/cache.js';
import { OsvError, type OsvClient } from '../osv/client.js';
import { configFingerprint } from './fingerprint.js';
import { discoverManifests, parseManifest, type PackageRef } from './parsers/index.js';
import type { Finding, ScanWarning } from './types.js';

export interface DependencyStageOptions {
  dir: string;
  osv: OsvClient;
  cache: VulnCache;
  signal: AbortSignal;
  progress: (pct: number, message: string) => Promise<void>;
  log: Logger;
}

export interface DependencyStageResult {
  findings: Finding[];
  warnings: ScanWarning[];
  packages: number;
  advisories: number;
}

export const MAX_PACKAGES = 2000;

function noLockfileFinding(relPath: string): Finding {
  return {
    fingerprint: configFingerprint('deps.no_lockfile', relPath),
    category: 'config',
    severity: 'medium',
    ruleId: 'deps.no_lockfile',
    title: `No lockfile next to ${relPath}`,
    description:
      'Without a lockfile the installed dependency versions are not reproducible, and only exactly pinned versions could be checked for advisories.',
    recommendation: 'Commit a lockfile (package-lock.json, yarn.lock or pnpm-lock.yaml) so dependency versions are reproducible and scannable.',
    location: relPath,
    referenceId: null,
    referenceUrl: null,
    evidence: null,
    metadata: { manifest: relPath, whyItMatters: 'Unpinned dependencies can silently pull in vulnerable versions on the next install.' },
  };
}

export async function runDependencyStage(opts: DependencyStageOptions): Promise<DependencyStageResult> {
  const manifests = await discoverManifests(opts.dir);
  const warnings: ScanWarning[] = [];
  const findings: Finding[] = [];

  if (manifests.length === 0) {
    warnings.push({
      code: 'no_manifests',
      message: 'No supported dependency manifests were found (package-lock.json, package.json, requirements.txt, go.mod, Gemfile.lock).',
    });
    return { findings, warnings, packages: 0, advisories: 0 };
  }

  // A parsed lockfile replaces package.json; an unparsed one (yarn, pnpm) only proves versions are pinned.
  const parsedLockDirs = new Set(manifests.filter((m) => m.kind === 'package-lock').map((m) => path.posix.dirname(m.relPath)));
  const markerLockDirs = new Set(manifests.filter((m) => m.kind === 'lock-marker').map((m) => path.posix.dirname(m.relPath)));
  const packages = new Map<string, PackageInManifest>();

  for (const manifest of manifests) {
    if (manifest.kind === 'lock-marker') continue;
    if (manifest.kind === 'package-json') {
      const dir = path.posix.dirname(manifest.relPath);
      if (parsedLockDirs.has(dir)) continue;
      if (!markerLockDirs.has(dir)) findings.push(noLockfileFinding(manifest.relPath));
    }
    let text: string;
    try {
      text = await readFile(manifest.absPath, 'utf8');
    } catch {
      continue;
    }
    let refs: PackageRef[];
    try {
      refs = parseManifest(manifest.kind, text);
    } catch (err) {
      warnings.push({ code: 'manifest_unreadable', message: `Could not parse ${manifest.relPath}: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    for (const ref of refs) {
      const key = `${ref.ecosystem}:${ref.name}@${ref.version}`;
      if (!packages.has(key)) packages.set(key, { ref, manifest: manifest.relPath });
    }
  }

  let list = [...packages.values()];
  if (list.length > MAX_PACKAGES) {
    warnings.push({ code: 'too_many_packages', message: `Only the first ${MAX_PACKAGES} of ${list.length} packages were checked.` });
    list = list.slice(0, MAX_PACKAGES);
  }
  await opts.progress(35, `Found ${list.length} packages in ${manifests.length} manifest${manifests.length === 1 ? '' : 's'}, checking advisories`);
  if (list.length === 0) return { findings, warnings, packages: 0, advisories: 0 };

  try {
    const result = await fetchAdvisories({
      osv: opts.osv,
      cache: opts.cache,
      packages: list,
      signal: opts.signal,
      onSkipped: (id, err) => opts.log.warn({ err, advisory: id }, 'advisory details unavailable, skipped'),
    });
    findings.push(...result.findings);
    await opts.progress(60, `Checked ${list.length} packages against OSV, ${result.findings.length} advisories found`);
    return { findings, warnings, packages: list.length, advisories: result.findings.length };
  } catch (err) {
    if (err instanceof OsvError) {
      opts.log.warn({ err }, 'osv unavailable');
      warnings.push({
        code: 'osv_unavailable',
        message: `The dependency vulnerability check did not run: ${err.message}. Results cover code checks only.`,
      });
      return { findings, warnings, packages: list.length, advisories: 0 };
    }
    throw err;
  }
}
