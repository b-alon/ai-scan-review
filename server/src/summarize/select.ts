import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { createClaudeSummarizer } from './claude.js';
import { createDeterministicSummarizer } from './deterministic.js';
import type { Summarizer } from './types.js';

export function withFallback(primary: Summarizer, fallback: Summarizer, logger: Logger): Summarizer {
  return {
    mode: primary.mode,
    async summarize(input, signal) {
      try {
        return await primary.summarize(input, signal);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn({ err, primary: primary.mode }, 'summarizer failed, using fallback');
        const result = await fallback.summarize(input, signal);
        return { ...result, note: `fallback from ${primary.mode}: ${reason}` };
      }
    },
  };
}

export function createSummarizer(config: Pick<Config, 'summarizerMode' | 'ANTHROPIC_API_KEY' | 'ANTHROPIC_MODEL'>, logger: Logger): Summarizer {
  const deterministic = createDeterministicSummarizer();
  if (config.summarizerMode !== 'claude' || !config.ANTHROPIC_API_KEY) return deterministic;
  return withFallback(createClaudeSummarizer({ apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL, logger }), deterministic, logger);
}
