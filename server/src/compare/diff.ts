import type { Finding } from '../scan/types.js';

export interface FindingDiff {
  new: Finding[];
  fixed: Finding[];
  stillOpen: Finding[];
}

export function diffFindings(current: Finding[], previous: Finding[]): FindingDiff {
  const previousKeys = new Set(previous.map((f) => f.fingerprint));
  const currentKeys = new Set(current.map((f) => f.fingerprint));
  return {
    new: current.filter((f) => !previousKeys.has(f.fingerprint)),
    fixed: previous.filter((f) => !currentKeys.has(f.fingerprint)),
    stillOpen: current.filter((f) => previousKeys.has(f.fingerprint)),
  };
}
