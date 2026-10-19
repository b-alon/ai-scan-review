import { describe, expect, it } from 'vitest';
import { diffFindings } from '../../src/compare/diff.js';
import type { Finding } from '../../src/scan/types.js';

const f = (fingerprint: string): Finding => ({ fingerprint, category: 'code', severity: 'low', ruleId: 'r', title: fingerprint, description: '', recommendation: '', location: '', referenceId: null, referenceUrl: null, evidence: null, metadata: {} });

describe('diffFindings', () => {
  it('splits findings into new, fixed and still open by fingerprint', () => {
    const diff = diffFindings([f('a'), f('b')], [f('b'), f('c')]);
    expect(diff.new.map((x) => x.fingerprint)).toEqual(['a']);
    expect(diff.fixed.map((x) => x.fingerprint)).toEqual(['c']);
    expect(diff.stillOpen.map((x) => x.fingerprint)).toEqual(['b']);
  });
});
