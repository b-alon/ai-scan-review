import { describe, expect, it, vi } from 'vitest';
import { fetchAdvisories } from '../../src/osv/advisories.js';
import { createMemoryVulnCache } from '../../src/osv/cache.js';
import { createOsvClient, OsvError, type OsvClient } from '../../src/osv/client.js';
import { canonicalId, findFixedVersion, mapSeverity, vulnToFinding } from '../../src/osv/map.js';
import type { OsvVuln } from '../../src/osv/types.js';
import { codeFingerprint } from '../../src/scan/fingerprint.js';

const lodash = { ecosystem: 'npm' as const, name: 'lodash', version: '4.17.15' };

const ghsa: OsvVuln = {
  id: 'GHSA-p6mc-m468-83gw',
  summary: 'Prototype Pollution in lodash',
  details: 'Long details',
  aliases: ['CVE-2020-8203'],
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H' }],
  database_specific: { severity: 'HIGH', cwe_ids: ['CWE-1321'] },
  affected: [
    { package: { ecosystem: 'npm', name: 'lodash' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '3.7.0' }, { fixed: '4.17.19' }] }] },
    { package: { ecosystem: 'npm', name: 'lodash-es' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '3.7.0' }, { fixed: '4.17.20' }] }] },
  ],
};

describe('mapping', () => {
  it('maps database severities and falls back to medium', () => {
    expect(mapSeverity(ghsa)).toBe('high');
    expect(mapSeverity({ ...ghsa, database_specific: { severity: 'MODERATE' } })).toBe('medium');
    expect(mapSeverity({ ...ghsa, database_specific: { severity: 'CRITICAL' } })).toBe('critical');
    expect(mapSeverity({ id: 'X', severity: [{ type: 'CVSS_V3', score: '9.8' }] })).toBe('critical');
    expect(mapSeverity({ id: 'X' })).toBe('medium');
  });

  it('finds the fixed version for the matching package only', () => {
    expect(findFixedVersion(ghsa, lodash)).toBe('4.17.19');
    expect(findFixedVersion(ghsa, { ...lodash, name: 'other' })).toBeNull();
  });

  it('prefers the GHSA id as the canonical id', () => {
    expect(canonicalId(ghsa)).toBe('GHSA-p6mc-m468-83gw');
    expect(canonicalId({ id: 'CVE-2020-8203', aliases: ['GHSA-p6mc-m468-83gw'] })).toBe('GHSA-p6mc-m468-83gw');
    expect(canonicalId({ id: 'MAL-2024-1' })).toBe('MAL-2024-1');
  });

  it('builds a finding with upgrade advice, and a no-fix finding when nothing is fixed', () => {
    const f = vulnToFinding(ghsa, lodash, 'package-lock.json');
    expect(f).toMatchObject({
      fingerprint: 'dep:npm:lodash:GHSA-p6mc-m468-83gw',
      category: 'dependency',
      severity: 'high',
      referenceId: 'GHSA-p6mc-m468-83gw',
      referenceUrl: 'https://osv.dev/vulnerability/GHSA-p6mc-m468-83gw',
      location: 'lodash@4.17.15 (npm) in package-lock.json',
    });
    expect(f.recommendation).toBe('Upgrade lodash from 4.17.15 to 4.17.19 or later.');
    expect(f.metadata).toMatchObject({ fixedVersion: '4.17.19', cve: 'CVE-2020-8203' });
    const bare = vulnToFinding({ id: 'GHSA-x' }, lodash, 'package.json');
    expect(bare.severity).toBe('medium');
    expect(bare.recommendation).toMatch(/No fixed version is published/);
    expect(bare.title).toContain('GHSA-x');
  });
});

describe('fingerprints', () => {
  it('ignore indentation and line numbers', () => {
    expect(codeFingerprint('secret.aws', 'src/a.js', '  const k = "AKIA"  ')).toBe(codeFingerprint('secret.aws', 'src/a.js', 'const k = "AKIA"'));
    expect(codeFingerprint('secret.aws', 'src/a.js', 'x')).not.toBe(codeFingerprint('secret.aws', 'src/b.js', 'x'));
  });
});

describe('createOsvClient', () => {
  it('chunks batch queries and returns ids per package', async () => {
    const calls: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { queries: unknown[] };
      calls.push(body.queries.length);
      return new Response(JSON.stringify({ results: body.queries.map((_q, i) => (i === 0 ? { vulns: [{ id: 'GHSA-a' }] } : {})) }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createOsvClient({ fetchImpl });
    const refs = Array.from({ length: 1001 }, (_, i) => ({ ...lodash, name: `p${i}` }));
    const ids = await client.queryBatch(refs, new AbortController().signal);
    expect(calls).toEqual([1000, 1]);
    expect(ids).toHaveLength(1001);
    expect(ids[0]).toEqual(['GHSA-a']);
    expect(ids[1]).toEqual([]);
    expect(ids[1000]).toEqual(['GHSA-a']);
  });

  it('wraps failures and timeouts in OsvError', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(createOsvClient({ fetchImpl: failing }).getVuln('GHSA-a', new AbortController().signal)).rejects.toBeInstanceOf(OsvError);
    const hanging = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))))) as unknown as typeof fetch;
    const outcomes: string[] = [];
    await expect(createOsvClient({ fetchImpl: hanging, timeoutMs: 50, onRequest: (o) => outcomes.push(o) }).getVuln('GHSA-a', new AbortController().signal)).rejects.toThrow(/timed out/);
    expect(outcomes).toEqual(['timeout']);
  });
});

describe('fetchAdvisories', () => {
  it('dedupes advisories, uses the cache, and only fetches missing details', async () => {
    const getVuln = vi.fn(async (id: string) => ({ ...ghsa, id, aliases: id === 'CVE-2020-8203' ? ['GHSA-p6mc-m468-83gw'] : ghsa.aliases }));
    const osv: OsvClient = {
      queryBatch: async (refs) => refs.map(() => ['GHSA-p6mc-m468-83gw', 'CVE-2020-8203']),
      getVuln,
    };
    const cache = createMemoryVulnCache();
    const packages = [{ ref: lodash, manifest: 'package-lock.json' }, { ref: { ...lodash, version: '4.17.16' }, manifest: 'other/package-lock.json' }];
    const first = await fetchAdvisories({ osv, cache, packages, signal: new AbortController().signal });
    expect(first.findings.map((f) => f.fingerprint)).toEqual(['dep:npm:lodash:GHSA-p6mc-m468-83gw']);
    expect(first.advisories).toBe(2);
    expect(getVuln).toHaveBeenCalledTimes(2);
    const second = await fetchAdvisories({ osv, cache, packages, signal: new AbortController().signal });
    expect(second.findings).toHaveLength(1);
    expect(getVuln).toHaveBeenCalledTimes(2);
  });
});
