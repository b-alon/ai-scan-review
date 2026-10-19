import { codeFingerprint } from '../fingerprint.js';
import type { Finding } from '../types.js';
import { RULES } from './rules.js';
import type { Rule } from './types.js';

const PLACEHOLDER = /changeme|change_me|example|placeholder|xxx|your[-_ ]?|<[^>]*>|\$\{|%[A-Z_]+%|process\.env|os\.environ|\bdummy\b|\bsample\b|\btest\b|\bfake\b|^\*+$|^\.+$|^x+$/i;
const EXCLUDED_PATH = /(^|\/)(test|tests|spec|specs|__tests__|__mocks__|fixtures?|examples?|docs?|samples?)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|\.md$|\.lock$/i;

export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER.test(value);
}

export function isExcludedPath(relPath: string): boolean {
  return EXCLUDED_PATH.test(relPath);
}

export function maskValue(value: string): string {
  return value.length <= 4 ? '****' : `${value.slice(0, 4)}****`;
}

const SECRET_PATTERNS = RULES.filter((r) => r.secret).map((r) => new RegExp(r.pattern.source, r.pattern.flags.includes('g') ? r.pattern.flags : `${r.pattern.flags}g`));

/** Masks every secret-shaped value in a line, whichever rule produced the finding. */
export function redactSecrets(line: string): string {
  let out = line;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match: string, group?: string) => {
      const value = typeof group === 'string' ? group : match;
      return match.replace(value, maskValue(value));
    });
  }
  return out;
}

export function extensionOf(relPath: string): string {
  const base = relPath.split('/').pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function scanText(relPath: string, text: string, rules: Rule[] = RULES): Finding[] {
  const ext = extensionOf(relPath);
  const applicable = rules.filter((r) => (!r.extensions || r.extensions.includes(ext)) && !(r.skipExcludedPaths && isExcludedPath(relPath)));
  const out: Finding[] = [];
  if (applicable.length === 0) return out;
  const seen = new Set<string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.length > 2000) continue;
    let secretMatchedOnLine = false;
    for (const rule of applicable) {
      if (rule.fallbackOnly && secretMatchedOnLine) continue;
      const match = rule.pattern.exec(line);
      if (!match) continue;
      const value = match[1] ?? match[0];
      if (rule.placeholderFilter && isPlaceholderValue(value)) continue;
      if (rule.secret) secretMatchedOnLine = true;
      const fingerprint = codeFingerprint(rule.id, relPath, line);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const location = `${relPath}:${i + 1}`;
      const evidence = redactSecrets(line).trim().slice(0, 200);
      out.push({
        fingerprint,
        category: rule.category,
        severity: rule.severity,
        ruleId: rule.id,
        title: rule.title,
        description: rule.description,
        recommendation: rule.recommendation.replace('{location}', location),
        location,
        referenceId: null,
        referenceUrl: null,
        evidence,
        metadata: { line: i + 1, path: relPath, whyItMatters: rule.whyItMatters },
      });
    }
  }
  return out;
}
