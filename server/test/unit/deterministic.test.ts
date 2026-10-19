import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/scan/types.js';
import { createDeterministicSummarizer, summarizeDeterministic } from '../../src/summarize/deterministic.js';
import type { SummaryInput } from '../../src/summarize/types.js';

const dep = (id: string, version: string, fixed: string | null, severity: Finding['severity']): Finding => ({
  fingerprint: `dep:npm:lodash:${id}`,
  category: 'dependency',
  severity,
  ruleId: 'osv.advisory',
  title: `Prototype pollution (lodash@${version})`,
  description: 'd',
  recommendation: fixed ? `Upgrade lodash from ${version} to ${fixed} or later.` : 'No fixed version is published for lodash.',
  location: `lodash@${version} (npm) in package-lock.json`,
  referenceId: id,
  referenceUrl: `https://osv.dev/vulnerability/${id}`,
  evidence: null,
  metadata: { ecosystem: 'npm', package: 'lodash', version, fixedVersion: fixed },
});

const secret: Finding = {
  fingerprint: 'code:secret.aws_access_key:src/config.js:abc',
  category: 'code',
  severity: 'critical',
  ruleId: 'secret.aws_access_key',
  title: 'AWS access key committed to the repository',
  description: 'd',
  recommendation: 'Rotate the AWS key found at src/config.js:3, remove it from the file, and load it from an environment variable or a secret manager.',
  location: 'src/config.js:3',
  referenceId: null,
  referenceUrl: null,
  evidence: 'const key = "AKIA****";',
  metadata: { line: 3, path: 'src/config.js', whyItMatters: 'Anyone who can read this repository can act as your AWS account.' },
};

const evalFinding: Finding = {
  fingerprint: 'code:code.eval:src/util.js:def',
  category: 'code',
  severity: 'medium',
  ruleId: 'code.eval',
  title: 'Use of eval',
  description: 'd',
  recommendation: 'Replace eval at src/util.js:9 with JSON.parse, a safe expression parser, or explicit logic.',
  location: 'src/util.js:9',
  referenceId: null,
  referenceUrl: null,
  evidence: 'eval(x)',
  metadata: { line: 9, path: 'src/util.js', whyItMatters: 'Evaluated input runs as code.' },
};

const noFix = { ...dep('GHSA-nofix', '1.0.0', null, 'low'), fingerprint: 'dep:npm:left-pad:GHSA-nofix', title: 'Something (left-pad@1.0.0)', metadata: { ecosystem: 'npm', package: 'left-pad', version: '1.0.0', fixedVersion: null } };

const input: SummaryInput = {
  repo: { owner: 'o', name: 'r', commitSha: 'a'.repeat(40) },
  findings: [evalFinding, dep('GHSA-1', '4.17.15', '4.17.19', 'high'), secret, dep('GHSA-2', '4.17.15', '4.17.21', 'high'), noFix],
  warnings: [{ code: 'no_lockfile', message: 'A manifest had no lockfile.' }],
  stats: { files: 120, packages: 40 },
};

describe('summarizeDeterministic', () => {
  it('reports no issues for an empty scan', () => {
    const s = summarizeDeterministic({ ...input, findings: [], warnings: [] });
    expect(s.riskLevel).toBe('none');
    expect(s.headline).toBe('No issues found in 120 files and 40 packages.');
    expect(s.topRisks).toEqual([]);
    expect(s.nextActions).toEqual([]);
  });

  it('orders risks by severity with secrets first and writes a counted headline', () => {
    const s = summarizeDeterministic(input);
    expect(s.riskLevel).toBe('critical');
    expect(s.headline).toBe('5 issues found (1 critical, 2 high, 1 medium, 1 low). Most urgent: AWS access key committed to the repository.');
    expect(s.topRisks.map((r) => r.fingerprint)).toEqual([secret.fingerprint, 'dep:npm:lodash:GHSA-1', 'dep:npm:lodash:GHSA-2', evalFinding.fingerprint, noFix.fingerprint]);
    expect(s.topRisks[0]?.whyItMatters).toContain('AWS account');
    expect(s.topRisks[1]?.whyItMatters).toContain('fix exists in 4.17.19');
    expect(s.overview).toContain('Overall risk is critical.');
    expect(s.overview).toContain('3 advisories affect 2 packages; 2 of them have a fixed version available.');
    expect(s.overview).toContain('A manifest had no lockfile.');
  });

  it('groups dependency actions per package and orders actions by severity', () => {
    const s = summarizeDeterministic(input);
    expect(s.nextActions.map((a) => a.action)).toEqual([
      secret.recommendation,
      'Upgrade lodash from 4.17.15 to 4.17.21 or later (closes 2 advisories).',
      evalFinding.recommendation,
      'No fixed version is published for left-pad 1.0.0; review the advisory and consider replacing or isolating the package.',
    ]);
    expect(s.nextActions[1]).toMatchObject({ effort: 'minutes', resolves: ['dep:npm:lodash:GHSA-1', 'dep:npm:lodash:GHSA-2'] });
    expect(s.nextActions[2]?.effort).toBe('hours');
    expect(s.nextActions[3]?.effort).toBe('hours');
  });

  it('exposes a Summarizer with mode deterministic', async () => {
    const out = await createDeterministicSummarizer().summarize(input, new AbortController().signal);
    expect(out.mode).toBe('deterministic');
    expect(out.note).toBeNull();
    expect(out.summary.topRisks).toHaveLength(5);
  });
});
