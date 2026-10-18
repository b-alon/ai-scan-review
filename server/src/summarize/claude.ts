import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Logger } from '../logger.js';
import { compareSeverity } from '../scan/types.js';
import { SummarySchema } from './contract.js';
import { sanitizeSummary } from './guards.js';
import type { Summarizer, SummaryInput } from './types.js';

export const MAX_FINDINGS_IN_PROMPT = 50;

export const SYSTEM_PROMPT = `You write the summary page of a security scan for the developer who owns the repository.

You receive the scan findings as JSON. Produce a summary with:
- riskLevel: the overall posture, based on the most severe findings.
- headline: one sentence a developer can act on.
- overview: two to four plain sentences. Explain what matters most and why, in terms of impact on the product and its users, not scanner mechanics. Mention any warning that limits the scan.
- topRisks: at most five, most important first. Each must reference a real fingerprint from the findings and explain why it matters as impact, not as a rule name.
- nextActions: an ordered list of concrete actions. Name files, packages and versions. Merge findings that one action resolves, for example one upgrade that closes several advisories on the same package. Each action lists the fingerprints it resolves. Estimate effort as minutes, hours or days.

Only reference fingerprints that appear in the input. Do not invent findings. Write for a developer, not a security analyst.`;

export function buildUserMessage(input: SummaryInput): string {
  const sorted = [...input.findings].sort((a, b) => compareSeverity(a.severity, b.severity));
  const included = sorted.slice(0, MAX_FINDINGS_IN_PROMPT).map((f) => ({
    fingerprint: f.fingerprint,
    severity: f.severity,
    category: f.category,
    title: f.title,
    location: f.location,
    reference: f.referenceId,
    fixedVersion: typeof f.metadata.fixedVersion === 'string' ? f.metadata.fixedVersion : null,
    recommendation: f.recommendation,
  }));
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of input.findings) counts[f.severity] += 1;
  const payload = {
    repository: `${input.repo.owner}/${input.repo.name}`,
    commit: input.repo.commitSha,
    stats: input.stats,
    counts,
    warnings: input.warnings,
    findings: included,
    omitted: Math.max(0, input.findings.length - included.length),
  };
  return `Summarize this scan.\n${JSON.stringify(payload, null, 2)}`;
}

export interface ClaudeSummarizerOptions {
  apiKey: string;
  model: string;
  logger: Logger;
  timeoutMs?: number;
  client?: Pick<Anthropic, 'messages'>;
}

export function createClaudeSummarizer(opts: ClaudeSummarizerOptions): Summarizer {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 60_000, maxRetries: 1 });
  return {
    mode: 'claude',
    async summarize(input, signal) {
      const response = await client.messages.parse(
        {
          model: opts.model,
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserMessage(input) }],
          output_config: { format: zodOutputFormat(SummarySchema) },
        },
        { signal },
      );
      if (response.stop_reason === 'refusal') throw new Error('Claude declined to summarize this scan');
      if (!response.parsed_output) throw new Error(`Claude returned no parsable summary (stop reason: ${response.stop_reason})`);
      opts.logger.info({ model: opts.model, usage: response.usage }, 'claude summary produced');
      return { summary: sanitizeSummary(response.parsed_output, input.findings), mode: 'claude', note: `model: ${opts.model}` };
    },
  };
}
