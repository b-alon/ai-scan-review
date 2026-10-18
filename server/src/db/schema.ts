import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ScanStats, ScanWarning } from '../scan/types.js';
import type { Summary } from '../summarize/contract.js';

export const scanStatus = pgEnum('scan_status', ['queued', 'running', 'done', 'failed']);
export const findingCategory = pgEnum('finding_category', ['dependency', 'code', 'config']);
export const findingSeverity = pgEnum('finding_severity', ['critical', 'high', 'medium', 'low']);

export const scans = pgTable(
  'scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoOwner: text('repo_owner').notNull(),
    repoName: text('repo_name').notNull(),
    repoUrl: text('repo_url').notNull(),
    refRequested: text('ref_requested'),
    refResolved: text('ref_resolved'),
    commitSha: text('commit_sha').notNull(),
    status: scanStatus('status').notNull().default('queued'),
    stage: text('stage'),
    progressPct: integer('progress_pct').notNull().default(0),
    progressMessage: text('progress_message').notNull().default('Queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    error: text('error'),
    warnings: jsonb('warnings').$type<ScanWarning[]>().notNull().default(sql`'[]'::jsonb`),
    summary: jsonb('summary').$type<Summary>(),
    summarizer: text('summarizer'),
    summarizerNote: text('summarizer_note'),
    stats: jsonb('stats').$type<ScanStats>().notNull().default(sql`'{}'::jsonb`),
    previousScanId: uuid('previous_scan_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('scans_repo_created_idx').on(t.repoUrl, t.createdAt),
    index('scans_repo_commit_idx').on(t.repoUrl, t.commitSha),
    index('scans_status_idx').on(t.status),
  ],
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    category: findingCategory('category').notNull(),
    severity: findingSeverity('severity').notNull(),
    ruleId: text('rule_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    recommendation: text('recommendation').notNull(),
    location: text('location').notNull(),
    referenceId: text('reference_id'),
    referenceUrl: text('reference_url'),
    evidence: text('evidence'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index('findings_scan_idx').on(t.scanId), index('findings_scan_fp_idx').on(t.scanId, t.fingerprint)],
);

export const scanEvents = pgTable(
  'scan_events',
  {
    id: serial('id').primaryKey(),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => scans.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('scan_events_scan_idx').on(t.scanId)],
);

export const osvVulns = pgTable('osv_vulns', {
  id: text('id').primaryKey(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ScanRow = typeof scans.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type EventRow = typeof scanEvents.$inferSelect;
