import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/scan/types.js';
import { sanitizeSummary } from '../../src/summarize/guards.js';

const f = (fingerprint: string, severity: Finding['severity'] = 'high'): Finding => ({
  fingerprint, category: 'code', severity, ruleId: 'r', title: fingerprint, description: '', recommendation: '', location: 'a:1', referenceId: null, referenceUrl: null, evidence: null, metadata: {},
});

describe('sanitizeSummary', () => {
  it('drops unknown fingerprints, caps lists and repairs the risk level', () => {
    const out = sanitizeSummary(
      {
        riskLevel: 'none',
        headline: '  h  ',
        overview: 'o',
        topRisks: Array.from({ length: 7 }, (_, i) => ({ fingerprint: i < 6 ? `k${i}` : 'ghost', title: 't', whyItMatters: 'w' })),
        nextActions: [{ action: 'do it', effort: 'minutes', resolves: ['k0', 'ghost'] }, { action: '   ', effort: 'hours', resolves: [] }],
      },
      Array.from({ length: 6 }, (_, i) => f(`k${i}`, i === 0 ? 'critical' : 'low')),
    );
    expect(out.riskLevel).toBe('critical');
    expect(out.headline).toBe('h');
    expect(out.topRisks.map((r) => r.fingerprint)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
    expect(out.nextActions).toEqual([{ action: 'do it', effort: 'minutes', resolves: ['k0'] }]);
  });

  it('never reports a risk level below the worst finding', () => {
    const out = sanitizeSummary({ riskLevel: 'low', headline: 'h', overview: 'o', topRisks: [], nextActions: [] }, [f('k0', 'critical'), f('k1', 'low')]);
    expect(out.riskLevel).toBe('critical');
    const keep = sanitizeSummary({ riskLevel: 'critical', headline: 'h', overview: 'o', topRisks: [], nextActions: [] }, [f('k1', 'low')]);
    expect(keep.riskLevel).toBe('critical');
  });

  it('forces none when there are no findings', () => {
    const out = sanitizeSummary({ riskLevel: 'high', headline: 'h', overview: 'o', topRisks: [{ fingerprint: 'x', title: 't', whyItMatters: 'w' }], nextActions: [] }, []);
    expect(out.riskLevel).toBe('none');
    expect(out.topRisks).toEqual([]);
  });
});
