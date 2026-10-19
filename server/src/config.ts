import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'is required'),
  ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  PORT: z.coerce.number().int().positive().default(8787),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  GITHUB_TOKEN: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  SCAN_FRESHNESS_MINUTES: z.coerce.number().int().nonnegative().default(10),
  SCAN_CACHE_DIR: z.string().min(1).default(path.join(os.tmpdir(), 'scan-cache')),
  SCAN_CACHE_MAX_AGE_HOURS: z.coerce.number().positive().default(24),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.string().default('development'),
});

export type SummarizerMode = 'claude' | 'deterministic';

export type Config = z.infer<typeof EnvSchema> & {
  summarizerMode: SummarizerMode;
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') cleaned[key] = value;
  }
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const data = result.data;
  return {
    ...data,
    summarizerMode: data.ANTHROPIC_API_KEY ? 'claude' : 'deterministic',
    isProduction: data.NODE_ENV === 'production',
  };
}
