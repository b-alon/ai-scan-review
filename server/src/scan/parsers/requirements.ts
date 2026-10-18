import type { PackageRef } from './types.js';

export function parseRequirements(text: string): PackageRef[] {
  const out: PackageRef[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*([0-9][0-9A-Za-z.+!-]*)/.exec(line);
    if (m) out.push({ ecosystem: 'PyPI', name: m[1]!.toLowerCase(), version: m[2]! });
  }
  return out;
}
