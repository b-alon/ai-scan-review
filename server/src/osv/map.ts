import { dependencyFingerprint } from '../scan/fingerprint.js';
import type { PackageRef } from '../scan/parsers/types.js';
import type { Finding, Severity } from '../scan/types.js';
import type { OsvVuln } from './types.js';

export function canonicalId(vuln: OsvVuln): string {
  if (vuln.id.startsWith('GHSA-')) return vuln.id;
  return vuln.aliases?.find((a) => a.startsWith('GHSA-')) ?? vuln.id;
}

export function mapSeverity(vuln: OsvVuln): Severity {
  const label = vuln.database_specific?.severity?.toUpperCase();
  if (label === 'CRITICAL') return 'critical';
  if (label === 'HIGH') return 'high';
  if (label === 'MODERATE' || label === 'MEDIUM') return 'medium';
  if (label === 'LOW') return 'low';
  const numeric = vuln.severity?.map((s) => s.score ?? '').find((s) => /^\d+(\.\d+)?$/.test(s));
  if (numeric) {
    const n = Number(numeric);
    if (n >= 9) return 'critical';
    if (n >= 7) return 'high';
    if (n >= 4) return 'medium';
    return 'low';
  }
  return 'medium';
}

export function findFixedVersion(vuln: OsvVuln, pkg: PackageRef): string | null {
  for (const affected of vuln.affected ?? []) {
    if (affected.package?.ecosystem !== pkg.ecosystem || affected.package?.name !== pkg.name) continue;
    for (const range of affected.ranges ?? []) {
      if (range.type !== 'SEMVER' && range.type !== 'ECOSYSTEM') continue;
      for (const event of range.events ?? []) if (event.fixed) return event.fixed;
    }
  }
  return null;
}

export function vulnToFinding(vuln: OsvVuln, pkg: PackageRef, manifestPath: string): Finding {
  const id = canonicalId(vuln);
  const fixed = findFixedVersion(vuln, pkg);
  const cve = vuln.aliases?.find((a) => a.startsWith('CVE-')) ?? (vuln.id.startsWith('CVE-') ? vuln.id : null);
  const summary = vuln.summary?.trim() || `${id} in ${pkg.name}`;
  return {
    fingerprint: dependencyFingerprint(pkg.ecosystem, pkg.name, id),
    category: 'dependency',
    severity: mapSeverity(vuln),
    ruleId: 'osv.advisory',
    title: `${summary} (${pkg.name}@${pkg.version})`,
    description: (vuln.details?.trim() || summary).slice(0, 2000),
    recommendation: fixed
      ? `Upgrade ${pkg.name} from ${pkg.version} to ${fixed} or later.`
      : `No fixed version is published for ${pkg.name} ${pkg.version}. Check the advisory and consider replacing or isolating the package.`,
    location: `${pkg.name}@${pkg.version} (${pkg.ecosystem}) in ${manifestPath}`,
    referenceId: id,
    referenceUrl: `https://osv.dev/vulnerability/${id}`,
    evidence: null,
    metadata: {
      ecosystem: pkg.ecosystem,
      package: pkg.name,
      version: pkg.version,
      fixedVersion: fixed,
      cve,
      manifest: manifestPath,
      cwe: vuln.database_specific?.cwe_ids ?? [],
    },
  };
}
