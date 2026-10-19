import { compareSeverity, SEVERITY_ORDER, type Category, type Finding, type Severity } from '../scan/types.js';
import type { Summary } from './contract.js';
import { highestSeverity, sanitizeSummary } from './guards.js';
import type { Summarizer, SummaryInput } from './types.js';

type Effort = Summary['nextActions'][number]['effort'];

const CATEGORY_RANK: Record<Category, number> = { code: 0, dependency: 1, config: 2 };
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

const isSecret = (f: Finding): boolean => f.ruleId.startsWith('secret.');

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      compareSeverity(a.severity, b.severity) ||
      Number(isSecret(b)) - Number(isSecret(a)) ||
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
      a.title.localeCompare(b.title),
  );
}

function whyItMatters(f: Finding): string {
  if (f.category === 'dependency') {
    const fixed = f.metadata.fixedVersion;
    return `${String(f.metadata.package)}@${String(f.metadata.version)} is affected by a known ${f.severity} severity vulnerability. ${
      typeof fixed === 'string' ? `A fix exists in ${fixed}.` : 'No fixed version is published yet.'
    }`;
  }
  const why = f.metadata.whyItMatters;
  return typeof why === 'string' ? why : f.description;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function effortFor(f: Finding): Effort {
  if (isSecret(f) || f.category === 'config') return 'minutes';
  return 'hours';
}

function buildHeadline(sorted: Finding[], counts: Record<Severity, number>, input: SummaryInput): string {
  if (sorted.length === 0) return `No issues found in ${plural(input.stats.files, 'file')} and ${plural(input.stats.packages, 'package')}.`;
  const parts = SEVERITIES.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`);
  return `${plural(sorted.length, 'issue')} found (${parts.join(', ')}). Most urgent: ${sorted[0]!.title}.`;
}

function buildOverview(sorted: Finding[], riskLevel: string, input: SummaryInput): string {
  const sentences: string[] = [];
  if (sorted.length === 0) {
    sentences.push(`The scan checked ${plural(input.stats.files, 'file')} and ${plural(input.stats.packages, 'package')} and found nothing to act on.`);
  } else {
    const secrets = sorted.filter(isSecret);
    const deps = sorted.filter((f) => f.category === 'dependency');
    const code = sorted.filter((f) => f.category === 'code' && !isSecret(f));
    const config = sorted.filter((f) => f.category === 'config');
    const groups: Array<[string, number]> = [
      ['leaked credentials', secrets.length],
      ['vulnerable dependencies', deps.length],
      ['risky code patterns', code.length],
      ['configuration issues', config.length],
    ];
    const [dominantName, dominantCount] = groups.sort((a, b) => b[1] - a[1])[0]!;
    sentences.push(`Overall risk is ${riskLevel}. The biggest category is ${dominantName} (${dominantCount} of ${sorted.length}).`);
    if (secrets.length > 0) sentences.push(`${plural(secrets.length, 'credential')} appear in source and should be rotated today.`);
    if (deps.length > 0) {
      const withFix = deps.filter((f) => typeof f.metadata.fixedVersion === 'string').length;
      const packages = new Set(deps.map((f) => String(f.metadata.package))).size;
      sentences.push(`${plural(deps.length, 'advisory', 'advisories')} affect ${plural(packages, 'package')}; ${withFix} of them have a fixed version available.`);
    }
  }
  for (const w of input.warnings) sentences.push(w.message);
  return sentences.join(' ');
}

function buildActions(sorted: Finding[]): Summary['nextActions'] {
  interface Draft {
    action: string;
    effort: Effort;
    resolves: string[];
    rank: number;
    count: number;
  }
  const drafts: Draft[] = [];

  for (const f of sorted.filter(isSecret)) {
    drafts.push({ action: f.recommendation, effort: 'minutes', resolves: [f.fingerprint], rank: SEVERITY_ORDER[f.severity], count: 1 });
  }

  const byPackage = new Map<string, Finding[]>();
  for (const f of sorted.filter((x) => x.category === 'dependency')) {
    const key = `${String(f.metadata.ecosystem)}:${String(f.metadata.package)}`;
    byPackage.set(key, [...(byPackage.get(key) ?? []), f]);
  }
  for (const group of byPackage.values()) {
    const top = group[0]!;
    const pkg = String(top.metadata.package);
    const version = String(top.metadata.version);
    const fixes = group.map((f) => f.metadata.fixedVersion).filter((v): v is string => typeof v === 'string');
    const fixed = fixes.length > 0 ? fixes.sort(compareVersions).at(-1)! : null;
    const count = group.length;
    const action = fixed
      ? `Upgrade ${pkg} from ${version} to ${fixed} or later${count > 1 ? ` (closes ${count} advisories)` : ''}.`
      : `No fixed version is published for ${pkg} ${version}; review the ${count > 1 ? 'advisories' : 'advisory'} and consider replacing or isolating the package.`;
    drafts.push({ action, effort: fixed ? 'minutes' : 'hours', resolves: group.map((f) => f.fingerprint), rank: Math.min(...group.map((f) => SEVERITY_ORDER[f.severity])), count });
  }

  for (const f of sorted.filter((x) => !isSecret(x) && x.category !== 'dependency')) {
    drafts.push({ action: f.recommendation, effort: effortFor(f), resolves: [f.fingerprint], rank: SEVERITY_ORDER[f.severity], count: 1 });
  }

  drafts.sort((a, b) => a.rank - b.rank || b.count - a.count || a.action.localeCompare(b.action));
  return drafts.slice(0, 20).map(({ action, effort, resolves }) => ({ action, effort, resolves }));
}

export function summarizeDeterministic(input: SummaryInput): Summary {
  const sorted = sortFindings(input.findings);
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of sorted) counts[f.severity] += 1;
  const riskLevel = highestSeverity(sorted);
  return {
    riskLevel,
    headline: buildHeadline(sorted, counts, input),
    overview: buildOverview(sorted, riskLevel, input),
    topRisks: sorted.slice(0, 5).map((f) => ({ fingerprint: f.fingerprint, title: f.title, whyItMatters: whyItMatters(f) })),
    nextActions: buildActions(sorted),
  };
}

export function createDeterministicSummarizer(): Summarizer {
  return {
    mode: 'deterministic',
    async summarize(input) {
      return { summary: sanitizeSummary(summarizeDeterministic(input), input.findings), mode: 'deterministic', note: null };
    },
  };
}
