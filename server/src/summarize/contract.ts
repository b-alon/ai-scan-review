import { z } from 'zod';

export const RiskLevelSchema = z.enum(['critical', 'high', 'medium', 'low', 'none']);

export const SummarySchema = z.object({
  riskLevel: RiskLevelSchema,
  headline: z.string(),
  overview: z.string(),
  topRisks: z.array(
    z.object({
      fingerprint: z.string(),
      title: z.string(),
      whyItMatters: z.string(),
    }),
  ),
  nextActions: z.array(
    z.object({
      action: z.string(),
      effort: z.enum(['minutes', 'hours', 'days']),
      resolves: z.array(z.string()),
    }),
  ),
});

export type Summary = z.infer<typeof SummarySchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
