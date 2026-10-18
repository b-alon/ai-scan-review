import type { PackageRef } from './types.js';

interface LegacyDep {
  version?: string;
  dependencies?: Record<string, LegacyDep>;
}

interface LockFile {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string; link?: boolean }>;
  dependencies?: Record<string, LegacyDep>;
}

export function parsePackageLock(text: string): PackageRef[] {
  const data = JSON.parse(text) as LockFile;
  const out = new Map<string, PackageRef>();
  const add = (name: string, version: string | undefined): void => {
    if (!name || !version || version.startsWith('file:') || version.startsWith('link:')) return;
    out.set(`${name}@${version}`, { ecosystem: 'npm', name, version });
  };
  if (data.packages) {
    for (const [key, entry] of Object.entries(data.packages)) {
      if (!key || entry.link) continue;
      const idx = key.lastIndexOf('node_modules/');
      if (idx < 0) continue;
      add(key.slice(idx + 'node_modules/'.length), entry.version);
    }
  } else if (data.dependencies) {
    const walk = (deps: Record<string, LegacyDep>): void => {
      for (const [name, dep] of Object.entries(deps)) {
        add(name, dep.version);
        if (dep.dependencies) walk(dep.dependencies);
      }
    };
    walk(data.dependencies);
  }
  return [...out.values()];
}
