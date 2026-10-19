import { parseGemfileLock } from './gemfile-lock.js';
import { parseGoMod } from './go-mod.js';
import { parsePackageJson } from './package-json.js';
import { parsePackageLock } from './package-lock.js';
import { parseRequirements } from './requirements.js';
import type { ManifestKind, PackageRef } from './types.js';

export { discoverManifests } from './discover.js';
export type { Ecosystem, ManifestFile, ManifestKind, PackageRef } from './types.js';

export function parseManifest(kind: ManifestKind, text: string): PackageRef[] {
  switch (kind) {
    case 'package-lock':
      return parsePackageLock(text);
    case 'package-json':
      return parsePackageJson(text);
    case 'requirements':
      return parseRequirements(text);
    case 'go-mod':
      return parseGoMod(text);
    case 'gemfile-lock':
      return parseGemfileLock(text);
    case 'lock-marker':
      return [];
  }
}
