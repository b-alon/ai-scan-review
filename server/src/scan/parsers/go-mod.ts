import type { PackageRef } from './types.js';

export function parseGoMod(text: string): PackageRef[] {
  const out: PackageRef[] = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('require (')) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ')') {
      inBlock = false;
      continue;
    }
    const m = inBlock ? /^(\S+)\s+v(\S+)$/.exec(line) : /^require\s+(\S+)\s+v(\S+)$/.exec(line);
    if (m) out.push({ ecosystem: 'Go', name: m[1]!, version: m[2]! });
  }
  return out;
}
