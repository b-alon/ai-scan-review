import type { PackageRef } from './types.js';

export function parsePackageJson(text: string): PackageRef[] {
  const data = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const out: PackageRef[] = [];
  for (const deps of [data.dependencies, data.devDependencies]) {
    for (const [name, range] of Object.entries(deps ?? {})) {
      const m = /^[=v]?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(String(range).trim());
      if (m) out.push({ ecosystem: 'npm', name, version: m[1]! });
    }
  }
  return out;
}
