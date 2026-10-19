import type { PackageRef } from './types.js';

export function parseGemfileLock(text: string): PackageRef[] {
  const out: PackageRef[] = [];
  let inSpecs = false;
  for (const raw of text.split('\n')) {
    if (/^\S/.test(raw)) {
      inSpecs = false;
      continue;
    }
    if (/^  specs:\s*$/.test(raw)) {
      inSpecs = true;
      continue;
    }
    if (!inSpecs) continue;
    const m = /^    ([A-Za-z0-9._-]+) \(([^)]+)\)\s*$/.exec(raw);
    if (m) out.push({ ecosystem: 'RubyGems', name: m[1]!, version: m[2]!.split('-')[0]! });
  }
  return out;
}
