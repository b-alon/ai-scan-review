import { readFile } from 'node:fs/promises';
import { walkFiles } from './files.js';
import { configFingerprint } from './fingerprint.js';
import { extensionOf, scanText } from './rules/engine.js';
import { RULES } from './rules/rules.js';
import type { Finding } from './types.js';

export interface CodeStageOptions {
  dir: string;
  signal: AbortSignal;
  progress: (pct: number, message: string) => Promise<void>;
}

export interface CodeStageResult {
  findings: Finding[];
  files: number;
  truncated: boolean;
}

const TEXT_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'py', 'rb', 'go', 'java', 'kt', 'php', 'cs', 'swift', 'rs',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sh', 'bash', 'zsh', 'txt', 'xml', 'properties', 'tf', 'md', 'html', 'vue', 'svelte',
]);

const COMMITTED_ENV = /^\.env(\.(local|development|production|staging|test))?$/;

function envCommittedFinding(relPath: string): Finding {
  return {
    fingerprint: configFingerprint('config.env_committed', relPath),
    category: 'config',
    severity: 'high',
    ruleId: 'config.env_committed',
    title: `Environment file ${relPath} is committed`,
    description: 'A dotenv file is checked into the repository. These files usually hold real credentials.',
    recommendation: `Remove ${relPath} from the repository, add it to .gitignore, rotate any credentials it contains, and commit a .env.example with empty values instead.`,
    location: relPath,
    referenceId: null,
    referenceUrl: null,
    evidence: null,
    metadata: { path: relPath, whyItMatters: 'Everything in a committed dotenv file is visible to everyone with repository access and stays in history after deletion.' },
  };
}

export async function runCodeStage(opts: CodeStageOptions): Promise<CodeStageResult> {
  const { files, truncated } = await walkFiles(opts.dir);
  const findings: Finding[] = [];
  let scanned = 0;

  for (const file of files) {
    if (opts.signal.aborted) throw new Error('Scan aborted');
    const base = file.relPath.split('/').pop() ?? '';
    if (COMMITTED_ENV.test(base)) {
      findings.push(envCommittedFinding(file.relPath));
      continue;
    }
    const ext = extensionOf(file.relPath);
    if (ext && !TEXT_EXTENSIONS.has(ext)) continue;
    const buffer = await readFile(file.absPath);
    if (buffer.subarray(0, 8000).includes(0)) continue;
    findings.push(...scanText(file.relPath, buffer.toString('utf8')));
    scanned += 1;
    if (scanned % 500 === 0) {
      await opts.progress(Math.min(84, 60 + Math.round((24 * scanned) / files.length)), `Scanned ${scanned} of ${files.length} files`);
    }
  }

  await opts.progress(85, `Scanned ${scanned} files with ${RULES.length} rules, ${findings.length} findings`);
  return { findings, files: files.length, truncated };
}
