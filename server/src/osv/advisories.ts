import type { PackageRef } from '../scan/parsers/types.js';
import type { Finding } from '../scan/types.js';
import type { VulnCache } from './cache.js';
import type { OsvClient } from './client.js';
import { vulnToFinding } from './map.js';
import type { OsvVuln } from './types.js';

export interface PackageInManifest {
  ref: PackageRef;
  manifest: string;
}

export interface FetchAdvisoriesOptions {
  osv: OsvClient;
  cache: VulnCache;
  packages: PackageInManifest[];
  signal: AbortSignal;
  concurrency?: number;
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function fetchAdvisories(opts: FetchAdvisoriesOptions): Promise<{ findings: Finding[]; advisories: number }> {
  const idsPerPackage = await opts.osv.queryBatch(
    opts.packages.map((p) => p.ref),
    opts.signal,
  );
  const allIds = [...new Set(idsPerPackage.flat())];
  const cached = await opts.cache.get(allIds);
  const missing = allIds.filter((id) => !cached.has(id));
  const fetched: OsvVuln[] = [];
  await runPool(missing, opts.concurrency ?? 5, async (id) => {
    fetched.push(await opts.osv.getVuln(id, opts.signal));
  });
  await opts.cache.put(fetched);

  const byId = new Map(cached);
  for (const v of fetched) byId.set(v.id, v);

  const findings = new Map<string, Finding>();
  opts.packages.forEach((pkg, i) => {
    for (const id of idsPerPackage[i] ?? []) {
      const vuln = byId.get(id);
      if (!vuln) continue;
      const finding = vulnToFinding(vuln, pkg.ref, pkg.manifest);
      if (!findings.has(finding.fingerprint)) findings.set(finding.fingerprint, finding);
    }
  });
  return { findings: [...findings.values()], advisories: allIds.length };
}
