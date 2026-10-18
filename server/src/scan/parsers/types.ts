export type Ecosystem = 'npm' | 'PyPI' | 'Go' | 'RubyGems';

export interface PackageRef {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

export type ManifestKind = 'package-lock' | 'package-json' | 'requirements' | 'go-mod' | 'gemfile-lock';

export interface ManifestFile {
  kind: ManifestKind;
  relPath: string;
  absPath: string;
}
