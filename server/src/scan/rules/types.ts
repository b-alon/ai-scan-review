import type { Category, Severity } from '../types.js';

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
  whyItMatters: string;
  pattern: RegExp;
  extensions?: string[];
  secret?: boolean;
  /** Only low-confidence patterns drop placeholder-looking values; format-matched keys are kept. */
  placeholderFilter?: boolean;
  /** Fires only when no other secret rule matched the same line. */
  fallbackOnly?: boolean;
  skipExcludedPaths?: boolean;
}
