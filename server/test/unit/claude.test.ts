import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { Finding } from '../../src/scan/types.js';
import { buildUserMessage, createClaudeSummarizer } from '../../src/summarize/claude.js';
import { createDeterministicSummarizer } from '../../src/summarize/deterministic.js';
import { createSummarizer, withFallback } from '../../src/summarize/select.js';
import type { SummaryInput } from '../../src/summarize/types.js';

const logger = pino({ level: 'silent' });
const f = (fingerprint: string, severity: Finding['severity'] = 'high'): Finding => ({ fingerprint, category: 'code', severity, ruleId: 'secret.aws_access_key', title: `T ${fingerprint}`, description: 'd', recommendation: 'r', location: 'a:1', referenceId: null, referenceUrl: null, evidence: null, metadata: {} });
const input: SummaryInput = { repo: { owner: 'o', name: 'r', commitSha: 'a'.repeat(40) }, findings: [f('k1', 'critical'), f('k2')], warnings: [], stats: { files: 10, packages: 2 } };

const goodOutput = { riskLevel: 'critical', headline: 'Rotate the key', overview: 'o', topRisks: [{ fingerprint: 'k1', title: 'T', whyItMatters: 'w' }, { fingerprint: 'ghost', title: 'x', whyItMatters: 'y' }], nextActions: [{ action: 'Rotate', effort: 'minutes', resolves: ['k1', 'ghost'] }] };

function fakeClient(result: { parsed_output: unknown; stop_reason: string } | Error) {
  const parse = vi.fn(async (_params: unknown, _options?: unknown) => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { client: { messages: { parse } } as never, parse };
}

describe('createClaudeSummarizer', () => {
  it('sends the findings with structured output and sanitizes the result', async () => {
    const { client, parse } = fakeClient({ parsed_output: goodOutput, stop_reason: 'end_turn' });
    const out = await createClaudeSummarizer({ apiKey: 'k', model: 'claude-opus-5-5', logger, client }).summarize(input, new AbortController().signal);
    expect(out.mode).toBe('claude');
    expect(out.note).toBe('model: claude-opus-5-5');
    expect(out.summary.topRisks.map((r) => r.fingerprint)).toEqual(['k1']);
    expect(out.summary.nextActions[0]?.resolves).toEqual(['k1']);
    const params = parse.mock.calls[0]![0] as unknown as { model: string; output_config: { format: unknown }; messages: Array<{ content: string }> };
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.output_config.format).toBeDefined();
    expect(params.messages[0]!.content).toContain('k1');
  });

  it('throws on refusal or empty output', async () => {
    const refused = fakeClient({ parsed_output: null, stop_reason: 'refusal' }).client;
    await expect(createClaudeSummarizer({ apiKey: 'k', model: 'm', logger, client: refused }).summarize(input, new AbortController().signal)).rejects.toThrow(/declined/);
    const empty = fakeClient({ parsed_output: null, stop_reason: 'max_tokens' }).client;
    await expect(createClaudeSummarizer({ apiKey: 'k', model: 'm', logger, client: empty }).summarize(input, new AbortController().signal)).rejects.toThrow(/no parsable summary/);
  });

  it('caps the findings sent to the model at fifty, highest severity first', () => {
    const many = { ...input, findings: Array.from({ length: 60 }, (_, i) => f(`x${i}`, i === 59 ? 'critical' : 'low')) };
    const message = buildUserMessage(many);
    const parsed = JSON.parse(message.slice(message.indexOf('{'))) as { findings: Array<{ fingerprint: string }>; omitted: number };
    expect(parsed.findings).toHaveLength(50);
    expect(parsed.findings[0]?.fingerprint).toBe('x59');
    expect(parsed.omitted).toBe(10);
  });
});

describe('withFallback and createSummarizer', () => {
  it('falls back to the deterministic summary and records why', async () => {
    const { client } = fakeClient(new Error('rate limited'));
    const primary = createClaudeSummarizer({ apiKey: 'k', model: 'm', logger, client });
    const out = await withFallback(primary, createDeterministicSummarizer(), logger).summarize(input, new AbortController().signal);
    expect(out.mode).toBe('deterministic');
    expect(out.note).toBe('fallback from claude: rate limited');
    expect(out.summary.riskLevel).toBe('critical');
  });

  it('selects by configuration', () => {
    expect(createSummarizer({ summarizerMode: 'deterministic', ANTHROPIC_API_KEY: undefined, ANTHROPIC_MODEL: 'm' }, logger).mode).toBe('deterministic');
    expect(createSummarizer({ summarizerMode: 'claude', ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm' }, logger).mode).toBe('claude');
  });
});
