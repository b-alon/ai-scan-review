export type Ecosystem = 'npm' | 'PyPI' | 'Go' | 'RubyGems';

export interface PackageRef {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

/** 'lock-marker' covers lockfiles that are not parsed yet (yarn, pnpm, shrinkwrap) but prove versions are pinned. */
export type ManifestKind = 'package-lock' | 'package-json' | 'requirements' | 'go-mod' | 'gemfile-lock' | 'lock-marker';

export interface ManifestFile {
  kind: ManifestKind;
  relPath: string;
  absPath: string;
}
