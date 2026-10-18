import { createHash } from 'node:crypto';

export function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

export function dependencyFingerprint(ecosystem: string, name: string, vulnId: string): string {
  return `dep:${ecosystem}:${name}:${vulnId}`;
}

export function codeFingerprint(ruleId: string, relPath: string, line: string): string {
  const hash = createHash('sha1').update(normalizeLine(line)).digest('hex').slice(0, 12);
  return `code:${ruleId}:${relPath}:${hash}`;
}

export function configFingerprint(ruleId: string, relPath: string): string {
  return `config:${ruleId}:${relPath}`;
}
