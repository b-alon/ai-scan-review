# AI Scan Review Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the scan-review product from the spec: submit a GitHub repo, run a real dependency and code scan in a worker, follow progress live, read a prioritized result, compare with the previous scan, all started with one `docker compose up`.

**Architecture:** One Node/TypeScript codebase with two roles. The `api` role serves REST, Server-Sent Events and the built React UI; the `worker` role runs pg-boss jobs that execute the scan pipeline. Postgres is the only infrastructure: queue (pg-boss), progress, results and history.

**Tech Stack:** Node 24, TypeScript 5.9, Fastify 5, Drizzle ORM 0.45 + pg, pg-boss 12, Zod 4, pino, prom-client, React 19 + Vite 8 + Mantine 9 + react-router 8, Vitest 5, Docker Compose, OSV.dev API, `@anthropic-ai/sdk`.

**Spec:** `docs/superpowers/specs/2026-10-18-ai-scan-review-design.md`

## Global Constraints

- Backend is Node.js + TypeScript, ESM (`"type": "module"`, `module: NodeNext`). Relative imports in server source end with `.js`.
- TypeScript is pinned to `~5.9.3`. Do not upgrade to 7.x: typescript-eslint 8 requires `<6.1.0`.
- Docker images: `node:24-alpine` and `postgres:16-alpine`. The runtime image installs `git`.
- The database port is never published in `compose.yaml`. Only `compose.dev.yaml` publishes it, on host port 5433.
- Every boundary is validated with Zod: env, request bodies, the summary contract.
- The GitHub token never appears in a URL, a log line, or an error message. It is passed to git only as an `http.extraHeader` argument.
- Finding evidence is masked before storage: matched secret values keep their first 4 characters followed by `****`.
- Summary shape (spec section 5) is identical for both summarizers.
- Scan status values: `queued`, `running`, `done`, `failed`. Stages: `fetching`, `dependencies`, `code`, `summarizing`, `persisting`.
- pg-boss job options: `retryLimit: 2`, `retryBackoff: true`, `expireInSeconds: 600`. `max_attempts` on a scan is 3.
- Defaults: freshness window 10 minutes, app port 8080, worker concurrency 2, model `claude-opus-5-5`.
- UI copy is plain language. Result sections are titled "What matters", "What is risky", "What to do next".
- Commit after every task with a conventional message and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Integration tests need `DATABASE_URL` (the dev Compose database: `postgres://scan:scan@localhost:5433/scan`) and skip themselves when it is unset. Unit tests never touch the network or the database.
- Install dependencies with `npm install -w <workspace> <pkg>` in the step that first needs them, so `package-lock.json` stays accurate.

## Review Focus

1. A repo URL pasted with mixed case or surrounding whitespace (`  https://GitHub.com/Owner/Repo.git `) must normalize to the same `repo_url` as the lowercase form so history groups correctly. Test in Task 7.
2. A fetch that hangs (slow GitHub, huge repo) must abort at the stage timeout, clean up the temp directory, and surface as a retryable error, not a stuck `running` scan. Test in Task 15.
3. An advisory with no `database_specific.severity` and no `fixed` event must still produce a finding (severity medium, action "no fixed version") rather than crashing the dependency stage. Test in Task 17.
4. A client that opens the SSE stream after the scan already finished must receive `snapshot` then the terminal event, and the connection must close. Test in Task 12.
5. A placeholder secret (`password = "changeme"`) and a `.env.example` file must not produce findings, while a real-looking key must, with its value masked in evidence. Test in Task 19.

## File Structure

```
package.json                     npm workspaces: server, web; root scripts
compose.yaml                     db, migrate, api, worker
compose.dev.yaml                 publishes db on 5433
Dockerfile                       multi-stage: deps, build, runtime (with git)
.dockerignore, .env.example, .gitignore, .nvmrc
scripts/smoke.mjs                end-to-end smoke against a running stack
server/
  package.json, tsconfig.json, tsconfig.build.json, vitest.config.ts, eslint.config.js, drizzle.config.ts
  drizzle/                       generated SQL migrations (committed)
  src/main.ts                    entrypoint; ROLE selects api, worker or all
  src/version.ts                 APP_VERSION
  src/config.ts                  Zod-validated env
  src/logger.ts                  pino with redaction
  src/metrics.ts                 prom-client registry and metrics
  src/db/schema.ts               Drizzle tables and enums
  src/db/client.ts               pool and db factories
  src/db/migrate.ts              runMigrations + CLI
  src/db/scans-repo.ts           all scan/finding/event queries
  src/queue/boss.ts              pg-boss setup, enqueue, worker registration
  src/api/app.ts                 Fastify factory
  src/api/errors.ts              HttpError
  src/api/read-model.ts          ScanView, list items, comparison
  src/api/notifier.ts            LISTEN scan_updates
  src/api/routes/health.ts       /api/health, /api/ready
  src/api/routes/scans.ts        POST/GET /api/scans
  src/api/routes/stream.ts       SSE
  src/api/routes/static.ts       serve web/dist with SPA fallback
  src/github/parse-url.ts        URL and ref parsing
  src/github/exec.ts             execFile wrapper
  src/github/git-auth.ts         token header args and git env
  src/github/resolve-ref.ts      git ls-remote resolver
  src/scan/types.ts              Finding, ScanWarning, ScanStats, Stage, Severity
  src/scan/errors.ts             NonRetryableScanError
  src/scan/pipeline.ts           Pipeline interfaces and createPipeline
  src/scan/fake-pipeline.ts      stage walker for tests and early E2E
  src/scan/run-scan.ts           pg-boss job handler
  src/scan/fetch.ts              git fetch into a temp dir
  src/scan/files.ts              directory walker with limits
  src/scan/parsers/*.ts          manifest parsers and discovery
  src/scan/deps-stage.ts         dependency stage
  src/scan/rules/*.ts            code rules and engine
  src/scan/code-stage.ts         code stage
  src/scan/fingerprint.ts        stable fingerprints
  src/osv/*.ts                   OSV client, mapping, cache, advisories
  src/summarize/contract.ts      Summary Zod schema
  src/summarize/types.ts         SummaryInput, Summarizer, SummarizeOutcome
  src/summarize/deterministic.ts
  src/summarize/claude.ts
  src/summarize/guards.ts        sanitizeSummary
  src/summarize/select.ts        createSummarizer with fallback
  src/compare/diff.ts            diffFindings
  test/unit/**                   no network, no database
  test/integration/**            DATABASE_URL-gated
  test/fixtures/**
  scripts/try-claude.ts          prints a real Claude summary for the README
web/
  package.json, tsconfig.json, vite.config.ts, index.html, eslint.config.js
  src/main.tsx, src/App.tsx
  src/api.ts                     fetch wrappers
  src/types.ts                   API types mirrored for the UI
  src/hooks/useScanStream.ts     SSE with polling fallback
  src/lib/format.ts              timeAgo, shortSha, severity helpers
  src/pages/HomePage.tsx, ScanPage.tsx, RepoHistoryPage.tsx
  src/components/*.tsx           ScanProgress, ScanResult, RiskBadge, TopRisks, NextActions, ComparisonSection, FindingsTable, ReusedBanner, ScanListItemRow
  src/test/setup.ts
```

---

### Task 1: Server workspace scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `.nvmrc`
- Create: `server/package.json`, `server/tsconfig.json`, `server/tsconfig.build.json`, `server/vitest.config.ts`, `server/eslint.config.js`
- Test: `server/test/unit/sanity.test.ts`

**Interfaces:**
- Produces: npm scripts used by every later task: `npm test -w server`, `npm run test:integration -w server`, `npm run typecheck -w server`, `npm run lint -w server`, `npm run build -w server`.

- [ ] **Step 1: Write the root `package.json`**

```json
{
  "name": "ai-scan-review",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "workspaces": ["server"],
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "npm run dev -w server",
    "dev:db": "docker compose -f compose.yaml -f compose.dev.yaml up -d db",
    "build": "npm run build -w server",
    "test": "npm run test -w server",
    "test:integration": "npm run test:integration -w server",
    "typecheck": "npm run typecheck -w server",
    "lint": "npm run lint -w server"
  }
}
```

- [ ] **Step 2: Write `.gitignore` and `.nvmrc`**

`.gitignore`:
```
node_modules/
dist/
.env
coverage/
*.log
.DS_Store
```

`.nvmrc`:
```
24
```

- [ ] **Step 3: Write `server/package.json`**

```json
{
  "name": "@scan/server",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src test",
    "test": "vitest run --dir test/unit",
    "test:integration": "vitest run --dir test/integration",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts"
  }
}
```

- [ ] **Step 4: Install the dev toolchain**

Run from the repo root:
```bash
npm install -w server -D typescript@~5.9.3 tsx@^4 vitest@^5 @types/node@^24 eslint@^10 typescript-eslint@^8
```
Expected: `package-lock.json` created, `server/package.json` gains `devDependencies`.

- [ ] **Step 5: Write `server/tsconfig.json` and `server/tsconfig.build.json`**

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "scripts", "drizzle.config.ts", "vitest.config.ts"]
}
```

`server/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Write `server/vitest.config.ts` and `server/eslint.config.js`**

`server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
```

`server/eslint.config.js`:
```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'drizzle/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 7: Write the sanity test**

`server/test/unit/sanity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Run the toolchain**

Run: `npm test -w server && npm run typecheck -w server && npm run lint -w server`
Expected: 1 test passed; typecheck and lint exit 0.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold server workspace with TypeScript, Vitest and ESLint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Configuration from environment

**Files:**
- Create: `server/src/config.ts`
- Test: `server/test/unit/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): Config`; `Config` has `DATABASE_URL`, `ROLE: 'api'|'worker'|'all'`, `PORT`, `ANTHROPIC_API_KEY?`, `ANTHROPIC_MODEL`, `GITHUB_TOKEN?`, `WORKER_CONCURRENCY`, `SCAN_FRESHNESS_MINUTES`, `LOG_LEVEL`, `NODE_ENV`, plus derived `summarizerMode: 'claude'|'deterministic'` and `isProduction: boolean`. Type `SummarizerMode`.

- [ ] **Step 1: Install zod**

Run: `npm install -w server zod@^4`

- [ ] **Step 2: Write the failing test**

`server/test/unit/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = { DATABASE_URL: 'postgres://scan:scan@localhost:5433/scan' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c.ROLE).toBe('all');
    expect(c.PORT).toBe(8080);
    expect(c.WORKER_CONCURRENCY).toBe(2);
    expect(c.SCAN_FRESHNESS_MINUTES).toBe(10);
    expect(c.ANTHROPIC_MODEL).toBe('claude-opus-5-5');
    expect(c.summarizerMode).toBe('deterministic');
    expect(c.isProduction).toBe(false);
  });

  it('treats empty strings as unset', () => {
    const c = loadConfig({ ...base, ANTHROPIC_API_KEY: '', GITHUB_TOKEN: '   ', PORT: '' });
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
    expect(c.GITHUB_TOKEN).toBeUndefined();
    expect(c.PORT).toBe(8080);
  });

  it('switches summarizer mode on when a key is present', () => {
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: 'sk-ant-test' }).summarizerMode).toBe('claude');
  });

  it('coerces numbers and rejects bad values naming the variable', () => {
    expect(loadConfig({ ...base, PORT: '9090' }).PORT).toBe(9090);
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, ROLE: 'bogus' })).toThrow(/ROLE/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w server -- config`
Expected: FAIL, cannot find module `../../src/config.js`.

- [ ] **Step 4: Write `server/src/config.ts`**

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'is required'),
  ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  PORT: z.coerce.number().int().positive().default(8080),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  GITHUB_TOKEN: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  SCAN_FRESHNESS_MINUTES: z.coerce.number().int().nonnegative().default(10),
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w server -- config`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): zod-validated configuration from environment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Database schema, migrations and dev Compose database

**Files:**
- Create: `server/src/scan/types.ts`, `server/src/summarize/contract.ts`
- Create: `server/src/db/schema.ts`, `server/src/db/client.ts`, `server/src/db/migrate.ts`, `server/drizzle.config.ts`
- Create: `compose.yaml` (db only for now), `compose.dev.yaml`
- Create: `server/test/integration/helpers.ts`
- Test: `server/test/integration/db.test.ts`

**Interfaces:**
- Produces: `scans`, `findings`, `scanEvents`, `osvVulns` tables; `ScanRow`, `FindingRow`, `EventRow` select types; `createPool(url): pg.Pool`; `createDb(pool): Db`; `Db`, `Queryable` (db or transaction); `runMigrations(url): Promise<void>`; domain types `Finding`, `ScanWarning`, `ScanStats`, `Stage`, `Severity`, `Category`, `SEVERITY_ORDER`; `SummarySchema`, `Summary`, `RiskLevel`; test helpers `setupTestDb()`, `resetDb(db)`.

- [ ] **Step 1: Install database packages**

Run: `npm install -w server drizzle-orm@^0.45 pg@^8 && npm install -w server -D drizzle-kit@^0.31 @types/pg@^8`

- [ ] **Step 2: Write the domain types**

`server/src/scan/types.ts`:
```ts
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'dependency' | 'code' | 'config';
export type Stage = 'fetching' | 'dependencies' | 'code' | 'summarizing' | 'persisting';

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface Finding {
  fingerprint: string;
  category: Category;
  severity: Severity;
  ruleId: string;
  title: string;
  description: string;
  recommendation: string;
  location: string;
  referenceId: string | null;
  referenceUrl: string | null;
  evidence: string | null;
  metadata: Record<string, unknown>;
}

export interface ScanWarning {
  code: string;
  message: string;
}

export interface ScanStats {
  files?: number;
  packages?: number;
  advisories?: number;
  stageDurationsMs?: Partial<Record<Stage, number>>;
  totalMs?: number;
}

export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
}
```

`server/src/summarize/contract.ts`:
```ts
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
```

- [ ] **Step 3: Write the Drizzle schema**

`server/src/db/schema.ts`:
```ts
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
```

- [ ] **Step 4: Write the client and migrate modules**

`server/src/db/client.ts`:
```ts
import pg from 'pg';
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

export function createDb(pool: pg.Pool) {
  return drizzle({ client: pool, schema });
}

export type Db = ReturnType<typeof createDb>;
// Accepts both the database and a transaction handle (PgTransaction extends PgDatabase).
export type Queryable = PgDatabase<NodePgQueryResultHKT, typeof schema>;
```

`server/src/db/migrate.ts`:
```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client.js';

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = createPool(connectionString);
  try {
    const db = createDb(pool);
    const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('migrations applied');
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
```

`server/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://scan:scan@localhost:5433/scan' },
});
```

- [ ] **Step 5: Generate the first migration**

Run: `npm run db:generate -w server`
Expected: `server/drizzle/0000_<name>.sql` and `server/drizzle/meta/` created. Open the SQL file and confirm it creates the three enums and four tables.

- [ ] **Step 6: Write the Compose files for the database**

`compose.yaml`:
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: scan
      POSTGRES_PASSWORD: scan
      POSTGRES_DB: scan
    volumes:
      - dbdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scan -d scan"]
      interval: 2s
      timeout: 3s
      retries: 30

volumes:
  dbdata:
```

`compose.dev.yaml`:
```yaml
services:
  db:
    ports:
      - "5433:5432"
```

- [ ] **Step 7: Start the dev database**

Start Docker Desktop if it is not running (`docker info` must succeed). Then:
```bash
npm run dev:db
export DATABASE_URL=postgres://scan:scan@localhost:5433/scan
```
Expected: `docker compose ps` shows `db` healthy.

- [ ] **Step 8: Write the integration helpers and the failing test**

`server/test/integration/helpers.ts`:
```ts
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { createDb, createPool, type Db } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

export const TEST_DATABASE_URL = process.env.DATABASE_URL;

export interface TestDb {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export async function setupTestDb(): Promise<TestDb> {
  if (!TEST_DATABASE_URL) throw new Error('DATABASE_URL is required for integration tests');
  await runMigrations(TEST_DATABASE_URL);
  const pool = createPool(TEST_DATABASE_URL);
  const db = createDb(pool);
  return { db, pool, close: () => pool.end() };
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE findings, scan_events, scans, osv_vulns RESTART IDENTITY CASCADE`);
}
```

`server/test/integration/db.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scans } from '../../src/db/schema.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('database', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await setupTestDb();
    await resetDb(t.db);
  });

  afterAll(async () => {
    await t.close();
  });

  it('applies migrations and round-trips a scan row', async () => {
    const [row] = await t.db
      .insert(scans)
      .values({ repoOwner: 'o', repoName: 'r', repoUrl: 'https://github.com/o/r', commitSha: 'a'.repeat(40) })
      .returning();
    expect(row?.status).toBe('queued');
    expect(row?.warnings).toEqual([]);
    const found = await t.db.select().from(scans).where(eq(scans.id, row!.id));
    expect(found).toHaveLength(1);
    expect(found[0]?.progressMessage).toBe('Queued');
  });
});
```

- [ ] **Step 9: Run the integration test**

Run: `npm run test:integration -w server`
Expected: 1 test passes (migrations applied against the dev database).

- [ ] **Step 10: Typecheck, lint, commit**

Run: `npm run typecheck -w server && npm run lint -w server`
Expected: exit 0.

```bash
git add -A
git commit -m "feat(server): drizzle schema, migrations and dev compose database

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Logger, Fastify app factory, health and readiness, entrypoint

**Files:**
- Create: `server/src/version.ts`, `server/src/logger.ts`, `server/src/api/errors.ts`, `server/src/api/app.ts`, `server/src/api/routes/health.ts`, `server/src/main.ts`
- Test: `server/test/unit/health.test.ts`

**Interfaces:**
- Produces: `createLogger(config): Logger` (pino, redacts `authorization`, `token`, `apiKey`, env secrets); `HttpError(status, code, message)`; `buildApp({ logger, routes }): Promise<FastifyInstance>` where `routes` is an array of `(app) => void | Promise<void>`; `registerHealthRoutes(app, { role, version, summarizerMode, checkDb, isQueueReady })` serving `GET /api/health` and `GET /api/ready`; `APP_VERSION`.
- Error envelope for every error response: `{ error: { code, message } }`.

- [ ] **Step 1: Install Fastify and pino**

Run: `npm install -w server fastify@^5 pino@^10 && npm install -w server -D pino-pretty@^13`

- [ ] **Step 2: Write the failing test**

`server/test/unit/health.test.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { registerHealthRoutes } from '../../src/api/routes/health.js';

describe('health routes', () => {
  let app: FastifyInstance;
  let dbOk = true;

  beforeAll(async () => {
    app = await buildApp({
      logger: pino({ level: 'silent' }),
      routes: [
        (a) =>
          registerHealthRoutes(a, {
            role: 'api',
            version: 'test',
            summarizerMode: 'deterministic',
            checkDb: async () => {
              if (!dbOk) throw new Error('connection refused');
            },
            isQueueReady: () => true,
          }),
      ],
    });
    await app.ready();
  });

  afterAll(() => app.close());

  it('reports liveness', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, role: 'api', version: 'test', summarizer: 'deterministic' });
  });

  it('reports readiness and fails when the database is down', async () => {
    let res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, checks: { db: 'ok', queue: 'ok' } });
    dbOk = false;
    res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.db).toMatch(/connection refused/);
    dbOk = true;
  });

  it('returns a JSON 404 envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w server -- health`
Expected: FAIL, cannot find module `../../src/api/app.js`.

- [ ] **Step 4: Write the modules**

`server/src/version.ts`:
```ts
export const APP_VERSION = '0.1.0';
```

`server/src/logger.ts`:
```ts
import { pino, type Logger } from 'pino';
import type { Config } from './config.js';

export type { Logger };

export const REDACT_PATHS = [
  'req.headers.authorization',
  'headers.authorization',
  '*.token',
  '*.apiKey',
  '*.GITHUB_TOKEN',
  '*.ANTHROPIC_API_KEY',
];

export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'isProduction'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(config.isProduction
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }),
  });
}
```

`server/src/api/errors.ts`:
```ts
import type { FastifyInstance } from 'fastify';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function jsonNotFound(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: `No route for ${req.method} ${req.url}` } }),
  );
}
```

`server/src/api/routes/health.ts`:
```ts
import type { FastifyInstance } from 'fastify';

export interface HealthDeps {
  role: string;
  version: string;
  summarizerMode: string;
  checkDb: () => Promise<void>;
  isQueueReady: () => boolean;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get('/api/health', async () => ({
    ok: true,
    role: deps.role,
    version: deps.version,
    summarizer: deps.summarizerMode,
  }));

  app.get('/api/ready', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await deps.checkDb();
      checks.db = 'ok';
    } catch (err) {
      checks.db = err instanceof Error ? err.message : String(err);
    }
    checks.queue = deps.isQueueReady() ? 'ok' : 'not started';
    const ok = Object.values(checks).every((v) => v === 'ok');
    return reply.code(ok ? 200 : 503).send({ ok, checks });
  });
}
```

`server/src/api/app.ts`:
```ts
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from '../logger.js';
import { HttpError, jsonNotFound } from './errors.js';

export type RoutePlugin = (app: FastifyInstance) => void | Promise<void>;

export interface AppDeps {
  logger: Logger;
  routes: RoutePlugin[];
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong on our side.' } });
  });

  for (const route of deps.routes) await route(app);
  jsonNotFound(app);
  return app;
}
```

`server/src/main.ts`:
```ts
import { sql } from 'drizzle-orm';
import { buildApp } from './api/app.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { loadConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { createLogger } from './logger.js';
import { APP_VERSION } from './version.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);

  const app = await buildApp({
    logger,
    routes: [
      (a) =>
        registerHealthRoutes(a, {
          role: config.ROLE,
          version: APP_VERSION,
          summarizerMode: config.summarizerMode,
          checkDb: async () => {
            await db.execute(sql`select 1 from scans limit 1`);
          },
          isQueueReady: () => true,
        }),
    ],
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

If `loggerInstance` rejects the pino type, cast with `loggerInstance: deps.logger as unknown as FastifyBaseLogger` (import the type from `fastify`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w server -- health`
Expected: 3 tests pass.

- [ ] **Step 6: Run the server against the dev database**

Run (with `DATABASE_URL` exported and the dev db up): `npm run dev -w server`
In another shell: `curl -s localhost:8080/api/ready`
Expected: `{"ok":true,"checks":{"db":"ok","queue":"ok"}}`. Stop the server with Ctrl-C.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npm run typecheck -w server && npm run lint -w server`

```bash
git add -A
git commit -m "feat(server): fastify app with health, readiness and structured logging

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Web workspace scaffold and static serving

**Files:**
- Modify: `package.json` (root)
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/eslint.config.js`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/pages/HomePage.tsx`, `web/src/test/setup.ts`
- Create: `server/src/api/routes/static.ts`
- Modify: `server/src/main.ts`
- Test: `web/src/test/app.test.tsx`

**Interfaces:**
- Produces: `registerStatic(app, webDistDir)` serving `web/dist` with an SPA fallback and a JSON 404 for `/api/*`; the React shell with `MantineProvider`, `BrowserRouter`, an `AppShell` header, and a `/` route; root scripts `dev`, `build`, `test`, `typecheck`, `lint` covering both workspaces.

- [ ] **Step 1: Update the root `package.json`**

```json
{
  "name": "ai-scan-review",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "workspaces": ["server", "web"],
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "concurrently -n api,web -c blue,magenta \"npm run dev -w server\" \"npm run dev -w web\"",
    "dev:db": "docker compose -f compose.yaml -f compose.dev.yaml up -d db",
    "build": "npm run build -w web && npm run build -w server",
    "test": "npm run test -w server && npm run test -w web",
    "test:integration": "npm run test:integration -w server",
    "typecheck": "npm run typecheck -w server && npm run typecheck -w web",
    "lint": "npm run lint -w server && npm run lint -w web",
    "smoke": "node scripts/smoke.mjs"
  }
}
```

- [ ] **Step 2: Write `web/package.json` and install**

`web/package.json`:
```json
{
  "name": "@scan/web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  }
}
```

Run from the root:
```bash
npm install -D concurrently@^10
npm install -w web react@^19 react-dom@^19 react-router@^8 @mantine/core@^9 @mantine/hooks@^9
npm install -w web -D vite@^8 @vitejs/plugin-react@^6 vitest@^5 jsdom@^30 @testing-library/react@^16 @testing-library/jest-dom@^6 @types/react@^19 @types/react-dom@^19 typescript@~5.9.3 eslint@^10 typescript-eslint@^8
```

- [ ] **Step 3: Write the web config files**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

`web/eslint.config.js`:
```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Scan Review</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

const { getComputedStyle } = window;
window.getComputedStyle = (elt) => getComputedStyle(elt);
window.HTMLElement.prototype.scrollIntoView = () => {};

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

if (!('EventSource' in window)) {
  Object.defineProperty(window, 'EventSource', { writable: true, value: undefined });
}
```

- [ ] **Step 4: Write the failing test**

`web/src/test/app.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../App';

describe('App shell', () => {
  it('renders the header and the home page', () => {
    render(<App />);
    expect(screen.getByText('AI Scan Review')).toBeInTheDocument();
    expect(screen.getByText('Scan a GitHub repository')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -w web`
Expected: FAIL, cannot resolve `../App`.

- [ ] **Step 6: Write the React shell**

`web/src/main.tsx`:
```tsx
import '@mantine/core/styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`web/src/App.tsx`:
```tsx
import { Anchor, AppShell, Container, Group, MantineProvider, Title } from '@mantine/core';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { HomePage } from './pages/HomePage';

export function App() {
  return (
    <MantineProvider defaultColorScheme="auto">
      <BrowserRouter>
        <AppShell header={{ height: 56 }} padding="md">
          <AppShell.Header>
            <Group h="100%" px="md">
              <Anchor component={Link} to="/" underline="never" c="inherit">
                <Title order={4}>AI Scan Review</Title>
              </Anchor>
            </Group>
          </AppShell.Header>
          <AppShell.Main>
            <Container size="lg">
              <Routes>
                <Route path="/" element={<HomePage />} />
              </Routes>
            </Container>
          </AppShell.Main>
        </AppShell>
      </BrowserRouter>
    </MantineProvider>
  );
}
```

`web/src/pages/HomePage.tsx`:
```tsx
import { Stack, Text, Title } from '@mantine/core';

export function HomePage() {
  return (
    <Stack gap="xs">
      <Title order={2}>Scan a GitHub repository</Title>
      <Text c="dimmed">Submit a repository to get a prioritized security review.</Text>
    </Stack>
  );
}
```

- [ ] **Step 7: Run the web test, typecheck and build**

Run: `npm test -w web && npm run typecheck -w web && npm run build -w web`
Expected: 1 test passes; `web/dist/index.html` exists.

- [ ] **Step 8: Serve the build from the API**

Run: `npm install -w server @fastify/static@^10`

`server/src/api/routes/static.ts`:
```ts
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { jsonNotFound } from '../errors.js';

export async function registerStatic(app: FastifyInstance, webDistDir: string): Promise<void> {
  if (!existsSync(webDistDir)) {
    app.log.warn({ webDistDir }, 'web build not found; the UI will not be served');
    jsonNotFound(app);
    return;
  }
  await app.register(fastifyStatic, { root: webDistDir, prefix: '/', wildcard: true, index: ['index.html'] });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'not_found', message: `No route for ${req.method} ${req.url}` } });
    }
    return reply.sendFile('index.html');
  });
}
```

Modify `server/src/api/app.ts`: add `webDistDir: string | null` to `AppDeps`, import `registerStatic`, and replace the final `jsonNotFound(app);` line with:
```ts
  if (deps.webDistDir) await registerStatic(app, deps.webDistDir);
  else jsonNotFound(app);
```

Modify `server/src/main.ts`: add at the top
```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
```
and pass `webDistDir: config.ROLE === 'worker' ? null : WEB_DIST` to `buildApp`. Update the health test to pass `webDistDir: null`.

- [ ] **Step 9: Verify end to end in dev**

Run: `npm run dev -w server` (dev db up, `DATABASE_URL` exported). Open `http://localhost:8080` in a browser.
Expected: the header "AI Scan Review" and the home page render; `curl -s localhost:8080/api/nope` returns the JSON 404 envelope; `curl -s localhost:8080/scans/abc` returns the HTML shell.

- [ ] **Step 10: Run everything and commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add -A
git commit -m "feat(web): react shell with mantine, served by the api with spa fallback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docker image and full Compose stack

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `.env.example`
- Modify: `compose.yaml`

**Interfaces:**
- Produces: image `ai-scan-review` with `node server/dist/main.js` as the command; Compose services `db`, `migrate`, `api`, `worker`; env passthrough for `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GITHUB_TOKEN`, `APP_PORT`, `LOG_LEVEL`, `WORKER_CONCURRENCY`, `SCAN_FRESHNESS_MINUTES`.

- [ ] **Step 1: Write the Dockerfile and `.dockerignore`**

`Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
RUN apk add --no-cache git
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/drizzle server/drizzle
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 8080
CMD ["node", "server/dist/main.js"]
```

`.dockerignore`:
```
node_modules
*/node_modules
dist
*/dist
.git
.env
docs
coverage
```

- [ ] **Step 2: Write `.env.example`**

```
# Copy to .env. Everything is optional; the app runs with none of these set.

# Enables the Claude summarizer. Without it a rule-based summarizer runs.
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-5-5

# Lets the scanner read private repositories the token can access.
GITHUB_TOKEN=

# Host port for the UI and API.
APP_PORT=8080

LOG_LEVEL=info
WORKER_CONCURRENCY=2
SCAN_FRESHNESS_MINUTES=10
```

- [ ] **Step 3: Write the full `compose.yaml`**

```yaml
x-app-env: &app-env
  DATABASE_URL: postgres://scan:scan@db:5432/scan
  NODE_ENV: production
  PORT: "8080"
  LOG_LEVEL: ${LOG_LEVEL:-info}
  ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
  ANTHROPIC_MODEL: ${ANTHROPIC_MODEL:-claude-opus-5-5}
  GITHUB_TOKEN: ${GITHUB_TOKEN:-}
  WORKER_CONCURRENCY: ${WORKER_CONCURRENCY:-2}
  SCAN_FRESHNESS_MINUTES: ${SCAN_FRESHNESS_MINUTES:-10}

x-app-healthcheck: &app-healthcheck
  test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/api/ready"]
  interval: 5s
  timeout: 3s
  retries: 20

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: scan
      POSTGRES_PASSWORD: scan
      POSTGRES_DB: scan
    volumes:
      - dbdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scan -d scan"]
      interval: 2s
      timeout: 3s
      retries: 30

  migrate:
    build: .
    image: ai-scan-review
    command: ["node", "server/dist/db/migrate.js"]
    environment:
      DATABASE_URL: postgres://scan:scan@db:5432/scan
    depends_on:
      db:
        condition: service_healthy

  api:
    build: .
    image: ai-scan-review
    environment:
      <<: *app-env
      ROLE: api
    ports:
      - "${APP_PORT:-8080}:8080"
    depends_on:
      migrate:
        condition: service_completed_successfully
    healthcheck: *app-healthcheck

  worker:
    build: .
    image: ai-scan-review
    environment:
      <<: *app-env
      ROLE: worker
    depends_on:
      migrate:
        condition: service_completed_successfully
    healthcheck: *app-healthcheck

volumes:
  dbdata:
```

- [ ] **Step 4: Build and start the stack**

Run: `docker compose up --build -d`
Expected: `docker compose ps` shows `db`, `api`, `worker` healthy and `migrate` exited 0.

- [ ] **Step 5: Verify**

```bash
curl -s localhost:8080/api/health
curl -s localhost:8080/api/ready
curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/
docker compose logs migrate | tail -2
```
Expected: health shows `role: "api"`; ready is `ok: true`; `/` returns 200; migrate logs "migrations applied". Open `http://localhost:8080` and see the shell.

- [ ] **Step 6: Stop and commit**

Run: `docker compose down`

```bash
git add -A
git commit -m "build: docker image and compose stack with db, migrate, api and worker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: GitHub URL and ref parsing

**Files:**
- Create: `server/src/github/parse-url.ts`
- Test: `server/test/unit/parse-url.test.ts`

**Interfaces:**
- Produces: `parseGitHubUrl(input: string, explicitRef?: string | null): ParsedRepo` with `ParsedRepo { owner, repo, repoUrl, ref: string | null, refKind: 'default' | 'named' | 'sha' | 'pull' }`; `classifyRef(ref): RefKind`; `InvalidRepoUrlError`.
- `repoUrl` is always `https://github.com/<owner>/<repo>` in lowercase. A SHA ref is only accepted in full (40 hex characters); abbreviated SHAs are rejected with a message asking for the full one, because git cannot fetch by an abbreviated hash.

- [ ] **Step 1: Write the failing test**

`server/test/unit/parse-url.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { InvalidRepoUrlError, parseGitHubUrl } from '../../src/github/parse-url.js';

describe('parseGitHubUrl', () => {
  const base = { owner: 'owner', repo: 'repo', repoUrl: 'https://github.com/owner/repo' };

  it.each([
    ['https://github.com/owner/repo', null, 'default'],
    ['https://github.com/owner/repo.git', null, 'default'],
    ['https://github.com/owner/repo/', null, 'default'],
    ['http://www.github.com/owner/repo', null, 'default'],
    ['github.com/owner/repo', null, 'default'],
    ['git@github.com:owner/repo.git', null, 'default'],
    ['  https://GitHub.com/Owner/Repo.git  ', null, 'default'],
  ])('normalizes %s', (input, ref, refKind) => {
    expect(parseGitHubUrl(input)).toEqual({ ...base, ref, refKind });
  });

  it('reads refs from GitHub URL forms', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/main')).toMatchObject({ ref: 'main', refKind: 'named' });
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/release/1.0')).toMatchObject({ ref: 'release/1.0', refKind: 'named' });
    expect(parseGitHubUrl('https://github.com/owner/repo/blob/dev/src/index.ts')).toMatchObject({ ref: 'dev', refKind: 'named' });
    expect(parseGitHubUrl('https://github.com/owner/repo/releases/tag/v1.2.3')).toMatchObject({ ref: 'v1.2.3', refKind: 'named' });
    expect(parseGitHubUrl('https://github.com/owner/repo/commit/0123456789abcdef0123456789abcdef01234567')).toMatchObject({
      ref: '0123456789abcdef0123456789abcdef01234567',
      refKind: 'sha',
    });
    expect(parseGitHubUrl('https://github.com/owner/repo/pull/42/files')).toMatchObject({ ref: 'refs/pull/42/head', refKind: 'pull' });
    expect(parseGitHubUrl('https://github.com/owner/repo/issues/9')).toMatchObject({ ref: null, refKind: 'default' });
  });

  it('lets an explicit ref override the URL and classifies it', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/main', 'v2')).toMatchObject({ ref: 'v2', refKind: 'named' });
    expect(parseGitHubUrl('https://github.com/owner/repo', 'ABCDEF0123456789ABCDEF0123456789ABCDEF01')).toMatchObject({
      ref: 'abcdef0123456789abcdef0123456789abcdef01',
      refKind: 'sha',
    });
    expect(parseGitHubUrl('https://github.com/owner/repo', '  ')).toMatchObject({ ref: null, refKind: 'default' });
  });

  it.each([
    ['', /Enter a GitHub repository URL/],
    ['https://gitlab.com/owner/repo', /Only github.com/],
    ['https://github.com/owner', /owner and a repository/],
    ['https://github.com/ow ner/repo', /unsupported characters/],
    ['not a url at all', /Only github.com|valid URL/],
  ])('rejects %s', (input, message) => {
    expect(() => parseGitHubUrl(input)).toThrow(InvalidRepoUrlError);
    expect(() => parseGitHubUrl(input)).toThrow(message);
  });

  it('rejects refs git would treat as options or ranges', () => {
    expect(() => parseGitHubUrl('https://github.com/owner/repo', '--upload-pack=evil')).toThrow(InvalidRepoUrlError);
    expect(() => parseGitHubUrl('https://github.com/owner/repo', 'a..b')).toThrow(InvalidRepoUrlError);
    expect(() => parseGitHubUrl('https://github.com/owner/repo', 'bad ref')).toThrow(InvalidRepoUrlError);
  });

  it('rejects abbreviated commit shas, which git cannot fetch', () => {
    expect(() => parseGitHubUrl('https://github.com/owner/repo', 'abc1234')).toThrow(/full 40 character/);
    expect(() => parseGitHubUrl('https://github.com/owner/repo/commit/abc1234')).toThrow(/full 40 character/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server -- parse-url`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Write `server/src/github/parse-url.ts`**

```ts
export type RefKind = 'default' | 'named' | 'sha' | 'pull';

export interface ParsedRepo {
  owner: string;
  repo: string;
  repoUrl: string;
  ref: string | null;
  refKind: RefKind;
}

export class InvalidRepoUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRepoUrlError';
  }
}

const NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/i;
const SHORT_SHA = /^[0-9a-f]{7,39}$/i;
const UNSAFE_REF = /\s|\.\.|[~^:?*[\\]|^-|\/$|^\/|@\{/;

export function classifyRef(ref: string): RefKind {
  if (SHA.test(ref)) return 'sha';
  if (/^refs\/pull\/\d+\/head$/.test(ref)) return 'pull';
  return 'named';
}

function assertSafeRef(ref: string): void {
  if (SHORT_SHA.test(ref)) {
    throw new InvalidRepoUrlError('Use the full 40 character commit SHA, or a branch or tag name.');
  }
  if (UNSAFE_REF.test(ref) || ref.length > 200) {
    throw new InvalidRepoUrlError('The ref contains characters git does not allow.');
  }
}

export function parseGitHubUrl(input: string, explicitRef?: string | null): ParsedRepo {
  const raw = input.trim();
  if (!raw) throw new InvalidRepoUrlError('Enter a GitHub repository URL.');

  let pathPart: string;
  const ssh = /^git@github\.com:(.+)$/i.exec(raw);
  if (ssh) {
    pathPart = ssh[1]!;
  } else {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      throw new InvalidRepoUrlError('That does not look like a valid URL.');
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') {
      throw new InvalidRepoUrlError('Only github.com repositories are supported.');
    }
    pathPart = url.pathname;
  }

  const segments = pathPart.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new InvalidRepoUrlError('The URL must include an owner and a repository, like github.com/owner/repo.');
  }
  const owner = segments[0]!.toLowerCase();
  const repo = segments[1]!.replace(/\.git$/i, '').toLowerCase();
  if (!NAME.test(owner) || !NAME.test(repo)) {
    throw new InvalidRepoUrlError('The owner or repository name contains unsupported characters.');
  }

  let ref: string | null = null;
  let refKind: RefKind = 'default';
  const explicit = explicitRef?.trim();
  if (explicit) {
    refKind = classifyRef(explicit);
    ref = refKind === 'sha' ? explicit.toLowerCase() : explicit;
  } else {
    const [kind, ...more] = segments.slice(2);
    const first = more[0];
    if ((kind === 'tree' || kind === 'blob') && first) {
      ref = kind === 'tree' ? more.join('/') : first;
      refKind = classifyRef(ref);
    } else if (kind === 'commit' && first && /^[0-9a-f]{7,40}$/i.test(first)) {
      ref = first.toLowerCase();
      refKind = 'sha';
    } else if (kind === 'releases' && first === 'tag' && more[1]) {
      ref = more.slice(1).join('/');
      refKind = 'named';
    } else if (kind === 'pull' && first && /^\d+$/.test(first)) {
      ref = `refs/pull/${first}/head`;
      refKind = 'pull';
    }
  }
  if (ref) assertSafeRef(ref);

  return { owner, repo, repoUrl: `https://github.com/${owner}/${repo}`, ref, refKind };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w server -- parse-url`
Expected: all pass. If `'not a url at all'` parses as a host, the `Only github.com` branch rejects it, which the test accepts.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): parse github urls, refs, tags, commits and pull requests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Git exec wrapper and ref resolver

**Files:**
- Create: `server/src/github/exec.ts`, `server/src/github/git-auth.ts`, `server/src/github/resolve-ref.ts`
- Test: `server/test/unit/resolve-ref.test.ts`, `server/test/unit/git-auth.test.ts`

**Interfaces:**
- Produces: `Exec = (cmd, args, { cwd?, env?, signal?, timeoutMs }) => Promise<{ stdout, stderr }>`; `ExecError { cmd, code, stderr, timedOut }` whose message never contains args; `realExec`; `gitAuthArgs(token?): string[]`; `gitEnv(): NodeJS.ProcessEnv`; `createGitRefResolver({ exec, token?, timeoutMs? }): RefResolver`; `RefResolver.resolve(parsed): Promise<{ commitSha, refResolved }>`; errors `RepoNotFoundError`, `RefNotFoundError`, `GitUnavailableError`; pure helpers `parseLsRemote`, `pickResolved`, `mapGitError`.

- [ ] **Step 1: Write the failing tests**

`server/test/unit/git-auth.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { gitAuthArgs, gitEnv } from '../../src/github/git-auth.js';

describe('git auth', () => {
  it('returns no args without a token', () => {
    expect(gitAuthArgs(undefined)).toEqual([]);
  });

  it('passes the token as a basic auth header, never in a URL', () => {
    const args = gitAuthArgs('ghp_secret');
    expect(args[0]).toBe('-c');
    expect(args[1]).toBe(`http.extraHeader=Authorization: Basic ${Buffer.from('x-access-token:ghp_secret').toString('base64')}`);
    expect(args.join(' ')).not.toContain('ghp_secret');
  });

  it('disables prompts and lfs downloads', () => {
    const env = gitEnv();
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_LFS_SKIP_SMUDGE).toBe('1');
  });
});
```

`server/test/unit/resolve-ref.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { ExecError, type Exec } from '../../src/github/exec.js';
import { parseGitHubUrl } from '../../src/github/parse-url.js';
import {
  createGitRefResolver,
  GitUnavailableError,
  parseLsRemote,
  pickResolved,
  RefNotFoundError,
  RepoNotFoundError,
} from '../../src/github/resolve-ref.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function fakeExec(stdout: string): Exec & { mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(async () => ({ stdout, stderr: '' }));
  return Object.assign(mock as unknown as Exec, { mock });
}

describe('parseLsRemote', () => {
  it('reads symrefs and sha lines', () => {
    const out = `ref: refs/heads/main\tHEAD\n${SHA_A}\tHEAD\n`;
    expect(parseLsRemote(out)).toEqual({ symref: 'refs/heads/main', lines: [{ sha: SHA_A, ref: 'HEAD' }] });
  });
});

describe('pickResolved', () => {
  it('prefers the peeled tag, then the tag, then the branch', () => {
    const parsed = parseGitHubUrl('https://github.com/o/r', 'v1');
    const out = `${SHA_A}\trefs/heads/v1\n${SHA_B}\trefs/tags/v1\n${'c'.repeat(40)}\trefs/tags/v1^{}\n`;
    expect(pickResolved(parsed, out)).toEqual({ commitSha: 'c'.repeat(40), refResolved: 'refs/tags/v1' });
    const branchOnly = `${SHA_A}\trefs/heads/v1\n`;
    expect(pickResolved(parsed, branchOnly)).toEqual({ commitSha: SHA_A, refResolved: 'refs/heads/v1' });
  });

  it('resolves the default branch from HEAD', () => {
    const parsed = parseGitHubUrl('https://github.com/o/r');
    const out = `ref: refs/heads/main\tHEAD\n${SHA_A}\tHEAD\n`;
    expect(pickResolved(parsed, out)).toEqual({ commitSha: SHA_A, refResolved: 'refs/heads/main' });
  });
});

describe('createGitRefResolver', () => {
  it('calls git ls-remote with --symref for the default branch', async () => {
    const exec = fakeExec(`ref: refs/heads/main\tHEAD\n${SHA_A}\tHEAD\n`);
    const resolver = createGitRefResolver({ exec });
    const result = await resolver.resolve(parseGitHubUrl('https://github.com/o/r'));
    expect(result).toEqual({ commitSha: SHA_A, refResolved: 'refs/heads/main' });
    const [cmd, args, opts] = exec.mock.mock.calls[0]!;
    expect(cmd).toBe('git');
    expect(args).toEqual(['ls-remote', '--symref', 'https://github.com/o/r', 'HEAD']);
    expect(opts.timeoutMs).toBe(10_000);
    expect(opts.env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('asks for both heads and tags for a named ref and adds the auth header', async () => {
    const exec = fakeExec(`${SHA_A}\trefs/heads/dev\n`);
    const resolver = createGitRefResolver({ exec, token: 'tok' });
    await resolver.resolve(parseGitHubUrl('https://github.com/o/r', 'dev'));
    const args = exec.mock.mock.calls[0]![1] as string[];
    expect(args.slice(0, 2)).toEqual(['-c', expect.stringContaining('http.extraHeader=Authorization: Basic ')]);
    expect(args.slice(2)).toEqual(['ls-remote', 'https://github.com/o/r', 'refs/heads/dev', 'refs/tags/dev']);
  });

  it('asks for the pull request head ref', async () => {
    const exec = fakeExec(`${SHA_A}\trefs/pull/7/head\n`);
    const result = await createGitRefResolver({ exec }).resolve(parseGitHubUrl('https://github.com/o/r/pull/7'));
    expect(result).toEqual({ commitSha: SHA_A, refResolved: 'refs/pull/7/head' });
    expect(exec.mock.mock.calls[0]![1]).toEqual(['ls-remote', 'https://github.com/o/r', 'refs/pull/7/head']);
  });

  it('returns a sha without calling git', async () => {
    const exec = fakeExec('');
    const result = await createGitRefResolver({ exec }).resolve(parseGitHubUrl('https://github.com/o/r', 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'));
    expect(result).toEqual({ commitSha: 'abcdef0123456789abcdef0123456789abcdef01', refResolved: 'abcdef0123456789abcdef0123456789abcdef01' });
    expect(exec.mock).not.toHaveBeenCalled();
  });

  it('maps git failures to typed errors without leaking the token', async () => {
    const failing = (stderr: string, timedOut = false): Exec => async () => {
      throw new ExecError('git', 128, stderr, timedOut);
    };
    const parsed = parseGitHubUrl('https://github.com/o/r');
    await expect(createGitRefResolver({ exec: failing('remote: Repository not found.'), token: 'tok' }).resolve(parsed)).rejects.toBeInstanceOf(RepoNotFoundError);
    await expect(createGitRefResolver({ exec: failing('fatal: could not read Username for https://github.com') }).resolve(parsed)).rejects.toBeInstanceOf(RepoNotFoundError);
    await expect(createGitRefResolver({ exec: failing('', true) }).resolve(parsed)).rejects.toBeInstanceOf(GitUnavailableError);
    await expect(createGitRefResolver({ exec: failing('fatal: unable to access: Could not resolve host') }).resolve(parsed)).rejects.toBeInstanceOf(GitUnavailableError);
    await expect(createGitRefResolver({ exec: failing('weird'), token: 'tok' }).resolve(parsed)).rejects.toThrow(/git failed: weird/);
    await expect(createGitRefResolver({ exec: failing('weird'), token: 'tok' }).resolve(parsed)).rejects.not.toThrow(/tok/);
  });

  it('reports a missing ref', async () => {
    const exec = fakeExec('');
    await expect(createGitRefResolver({ exec }).resolve(parseGitHubUrl('https://github.com/o/r', 'nope'))).rejects.toBeInstanceOf(RefNotFoundError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w server -- git-auth resolve-ref`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the modules**

`server/src/github/exec.ts`:
```ts
import { execFile } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
}

export type Exec = (cmd: string, args: string[], opts: ExecOptions) => Promise<ExecResult>;

export class ExecError extends Error {
  constructor(
    public readonly cmd: string,
    public readonly code: number | null,
    public readonly stderr: string,
    public readonly timedOut: boolean,
  ) {
    super(timedOut ? `${cmd} timed out` : `${cmd} exited with code ${code ?? 'unknown'}`);
    this.name = 'ExecError';
  }
}

export const realExec: Exec = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, env: opts.env, signal: opts.signal, timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
          const timedOut = e.killed === true || e.name === 'AbortError' || opts.signal?.aborted === true;
          const code = typeof e.code === 'number' ? e.code : null;
          reject(new ExecError(cmd, code, String(stderr ?? ''), timedOut));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
```

`server/src/github/git-auth.ts`:
```ts
export function gitAuthArgs(token: string | undefined): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.extraHeader=Authorization: Basic ${basic}`];
}

export function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' };
}
```

`server/src/github/resolve-ref.ts`:
```ts
import { ExecError, type Exec } from './exec.js';
import { gitAuthArgs, gitEnv } from './git-auth.js';
import type { ParsedRepo } from './parse-url.js';

export interface ResolvedRef {
  commitSha: string;
  refResolved: string;
}

export class RepoNotFoundError extends Error {
  override name = 'RepoNotFoundError';
}
export class RefNotFoundError extends Error {
  override name = 'RefNotFoundError';
}
export class GitUnavailableError extends Error {
  override name = 'GitUnavailableError';
}

export interface RefResolver {
  resolve(repo: ParsedRepo): Promise<ResolvedRef>;
}

export interface LsRemoteLine {
  sha: string;
  ref: string;
}

export function parseLsRemote(output: string): { symref: string | null; lines: LsRemoteLine[] } {
  let symref: string | null = null;
  const lines: LsRemoteLine[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const sym = /^ref:\s+(\S+)\s+HEAD$/.exec(line);
    if (sym) {
      symref = sym[1]!;
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length >= 2 && /^[0-9a-f]{40}$/.test(parts[0]!)) lines.push({ sha: parts[0]!, ref: parts[1]! });
  }
  return { symref, lines };
}

export function pickResolved(parsed: ParsedRepo, output: string): ResolvedRef | null {
  const { symref, lines } = parseLsRemote(output);
  const find = (ref: string) => lines.find((l) => l.ref === ref);
  if (parsed.refKind === 'default') {
    const head = find('HEAD');
    return head ? { commitSha: head.sha, refResolved: symref ?? 'HEAD' } : null;
  }
  if (parsed.refKind === 'pull') {
    const line = find(parsed.ref!);
    return line ? { commitSha: line.sha, refResolved: line.ref } : null;
  }
  const name = parsed.ref!;
  for (const candidate of [`refs/tags/${name}^{}`, `refs/tags/${name}`, `refs/heads/${name}`]) {
    const line = find(candidate);
    if (line) return { commitSha: line.sha, refResolved: candidate.replace(/\^\{\}$/, '') };
  }
  return null;
}

export const REPO_NOT_FOUND_MESSAGE = 'Repository not found or private. Set GITHUB_TOKEN to scan private repositories.';

export function mapGitError(err: unknown): Error {
  if (!(err instanceof ExecError)) return err instanceof Error ? err : new Error(String(err));
  const text = err.stderr;
  if (/not found|could not read Username|Authentication failed|Permission denied|403/i.test(text)) {
    return new RepoNotFoundError(REPO_NOT_FOUND_MESSAGE);
  }
  if (err.timedOut) return new GitUnavailableError('GitHub did not respond in time. Try again in a moment.');
  if (/Could not resolve host|unable to access|Connection timed out|Failed to connect|Connection refused/i.test(text)) {
    return new GitUnavailableError('Could not reach GitHub. Check network access and try again.');
  }
  return new GitUnavailableError(`git failed: ${text.split('\n')[0] || 'unknown error'}`);
}

export function createGitRefResolver(opts: { exec: Exec; token?: string | undefined; timeoutMs?: number }): RefResolver {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return {
    async resolve(parsed) {
      if (parsed.refKind === 'sha') {
        const sha = parsed.ref!.toLowerCase();
        return { commitSha: sha, refResolved: sha };
      }
      const args = [...gitAuthArgs(opts.token), 'ls-remote'];
      if (parsed.refKind === 'default') args.push('--symref', parsed.repoUrl, 'HEAD');
      else if (parsed.refKind === 'pull') args.push(parsed.repoUrl, parsed.ref!);
      else args.push(parsed.repoUrl, `refs/heads/${parsed.ref}`, `refs/tags/${parsed.ref}`);

      let stdout: string;
      try {
        ({ stdout } = await opts.exec('git', args, { env: gitEnv(), timeoutMs }));
      } catch (err) {
        throw mapGitError(err);
      }
      const resolved = pickResolved(parsed, stdout);
      if (!resolved) {
        throw new RefNotFoundError(
          parsed.refKind === 'default' ? 'The repository has no default branch.' : `Branch, tag or pull request "${parsed.ref}" was not found.`,
        );
      }
      return resolved;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w server -- git-auth resolve-ref`
Expected: all pass.

- [ ] **Step 5: Try it against GitHub once**

Run: `node -e "import('./server/node_modules/tsx/dist/esm/index.mjs')" 2>/dev/null; cd server && npx tsx -e "import { realExec } from './src/github/exec.ts'; import { createGitRefResolver } from './src/github/resolve-ref.ts'; import { parseGitHubUrl } from './src/github/parse-url.ts'; console.log(await createGitRefResolver({ exec: realExec }).resolve(parseGitHubUrl('https://github.com/expressjs/express/tree/4.18.2')))"`
Expected: an object with a 40 character `commitSha` and `refResolved: 'refs/tags/4.18.2'`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): resolve branches, tags and pull requests with git ls-remote

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Scan repository (all database queries)

**Files:**
- Create: `server/src/db/scans-repo.ts`
- Test: `server/test/integration/scans-repo.test.ts`

**Interfaces:**
- Produces, all taking a `Queryable` (or `Db` where a transaction is opened):
  - `createScan(q, NewScan): Promise<ScanRow>` with `NewScan { repoOwner, repoName, repoUrl, refRequested, refResolved, commitSha, maxAttempts }`
  - `getScan(q, id)`, `listScans(q, limit)`, `listFindings(q, scanId): Promise<FindingRow[]>` sorted by severity then title, `listEvents(q, scanId)`
  - `findActiveScanByCommit(q, repoUrl, commitSha)`, `findRecentDoneScanByCommit(q, repoUrl, commitSha, since: Date, summarizer: string)`, `findPreviousDoneScan(q, repoUrl, before: Date, excludeId)`
  - `startAttempt(db, scanId, attempt): Promise<ScanRow | undefined>` resets the scan for an attempt
  - `updateProgress(db, scanId, { stage, pct, message })`, `markRetrying(db, scanId, error)`, `markFailed(db, scanId, error)`, `completeScan(db, scanId, ScanCompletion)`
  - `countFindingsBySeverity(q, scanIds): Promise<Map<string, SeverityCounts>>`, `countQueued(q): Promise<number>`
  - `notifyScanUpdate(q, scanId)` runs `pg_notify('scan_updates', scanId)`; every write above calls it inside its transaction.

- [ ] **Step 1: Write the failing test**

`server/test/integration/scans-repo.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  completeScan,
  countFindingsBySeverity,
  countQueued,
  createScan,
  findActiveScanByCommit,
  findPreviousDoneScan,
  findRecentDoneScanByCommit,
  getScan,
  listEvents,
  listFindings,
  listScans,
  markFailed,
  markRetrying,
  startAttempt,
  updateProgress,
} from '../../src/db/scans-repo.js';
import type { Finding } from '../../src/scan/types.js';
import type { Summary } from '../../src/summarize/contract.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

const SHA = 'f'.repeat(40);
const newScan = (over: Partial<Parameters<typeof createScan>[1]> = {}) => ({
  repoOwner: 'o',
  repoName: 'r',
  repoUrl: 'https://github.com/o/r',
  refRequested: null,
  refResolved: 'refs/heads/main',
  commitSha: SHA,
  maxAttempts: 3,
  ...over,
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  fingerprint: 'dep:npm:lodash:GHSA-1',
  category: 'dependency',
  severity: 'high',
  ruleId: 'osv.advisory',
  title: 'Prototype pollution in lodash',
  description: 'desc',
  recommendation: 'Upgrade lodash',
  location: 'lodash@4.17.15 (npm)',
  referenceId: 'GHSA-1',
  referenceUrl: 'https://osv.dev/vulnerability/GHSA-1',
  evidence: null,
  metadata: { package: 'lodash' },
  ...over,
});

const summary: Summary = { riskLevel: 'high', headline: 'h', overview: 'o', topRisks: [], nextActions: [] };

describe.skipIf(!TEST_DATABASE_URL)('scans repository', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await setupTestDb();
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it('creates and finds active scans by commit', async () => {
    const scan = await createScan(t.db, newScan());
    expect(scan.status).toBe('queued');
    expect(await findActiveScanByCommit(t.db, scan.repoUrl, SHA)).toMatchObject({ id: scan.id });
    expect(await findActiveScanByCommit(t.db, scan.repoUrl, 'e'.repeat(40))).toBeUndefined();
    expect(await countQueued(t.db)).toBe(1);
  });

  it('starts an attempt, records progress and events, and notifies', async () => {
    const scan = await createScan(t.db, newScan());
    const started = await startAttempt(t.db, scan.id, 1);
    expect(started).toMatchObject({ status: 'running', stage: 'fetching', attempts: 1 });
    await updateProgress(t.db, scan.id, { stage: 'dependencies', pct: 40, message: 'Checked 10 packages' });
    const after = await getScan(t.db, scan.id);
    expect(after).toMatchObject({ stage: 'dependencies', progressPct: 40, progressMessage: 'Checked 10 packages' });
    const events = await listEvents(t.db, scan.id);
    expect(events.map((e) => e.message)).toEqual(['Scan started', 'Checked 10 packages']);
  });

  it('completes a scan with findings and summary, then a retry resets it', async () => {
    const scan = await createScan(t.db, newScan());
    await startAttempt(t.db, scan.id, 1);
    await completeScan(t.db, scan.id, {
      findings: [finding(), finding({ fingerprint: 'code:x', category: 'code', severity: 'critical', title: 'AWS key' })],
      summary,
      summarizer: 'deterministic',
      summarizerNote: null,
      warnings: [{ code: 'w', message: 'm' }],
      stats: { files: 3 },
      previousScanId: null,
    });
    const done = await getScan(t.db, scan.id);
    expect(done).toMatchObject({ status: 'done', progressPct: 100, summarizer: 'deterministic', warnings: [{ code: 'w', message: 'm' }] });
    expect(done?.finishedAt).toBeInstanceOf(Date);
    const rows = await listFindings(t.db, scan.id);
    expect(rows.map((r) => r.severity)).toEqual(['critical', 'high']);
    const counts = await countFindingsBySeverity(t.db, [scan.id]);
    expect(counts.get(scan.id)).toEqual({ critical: 1, high: 1, medium: 0, low: 0 });

    const again = await startAttempt(t.db, scan.id, 2);
    expect(again).toMatchObject({ status: 'running', attempts: 2, summary: null, warnings: [] });
    expect(await listFindings(t.db, scan.id)).toEqual([]);
  });

  it('marks retrying and failed with events', async () => {
    const scan = await createScan(t.db, newScan());
    await startAttempt(t.db, scan.id, 1);
    await markRetrying(t.db, scan.id, 'boom');
    expect(await getScan(t.db, scan.id)).toMatchObject({ status: 'queued', error: 'boom' });
    await markFailed(t.db, scan.id, 'gave up');
    expect(await getScan(t.db, scan.id)).toMatchObject({ status: 'failed', error: 'gave up' });
    expect((await listEvents(t.db, scan.id)).at(-1)?.stage).toBe('failed');
  });

  it('finds recent done scans inside the window for the same summarizer only', async () => {
    const scan = await createScan(t.db, newScan());
    await startAttempt(t.db, scan.id, 1);
    await completeScan(t.db, scan.id, { findings: [], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: null });
    const since = new Date(Date.now() - 60_000);
    expect(await findRecentDoneScanByCommit(t.db, scan.repoUrl, SHA, since, 'deterministic')).toMatchObject({ id: scan.id });
    expect(await findRecentDoneScanByCommit(t.db, scan.repoUrl, SHA, since, 'claude')).toBeUndefined();
    expect(await findRecentDoneScanByCommit(t.db, scan.repoUrl, SHA, new Date(Date.now() + 1000), 'deterministic')).toBeUndefined();
  });

  it('finds the previous done scan of the same repo and lists recent scans', async () => {
    const first = await createScan(t.db, newScan({ commitSha: '1'.repeat(40) }));
    await startAttempt(t.db, first.id, 1);
    await completeScan(t.db, first.id, { findings: [], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: null });
    const second = await createScan(t.db, newScan({ commitSha: '2'.repeat(40) }));
    const other = await createScan(t.db, newScan({ repoUrl: 'https://github.com/o/other', repoName: 'other' }));
    expect(await findPreviousDoneScan(t.db, second.repoUrl, second.createdAt, second.id)).toMatchObject({ id: first.id });
    expect(await findPreviousDoneScan(t.db, other.repoUrl, other.createdAt, other.id)).toBeUndefined();
    const list = await listScans(t.db, 10);
    expect(list.map((s) => s.id)).toEqual([other.id, second.id, first.id]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -w server -- scans-repo`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `server/src/db/scans-repo.ts`**

```ts
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { compareSeverity, type Finding, type ScanStats, type ScanWarning, type Severity, type Stage } from '../scan/types.js';
import type { Summary } from '../summarize/contract.js';
import type { Db, Queryable } from './client.js';
import { findings, scanEvents, scans, type EventRow, type FindingRow, type ScanRow } from './schema.js';

export interface NewScan {
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  refRequested: string | null;
  refResolved: string | null;
  commitSha: string;
  maxAttempts: number;
}

export interface ProgressUpdate {
  stage: Stage;
  pct: number;
  message: string;
}

export interface ScanCompletion {
  findings: Finding[];
  summary: Summary;
  summarizer: 'claude' | 'deterministic';
  summarizerNote: string | null;
  warnings: ScanWarning[];
  stats: ScanStats;
  previousScanId: string | null;
  commitSha?: string;
}

export type SeverityCounts = Record<Severity, number>;

export async function notifyScanUpdate(q: Queryable, scanId: string): Promise<void> {
  await q.execute(sql`select pg_notify('scan_updates', ${scanId})`);
}

export async function createScan(q: Queryable, input: NewScan): Promise<ScanRow> {
  const [row] = await q.insert(scans).values(input).returning();
  if (!row) throw new Error('insert returned no row');
  return row;
}

export async function getScan(q: Queryable, id: string): Promise<ScanRow | undefined> {
  const rows = await q.select().from(scans).where(eq(scans.id, id)).limit(1);
  return rows[0];
}

export async function listScans(q: Queryable, limit: number): Promise<ScanRow[]> {
  return q.select().from(scans).orderBy(desc(scans.createdAt)).limit(limit);
}

export async function findActiveScanByCommit(q: Queryable, repoUrl: string, commitSha: string): Promise<ScanRow | undefined> {
  const rows = await q
    .select()
    .from(scans)
    .where(and(eq(scans.repoUrl, repoUrl), eq(scans.commitSha, commitSha), inArray(scans.status, ['queued', 'running'])))
    .orderBy(desc(scans.createdAt))
    .limit(1);
  return rows[0];
}

export async function findRecentDoneScanByCommit(
  q: Queryable,
  repoUrl: string,
  commitSha: string,
  since: Date,
  summarizer: string,
): Promise<ScanRow | undefined> {
  const rows = await q
    .select()
    .from(scans)
    .where(
      and(
        eq(scans.repoUrl, repoUrl),
        eq(scans.commitSha, commitSha),
        eq(scans.status, 'done'),
        eq(scans.summarizer, summarizer),
        gte(scans.finishedAt, since),
      ),
    )
    .orderBy(desc(scans.finishedAt))
    .limit(1);
  return rows[0];
}

export async function findPreviousDoneScan(q: Queryable, repoUrl: string, before: Date, excludeId: string): Promise<ScanRow | undefined> {
  const rows = await q
    .select()
    .from(scans)
    .where(and(eq(scans.repoUrl, repoUrl), eq(scans.status, 'done'), lt(scans.createdAt, before), ne(scans.id, excludeId)))
    .orderBy(desc(scans.createdAt))
    .limit(1);
  return rows[0];
}

export async function startAttempt(db: Db, scanId: string, attempt: number): Promise<ScanRow | undefined> {
  return db.transaction(async (tx) => {
    await tx.delete(findings).where(eq(findings.scanId, scanId));
    const [row] = await tx
      .update(scans)
      .set({
        status: 'running',
        stage: 'fetching',
        progressPct: 0,
        progressMessage: 'Starting scan',
        attempts: attempt,
        error: null,
        summary: null,
        summarizer: null,
        summarizerNote: null,
        warnings: [],
        stats: {},
        previousScanId: null,
        startedAt: new Date(),
        finishedAt: null,
      })
      .where(eq(scans.id, scanId))
      .returning();
    if (!row) return undefined;
    await tx.insert(scanEvents).values({ scanId, stage: 'fetching', message: attempt > 1 ? `Attempt ${attempt} started` : 'Scan started' });
    await notifyScanUpdate(tx, scanId);
    return row;
  });
}

export async function updateProgress(db: Db, scanId: string, update: ProgressUpdate): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(scans)
      .set({ stage: update.stage, progressPct: update.pct, progressMessage: update.message })
      .where(eq(scans.id, scanId));
    await tx.insert(scanEvents).values({ scanId, stage: update.stage, message: update.message });
    await notifyScanUpdate(tx, scanId);
  });
}

export async function markRetrying(db: Db, scanId: string, error: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(scans)
      .set({ status: 'queued', stage: null, error, progressMessage: `Retrying after error: ${error}` })
      .where(eq(scans.id, scanId));
    await tx.insert(scanEvents).values({ scanId, stage: 'retry', message: `Attempt failed: ${error}` });
    await notifyScanUpdate(tx, scanId);
  });
}

export async function markFailed(db: Db, scanId: string, error: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(scans)
      .set({ status: 'failed', stage: null, error, progressMessage: 'Scan failed', finishedAt: new Date() })
      .where(eq(scans.id, scanId));
    await tx.insert(scanEvents).values({ scanId, stage: 'failed', message: error });
    await notifyScanUpdate(tx, scanId);
  });
}

export async function completeScan(db: Db, scanId: string, c: ScanCompletion): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < c.findings.length; i += 500) {
      const chunk = c.findings.slice(i, i + 500).map((f) => ({ ...f, scanId }));
      await tx.insert(findings).values(chunk);
    }
    await tx
      .update(scans)
      .set({
        status: 'done',
        stage: null,
        progressPct: 100,
        progressMessage: 'Scan complete',
        summary: c.summary,
        summarizer: c.summarizer,
        summarizerNote: c.summarizerNote,
        warnings: c.warnings,
        stats: c.stats,
        previousScanId: c.previousScanId,
        finishedAt: new Date(),
        ...(c.commitSha ? { commitSha: c.commitSha } : {}),
      })
      .where(eq(scans.id, scanId));
    await tx.insert(scanEvents).values({ scanId, stage: 'done', message: `Scan complete: ${c.findings.length} findings` });
    await notifyScanUpdate(tx, scanId);
  });
}

export async function listFindings(q: Queryable, scanId: string): Promise<FindingRow[]> {
  const rows = await q.select().from(findings).where(eq(findings.scanId, scanId));
  return rows.sort((a, b) => compareSeverity(a.severity, b.severity) || a.title.localeCompare(b.title));
}

export async function listEvents(q: Queryable, scanId: string): Promise<EventRow[]> {
  return q.select().from(scanEvents).where(eq(scanEvents.scanId, scanId)).orderBy(asc(scanEvents.id));
}

export async function countFindingsBySeverity(q: Queryable, scanIds: string[]): Promise<Map<string, SeverityCounts>> {
  const out = new Map<string, SeverityCounts>();
  if (scanIds.length === 0) return out;
  const rows = await q
    .select({ scanId: findings.scanId, severity: findings.severity, count: sql<number>`count(*)::int` })
    .from(findings)
    .where(inArray(findings.scanId, scanIds))
    .groupBy(findings.scanId, findings.severity);
  for (const r of rows) {
    const counts = out.get(r.scanId) ?? { critical: 0, high: 0, medium: 0, low: 0 };
    counts[r.severity] = r.count;
    out.set(r.scanId, counts);
  }
  return out;
}

export async function countQueued(q: Queryable): Promise<number> {
  const [row] = await q.select({ count: sql<number>`count(*)::int` }).from(scans).where(eq(scans.status, 'queued'));
  return row?.count ?? 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -w server -- scans-repo`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): scan repository with attempts, progress, completion and lookups

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: pg-boss queue

**Files:**
- Create: `server/src/queue/boss.ts`
- Test: `server/test/integration/queue.test.ts`

**Interfaces:**
- Produces: `SCAN_QUEUE = 'scan'`; `ScanJobData { scanId }`; `ScanJob { id, data, retryCount, retryLimit, signal }`; `ScanJobHandler = (job: ScanJob) => Promise<void>`; `SCAN_JOB_OPTIONS`; `MAX_ATTEMPTS = 3`; `createBoss(connectionString, logger, { testSpies? }): Promise<PgBoss>`; `enqueueScan(boss, scanId, overrides?): Promise<string | null>`; `registerScanWorker(boss, concurrency, handler): Promise<string>`.

- [ ] **Step 1: Install pg-boss**

Run: `npm install -w server pg-boss@^12`

- [ ] **Step 2: Write the failing test**

`server/test/integration/queue.test.ts`:
```ts
import type { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBoss, enqueueScan, registerScanWorker, SCAN_QUEUE, type ScanJob } from '../../src/queue/boss.js';
import { TEST_DATABASE_URL } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('queue', () => {
  let boss: PgBoss;
  const seen: Array<{ scanId: string; retryCount: number; retryLimit: number }> = [];
  let flakyFailures = 0;

  beforeAll(async () => {
    boss = await createBoss(TEST_DATABASE_URL!, pino({ level: 'silent' }), { testSpies: true });
    await registerScanWorker(boss, 1, async (job: ScanJob) => {
      seen.push({ scanId: job.data.scanId, retryCount: job.retryCount, retryLimit: job.retryLimit });
      if (job.data.scanId === 'flaky' && flakyFailures === 0) {
        flakyFailures += 1;
        throw new Error('first attempt fails');
      }
    });
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, timeout: 5_000 });
  });

  it('runs the handler for a sent job with the job id as the handle', async () => {
    const id = await enqueueScan(boss, 'scan-1');
    expect(id).toBeTruthy();
    const job = await boss.getSpy(SCAN_QUEUE).waitForJobWithId(id!, 'completed');
    expect(job.data).toEqual({ scanId: 'scan-1' });
    expect(seen).toContainEqual({ scanId: 'scan-1', retryCount: 0, retryLimit: 2 });
  });

  it('retries a failing handler and exposes the attempt number', async () => {
    const id = await enqueueScan(boss, 'flaky', { retryDelay: 1, retryBackoff: false });
    await boss.getSpy(SCAN_QUEUE).waitForJobWithId(id!, 'completed');
    const attempts = seen.filter((s) => s.scanId === 'flaky').map((s) => s.retryCount);
    expect(attempts).toEqual([0, 1]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:integration -w server -- queue`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `server/src/queue/boss.ts`**

```ts
import { PgBoss } from 'pg-boss';
import type { Logger } from '../logger.js';

export const SCAN_QUEUE = 'scan';

export interface ScanJobData {
  scanId: string;
}

export interface ScanJob {
  id: string;
  data: ScanJobData;
  retryCount: number;
  retryLimit: number;
  signal: AbortSignal;
}

export type ScanJobHandler = (job: ScanJob) => Promise<void>;

export const SCAN_JOB_OPTIONS = { retryLimit: 2, retryDelay: 2, retryBackoff: true, expireInSeconds: 600 } as const;
export const MAX_ATTEMPTS = SCAN_JOB_OPTIONS.retryLimit + 1;

export interface BossOptions {
  testSpies?: boolean;
}

export async function createBoss(connectionString: string, logger: Logger, opts: BossOptions = {}): Promise<PgBoss> {
  const options = {
    connectionString,
    max: 5,
    useListenNotify: true,
    ...(opts.testSpies ? { __test__enableSpies: true } : {}),
  } as ConstructorParameters<typeof PgBoss>[0];
  const boss = new PgBoss(options);
  boss.on('error', (err: unknown) => logger.error({ err }, 'pg-boss error'));
  boss.on('warning', (warning: unknown) => logger.warn({ warning }, 'pg-boss warning'));
  await boss.start();
  if (!(await boss.getQueue(SCAN_QUEUE))) {
    await boss.createQueue(SCAN_QUEUE, { ...SCAN_JOB_OPTIONS, notify: true });
  }
  return boss;
}

export interface EnqueueOverrides {
  retryDelay?: number;
  retryBackoff?: boolean;
}

export async function enqueueScan(boss: PgBoss, scanId: string, overrides: EnqueueOverrides = {}): Promise<string | null> {
  return boss.send(SCAN_QUEUE, { scanId }, overrides);
}

export async function registerScanWorker(boss: PgBoss, concurrency: number, handler: ScanJobHandler): Promise<string> {
  return boss.work<ScanJobData>(
    SCAN_QUEUE,
    { localConcurrency: concurrency, includeMetadata: true, pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) await handler(job as unknown as ScanJob);
    },
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:integration -w server -- queue`
Expected: 2 tests pass (the second takes a few seconds for the retry delay).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): pg-boss scan queue with retries and worker registration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Scan API routes and read model

**Files:**
- Create: `server/src/api/read-model.ts`, `server/src/api/routes/scans.ts`
- Test: `server/test/integration/scan-routes.test.ts`

**Interfaces:**
- Produces: `loadScanView(q, id): Promise<ScanView | undefined>`; `ScanView` (all scan columns with ISO date strings, `events: { stage, message, createdAt }[]`, `findings: Finding[] | null` when done, `comparison: Comparison | null`); `Comparison { previousScanId, previousSha, sameCommit, new, fixed, stillOpen }`; `toFinding(row: FindingRow): Finding`; `listScanItems(q, limit): Promise<ScanListItem[]>` with `ScanListItem { id, repoOwner, repoName, repoUrl, commitSha, refResolved, status, riskLevel, counts, summarizer, createdAt, finishedAt }`; `registerScanRoutes(app, { db, resolver, enqueue, freshnessMinutes, summarizerMode, maxAttempts })`; `ReusedReason = 'in_progress' | 'recent' | null`; `CreateScanResponse = ScanView & { reused }`.
- Routes: `POST /api/scans`, `GET /api/scans/:id`, `GET /api/scans?limit=`.

- [ ] **Step 1: Write the failing test**

`server/test/integration/scan-routes.test.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { registerScanRoutes } from '../../src/api/routes/scans.js';
import { completeScan, startAttempt } from '../../src/db/scans-repo.js';
import type { ParsedRepo } from '../../src/github/parse-url.js';
import { RefNotFoundError, RepoNotFoundError, type RefResolver } from '../../src/github/resolve-ref.js';
import type { Summary } from '../../src/summarize/contract.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

const SHA_MAIN = '1'.repeat(40);
const SHA_V1 = '2'.repeat(40);
const summary: Summary = { riskLevel: 'none', headline: 'h', overview: 'o', topRisks: [], nextActions: [] };

const resolver: RefResolver = {
  async resolve(parsed: ParsedRepo) {
    if (parsed.repo === 'missing') throw new RepoNotFoundError('Repository not found or private.');
    if (parsed.ref === 'nope') throw new RefNotFoundError('Branch "nope" was not found.');
    if (parsed.ref === 'v1') return { commitSha: SHA_V1, refResolved: 'refs/tags/v1' };
    return { commitSha: SHA_MAIN, refResolved: 'refs/heads/main' };
  },
};

describe.skipIf(!TEST_DATABASE_URL)('scan routes', () => {
  let t: TestDb;
  let app: FastifyInstance;
  const enqueued: string[] = [];
  let summarizerMode: 'claude' | 'deterministic' = 'deterministic';

  beforeAll(async () => {
    t = await setupTestDb();
    app = await buildApp({
      logger: pino({ level: 'silent' }),
      webDistDir: null,
      routes: [
        (a) =>
          registerScanRoutes(a, {
            db: t.db,
            resolver,
            enqueue: async (id) => {
              enqueued.push(id);
            },
            freshnessMinutes: 10,
            get summarizerMode() {
              return summarizerMode;
            },
            maxAttempts: 3,
          }),
      ],
    });
    await app.ready();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    enqueued.length = 0;
    summarizerMode = 'deterministic';
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  const post = (body: unknown) => app.inject({ method: 'POST', url: '/api/scans', payload: body });

  it('rejects bad input with specific codes', async () => {
    expect((await post({})).statusCode).toBe(400);
    const bad = await post({ repoUrl: 'https://gitlab.com/a/b' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_repo_url');
    const missing = await post({ repoUrl: 'https://github.com/a/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('repo_not_found');
    const ref = await post({ repoUrl: 'https://github.com/a/b', ref: 'nope' });
    expect(ref.statusCode).toBe(400);
    expect(ref.json().error.code).toBe('ref_not_found');
    expect(enqueued).toEqual([]);
  });

  it('creates a scan, enqueues it, and returns the view', async () => {
    const res = await post({ repoUrl: 'https://github.com/A/B' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ repoUrl: 'https://github.com/a/b', commitSha: SHA_MAIN, refResolved: 'refs/heads/main', status: 'queued', reused: null, findings: null, comparison: null });
    expect(enqueued).toEqual([body.id]);
    const get = await app.inject({ method: 'GET', url: `/api/scans/${body.id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json().events).toEqual([]);
  });

  it('joins an in-flight scan of the same commit', async () => {
    const first = (await post({ repoUrl: 'https://github.com/a/b' })).json();
    const second = await post({ repoUrl: 'https://github.com/a/b/tree/main' });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ id: first.id, reused: 'in_progress' });
    expect(enqueued).toHaveLength(1);
  });

  it('reuses a recent done scan unless forced or the summarizer differs', async () => {
    const first = (await post({ repoUrl: 'https://github.com/a/b' })).json();
    await startAttempt(t.db, first.id, 1);
    await completeScan(t.db, first.id, { findings: [], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: null });

    const reused = await post({ repoUrl: 'https://github.com/a/b' });
    expect(reused.statusCode).toBe(200);
    expect(reused.json()).toMatchObject({ id: first.id, reused: 'recent', status: 'done' });

    const forced = await post({ repoUrl: 'https://github.com/a/b', force: true });
    expect(forced.statusCode).toBe(201);
    expect(forced.json().id).not.toBe(first.id);

    summarizerMode = 'claude';
    const other = await post({ repoUrl: 'https://github.com/a/b', ref: 'v1' });
    expect(other.statusCode).toBe(201);
  });

  it('returns 404 for unknown or malformed ids and lists scans with counts', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/scans/not-a-uuid' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/scans/00000000-0000-0000-0000-000000000000' })).statusCode).toBe(404);
    const created = (await post({ repoUrl: 'https://github.com/a/b' })).json();
    const list = await app.inject({ method: 'GET', url: '/api/scans?limit=5' });
    expect(list.statusCode).toBe(200);
    expect(list.json().scans[0]).toMatchObject({ id: created.id, status: 'queued', riskLevel: null, counts: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -w server -- scan-routes`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `server/src/api/read-model.ts`**

```ts
import type { Queryable } from '../db/client.js';
import { countFindingsBySeverity, getScan, listEvents, listFindings, listScans, type SeverityCounts } from '../db/scans-repo.js';
import type { FindingRow, ScanRow } from '../db/schema.js';
import type { Finding, ScanStats, ScanWarning } from '../scan/types.js';
import type { RiskLevel, Summary } from '../summarize/contract.js';

export interface ScanEventView {
  stage: string;
  message: string;
  createdAt: string;
}

export interface Comparison {
  previousScanId: string;
  previousSha: string;
  sameCommit: boolean;
  new: Finding[];
  fixed: Finding[];
  stillOpen: Finding[];
}

export interface ScanView {
  id: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  refRequested: string | null;
  refResolved: string | null;
  commitSha: string;
  status: ScanRow['status'];
  stage: string | null;
  progressPct: number;
  progressMessage: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  warnings: ScanWarning[];
  summary: Summary | null;
  summarizer: string | null;
  summarizerNote: string | null;
  stats: ScanStats;
  previousScanId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  events: ScanEventView[];
  findings: Finding[] | null;
  comparison: Comparison | null;
}

export interface ScanListItem {
  id: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  commitSha: string;
  refResolved: string | null;
  status: ScanRow['status'];
  riskLevel: RiskLevel | null;
  counts: SeverityCounts | null;
  summarizer: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function toFinding(row: FindingRow): Finding {
  const { id: _id, scanId: _scanId, ...rest } = row;
  return rest;
}

export async function loadScanView(q: Queryable, id: string): Promise<ScanView | undefined> {
  const scan = await getScan(q, id);
  if (!scan) return undefined;
  const events = await listEvents(q, id);
  const findingsList = scan.status === 'done' ? (await listFindings(q, id)).map(toFinding) : null;
  return {
    id: scan.id,
    repoOwner: scan.repoOwner,
    repoName: scan.repoName,
    repoUrl: scan.repoUrl,
    refRequested: scan.refRequested,
    refResolved: scan.refResolved,
    commitSha: scan.commitSha,
    status: scan.status,
    stage: scan.stage,
    progressPct: scan.progressPct,
    progressMessage: scan.progressMessage,
    attempts: scan.attempts,
    maxAttempts: scan.maxAttempts,
    error: scan.error,
    warnings: scan.warnings,
    summary: scan.summary,
    summarizer: scan.summarizer,
    summarizerNote: scan.summarizerNote,
    stats: scan.stats,
    previousScanId: scan.previousScanId,
    createdAt: scan.createdAt.toISOString(),
    startedAt: scan.startedAt?.toISOString() ?? null,
    finishedAt: scan.finishedAt?.toISOString() ?? null,
    events: events.map((e) => ({ stage: e.stage, message: e.message, createdAt: e.createdAt.toISOString() })),
    findings: findingsList,
    comparison: null,
  };
}

export async function listScanItems(q: Queryable, limit: number): Promise<ScanListItem[]> {
  const rows = await listScans(q, limit);
  const counts = await countFindingsBySeverity(
    q,
    rows.filter((r) => r.status === 'done').map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    repoOwner: r.repoOwner,
    repoName: r.repoName,
    repoUrl: r.repoUrl,
    commitSha: r.commitSha,
    refResolved: r.refResolved,
    status: r.status,
    riskLevel: r.summary?.riskLevel ?? null,
    counts: r.status === 'done' ? (counts.get(r.id) ?? { critical: 0, high: 0, medium: 0, low: 0 }) : null,
    summarizer: r.summarizer,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));
}
```

`comparison` stays `null` here; Task 22 replaces that line with the real loader.

- [ ] **Step 4: Write `server/src/api/routes/scans.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SummarizerMode } from '../../config.js';
import type { Queryable } from '../../db/client.js';
import { createScan, findActiveScanByCommit, findRecentDoneScanByCommit } from '../../db/scans-repo.js';
import { InvalidRepoUrlError, parseGitHubUrl, type ParsedRepo } from '../../github/parse-url.js';
import { GitUnavailableError, RefNotFoundError, RepoNotFoundError, type RefResolver, type ResolvedRef } from '../../github/resolve-ref.js';
import { HttpError } from '../errors.js';
import { listScanItems, loadScanView, type ScanView } from '../read-model.js';

export interface ScanRouteDeps {
  db: Queryable;
  resolver: RefResolver;
  enqueue: (scanId: string) => Promise<void>;
  freshnessMinutes: number;
  readonly summarizerMode: SummarizerMode;
  maxAttempts: number;
}

export type ReusedReason = 'in_progress' | 'recent' | null;
export type CreateScanResponse = ScanView & { reused: ReusedReason };

const CreateScanBody = z.object({
  repoUrl: z.string().min(1).max(500),
  ref: z.string().max(200).optional(),
  force: z.boolean().optional(),
});

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

const NOT_FOUND = () => new HttpError(404, 'scan_not_found', 'No scan with that id.');

export function registerScanRoutes(app: FastifyInstance, deps: ScanRouteDeps): void {
  async function respond(id: string, reused: ReusedReason): Promise<CreateScanResponse> {
    const view = await loadScanView(deps.db, id);
    if (!view) throw new HttpError(500, 'internal_error', 'The scan could not be loaded after it was created.');
    return { ...view, reused };
  }

  app.post('/api/scans', async (req, reply) => {
    const body = CreateScanBody.safeParse(req.body);
    if (!body.success) {
      throw new HttpError(400, 'invalid_body', 'Send a JSON body with a repoUrl string and optional ref and force fields.');
    }

    let parsed: ParsedRepo;
    try {
      parsed = parseGitHubUrl(body.data.repoUrl, body.data.ref ?? null);
    } catch (err) {
      if (err instanceof InvalidRepoUrlError) throw new HttpError(400, 'invalid_repo_url', err.message);
      throw err;
    }

    let resolved: ResolvedRef;
    try {
      resolved = await deps.resolver.resolve(parsed);
    } catch (err) {
      if (err instanceof RepoNotFoundError) throw new HttpError(404, 'repo_not_found', err.message);
      if (err instanceof RefNotFoundError) throw new HttpError(400, 'ref_not_found', err.message);
      if (err instanceof GitUnavailableError) throw new HttpError(502, 'github_unavailable', err.message);
      throw err;
    }

    const active = await findActiveScanByCommit(deps.db, parsed.repoUrl, resolved.commitSha);
    if (active) return reply.code(200).send(await respond(active.id, 'in_progress'));

    if (!body.data.force && deps.freshnessMinutes > 0) {
      const since = new Date(Date.now() - deps.freshnessMinutes * 60_000);
      const recent = await findRecentDoneScanByCommit(deps.db, parsed.repoUrl, resolved.commitSha, since, deps.summarizerMode);
      if (recent) return reply.code(200).send(await respond(recent.id, 'recent'));
    }

    const scan = await createScan(deps.db, {
      repoOwner: parsed.owner,
      repoName: parsed.repo,
      repoUrl: parsed.repoUrl,
      refRequested: parsed.ref,
      refResolved: resolved.refResolved,
      commitSha: resolved.commitSha,
      maxAttempts: deps.maxAttempts,
    });
    await deps.enqueue(scan.id);
    req.log.info({ scanId: scan.id, repoUrl: scan.repoUrl, commitSha: scan.commitSha }, 'scan queued');
    return reply.code(201).send(await respond(scan.id, null));
  });

  app.get('/api/scans/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!z.uuid().safeParse(id).success) throw NOT_FOUND();
    const view = await loadScanView(deps.db, id);
    if (!view) throw NOT_FOUND();
    return view;
  });

  app.get('/api/scans', async (req) => {
    const query = ListQuery.safeParse(req.query);
    const limit = query.success ? query.data.limit : 50;
    return { scans: await listScanItems(deps.db, limit) };
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:integration -w server -- scan-routes`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): create, read and list scans with commit dedupe and freshness window

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Real-time stream with LISTEN/NOTIFY and SSE

**Files:**
- Create: `server/src/api/notifier.ts`, `server/src/api/routes/stream.ts`
- Create: `server/test/integration/sse.ts` (helper)
- Test: `server/test/integration/stream.test.ts`

**Interfaces:**
- Produces: `createScanNotifier(connectionString, logger): ScanNotifier` with `start()`, `stop()`, `subscribe(scanId, cb): () => void`, `connected: boolean`; `registerStreamRoute(app, { db, notifier, pollMs?, heartbeatMs? })` serving `GET /api/scans/:id/stream`.
- SSE events: `snapshot` (on connect), `progress`, then `done` or `failed`, then the connection closes. Comment lines `: ping` every `heartbeatMs`.

- [ ] **Step 1: Write the SSE test helper**

`server/test/integration/sse.ts`:
```ts
export interface SseEvent {
  event: string;
  data: unknown;
}

export async function readSse(url: string, opts: { until?: (events: SseEvent[]) => boolean; timeoutMs?: number } = {}): Promise<SseEvent[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  const events: SseEvent[] = [];
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`stream returned ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (chunk.startsWith(':')) continue;
        const event = /^event: (.*)$/m.exec(chunk)?.[1];
        const data = /^data: (.*)$/m.exec(chunk)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
      if (opts.until?.(events)) {
        controller.abort();
        break;
      }
    }
  } catch (err) {
    if (!(err instanceof Error && err.name === 'AbortError')) throw err;
  } finally {
    clearTimeout(timeout);
  }
  return events;
}
```

- [ ] **Step 2: Write the failing test**

`server/test/integration/stream.test.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { createScanNotifier, type ScanNotifier } from '../../src/api/notifier.js';
import { registerStreamRoute } from '../../src/api/routes/stream.js';
import { completeScan, createScan, markFailed, startAttempt, updateProgress } from '../../src/db/scans-repo.js';
import type { Summary } from '../../src/summarize/contract.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';
import { readSse, type SseEvent } from './sse.js';

const summary: Summary = { riskLevel: 'none', headline: 'h', overview: 'o', topRisks: [], nextActions: [] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!TEST_DATABASE_URL)('scan stream', () => {
  let t: TestDb;
  let app: FastifyInstance;
  let notifier: ScanNotifier;
  let baseUrl: string;

  beforeAll(async () => {
    t = await setupTestDb();
    notifier = createScanNotifier(TEST_DATABASE_URL!, pino({ level: 'silent' }));
    await notifier.start();
    app = await buildApp({
      logger: pino({ level: 'silent' }),
      webDistDir: null,
      routes: [(a) => registerStreamRoute(a, { db: t.db, notifier, pollMs: 300, heartbeatMs: 200 })],
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });
  afterAll(async () => {
    await app.close();
    await notifier.stop();
    await t.close();
  });

  const newScan = () =>
    createScan(t.db, { repoOwner: 'o', repoName: 'r', repoUrl: 'https://github.com/o/r', refRequested: null, refResolved: 'refs/heads/main', commitSha: 'a'.repeat(40), maxAttempts: 3 });

  it('streams snapshot, progress and done, then closes', async () => {
    const scan = await newScan();
    const reading = readSse(`${baseUrl}/api/scans/${scan.id}/stream`);
    await sleep(150);
    await startAttempt(t.db, scan.id, 1);
    await sleep(50);
    await updateProgress(t.db, scan.id, { stage: 'code', pct: 70, message: 'Scanning code' });
    await sleep(50);
    await completeScan(t.db, scan.id, { findings: [], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: null });
    const events: SseEvent[] = await reading;
    expect(events[0]?.event).toBe('snapshot');
    expect(events.some((e) => e.event === 'progress' && (e.data as { progressMessage: string }).progressMessage === 'Scanning code')).toBe(true);
    expect(events.at(-1)?.event).toBe('done');
    expect((events.at(-1)?.data as { findings: unknown[] }).findings).toEqual([]);
  });

  it('sends snapshot and the terminal event for an already finished scan', async () => {
    const scan = await newScan();
    await startAttempt(t.db, scan.id, 1);
    await markFailed(t.db, scan.id, 'boom');
    const events = await readSse(`${baseUrl}/api/scans/${scan.id}/stream`);
    expect(events.map((e) => e.event)).toEqual(['snapshot', 'failed']);
    expect((events[1]?.data as { error: string }).error).toBe('boom');
  });

  it('falls back to polling when notifications are unavailable', async () => {
    await notifier.stop();
    try {
      const scan = await newScan();
      const reading = readSse(`${baseUrl}/api/scans/${scan.id}/stream`, { until: (ev) => ev.some((e) => e.event === 'progress') });
      await sleep(100);
      await startAttempt(t.db, scan.id, 1);
      const events = await reading;
      expect(events.some((e) => e.event === 'progress')).toBe(true);
    } finally {
      await notifier.start();
    }
  });

  it('returns 404 for an unknown scan', async () => {
    const res = await fetch(`${baseUrl}/api/scans/00000000-0000-0000-0000-000000000000/stream`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:integration -w server -- stream`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write `server/src/api/notifier.ts`**

```ts
import pg from 'pg';
import type { Logger } from '../logger.js';

export interface ScanNotifier {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(scanId: string, cb: () => void): () => void;
  readonly connected: boolean;
}

export function createScanNotifier(connectionString: string, logger: Logger): ScanNotifier {
  const subscribers = new Map<string, Set<() => void>>();
  let client: pg.Client | null = null;
  let connected = false;
  let stopped = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 1000;

  function dispatch(scanId: string): void {
    for (const cb of subscribers.get(scanId) ?? []) {
      try {
        cb();
      } catch (err) {
        logger.warn({ err, scanId }, 'notifier subscriber threw');
      }
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    connected = false;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, 30_000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
    reconnectTimer.unref();
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    const next = new pg.Client({ connectionString });
    next.on('notification', (msg) => {
      if (msg.channel === 'scan_updates' && msg.payload) dispatch(msg.payload);
    });
    next.on('error', (err) => {
      logger.warn({ err }, 'notifier connection error');
      if (client === next) client = null;
      scheduleReconnect();
    });
    next.on('end', () => {
      if (client === next) client = null;
      scheduleReconnect();
    });
    try {
      await next.connect();
      await next.query('LISTEN scan_updates');
      client = next;
      connected = true;
      backoffMs = 1000;
      logger.info('listening for scan updates');
    } catch (err) {
      logger.warn({ err }, 'notifier could not connect');
      scheduleReconnect();
    }
  }

  return {
    get connected() {
      return connected;
    },
    async start() {
      stopped = false;
      await connect();
    },
    async stop() {
      stopped = true;
      connected = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const current = client;
      client = null;
      if (current) await current.end().catch(() => undefined);
    },
    subscribe(scanId, cb) {
      let set = subscribers.get(scanId);
      if (!set) {
        set = new Set();
        subscribers.set(scanId, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
        if (set.size === 0) subscribers.delete(scanId);
      };
    },
  };
}
```

- [ ] **Step 5: Write `server/src/api/routes/stream.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Queryable } from '../../db/client.js';
import { HttpError } from '../errors.js';
import type { ScanNotifier } from '../notifier.js';
import { loadScanView, type ScanView } from '../read-model.js';

export interface StreamDeps {
  db: Queryable;
  notifier: ScanNotifier;
  pollMs?: number;
  heartbeatMs?: number;
}

const isTerminal = (view: ScanView): boolean => view.status === 'done' || view.status === 'failed';

export function registerStreamRoute(app: FastifyInstance, deps: StreamDeps): void {
  const pollMs = deps.pollMs ?? 2000;
  const heartbeatMs = deps.heartbeatMs ?? 15_000;
  const openStreams = new Set<(final?: string) => void>();
  app.addHook('onClose', async () => {
    for (const close of openStreams) close('closing');
  });

  app.get('/api/scans/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const initial = z.uuid().safeParse(id).success ? await loadScanView(deps.db, id) : undefined;
    if (!initial) throw new HttpError(404, 'scan_not_found', 'No scan with that id.');

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    let closed = false;
    let lastPayload = '';
    let chain: Promise<void> = Promise.resolve();

    const write = (event: string, data: unknown): void => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const unsubscribe = deps.notifier.subscribe(id, () => push());
    const poll = setInterval(() => push(), pollMs);
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, heartbeatMs);

    function close(final?: string): void {
      if (closed) return;
      closed = true;
      openStreams.delete(close);
      unsubscribe();
      clearInterval(poll);
      clearInterval(heartbeat);
      if (final) res.write(`: ${final}\n\n`);
      res.end();
    }
    openStreams.add(close);

    function push(snapshot?: ScanView): void {
      chain = chain
        .then(async () => {
          if (closed) return;
          const view = snapshot ?? (await loadScanView(deps.db, id));
          if (!view) {
            close();
            return;
          }
          const payload = JSON.stringify(view);
          if (!snapshot && payload === lastPayload) return;
          lastPayload = payload;
          if (snapshot) write('snapshot', view);
          else if (!isTerminal(view)) write('progress', view);
          if (isTerminal(view)) {
            write(view.status, view);
            close();
          }
        })
        .catch((err: unknown) => {
          req.log.warn({ err, scanId: id }, 'stream push failed');
        });
    }

    req.raw.on('close', () => close());
    push(initial);
  });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:integration -w server -- stream`
Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): server-sent events stream fed by postgres notifications with polling backstop

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Worker job handler with a fake pipeline, end to end in Docker

**Files:**
- Create: `server/src/scan/errors.ts`, `server/src/scan/pipeline.ts`, `server/src/scan/fake-pipeline.ts`, `server/src/scan/run-scan.ts`
- Modify: `server/src/main.ts`
- Test: `server/test/integration/run-scan.test.ts`

**Interfaces:**
- Produces: `NonRetryableScanError`; `Pipeline { run(ctx: PipelineContext): Promise<PipelineResult> }`; `PipelineContext { scan: ScanRow; signal: AbortSignal; log: Logger; progress(stage, pct, message): Promise<void> }`; `PipelineResult { findings, warnings, stats, summary, summarizer, summarizerNote, commitSha? }`; `createFakePipeline({ stepMs? })`; `createScanJobHandler({ db, pipeline, logger }): ScanJobHandler`.
- Handler contract: attempt reset via `startAttempt`; `NonRetryableScanError` marks failed and returns; other errors mark retrying and rethrow, or mark failed and rethrow on the final attempt.

- [ ] **Step 1: Write the failing test**

`server/test/integration/run-scan.test.ts`:
```ts
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createScan, getScan, listEvents, listFindings } from '../../src/db/scans-repo.js';
import type { ScanJob } from '../../src/queue/boss.js';
import { NonRetryableScanError } from '../../src/scan/errors.js';
import { createFakePipeline } from '../../src/scan/fake-pipeline.js';
import type { Pipeline } from '../../src/scan/pipeline.js';
import { createScanJobHandler } from '../../src/scan/run-scan.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

const job = (scanId: string, retryCount = 0): ScanJob => ({ id: 'job-1', data: { scanId }, retryCount, retryLimit: 2, signal: new AbortController().signal });
const logger = pino({ level: 'silent' });

describe.skipIf(!TEST_DATABASE_URL)('scan job handler', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await setupTestDb();
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  const newScan = () =>
    createScan(t.db, { repoOwner: 'o', repoName: 'r', repoUrl: 'https://github.com/o/r', refRequested: null, refResolved: 'refs/heads/main', commitSha: 'a'.repeat(40), maxAttempts: 3 });

  it('walks the stages and completes the scan', async () => {
    const scan = await newScan();
    const handler = createScanJobHandler({ db: t.db, pipeline: createFakePipeline({ stepMs: 5 }), logger });
    await handler(job(scan.id));
    const done = await getScan(t.db, scan.id);
    expect(done).toMatchObject({ status: 'done', attempts: 1, summarizer: 'deterministic', progressPct: 100 });
    expect(done?.summary?.riskLevel).toBe('none');
    expect(done?.stats.totalMs).toBeGreaterThanOrEqual(0);
    const stages = (await listEvents(t.db, scan.id)).map((e) => e.stage);
    expect(stages).toEqual(['fetching', 'fetching', 'dependencies', 'code', 'summarizing', 'persisting', 'done']);
    expect(await listFindings(t.db, scan.id)).toEqual([]);
  });

  it('marks non-retryable errors as failed without throwing', async () => {
    const scan = await newScan();
    const pipeline: Pipeline = { run: async () => { throw new NonRetryableScanError('Commit not found in this repository.'); } };
    await createScanJobHandler({ db: t.db, pipeline, logger })(job(scan.id));
    expect(await getScan(t.db, scan.id)).toMatchObject({ status: 'failed', error: 'Commit not found in this repository.' });
  });

  it('marks retryable errors as queued and rethrows, then failed on the final attempt', async () => {
    const scan = await newScan();
    const pipeline: Pipeline = { run: async () => { throw new Error('OSV timed out'); } };
    const handler = createScanJobHandler({ db: t.db, pipeline, logger });
    await expect(handler(job(scan.id, 0))).rejects.toThrow('OSV timed out');
    expect(await getScan(t.db, scan.id)).toMatchObject({ status: 'queued', error: 'OSV timed out', attempts: 1 });
    await expect(handler(job(scan.id, 2))).rejects.toThrow('OSV timed out');
    expect(await getScan(t.db, scan.id)).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('skips a job whose scan row no longer exists', async () => {
    const handler = createScanJobHandler({ db: t.db, pipeline: createFakePipeline({ stepMs: 5 }), logger });
    await expect(handler(job('00000000-0000-0000-0000-000000000000'))).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -w server -- run-scan`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the scan modules**

`server/src/scan/errors.ts`:
```ts
export class NonRetryableScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableScanError';
  }
}
```

`server/src/scan/pipeline.ts`:
```ts
import type { ScanRow } from '../db/schema.js';
import type { Logger } from '../logger.js';
import type { Summary } from '../summarize/contract.js';
import type { Finding, ScanStats, ScanWarning, Stage } from './types.js';

export interface PipelineContext {
  scan: ScanRow;
  signal: AbortSignal;
  log: Logger;
  progress(stage: Stage, pct: number, message: string): Promise<void>;
}

export interface PipelineResult {
  findings: Finding[];
  warnings: ScanWarning[];
  stats: ScanStats;
  summary: Summary;
  summarizer: 'claude' | 'deterministic';
  summarizerNote: string | null;
  commitSha?: string;
}

export interface Pipeline {
  run(ctx: PipelineContext): Promise<PipelineResult>;
}
```

`server/src/scan/fake-pipeline.ts`:
```ts
import type { Pipeline } from './pipeline.js';
import type { Stage } from './types.js';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Scan aborted'));
      },
      { once: true },
    );
  });
}

export function createFakePipeline(opts: { stepMs?: number } = {}): Pipeline {
  const stepMs = opts.stepMs ?? 800;
  return {
    async run(ctx) {
      const steps: Array<[Stage, number, string]> = [
        ['fetching', 10, `Fetching ${ctx.scan.repoOwner}/${ctx.scan.repoName} at ${ctx.scan.commitSha.slice(0, 7)}`],
        ['dependencies', 40, 'Checking dependencies'],
        ['code', 70, 'Scanning code'],
        ['summarizing', 90, 'Summarizing'],
      ];
      for (const [stage, pct, message] of steps) {
        await ctx.progress(stage, pct, message);
        await sleep(stepMs, ctx.signal);
      }
      return {
        findings: [],
        warnings: [],
        stats: { files: 0, packages: 0 },
        summary: {
          riskLevel: 'none',
          headline: 'Fake scan complete',
          overview: 'This placeholder pipeline walks the stages without scanning anything.',
          topRisks: [],
          nextActions: [],
        },
        summarizer: 'deterministic',
        summarizerNote: 'fake pipeline',
        commitSha: ctx.scan.commitSha,
      };
    },
  };
}
```

`server/src/scan/run-scan.ts`:
```ts
import type { Db } from '../db/client.js';
import { completeScan, findPreviousDoneScan, markFailed, markRetrying, startAttempt, updateProgress } from '../db/scans-repo.js';
import type { Logger } from '../logger.js';
import type { ScanJobHandler } from '../queue/boss.js';
import { NonRetryableScanError } from './errors.js';
import type { Pipeline } from './pipeline.js';

export interface ScanHandlerDeps {
  db: Db;
  pipeline: Pipeline;
  logger: Logger;
}

export function createScanJobHandler(deps: ScanHandlerDeps): ScanJobHandler {
  return async (job) => {
    const { scanId } = job.data;
    const attempt = job.retryCount + 1;
    const log = deps.logger.child({ scanId, jobId: job.id, attempt });

    const scan = await startAttempt(deps.db, scanId, attempt);
    if (!scan) {
      log.warn('scan row missing; skipping job');
      return;
    }
    log.info({ repoUrl: scan.repoUrl, commitSha: scan.commitSha }, 'scan attempt started');
    const startedAt = Date.now();

    try {
      const result = await deps.pipeline.run({
        scan,
        signal: job.signal,
        log,
        progress: (stage, pct, message) => updateProgress(deps.db, scanId, { stage, pct, message }),
      });
      await updateProgress(deps.db, scanId, { stage: 'persisting', pct: 98, message: 'Saving results' });
      const previous = await findPreviousDoneScan(deps.db, scan.repoUrl, scan.createdAt, scan.id);
      await completeScan(deps.db, scanId, {
        ...result,
        stats: { ...result.stats, totalMs: Date.now() - startedAt },
        previousScanId: previous?.id ?? null,
      });
      log.info({ findings: result.findings.length, ms: Date.now() - startedAt, summarizer: result.summarizer }, 'scan done');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof NonRetryableScanError) {
        log.warn({ err }, 'scan failed, not retryable');
        await markFailed(deps.db, scanId, message);
        return;
      }
      if (job.retryCount >= job.retryLimit) {
        log.error({ err }, 'scan failed on final attempt');
        await markFailed(deps.db, scanId, message);
        throw err;
      }
      log.warn({ err }, 'scan attempt failed, will retry');
      await markRetrying(deps.db, scanId, message);
      throw err;
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -w server -- run-scan`
Expected: 4 tests pass.

- [ ] **Step 5: Wire the roles in `server/src/main.ts`**

Replace the file with:
```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { buildApp } from './api/app.js';
import { createScanNotifier } from './api/notifier.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { registerScanRoutes } from './api/routes/scans.js';
import { registerStreamRoute } from './api/routes/stream.js';
import { loadConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { realExec } from './github/exec.js';
import { createGitRefResolver } from './github/resolve-ref.js';
import { createLogger } from './logger.js';
import { createBoss, enqueueScan, MAX_ATTEMPTS, registerScanWorker } from './queue/boss.js';
import { createFakePipeline } from './scan/fake-pipeline.js';
import { createScanJobHandler } from './scan/run-scan.js';
import { APP_VERSION } from './version.js';

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const runsApi = config.ROLE !== 'worker';
  const runsWorker = config.ROLE !== 'api';

  const boss = await createBoss(config.DATABASE_URL, logger);
  const notifier = runsApi ? createScanNotifier(config.DATABASE_URL, logger) : null;
  if (notifier) await notifier.start();

  const app = await buildApp({
    logger,
    webDistDir: runsApi ? WEB_DIST : null,
    routes: [
      (a) =>
        registerHealthRoutes(a, {
          role: config.ROLE,
          version: APP_VERSION,
          summarizerMode: config.summarizerMode,
          checkDb: async () => {
            await db.execute(sql`select 1 from scans limit 1`);
          },
          isQueueReady: () => true,
        }),
      ...(runsApi && notifier
        ? [
            (a: Parameters<typeof registerScanRoutes>[0]) =>
              registerScanRoutes(a, {
                db,
                resolver: createGitRefResolver({ exec: realExec, token: config.GITHUB_TOKEN }),
                enqueue: async (scanId) => {
                  await enqueueScan(boss, scanId);
                },
                freshnessMinutes: config.SCAN_FRESHNESS_MINUTES,
                summarizerMode: config.summarizerMode,
                maxAttempts: MAX_ATTEMPTS,
              }),
            (a: Parameters<typeof registerStreamRoute>[0]) => registerStreamRoute(a, { db, notifier }),
          ]
        : []),
    ],
  });

  if (runsWorker) {
    const handler = createScanJobHandler({ db, pipeline: createFakePipeline(), logger });
    await registerScanWorker(boss, config.WORKER_CONCURRENCY, handler);
    logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'scan worker registered');
  }

  await app.listen({ port: config.PORT, host: '0.0.0.0' });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      await app.close();
      await notifier?.stop();
      await pool.end();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Run end to end in Docker**

```bash
docker compose up --build -d
curl -s -X POST localhost:8080/api/scans -H 'Content-Type: application/json' -d '{"repoUrl":"https://github.com/expressjs/express"}'
```
Expected: 201 with `status: "queued"` and a 40 character `commitSha`. Copy the id, then:
```bash
curl -N localhost:8080/api/scans/<id>/stream
```
Expected: `snapshot`, several `progress` events a second apart, then `done`, and the connection closes. `docker compose logs worker` shows "scan attempt started" and "scan done" with the scan id. Then `docker compose down`.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npm run typecheck -w server && npm run lint -w server`

```bash
git add -A
git commit -m "feat(worker): scan job handler with idempotent attempts and retry semantics

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Web submit form and live progress page

**Files:**
- Create: `web/src/types.ts`, `web/src/api.ts`, `web/src/lib/format.ts`, `web/src/hooks/useScanStream.ts`, `web/src/components/ScanProgress.tsx`, `web/src/components/ReusedBanner.tsx`, `web/src/components/ScanListItemRow.tsx`, `web/src/pages/ScanPage.tsx`
- Modify: `web/src/pages/HomePage.tsx`, `web/src/App.tsx`
- Test: `web/src/test/format.test.ts`, `web/src/test/useScanStream.test.ts`, `web/src/test/ScanProgress.test.tsx`

**Interfaces:**
- Produces: `api.createScan(repoUrl, ref?, force?)`, `api.getScan(id)`, `api.listScans(limit?)`; `ApiError`; `useScanStream(id): { view, mode, error }` with pure `reduceStream` and `isTerminal`; `timeAgo(iso)`, `shortSha(sha)`, `formatDuration(ms)`, `severityColor(severity)`, `riskColor(riskLevel)`; `<ScanProgress view />`, `<ReusedBanner reused view onScanAgain busy />`, `<ScanListItemRow item />`; routes `/` and `/scans/:id`.

- [ ] **Step 1: Write `web/src/types.ts`**

```ts
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'dependency' | 'code' | 'config';
export type RiskLevel = Severity | 'none';
export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';
export type Stage = 'fetching' | 'dependencies' | 'code' | 'summarizing' | 'persisting';

export interface Finding {
  fingerprint: string;
  category: Category;
  severity: Severity;
  ruleId: string;
  title: string;
  description: string;
  recommendation: string;
  location: string;
  referenceId: string | null;
  referenceUrl: string | null;
  evidence: string | null;
  metadata: Record<string, unknown>;
}

export interface Summary {
  riskLevel: RiskLevel;
  headline: string;
  overview: string;
  topRisks: Array<{ fingerprint: string; title: string; whyItMatters: string }>;
  nextActions: Array<{ action: string; effort: 'minutes' | 'hours' | 'days'; resolves: string[] }>;
}

export interface Comparison {
  previousScanId: string;
  previousSha: string;
  sameCommit: boolean;
  new: Finding[];
  fixed: Finding[];
  stillOpen: Finding[];
}

export interface ScanEvent {
  stage: string;
  message: string;
  createdAt: string;
}

export interface ScanStats {
  files?: number;
  packages?: number;
  advisories?: number;
  stageDurationsMs?: Partial<Record<Stage, number>>;
  totalMs?: number;
}

export interface ScanView {
  id: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  refRequested: string | null;
  refResolved: string | null;
  commitSha: string;
  status: ScanStatus;
  stage: string | null;
  progressPct: number;
  progressMessage: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  warnings: Array<{ code: string; message: string }>;
  summary: Summary | null;
  summarizer: string | null;
  summarizerNote: string | null;
  stats: ScanStats;
  previousScanId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  events: ScanEvent[];
  findings: Finding[] | null;
  comparison: Comparison | null;
}

export type ReusedReason = 'in_progress' | 'recent' | null;
export type CreateScanResponse = ScanView & { reused: ReusedReason };

export interface ScanListItem {
  id: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  commitSha: string;
  refResolved: string | null;
  status: ScanStatus;
  riskLevel: RiskLevel | null;
  counts: Record<Severity, number> | null;
  summarizer: string | null;
  createdAt: string;
  finishedAt: string | null;
}
```

- [ ] **Step 2: Write `web/src/api.ts`**

```ts
import type { CreateScanResponse, ScanListItem, ScanView } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? `Request failed with status ${res.status}`);
  }
  return body as T;
}

export const api = {
  createScan: (repoUrl: string, ref?: string, force = false) =>
    request<CreateScanResponse>('/api/scans', {
      method: 'POST',
      body: JSON.stringify({ repoUrl, ref: ref?.trim() ? ref.trim() : undefined, force }),
    }),
  getScan: (id: string) => request<ScanView>(`/api/scans/${id}`),
  listScans: (limit = 50) => request<{ scans: ScanListItem[] }>(`/api/scans?limit=${limit}`),
};
```

- [ ] **Step 3: Write the failing unit tests**

`web/src/test/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatDuration, shortSha, timeAgo } from '../lib/format';

describe('format helpers', () => {
  it('shortens shas', () => {
    expect(shortSha('0123456789abcdef0123456789abcdef01234567')).toBe('0123456');
  });
  it('formats durations', () => {
    expect(formatDuration(850)).toBe('0.9 s');
    expect(formatDuration(12_400)).toBe('12.4 s');
    expect(formatDuration(95_000)).toBe('1 min 35 s');
  });
  it('describes time ago', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    expect(timeAgo('2026-10-18T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-10-18T11:57:00Z', now)).toBe('3 minutes ago');
    expect(timeAgo('2026-10-18T09:00:00Z', now)).toBe('3 hours ago');
    expect(timeAgo('2026-10-15T12:00:00Z', now)).toBe('3 days ago');
  });
});
```

`web/src/test/useScanStream.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isTerminal, reduceStream, type StreamState } from '../hooks/useScanStream';
import type { ScanView } from '../types';

const view = (over: Partial<ScanView>): ScanView =>
  ({ id: '1', status: 'running', stage: 'code', progressPct: 70, progressMessage: 'x', events: [], findings: null, comparison: null, ...over }) as ScanView;

describe('reduceStream', () => {
  const start: StreamState = { view: null, mode: 'connecting', error: null };
  it('stores views and closes on terminal status', () => {
    const live = reduceStream(start, { type: 'mode', mode: 'live' });
    const running = reduceStream(live, { type: 'view', view: view({ status: 'running' }) });
    expect(running.mode).toBe('live');
    const done = reduceStream(running, { type: 'view', view: view({ status: 'done' }) });
    expect(done.mode).toBe('closed');
    expect(isTerminal(done.view)).toBe(true);
  });
  it('records errors', () => {
    expect(reduceStream(start, { type: 'error', message: 'nope' })).toEqual({ view: null, mode: 'closed', error: 'nope' });
  });
});
```

`web/src/test/ScanProgress.test.tsx`:
```tsx
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScanProgress } from '../components/ScanProgress';
import type { ScanView } from '../types';

const view = {
  id: '1',
  repoOwner: 'o',
  repoName: 'r',
  commitSha: 'abcdef1234567',
  status: 'running',
  stage: 'code',
  progressPct: 70,
  progressMessage: 'Scanned 120 files',
  attempts: 1,
  maxAttempts: 3,
  error: null,
  startedAt: '2026-10-18T12:00:00Z',
  createdAt: '2026-10-18T12:00:00Z',
  events: [
    { stage: 'fetching', message: 'Scan started', createdAt: '2026-10-18T12:00:00Z' },
    { stage: 'dependencies', message: 'Checked 50 packages', createdAt: '2026-10-18T12:00:03Z' },
    { stage: 'code', message: 'Scanned 120 files', createdAt: '2026-10-18T12:00:05Z' },
  ],
} as unknown as ScanView;

describe('ScanProgress', () => {
  it('shows the active step, the message and completed steps', () => {
    render(
      <MantineProvider>
        <ScanProgress view={view} />
      </MantineProvider>,
    );
    expect(screen.getAllByText('Scanned 120 files').length).toBeGreaterThan(0);
    expect(screen.getByText('Checked 50 packages')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();
  });

  it('explains a retry', () => {
    render(
      <MantineProvider>
        <ScanProgress view={{ ...view, status: 'queued', error: 'OSV timed out', attempts: 1 }} />
      </MantineProvider>,
    );
    expect(screen.getByText(/Retrying/)).toBeInTheDocument();
    expect(screen.getByText(/OSV timed out/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -w web`
Expected: FAIL, modules not found.

- [ ] **Step 5: Write `web/src/lib/format.ts`**

```ts
import type { RiskLevel, Severity } from '../types';

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function severityColor(severity: Severity): string {
  return { critical: 'red', high: 'orange', medium: 'yellow', low: 'blue' }[severity];
}

export function riskColor(risk: RiskLevel): string {
  return risk === 'none' ? 'green' : severityColor(risk);
}

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
```

- [ ] **Step 6: Write `web/src/hooks/useScanStream.ts`**

```ts
import { useEffect, useReducer } from 'react';
import { api } from '../api';
import type { ScanView } from '../types';

export type StreamMode = 'connecting' | 'live' | 'polling' | 'closed';

export interface StreamState {
  view: ScanView | null;
  mode: StreamMode;
  error: string | null;
}

export type StreamEvent = { type: 'view'; view: ScanView } | { type: 'mode'; mode: StreamMode } | { type: 'error'; message: string };

export function isTerminal(view: ScanView | null): boolean {
  return view?.status === 'done' || view?.status === 'failed';
}

export function reduceStream(state: StreamState, event: StreamEvent): StreamState {
  switch (event.type) {
    case 'view':
      return { ...state, view: event.view, error: null, mode: isTerminal(event.view) ? 'closed' : state.mode };
    case 'mode':
      return { ...state, mode: event.mode };
    case 'error':
      return { ...state, error: event.message, mode: 'closed' };
  }
}

const INITIAL: StreamState = { view: null, mode: 'connecting', error: null };
const POLL_MS = 2000;

export function useScanStream(id: string): StreamState {
  const [state, dispatch] = useReducer(reduceStream, INITIAL);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;

    const stop = (): void => {
      source?.close();
      source = null;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const applyView = (view: ScanView): void => {
      if (cancelled) return;
      dispatch({ type: 'view', view });
      if (isTerminal(view)) stop();
    };

    const fail = (err: unknown, fallback: string): void => {
      if (!cancelled) dispatch({ type: 'error', message: err instanceof Error ? err.message : fallback });
      stop();
    };

    const startPolling = (): void => {
      if (pollTimer || cancelled) return;
      dispatch({ type: 'mode', mode: 'polling' });
      const tick = async (): Promise<void> => {
        try {
          applyView(await api.getScan(id));
        } catch (err) {
          fail(err, 'Lost connection to the scan');
        }
      };
      void tick();
      pollTimer = setInterval(() => void tick(), POLL_MS);
    };

    const openStream = (): void => {
      if (typeof EventSource === 'undefined') {
        startPolling();
        return;
      }
      source = new EventSource(`/api/scans/${id}/stream`);
      const onEvent = (e: MessageEvent<string>): void => {
        failures = 0;
        applyView(JSON.parse(e.data) as ScanView);
      };
      for (const name of ['snapshot', 'progress', 'done', 'failed']) {
        source.addEventListener(name, onEvent as EventListener);
      }
      source.onopen = () => dispatch({ type: 'mode', mode: 'live' });
      source.onerror = () => {
        failures += 1;
        if (failures >= 2) {
          source?.close();
          source = null;
          startPolling();
        }
      };
    };

    api
      .getScan(id)
      .then((view) => {
        applyView(view);
        if (!isTerminal(view)) openStream();
      })
      .catch((err: unknown) => fail(err, 'Could not load the scan'));

    return () => {
      cancelled = true;
      stop();
    };
  }, [id]);

  return state;
}
```

- [ ] **Step 7: Write the components**

`web/src/components/ScanProgress.tsx`:
```tsx
import { Alert, Group, Loader, Paper, Stack, Stepper, Text, Timeline } from '@mantine/core';
import { formatDuration } from '../lib/format';
import type { ScanView } from '../types';

const STEPS: Array<{ key: string; label: string; stages: string[] }> = [
  { key: 'fetch', label: 'Fetch', stages: ['fetching'] },
  { key: 'deps', label: 'Dependencies', stages: ['dependencies'] },
  { key: 'code', label: 'Code', stages: ['code'] },
  { key: 'summary', label: 'Summarize', stages: ['summarizing', 'persisting'] },
];

function activeStep(stage: string | null): number {
  const idx = STEPS.findIndex((s) => stage !== null && s.stages.includes(stage));
  return idx < 0 ? 0 : idx;
}

export function ScanProgress({ view }: { view: ScanView }) {
  const retrying = view.status === 'queued' && view.error !== null;
  const waiting = view.status === 'queued' && view.error === null;
  const events = view.events;

  return (
    <Stack gap="lg">
      {retrying && (
        <Alert color="yellow" title={`Retrying (attempt ${view.attempts} of ${view.maxAttempts} failed)`}>
          {view.error}
        </Alert>
      )}
      <Paper withBorder p="lg" radius="md">
        <Stepper active={waiting ? 0 : activeStep(view.stage)} size="sm">
          {STEPS.map((s) => (
            <Stepper.Step key={s.key} label={s.label} loading={!waiting && !retrying && s.stages.includes(view.stage ?? '')} />
          ))}
        </Stepper>
        <Group mt="lg" gap="sm">
          {!retrying && <Loader size="sm" />}
          <Text fw={500}>{waiting ? 'Waiting for a worker to pick up the scan' : view.progressMessage}</Text>
          <Text c="dimmed" size="sm">
            {view.progressPct}%
          </Text>
        </Group>
      </Paper>
      {events.length > 0 && (
        <Timeline active={events.length - 1} bulletSize={18} lineWidth={2}>
          {events.map((e, i) => {
            const next = events[i + 1];
            const duration = next ? new Date(next.createdAt).getTime() - new Date(e.createdAt).getTime() : null;
            return (
              <Timeline.Item key={`${e.createdAt}-${i}`} title={e.message}>
                <Text c="dimmed" size="xs">
                  {e.stage}
                  {duration !== null ? ` · ${formatDuration(duration)}` : ''}
                </Text>
              </Timeline.Item>
            );
          })}
        </Timeline>
      )}
    </Stack>
  );
}
```

`web/src/components/ReusedBanner.tsx`:
```tsx
import { Alert, Button, Group, Text } from '@mantine/core';
import { timeAgo } from '../lib/format';
import type { ReusedReason, ScanView } from '../types';

export function ReusedBanner({ reused, view, onScanAgain, busy }: { reused: ReusedReason; view: ScanView; onScanAgain: () => void; busy: boolean }) {
  if (reused === 'in_progress') {
    return (
      <Alert color="blue" title="Joined a scan already in progress">
        A scan of this commit was already running. You are watching that one.
      </Alert>
    );
  }
  if (reused === 'recent') {
    return (
      <Alert color="blue" title={`This commit was scanned ${view.finishedAt ? timeAgo(view.finishedAt) : 'recently'}`}>
        <Group justify="space-between" align="center">
          <Text size="sm">Showing that result. Advisory data changes over time, so you can run a fresh scan.</Text>
          <Button size="xs" variant="light" onClick={onScanAgain} loading={busy}>
            Scan again
          </Button>
        </Group>
      </Alert>
    );
  }
  return null;
}
```

`web/src/components/ScanListItemRow.tsx`:
```tsx
import { Anchor, Badge, Group, Text } from '@mantine/core';
import { Link } from 'react-router';
import { riskColor, shortSha, timeAgo } from '../lib/format';
import type { ScanListItem } from '../types';

const STATUS_COLOR: Record<ScanListItem['status'], string> = { queued: 'gray', running: 'blue', done: 'green', failed: 'red' };

export function ScanListItemRow({ item, showRepo = true }: { item: ScanListItem; showRepo?: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap" py="xs">
      <Group gap="sm" wrap="nowrap">
        {showRepo && (
          <Anchor component={Link} to={`/scans/${item.id}`} fw={500}>
            {item.repoOwner}/{item.repoName}
          </Anchor>
        )}
        {!showRepo && (
          <Anchor component={Link} to={`/scans/${item.id}`} fw={500}>
            {shortSha(item.commitSha)}
          </Anchor>
        )}
        {showRepo && (
          <Text c="dimmed" size="sm" ff="monospace">
            {shortSha(item.commitSha)}
          </Text>
        )}
        <Text c="dimmed" size="sm">
          {timeAgo(item.createdAt)}
        </Text>
      </Group>
      <Group gap="xs" wrap="nowrap">
        {item.riskLevel && (
          <Badge color={riskColor(item.riskLevel)} variant="light">
            {item.riskLevel === 'none' ? 'no issues' : `${item.riskLevel} risk`}
          </Badge>
        )}
        <Badge color={STATUS_COLOR[item.status]} variant="outline">
          {item.status}
        </Badge>
      </Group>
    </Group>
  );
}
```

- [ ] **Step 8: Write the pages and routes**

`web/src/pages/HomePage.tsx`:
```tsx
import { Alert, Button, Divider, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { ScanListItemRow } from '../components/ScanListItemRow';
import type { ScanListItem } from '../types';

export function HomePage() {
  const navigate = useNavigate();
  const [repoUrl, setRepoUrl] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<ScanListItem[]>([]);

  useEffect(() => {
    api
      .listScans(20)
      .then((r) => setRecent(r.scans))
      .catch(() => setRecent([]));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const scan = await api.createScan(repoUrl, ref);
      navigate(`/scans/${scan.id}`, { state: { reused: scan.reused } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="xl">
      <Stack gap="xs">
        <Title order={2}>Scan a GitHub repository</Title>
        <Text c="dimmed">Get a prioritized security review: what matters, what is risky, and what to do next.</Text>
      </Stack>
      <Paper withBorder p="lg" radius="md">
        <form onSubmit={submit}>
          <Stack gap="md">
            <TextInput
              label="Repository URL"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.currentTarget.value)}
              required
              size="md"
            />
            <TextInput
              label="Branch, tag or commit"
              placeholder="default branch"
              value={ref}
              onChange={(e) => setRef(e.currentTarget.value)}
              size="md"
            />
            {error && <Alert color="red">{error}</Alert>}
            <Group justify="flex-end">
              <Button type="submit" loading={busy} size="md">
                Scan
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
      {recent.length > 0 && (
        <Stack gap="xs">
          <Title order={4}>Recent scans</Title>
          <Paper withBorder px="md" radius="md">
            {recent.map((item, i) => (
              <div key={item.id}>
                {i > 0 && <Divider />}
                <ScanListItemRow item={item} />
              </div>
            ))}
          </Paper>
        </Stack>
      )}
    </Stack>
  );
}
```

`web/src/pages/ScanPage.tsx`:
```tsx
import { Alert, Anchor, Badge, Button, Group, Paper, Skeleton, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { ReusedBanner } from '../components/ReusedBanner';
import { ScanProgress } from '../components/ScanProgress';
import { useScanStream } from '../hooks/useScanStream';
import { shortSha, timeAgo } from '../lib/format';
import type { ReusedReason, ScanView } from '../types';

function ScanHeader({ view }: { view: ScanView }) {
  const refLabel = view.refResolved?.replace(/^refs\/(heads|tags)\//, '') ?? view.refRequested ?? 'default branch';
  return (
    <Group justify="space-between" align="flex-start">
      <Stack gap={2}>
        <Title order={2}>
          <Anchor component={Link} to={`/repos/${view.repoOwner}/${view.repoName}`} c="inherit" underline="hover">
            {view.repoOwner}/{view.repoName}
          </Anchor>
        </Title>
        <Group gap="xs">
          <Badge variant="outline">{refLabel}</Badge>
          <Anchor href={`${view.repoUrl}/commit/${view.commitSha}`} target="_blank" ff="monospace" size="sm">
            {shortSha(view.commitSha)}
          </Anchor>
          <Text c="dimmed" size="sm">
            {view.finishedAt ? `scanned ${timeAgo(view.finishedAt)}` : `started ${timeAgo(view.createdAt)}`}
          </Text>
        </Group>
      </Stack>
    </Group>
  );
}

function ScanResultBasic({ view }: { view: ScanView }) {
  return (
    <Paper withBorder p="lg" radius="md">
      <Stack gap="xs">
        <Title order={3}>{view.summary?.headline}</Title>
        <Text>{view.summary?.overview}</Text>
        <Text c="dimmed" size="sm">
          {view.findings?.length ?? 0} findings
        </Text>
      </Stack>
    </Paper>
  );
}

export function ScanPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { reused?: ReusedReason } };
  const reused = location.state?.reused ?? null;
  const { view, error } = useScanStream(id);
  const [busy, setBusy] = useState(false);

  async function scanAgain(current: ScanView) {
    setBusy(true);
    try {
      const next = await api.createScan(current.repoUrl, current.refRequested ?? undefined, true);
      navigate(`/scans/${next.id}`, { state: { reused: next.reused } });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert color="red" title="Could not load this scan">{error}</Alert>;
  if (!view) return <Skeleton height={200} radius="md" />;

  return (
    <Stack gap="lg">
      <ScanHeader view={view} />
      <ReusedBanner reused={reused} view={view} onScanAgain={() => void scanAgain(view)} busy={busy} />
      {view.status === 'failed' && (
        <Alert color="red" title="The scan failed">
          <Stack gap="sm">
            <Text>{view.error}</Text>
            <Button size="xs" variant="light" onClick={() => void scanAgain(view)} loading={busy} w="fit-content">
              Scan again
            </Button>
          </Stack>
        </Alert>
      )}
      {(view.status === 'queued' || view.status === 'running') && <ScanProgress view={view} />}
      {view.status === 'done' && <ScanResultBasic view={view} />}
    </Stack>
  );
}
```

Modify `web/src/App.tsx`: import `ScanPage` and add `<Route path="/scans/:id" element={<ScanPage />} />` after the home route.

- [ ] **Step 9: Run the web tests, typecheck and build**

Run: `npm test -w web && npm run typecheck -w web && npm run lint -w web && npm run build -w web`
Expected: all tests pass, build succeeds.

- [ ] **Step 10: Try it in the browser against the Docker stack**

Run: `docker compose up --build -d`, open `http://localhost:8080`, submit `https://github.com/expressjs/express`.
Expected: navigation to the scan page, the stepper animates through the four steps with messages, the timeline fills, the basic result shows "Fake scan complete". Submitting the same URL again within ten minutes shows the "This commit was scanned ..." banner with a "Scan again" button. `docker compose down`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(web): submit form, live progress with sse and polling fallback, reuse banners

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Git fetch stage and file walker

**Files:**
- Create: `server/src/scan/files.ts`, `server/src/scan/fetch.ts`
- Test: `server/test/unit/files.test.ts`, `server/test/unit/fetch.test.ts`

**Interfaces:**
- Produces: `walkFiles(root, { maxFiles?, maxDepth?, maxFileBytes? }): Promise<{ files: WalkedFile[]; truncated: boolean }>` with `WalkedFile { absPath, relPath, size }` and `IGNORED_DIRS`; `countFiles(root)`; `fetchRepo({ repoUrl, commitSha, token?, exec, signal, timeoutMs?, tmpRoot? }): Promise<FetchResult>` with `FetchResult { dir, commitSha, fileCount, cleanup() }`; `CommitNotFoundError extends NonRetryableScanError`; `mapFetchError(err)`.
- Only full 40 character SHAs reach this stage (Task 7 rejects short ones).

- [ ] **Step 1: Write the failing tests**

`server/test/unit/files.test.ts`:
```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { walkFiles } from '../../src/scan/files.js';

describe('walkFiles', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'walk-'));
    await mkdir(path.join(root, 'src/deep/deeper'), { recursive: true });
    await mkdir(path.join(root, 'node_modules/x'), { recursive: true });
    await writeFile(path.join(root, 'src/a.ts'), 'a');
    await writeFile(path.join(root, 'src/deep/deeper/b.ts'), 'b');
    await writeFile(path.join(root, 'node_modules/x/index.js'), 'ignored');
    await writeFile(path.join(root, 'big.bin'), Buffer.alloc(600 * 1024));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('skips ignored directories and large files, returns posix relative paths', async () => {
    const { files, truncated } = await walkFiles(root);
    expect(files.map((f) => f.relPath).sort()).toEqual(['src/a.ts', 'src/deep/deeper/b.ts']);
    expect(truncated).toBe(false);
  });

  it('honors depth and file caps', async () => {
    expect((await walkFiles(root, { maxDepth: 1 })).files.map((f) => f.relPath)).toEqual(['src/a.ts']);
    const capped = await walkFiles(root, { maxFiles: 1 });
    expect(capped.files).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });
});
```

`server/test/unit/fetch.test.ts`:
```ts
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecError, type Exec } from '../../src/github/exec.js';
import { NonRetryableScanError } from '../../src/scan/errors.js';
import { CommitNotFoundError, fetchRepo } from '../../src/scan/fetch.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

interface Call {
  args: string[];
  cwd: string | undefined;
}

function recordingExec(behavior: (args: string[], cwd: string | undefined) => Promise<{ stdout: string; stderr: string }>): Exec & { calls: Call[] } {
  const calls: Call[] = [];
  const exec: Exec = async (_cmd, args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    return behavior(args, opts.cwd);
  };
  return Object.assign(exec, { calls });
}

describe('fetchRepo', () => {
  let tmpRoot: string;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'fetch-test-'));
  });
  afterEach(() => rm(tmpRoot, { recursive: true, force: true }));

  it('runs init, remote add, shallow fetch by sha, checkout and rev-parse, then cleans up', async () => {
    const exec = recordingExec(async (args, cwd) => {
      if (args.includes('checkout')) await writeFile(path.join(cwd!, 'index.js'), 'console.log(1)');
      if (args.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const result = await fetchRepo({ repoUrl: 'https://github.com/o/r', commitSha: SHA, exec, signal: new AbortController().signal, tmpRoot });
    expect(exec.calls.map((c) => c.args)).toEqual([
      ['init', '-q'],
      ['remote', 'add', 'origin', 'https://github.com/o/r'],
      ['fetch', '-q', '--depth', '1', 'origin', SHA],
      ['checkout', '-q', 'FETCH_HEAD'],
      ['rev-parse', 'HEAD'],
    ]);
    expect(exec.calls.every((c) => c.cwd === result.dir)).toBe(true);
    expect(result.commitSha).toBe(SHA);
    expect(result.fileCount).toBe(1);
    await result.cleanup();
    await expect(access(result.dir)).rejects.toThrow();
  });

  it('adds the auth header to every git call when a token is set', async () => {
    const exec = recordingExec(async () => ({ stdout: SHA, stderr: '' }));
    const result = await fetchRepo({ repoUrl: 'https://github.com/o/r', commitSha: SHA, token: 'tok', exec, signal: new AbortController().signal, tmpRoot });
    expect(exec.calls.every((c) => c.args[0] === '-c' && c.args[1]!.startsWith('http.extraHeader=Authorization: Basic '))).toBe(true);
    await result.cleanup();
  });

  it('maps a missing commit to a non-retryable error and cleans up', async () => {
    const exec = recordingExec(async (args) => {
      if (args.includes('fetch')) throw new ExecError('git', 128, 'fatal: remote error: upload-pack: not our ref 0123', false);
      return { stdout: '', stderr: '' };
    });
    await expect(fetchRepo({ repoUrl: 'https://github.com/o/r', commitSha: SHA, exec, signal: new AbortController().signal, tmpRoot })).rejects.toBeInstanceOf(CommitNotFoundError);
    const auth = recordingExec(async () => {
      throw new ExecError('git', 128, 'remote: Repository not found.', false);
    });
    await expect(fetchRepo({ repoUrl: 'https://github.com/o/r', commitSha: SHA, exec: auth, signal: new AbortController().signal, tmpRoot })).rejects.toBeInstanceOf(NonRetryableScanError);
  });

  it('aborts a hanging fetch at the timeout with a retryable error and cleans up', async () => {
    const hanging: Exec = (_cmd, args, opts) =>
      new Promise((resolve, reject) => {
        if (!args.includes('fetch')) {
          resolve({ stdout: '', stderr: '' });
          return;
        }
        opts.signal?.addEventListener('abort', () => reject(new ExecError('git', null, '', true)), { once: true });
      });
    const signal = AbortSignal.timeout(100);
    const promise = fetchRepo({ repoUrl: 'https://github.com/o/r', commitSha: SHA, exec: hanging, signal, tmpRoot, timeoutMs: 5000 });
    await expect(promise).rejects.toThrow(/timed out/);
    await expect(promise).rejects.not.toBeInstanceOf(NonRetryableScanError);
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(tmpRoot)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w server -- files fetch`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `server/src/scan/files.ts`**

```ts
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  '.next',
  'coverage',
  'target',
  '__pycache__',
  '.venv',
  'venv',
]);

export interface WalkOptions {
  maxFiles?: number;
  maxDepth?: number;
  maxFileBytes?: number;
}

export interface WalkedFile {
  absPath: string;
  relPath: string;
  size: number;
}

export async function walkFiles(root: string, opts: WalkOptions = {}): Promise<{ files: WalkedFile[]; truncated: boolean }> {
  const maxFiles = opts.maxFiles ?? 5000;
  const maxDepth = opts.maxDepth ?? 25;
  const maxFileBytes = opts.maxFileBytes ?? 512 * 1024;
  const files: WalkedFile[] = [];
  let truncated = false;

  async function visit(dir: string, depth: number): Promise<void> {
    if (truncated || depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await visit(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let size: number;
      try {
        size = (await stat(abs)).size;
      } catch {
        continue;
      }
      if (size > maxFileBytes) continue;
      files.push({ absPath: abs, relPath: path.relative(root, abs).split(path.sep).join('/'), size });
      if (files.length >= maxFiles) truncated = true;
    }
  }

  await visit(root, 0);
  return { files, truncated };
}

export async function countFiles(root: string): Promise<number> {
  const { files } = await walkFiles(root, { maxFiles: Number.MAX_SAFE_INTEGER, maxFileBytes: Number.MAX_SAFE_INTEGER });
  return files.length;
}
```

Depth semantics: `src/a.ts` is at depth 1 (inside one directory), so `maxDepth: 1` includes it and excludes `src/deep/...`.

- [ ] **Step 4: Write `server/src/scan/fetch.ts`**

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExecError, type Exec } from '../github/exec.js';
import { gitAuthArgs, gitEnv } from '../github/git-auth.js';
import { REPO_NOT_FOUND_MESSAGE } from '../github/resolve-ref.js';
import { NonRetryableScanError } from './errors.js';
import { countFiles } from './files.js';

export class CommitNotFoundError extends NonRetryableScanError {
  constructor() {
    super('Commit not found in this repository.');
    this.name = 'CommitNotFoundError';
  }
}

export interface FetchOptions {
  repoUrl: string;
  commitSha: string;
  token?: string | undefined;
  exec: Exec;
  signal: AbortSignal;
  timeoutMs?: number;
  tmpRoot?: string;
}

export interface FetchResult {
  dir: string;
  commitSha: string;
  fileCount: number;
  cleanup(): Promise<void>;
}

export function mapFetchError(err: unknown): Error {
  if (!(err instanceof ExecError)) return err instanceof Error ? err : new Error(String(err));
  const text = err.stderr;
  if (/not our ref|couldn't find remote ref|bad object|not a valid object name/i.test(text)) return new CommitNotFoundError();
  if (/Repository not found|could not read Username|Authentication failed|Permission denied/i.test(text)) {
    return new NonRetryableScanError(REPO_NOT_FOUND_MESSAGE);
  }
  if (err.timedOut) return new Error('Fetching the repository timed out.');
  return new Error(`git failed: ${text.split('\n')[0] || err.message}`);
}

export async function fetchRepo(opts: FetchOptions): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const dir = await mkdtemp(path.join(opts.tmpRoot ?? os.tmpdir(), 'scan-'));
  const cleanup = (): Promise<void> => rm(dir, { recursive: true, force: true });
  const auth = gitAuthArgs(opts.token);
  const env = gitEnv();
  const deadline = Date.now() + timeoutMs;

  const git = (args: string[]) =>
    opts.exec('git', [...auth, ...args], { cwd: dir, env, signal: opts.signal, timeoutMs: Math.max(1000, deadline - Date.now()) });

  try {
    await git(['init', '-q']);
    await git(['remote', 'add', 'origin', opts.repoUrl]);
    await git(['fetch', '-q', '--depth', '1', 'origin', opts.commitSha]);
    await git(['checkout', '-q', 'FETCH_HEAD']);
    const { stdout } = await git(['rev-parse', 'HEAD']);
    const fileCount = await countFiles(dir);
    const resolved = stdout.trim();
    return { dir, commitSha: /^[0-9a-f]{40}$/.test(resolved) ? resolved : opts.commitSha, fileCount, cleanup };
  } catch (err) {
    await cleanup();
    throw mapFetchError(err);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w server -- files fetch`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scan): shallow git fetch into a temp dir with timeouts and cleanup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Manifest parsers and discovery

**Files:**
- Create: `server/src/scan/parsers/types.ts`, `package-lock.ts`, `package-json.ts`, `requirements.ts`, `go-mod.ts`, `gemfile-lock.ts`, `discover.ts`, `index.ts` (all under `server/src/scan/parsers/`)
- Test: `server/test/unit/parsers.test.ts`

**Interfaces:**
- Produces: `PackageRef { ecosystem: 'npm' | 'PyPI' | 'Go' | 'RubyGems'; name; version }`; `ManifestKind`; `ManifestFile { kind, relPath, absPath }`; `parsePackageLock(text)`, `parsePackageJson(text)`, `parseRequirements(text)`, `parseGoMod(text)`, `parseGemfileLock(text)`; `parseManifest(kind, text)`; `discoverManifests(root, maxDepth = 3): Promise<ManifestFile[]>`.

- [ ] **Step 1: Write the failing test**

`server/test/unit/parsers.test.ts`:
```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverManifests } from '../../src/scan/parsers/discover.js';
import { parseGemfileLock } from '../../src/scan/parsers/gemfile-lock.js';
import { parseGoMod } from '../../src/scan/parsers/go-mod.js';
import { parsePackageJson } from '../../src/scan/parsers/package-json.js';
import { parsePackageLock } from '../../src/scan/parsers/package-lock.js';
import { parseRequirements } from '../../src/scan/parsers/requirements.js';

describe('parsePackageLock', () => {
  it('reads v3 packages including scoped and nested, skipping root and links', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'app', version: '1.0.0' },
        'node_modules/lodash': { version: '4.17.15' },
        'node_modules/@babel/core': { version: '7.0.0' },
        'node_modules/a/node_modules/lodash': { version: '4.17.21' },
        'node_modules/local': { link: true, resolved: 'packages/local' },
        'packages/local': { version: '0.0.1' },
      },
    });
    expect(parsePackageLock(lock)).toEqual([
      { ecosystem: 'npm', name: 'lodash', version: '4.17.15' },
      { ecosystem: 'npm', name: '@babel/core', version: '7.0.0' },
      { ecosystem: 'npm', name: 'lodash', version: '4.17.21' },
    ]);
  });

  it('reads v1 nested dependencies', () => {
    const lock = JSON.stringify({
      lockfileVersion: 1,
      dependencies: { minimist: { version: '1.2.0', dependencies: { lodash: { version: '4.17.15' } } } },
    });
    expect(parsePackageLock(lock)).toEqual([
      { ecosystem: 'npm', name: 'minimist', version: '1.2.0' },
      { ecosystem: 'npm', name: 'lodash', version: '4.17.15' },
    ]);
  });
});

describe('parsePackageJson', () => {
  it('keeps only exact versions', () => {
    const text = JSON.stringify({ dependencies: { lodash: '4.17.15', express: '^4.0.0', left: '=1.2.3' }, devDependencies: { vitest: '~5.0.0', tsx: 'v4.1.0' } });
    expect(parsePackageJson(text)).toEqual([
      { ecosystem: 'npm', name: 'lodash', version: '4.17.15' },
      { ecosystem: 'npm', name: 'left', version: '1.2.3' },
      { ecosystem: 'npm', name: 'tsx', version: '4.1.0' },
    ]);
  });
});

describe('parseRequirements', () => {
  it('reads pinned requirements only', () => {
    const text = ['Django==2.2.0  # old', 'requests[security]==2.20.0', 'flask>=1.0', '-r other.txt', '', 'numpy == 1.21.0'].join('\n');
    expect(parseRequirements(text)).toEqual([
      { ecosystem: 'PyPI', name: 'django', version: '2.2.0' },
      { ecosystem: 'PyPI', name: 'requests', version: '2.20.0' },
      { ecosystem: 'PyPI', name: 'numpy', version: '1.21.0' },
    ]);
  });
});

describe('parseGoMod', () => {
  it('reads single and block requires without the v prefix', () => {
    const text = ['module example.com/x', '', 'go 1.21', '', 'require golang.org/x/text v0.3.0', 'require (', '\tgithub.com/gin-gonic/gin v1.6.3 // indirect', '\tgolang.org/x/net v0.0.0-20200101000000-abcdef', ')'].join('\n');
    expect(parseGoMod(text)).toEqual([
      { ecosystem: 'Go', name: 'golang.org/x/text', version: '0.3.0' },
      { ecosystem: 'Go', name: 'github.com/gin-gonic/gin', version: '1.6.3' },
      { ecosystem: 'Go', name: 'golang.org/x/net', version: '0.0.0-20200101000000-abcdef' },
    ]);
  });
});

describe('parseGemfileLock', () => {
  it('reads direct specs and strips platform suffixes', () => {
    const text = ['GEM', '  remote: https://rubygems.org/', '  specs:', '    rack (2.0.1)', '    nokogiri (1.13.0-x86_64-linux)', '      racc (~> 1.4)', '    racc (1.6.0)', '', 'PLATFORMS', '  ruby', '', 'DEPENDENCIES', '  rack', ''].join('\n');
    expect(parseGemfileLock(text)).toEqual([
      { ecosystem: 'RubyGems', name: 'rack', version: '2.0.1' },
      { ecosystem: 'RubyGems', name: 'nokogiri', version: '1.13.0' },
      { ecosystem: 'RubyGems', name: 'racc', version: '1.6.0' },
    ]);
  });
});

describe('discoverManifests', () => {
  it('finds supported manifests up to three directories deep, skipping node_modules', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'manifests-'));
    try {
      await mkdir(path.join(root, 'services/api'), { recursive: true });
      await mkdir(path.join(root, 'a/b/c/d'), { recursive: true });
      await mkdir(path.join(root, 'node_modules/x'), { recursive: true });
      await writeFile(path.join(root, 'package.json'), '{}');
      await writeFile(path.join(root, 'package-lock.json'), '{}');
      await writeFile(path.join(root, 'services/api/requirements.txt'), '');
      await writeFile(path.join(root, 'a/b/c/go.mod'), '');
      await writeFile(path.join(root, 'a/b/c/d/Gemfile.lock'), '');
      await writeFile(path.join(root, 'node_modules/x/package.json'), '{}');
      const found = await discoverManifests(root);
      expect(found.map((m) => `${m.kind}:${m.relPath}`).sort()).toEqual(['go-mod:a/b/c/go.mod', 'package-json:package.json', 'package-lock:package-lock.json', 'requirements:services/api/requirements.txt']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server -- parsers`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the parser modules**

`server/src/scan/parsers/types.ts`:
```ts
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
```

`server/src/scan/parsers/package-lock.ts`:
```ts
import type { PackageRef } from './types.js';

interface LegacyDep {
  version?: string;
  dependencies?: Record<string, LegacyDep>;
}

interface LockFile {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string; link?: boolean }>;
  dependencies?: Record<string, LegacyDep>;
}

export function parsePackageLock(text: string): PackageRef[] {
  const data = JSON.parse(text) as LockFile;
  const out = new Map<string, PackageRef>();
  const add = (name: string, version: string | undefined): void => {
    if (!name || !version || version.startsWith('file:') || version.startsWith('link:')) return;
    out.set(`${name}@${version}`, { ecosystem: 'npm', name, version });
  };
  if (data.packages) {
    for (const [key, entry] of Object.entries(data.packages)) {
      if (!key || entry.link) continue;
      const idx = key.lastIndexOf('node_modules/');
      if (idx < 0) continue;
      add(key.slice(idx + 'node_modules/'.length), entry.version);
    }
  } else if (data.dependencies) {
    const walk = (deps: Record<string, LegacyDep>): void => {
      for (const [name, dep] of Object.entries(deps)) {
        add(name, dep.version);
        if (dep.dependencies) walk(dep.dependencies);
      }
    };
    walk(data.dependencies);
  }
  return [...out.values()];
}
```

`server/src/scan/parsers/package-json.ts`:
```ts
import type { PackageRef } from './types.js';

export function parsePackageJson(text: string): PackageRef[] {
  const data = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const out: PackageRef[] = [];
  for (const deps of [data.dependencies, data.devDependencies]) {
    for (const [name, range] of Object.entries(deps ?? {})) {
      const m = /^[=v]?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(String(range).trim());
      if (m) out.push({ ecosystem: 'npm', name, version: m[1]! });
    }
  }
  return out;
}
```

`server/src/scan/parsers/requirements.ts`:
```ts
import type { PackageRef } from './types.js';

export function parseRequirements(text: string): PackageRef[] {
  const out: PackageRef[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*([0-9][0-9A-Za-z.+!-]*)/.exec(line);
    if (m) out.push({ ecosystem: 'PyPI', name: m[1]!.toLowerCase(), version: m[2]! });
  }
  return out;
}
```

`server/src/scan/parsers/go-mod.ts`:
```ts
import type { PackageRef } from './types.js';

export function parseGoMod(text: string): PackageRef[] {
  const out: PackageRef[] = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('require (')) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ')') {
      inBlock = false;
      continue;
    }
    const m = inBlock ? /^(\S+)\s+v(\S+)$/.exec(line) : /^require\s+(\S+)\s+v(\S+)$/.exec(line);
    if (m) out.push({ ecosystem: 'Go', name: m[1]!, version: m[2]! });
  }
  return out;
}
```

`server/src/scan/parsers/gemfile-lock.ts`:
```ts
import type { PackageRef } from './types.js';

export function parseGemfileLock(text: string): PackageRef[] {
  const out: PackageRef[] = [];
  let inSpecs = false;
  for (const raw of text.split('\n')) {
    if (/^\S/.test(raw)) {
      inSpecs = false;
      continue;
    }
    if (/^  specs:\s*$/.test(raw)) {
      inSpecs = true;
      continue;
    }
    if (!inSpecs) continue;
    const m = /^    ([A-Za-z0-9._-]+) \(([^)]+)\)\s*$/.exec(raw);
    if (m) out.push({ ecosystem: 'RubyGems', name: m[1]!, version: m[2]!.split('-')[0]! });
  }
  return out;
}
```

`server/src/scan/parsers/discover.ts`:
```ts
import path from 'node:path';
import { walkFiles } from '../files.js';
import type { ManifestFile, ManifestKind } from './types.js';

const KINDS: Record<string, ManifestKind> = {
  'package-lock.json': 'package-lock',
  'package.json': 'package-json',
  'requirements.txt': 'requirements',
  'go.mod': 'go-mod',
  'Gemfile.lock': 'gemfile-lock',
};

export async function discoverManifests(root: string, maxDepth = 3): Promise<ManifestFile[]> {
  const { files } = await walkFiles(root, { maxDepth, maxFiles: 50_000, maxFileBytes: 20 * 1024 * 1024 });
  const out: ManifestFile[] = [];
  for (const f of files) {
    const kind = KINDS[path.posix.basename(f.relPath)];
    if (kind) out.push({ kind, relPath: f.relPath, absPath: f.absPath });
  }
  return out;
}
```

`server/src/scan/parsers/index.ts`:
```ts
import { parseGemfileLock } from './gemfile-lock.js';
import { parseGoMod } from './go-mod.js';
import { parsePackageJson } from './package-json.js';
import { parsePackageLock } from './package-lock.js';
import { parseRequirements } from './requirements.js';
import type { ManifestKind, PackageRef } from './types.js';

export { discoverManifests } from './discover.js';
export type { Ecosystem, ManifestFile, ManifestKind, PackageRef } from './types.js';

export function parseManifest(kind: ManifestKind, text: string): PackageRef[] {
  switch (kind) {
    case 'package-lock':
      return parsePackageLock(text);
    case 'package-json':
      return parsePackageJson(text);
    case 'requirements':
      return parseRequirements(text);
    case 'go-mod':
      return parseGoMod(text);
    case 'gemfile-lock':
      return parseGemfileLock(text);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w server -- parsers`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scan): manifest parsers for npm, pypi, go and rubygems with discovery

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: OSV client, advisory mapping and cache

**Files:**
- Create: `server/src/scan/fingerprint.ts`, `server/src/osv/types.ts`, `server/src/osv/client.ts`, `server/src/osv/map.ts`, `server/src/osv/cache.ts`, `server/src/osv/advisories.ts`
- Test: `server/test/unit/osv.test.ts`, `server/test/integration/osv-cache.test.ts`

**Interfaces:**
- Produces: `dependencyFingerprint(ecosystem, name, vulnId)`, `codeFingerprint(ruleId, relPath, line)`, `configFingerprint(ruleId, relPath)`, `normalizeLine(line)`; `OsvVuln`; `OsvError { retryable }`; `createOsvClient({ fetchImpl?, baseUrl?, timeoutMs?, onRequest? }): OsvClient` with `queryBatch(refs, signal): Promise<string[][]>` and `getVuln(id, signal)`; `canonicalId`, `mapSeverity`, `findFixedVersion`, `vulnToFinding(vuln, pkg, manifestPath)`; `VulnCache { get(ids), put(vulns) }`, `createMemoryVulnCache()`, `createDbVulnCache(db, maxAgeMs?)`; `fetchAdvisories({ osv, cache, packages, signal, concurrency? }): Promise<{ findings, advisories }>`.

- [ ] **Step 1: Write the failing unit test**

`server/test/unit/osv.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { fetchAdvisories } from '../../src/osv/advisories.js';
import { createMemoryVulnCache } from '../../src/osv/cache.js';
import { createOsvClient, OsvError, type OsvClient } from '../../src/osv/client.js';
import { canonicalId, findFixedVersion, mapSeverity, vulnToFinding } from '../../src/osv/map.js';
import type { OsvVuln } from '../../src/osv/types.js';
import { codeFingerprint } from '../../src/scan/fingerprint.js';

const lodash = { ecosystem: 'npm' as const, name: 'lodash', version: '4.17.15' };

const ghsa: OsvVuln = {
  id: 'GHSA-p6mc-m468-83gw',
  summary: 'Prototype Pollution in lodash',
  details: 'Long details',
  aliases: ['CVE-2020-8203'],
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H' }],
  database_specific: { severity: 'HIGH', cwe_ids: ['CWE-1321'] },
  affected: [
    { package: { ecosystem: 'npm', name: 'lodash' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '3.7.0' }, { fixed: '4.17.19' }] }] },
    { package: { ecosystem: 'npm', name: 'lodash-es' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '3.7.0' }, { fixed: '4.17.20' }] }] },
  ],
};

describe('mapping', () => {
  it('maps database severities and falls back to medium', () => {
    expect(mapSeverity(ghsa)).toBe('high');
    expect(mapSeverity({ ...ghsa, database_specific: { severity: 'MODERATE' } })).toBe('medium');
    expect(mapSeverity({ ...ghsa, database_specific: { severity: 'CRITICAL' } })).toBe('critical');
    expect(mapSeverity({ id: 'X', severity: [{ type: 'CVSS_V3', score: '9.8' }] })).toBe('critical');
    expect(mapSeverity({ id: 'X' })).toBe('medium');
  });

  it('finds the fixed version for the matching package only', () => {
    expect(findFixedVersion(ghsa, lodash)).toBe('4.17.19');
    expect(findFixedVersion(ghsa, { ...lodash, name: 'other' })).toBeNull();
  });

  it('prefers the GHSA id as the canonical id', () => {
    expect(canonicalId(ghsa)).toBe('GHSA-p6mc-m468-83gw');
    expect(canonicalId({ id: 'CVE-2020-8203', aliases: ['GHSA-p6mc-m468-83gw'] })).toBe('GHSA-p6mc-m468-83gw');
    expect(canonicalId({ id: 'MAL-2024-1' })).toBe('MAL-2024-1');
  });

  it('builds a finding with upgrade advice, and a no-fix finding when nothing is fixed', () => {
    const f = vulnToFinding(ghsa, lodash, 'package-lock.json');
    expect(f).toMatchObject({
      fingerprint: 'dep:npm:lodash:GHSA-p6mc-m468-83gw',
      category: 'dependency',
      severity: 'high',
      referenceId: 'GHSA-p6mc-m468-83gw',
      referenceUrl: 'https://osv.dev/vulnerability/GHSA-p6mc-m468-83gw',
      location: 'lodash@4.17.15 (npm) in package-lock.json',
    });
    expect(f.recommendation).toBe('Upgrade lodash from 4.17.15 to 4.17.19 or later.');
    expect(f.metadata).toMatchObject({ fixedVersion: '4.17.19', cve: 'CVE-2020-8203' });
    const bare = vulnToFinding({ id: 'GHSA-x' }, lodash, 'package.json');
    expect(bare.severity).toBe('medium');
    expect(bare.recommendation).toMatch(/No fixed version is published/);
    expect(bare.title).toContain('GHSA-x');
  });
});

describe('fingerprints', () => {
  it('ignore indentation and line numbers', () => {
    expect(codeFingerprint('secret.aws', 'src/a.js', '  const k = "AKIA"  ')).toBe(codeFingerprint('secret.aws', 'src/a.js', 'const k = "AKIA"'));
    expect(codeFingerprint('secret.aws', 'src/a.js', 'x')).not.toBe(codeFingerprint('secret.aws', 'src/b.js', 'x'));
  });
});

describe('createOsvClient', () => {
  it('chunks batch queries and returns ids per package', async () => {
    const calls: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { queries: unknown[] };
      calls.push(body.queries.length);
      return new Response(JSON.stringify({ results: body.queries.map((_q, i) => (i === 0 ? { vulns: [{ id: 'GHSA-a' }] } : {})) }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createOsvClient({ fetchImpl });
    const refs = Array.from({ length: 1001 }, (_, i) => ({ ...lodash, name: `p${i}` }));
    const ids = await client.queryBatch(refs, new AbortController().signal);
    expect(calls).toEqual([1000, 1]);
    expect(ids).toHaveLength(1001);
    expect(ids[0]).toEqual(['GHSA-a']);
    expect(ids[1]).toEqual([]);
    expect(ids[1000]).toEqual(['GHSA-a']);
  });

  it('wraps failures and timeouts in OsvError', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(createOsvClient({ fetchImpl: failing }).getVuln('GHSA-a', new AbortController().signal)).rejects.toBeInstanceOf(OsvError);
    const hanging = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))))) as unknown as typeof fetch;
    const outcomes: string[] = [];
    await expect(createOsvClient({ fetchImpl: hanging, timeoutMs: 50, onRequest: (o) => outcomes.push(o) }).getVuln('GHSA-a', new AbortController().signal)).rejects.toThrow(/timed out/);
    expect(outcomes).toEqual(['timeout']);
  });
});

describe('fetchAdvisories', () => {
  it('dedupes advisories, uses the cache, and only fetches missing details', async () => {
    const getVuln = vi.fn(async (id: string) => ({ ...ghsa, id, aliases: id === 'CVE-2020-8203' ? ['GHSA-p6mc-m468-83gw'] : ghsa.aliases }));
    const osv: OsvClient = {
      queryBatch: async (refs) => refs.map(() => ['GHSA-p6mc-m468-83gw', 'CVE-2020-8203']),
      getVuln,
    };
    const cache = createMemoryVulnCache();
    const packages = [{ ref: lodash, manifest: 'package-lock.json' }, { ref: { ...lodash, version: '4.17.16' }, manifest: 'other/package-lock.json' }];
    const first = await fetchAdvisories({ osv, cache, packages, signal: new AbortController().signal });
    expect(first.findings.map((f) => f.fingerprint)).toEqual(['dep:npm:lodash:GHSA-p6mc-m468-83gw']);
    expect(first.advisories).toBe(2);
    expect(getVuln).toHaveBeenCalledTimes(2);
    const second = await fetchAdvisories({ osv, cache, packages, signal: new AbortController().signal });
    expect(second.findings).toHaveLength(1);
    expect(getVuln).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Write the failing integration test for the database cache**

`server/test/integration/osv-cache.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDbVulnCache } from '../../src/osv/cache.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

describe.skipIf(!TEST_DATABASE_URL)('db vuln cache', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await setupTestDb();
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it('stores, returns and refreshes advisories, ignoring stale rows', async () => {
    const cache = createDbVulnCache(t.db, 1000);
    await cache.put([{ id: 'GHSA-a', summary: 'one' }]);
    expect((await cache.get(['GHSA-a', 'GHSA-b'])).get('GHSA-a')?.summary).toBe('one');
    await cache.put([{ id: 'GHSA-a', summary: 'two' }]);
    expect((await cache.get(['GHSA-a'])).get('GHSA-a')?.summary).toBe('two');
    await new Promise((r) => setTimeout(r, 1100));
    expect((await cache.get(['GHSA-a'])).size).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w server -- osv && npm run test:integration -w server -- osv-cache`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write the modules**

`server/src/scan/fingerprint.ts`:
```ts
import { createHash } from 'node:crypto';

export function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

export function dependencyFingerprint(ecosystem: string, name: string, vulnId: string): string {
  return `dep:${ecosystem}:${name}:${vulnId}`;
}

export function codeFingerprint(ruleId: string, relPath: string, line: string): string {
  const hash = createHash('sha1').update(normalizeLine(line)).digest('hex').slice(0, 12);
  return `code:${ruleId}:${relPath}:${hash}`;
}

export function configFingerprint(ruleId: string, relPath: string): string {
  return `config:${ruleId}:${relPath}`;
}
```

`server/src/osv/types.ts`:
```ts
export interface OsvAffected {
  package?: { ecosystem?: string; name?: string };
  ranges?: Array<{ type?: string; events?: Array<{ introduced?: string; fixed?: string; last_affected?: string }> }>;
  versions?: string[];
}

export interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  modified?: string;
  published?: string;
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string; cwe_ids?: string[] } & Record<string, unknown>;
  affected?: OsvAffected[];
  references?: Array<{ type?: string; url?: string }>;
}
```

`server/src/osv/client.ts`:
```ts
import type { PackageRef } from '../scan/parsers/types.js';
import type { OsvVuln } from './types.js';

export class OsvError extends Error {
  constructor(
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'OsvError';
  }
}

export interface OsvClient {
  queryBatch(refs: PackageRef[], signal: AbortSignal): Promise<string[][]>;
  getVuln(id: string, signal: AbortSignal): Promise<OsvVuln>;
}

export type OsvOutcome = 'ok' | 'error' | 'timeout';

export interface OsvClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  onRequest?: (outcome: OsvOutcome) => void;
}

const BATCH = 1000;

export function createOsvClient(opts: OsvClientOptions = {}): OsvClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? 'https://api.osv.dev';
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const report = opts.onRequest ?? (() => undefined);

  async function call<T>(path: string, init: RequestInit, signal: AbortSignal): Promise<T> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { ...init, signal: combined });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      report(timedOut ? 'timeout' : 'error');
      throw new OsvError(timedOut ? 'OSV request timed out' : `OSV request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      report('error');
      throw new OsvError(`OSV responded with status ${res.status}`, res.status >= 500 || res.status === 429);
    }
    report('ok');
    return (await res.json()) as T;
  }

  return {
    async queryBatch(refs, signal) {
      const results: string[][] = [];
      for (let i = 0; i < refs.length; i += BATCH) {
        const chunk = refs.slice(i, i + BATCH);
        const body = { queries: chunk.map((r) => ({ package: { name: r.name, ecosystem: r.ecosystem }, version: r.version })) };
        const data = await call<{ results?: Array<{ vulns?: Array<{ id: string }> }> }>(
          '/v1/querybatch',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
          signal,
        );
        for (let j = 0; j < chunk.length; j += 1) results.push((data.results?.[j]?.vulns ?? []).map((v) => v.id));
      }
      return results;
    },
    getVuln(id, signal) {
      return call<OsvVuln>(`/v1/vulns/${encodeURIComponent(id)}`, { method: 'GET' }, signal);
    },
  };
}
```

`server/src/osv/map.ts`:
```ts
import { dependencyFingerprint } from '../scan/fingerprint.js';
import type { PackageRef } from '../scan/parsers/types.js';
import type { Finding, Severity } from '../scan/types.js';
import type { OsvVuln } from './types.js';

export function canonicalId(vuln: OsvVuln): string {
  if (vuln.id.startsWith('GHSA-')) return vuln.id;
  return vuln.aliases?.find((a) => a.startsWith('GHSA-')) ?? vuln.id;
}

export function mapSeverity(vuln: OsvVuln): Severity {
  const label = vuln.database_specific?.severity?.toUpperCase();
  if (label === 'CRITICAL') return 'critical';
  if (label === 'HIGH') return 'high';
  if (label === 'MODERATE' || label === 'MEDIUM') return 'medium';
  if (label === 'LOW') return 'low';
  const numeric = vuln.severity?.map((s) => s.score ?? '').find((s) => /^\d+(\.\d+)?$/.test(s));
  if (numeric) {
    const n = Number(numeric);
    if (n >= 9) return 'critical';
    if (n >= 7) return 'high';
    if (n >= 4) return 'medium';
    return 'low';
  }
  return 'medium';
}

export function findFixedVersion(vuln: OsvVuln, pkg: PackageRef): string | null {
  for (const affected of vuln.affected ?? []) {
    if (affected.package?.ecosystem !== pkg.ecosystem || affected.package?.name !== pkg.name) continue;
    for (const range of affected.ranges ?? []) {
      if (range.type !== 'SEMVER' && range.type !== 'ECOSYSTEM') continue;
      for (const event of range.events ?? []) if (event.fixed) return event.fixed;
    }
  }
  return null;
}

export function vulnToFinding(vuln: OsvVuln, pkg: PackageRef, manifestPath: string): Finding {
  const id = canonicalId(vuln);
  const fixed = findFixedVersion(vuln, pkg);
  const cve = vuln.aliases?.find((a) => a.startsWith('CVE-')) ?? (vuln.id.startsWith('CVE-') ? vuln.id : null);
  const summary = vuln.summary?.trim() || `${id} in ${pkg.name}`;
  return {
    fingerprint: dependencyFingerprint(pkg.ecosystem, pkg.name, id),
    category: 'dependency',
    severity: mapSeverity(vuln),
    ruleId: 'osv.advisory',
    title: `${summary} (${pkg.name}@${pkg.version})`,
    description: (vuln.details?.trim() || summary).slice(0, 2000),
    recommendation: fixed
      ? `Upgrade ${pkg.name} from ${pkg.version} to ${fixed} or later.`
      : `No fixed version is published for ${pkg.name} ${pkg.version}. Check the advisory and consider replacing or isolating the package.`,
    location: `${pkg.name}@${pkg.version} (${pkg.ecosystem}) in ${manifestPath}`,
    referenceId: id,
    referenceUrl: `https://osv.dev/vulnerability/${id}`,
    evidence: null,
    metadata: {
      ecosystem: pkg.ecosystem,
      package: pkg.name,
      version: pkg.version,
      fixedVersion: fixed,
      cve,
      manifest: manifestPath,
      cwe: vuln.database_specific?.cwe_ids ?? [],
    },
  };
}
```

`server/src/osv/cache.ts`:
```ts
import { and, gte, inArray, sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { osvVulns } from '../db/schema.js';
import type { OsvVuln } from './types.js';

export interface VulnCache {
  get(ids: string[]): Promise<Map<string, OsvVuln>>;
  put(vulns: OsvVuln[]): Promise<void>;
}

export function createMemoryVulnCache(): VulnCache {
  const store = new Map<string, OsvVuln>();
  return {
    async get(ids) {
      const out = new Map<string, OsvVuln>();
      for (const id of ids) {
        const v = store.get(id);
        if (v) out.set(id, v);
      }
      return out;
    },
    async put(vulns) {
      for (const v of vulns) store.set(v.id, v);
    },
  };
}

export function createDbVulnCache(db: Queryable, maxAgeMs = 24 * 60 * 60 * 1000): VulnCache {
  return {
    async get(ids) {
      const out = new Map<string, OsvVuln>();
      if (ids.length === 0) return out;
      const rows = await db
        .select()
        .from(osvVulns)
        .where(and(inArray(osvVulns.id, ids), gte(osvVulns.fetchedAt, new Date(Date.now() - maxAgeMs))));
      for (const r of rows) out.set(r.id, r.payload as unknown as OsvVuln);
      return out;
    },
    async put(vulns) {
      if (vulns.length === 0) return;
      await db
        .insert(osvVulns)
        .values(vulns.map((v) => ({ id: v.id, payload: v as unknown as Record<string, unknown>, fetchedAt: new Date() })))
        .onConflictDoUpdate({ target: osvVulns.id, set: { payload: sql`excluded.payload`, fetchedAt: sql`excluded.fetched_at` } });
    },
  };
}
```

`server/src/osv/advisories.ts`:
```ts
import type { PackageRef } from '../scan/parsers/types.js';
import type { Finding } from '../scan/types.js';
import type { VulnCache } from './cache.js';
import type { OsvClient } from './client.js';
import { vulnToFinding } from './map.js';
import type { OsvVuln } from './types.js';

export interface PackageInManifest {
  ref: PackageRef;
  manifest: string;
}

export interface FetchAdvisoriesOptions {
  osv: OsvClient;
  cache: VulnCache;
  packages: PackageInManifest[];
  signal: AbortSignal;
  concurrency?: number;
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function fetchAdvisories(opts: FetchAdvisoriesOptions): Promise<{ findings: Finding[]; advisories: number }> {
  const idsPerPackage = await opts.osv.queryBatch(
    opts.packages.map((p) => p.ref),
    opts.signal,
  );
  const allIds = [...new Set(idsPerPackage.flat())];
  const cached = await opts.cache.get(allIds);
  const missing = allIds.filter((id) => !cached.has(id));
  const fetched: OsvVuln[] = [];
  await runPool(missing, opts.concurrency ?? 5, async (id) => {
    fetched.push(await opts.osv.getVuln(id, opts.signal));
  });
  await opts.cache.put(fetched);

  const byId = new Map(cached);
  for (const v of fetched) byId.set(v.id, v);

  const findings = new Map<string, Finding>();
  opts.packages.forEach((pkg, i) => {
    for (const id of idsPerPackage[i] ?? []) {
      const vuln = byId.get(id);
      if (!vuln) continue;
      const finding = vulnToFinding(vuln, pkg.ref, pkg.manifest);
      if (!findings.has(finding.fingerprint)) findings.set(finding.fingerprint, finding);
    }
  });
  return { findings: [...findings.values()], advisories: allIds.length };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w server -- osv && npm run test:integration -w server -- osv-cache`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(osv): advisory lookup with batching, severity mapping, fix versions and a cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: Dependency stage

**Files:**
- Create: `server/src/scan/deps-stage.ts`
- Test: `server/test/unit/deps-stage.test.ts`

**Interfaces:**
- Produces: `runDependencyStage({ dir, osv, cache, signal, progress: (pct, message) => Promise<void>, log }): Promise<{ findings, warnings, packages, advisories }>`; config finding rule id `deps.no_lockfile`; warning codes `no_manifests`, `manifest_unreadable`, `too_many_packages`, `osv_unavailable`.

- [ ] **Step 1: Write the failing test**

`server/test/unit/deps-stage.test.ts`:
```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryVulnCache } from '../../src/osv/cache.js';
import { OsvError, type OsvClient } from '../../src/osv/client.js';
import { runDependencyStage } from '../../src/scan/deps-stage.js';

const log = pino({ level: 'silent' });
const signal = new AbortController().signal;

describe('runDependencyStage', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'deps-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('prefers lockfiles, flags package.json without one, and maps advisories', async () => {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/lodash': { version: '4.17.15' } } }));
    await mkdir(path.join(root, 'services/api'));
    await writeFile(path.join(root, 'services/api/package.json'), JSON.stringify({ dependencies: { minimist: '1.2.0' } }));
    const osv: OsvClient = {
      queryBatch: vi.fn(async (refs) => refs.map((r) => (r.name === 'lodash' ? ['GHSA-l'] : []))),
      getVuln: vi.fn(async (id) => ({ id, summary: 'Bad', database_specific: { severity: 'HIGH' }, affected: [{ package: { ecosystem: 'npm', name: 'lodash' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] })),
    };
    const progress = vi.fn(async () => undefined);
    const result = await runDependencyStage({ dir: root, osv, cache: createMemoryVulnCache(), signal, progress, log });
    expect(result.packages).toBe(2);
    expect(result.findings.map((f) => f.ruleId).sort()).toEqual(['deps.no_lockfile', 'osv.advisory']);
    expect(result.findings.find((f) => f.ruleId === 'deps.no_lockfile')?.location).toBe('services/api/package.json');
    expect(result.warnings).toEqual([]);
    expect(progress).toHaveBeenCalledWith(60, expect.stringContaining('1 advisories found'));
  });

  it('warns and continues when there are no manifests or OSV is down', async () => {
    const osvDown: OsvClient = {
      queryBatch: async () => {
        throw new OsvError('OSV responded with status 503');
      },
      getVuln: async () => {
        throw new OsvError('x');
      },
    };
    const empty = await runDependencyStage({ dir: root, osv: osvDown, cache: createMemoryVulnCache(), signal, progress: async () => undefined, log });
    expect(empty.warnings.map((w) => w.code)).toEqual(['no_manifests']);

    await writeFile(path.join(root, 'requirements.txt'), 'django==2.2.0\n');
    const down = await runDependencyStage({ dir: root, osv: osvDown, cache: createMemoryVulnCache(), signal, progress: async () => undefined, log });
    expect(down.findings).toEqual([]);
    expect(down.packages).toBe(1);
    expect(down.warnings.map((w) => w.code)).toEqual(['osv_unavailable']);
  });

  it('reports unreadable manifests as warnings', async () => {
    await writeFile(path.join(root, 'package-lock.json'), '{not json');
    const osv: OsvClient = { queryBatch: async () => [], getVuln: async () => ({ id: 'x' }) };
    const result = await runDependencyStage({ dir: root, osv, cache: createMemoryVulnCache(), signal, progress: async () => undefined, log });
    expect(result.warnings[0]?.code).toBe('manifest_unreadable');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server -- deps-stage`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `server/src/scan/deps-stage.ts`**

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../logger.js';
import { fetchAdvisories, type PackageInManifest } from '../osv/advisories.js';
import type { VulnCache } from '../osv/cache.js';
import { OsvError, type OsvClient } from '../osv/client.js';
import { configFingerprint } from './fingerprint.js';
import { discoverManifests, parseManifest, type PackageRef } from './parsers/index.js';
import type { Finding, ScanWarning } from './types.js';

export interface DependencyStageOptions {
  dir: string;
  osv: OsvClient;
  cache: VulnCache;
  signal: AbortSignal;
  progress: (pct: number, message: string) => Promise<void>;
  log: Logger;
}

export interface DependencyStageResult {
  findings: Finding[];
  warnings: ScanWarning[];
  packages: number;
  advisories: number;
}

export const MAX_PACKAGES = 2000;

function noLockfileFinding(relPath: string): Finding {
  return {
    fingerprint: configFingerprint('deps.no_lockfile', relPath),
    category: 'config',
    severity: 'medium',
    ruleId: 'deps.no_lockfile',
    title: `No lockfile next to ${relPath}`,
    description:
      'Without a lockfile the installed dependency versions are not reproducible, and only exactly pinned versions could be checked for advisories.',
    recommendation: 'Commit a lockfile (package-lock.json) so dependency versions are reproducible and scannable.',
    location: relPath,
    referenceId: null,
    referenceUrl: null,
    evidence: null,
    metadata: { manifest: relPath, whyItMatters: 'Unpinned dependencies can silently pull in vulnerable versions on the next install.' },
  };
}

export async function runDependencyStage(opts: DependencyStageOptions): Promise<DependencyStageResult> {
  const manifests = await discoverManifests(opts.dir);
  const warnings: ScanWarning[] = [];
  const findings: Finding[] = [];

  if (manifests.length === 0) {
    warnings.push({
      code: 'no_manifests',
      message: 'No supported dependency manifests were found (package-lock.json, package.json, requirements.txt, go.mod, Gemfile.lock).',
    });
    return { findings, warnings, packages: 0, advisories: 0 };
  }

  const lockDirs = new Set(manifests.filter((m) => m.kind === 'package-lock').map((m) => path.posix.dirname(m.relPath)));
  const packages = new Map<string, PackageInManifest>();

  for (const manifest of manifests) {
    if (manifest.kind === 'package-json') {
      if (lockDirs.has(path.posix.dirname(manifest.relPath))) continue;
      findings.push(noLockfileFinding(manifest.relPath));
    }
    let text: string;
    try {
      text = await readFile(manifest.absPath, 'utf8');
    } catch {
      continue;
    }
    let refs: PackageRef[];
    try {
      refs = parseManifest(manifest.kind, text);
    } catch (err) {
      warnings.push({ code: 'manifest_unreadable', message: `Could not parse ${manifest.relPath}: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    for (const ref of refs) {
      const key = `${ref.ecosystem}:${ref.name}@${ref.version}`;
      if (!packages.has(key)) packages.set(key, { ref, manifest: manifest.relPath });
    }
  }

  let list = [...packages.values()];
  if (list.length > MAX_PACKAGES) {
    warnings.push({ code: 'too_many_packages', message: `Only the first ${MAX_PACKAGES} of ${list.length} packages were checked.` });
    list = list.slice(0, MAX_PACKAGES);
  }
  await opts.progress(35, `Found ${list.length} packages in ${manifests.length} manifest${manifests.length === 1 ? '' : 's'}, checking advisories`);
  if (list.length === 0) return { findings, warnings, packages: 0, advisories: 0 };

  try {
    const result = await fetchAdvisories({ osv: opts.osv, cache: opts.cache, packages: list, signal: opts.signal });
    findings.push(...result.findings);
    await opts.progress(60, `Checked ${list.length} packages against OSV, ${result.findings.length} advisories found`);
    return { findings, warnings, packages: list.length, advisories: result.findings.length };
  } catch (err) {
    if (err instanceof OsvError) {
      opts.log.warn({ err }, 'osv unavailable');
      warnings.push({
        code: 'osv_unavailable',
        message: `The dependency vulnerability check did not run: ${err.message}. Results cover code checks only.`,
      });
      return { findings, warnings, packages: list.length, advisories: 0 };
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w server -- deps-stage`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scan): dependency stage with lockfile preference and graceful osv degradation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: Code rules and code stage

**Files:**
- Create: `server/src/scan/rules/types.ts`, `server/src/scan/rules/rules.ts`, `server/src/scan/rules/engine.ts`, `server/src/scan/code-stage.ts`
- Test: `server/test/unit/rules.test.ts`, `server/test/unit/code-stage.test.ts`

**Interfaces:**
- Produces: `Rule { id, category, severity, title, description, recommendation, whyItMatters, pattern, extensions?, secret?, skipExcludedPaths? }`; `RULES: Rule[]`; `scanText(relPath, text, rules?): Finding[]`; `maskValue(value)`; `isPlaceholderValue(value)`; `isExcludedPath(relPath)`; `runCodeStage({ dir, signal, progress }): Promise<{ findings, files, truncated }>`; config rule `config.env_committed`.
- Code finding `metadata` carries `line`, `path`, and `whyItMatters`; `recommendation` has `{location}` substituted with `path:line`.

- [ ] **Step 1: Write the failing tests**

`server/test/unit/rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isExcludedPath, isPlaceholderValue, maskValue, scanText } from '../../src/scan/rules/engine.js';
import { RULES } from '../../src/scan/rules/rules.js';

describe('rules', () => {
  it('have unique ids and non-global patterns', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(RULES.every((r) => !r.pattern.global)).toBe(true);
  });

  it('flags an AWS key and masks the value in evidence', () => {
    const [f] = scanText('src/config.js', 'const key = "AKIAIOSFODNN7EXAMPLE";');
    expect(f).toMatchObject({ ruleId: 'secret.aws_access_key', severity: 'critical', location: 'src/config.js:1' });
    expect(f?.evidence).toBe('const key = "AKIA****";');
    expect(f?.evidence).not.toContain('IOSFODNN7EXAMPLE');
  });

  it('flags github tokens, stripe keys, private keys and slack webhooks', () => {
    const text = [
      'token = "ghp_' + 'a'.repeat(36) + '"',
      'STRIPE = "sk_live_' + 'b'.repeat(24) + '"',
      '-----BEGIN RSA PRIVATE KEY-----',
      'url = "https://hooks.slack.com/services/T000/B000/xxxx"',
    ].join('\n');
    const ids = scanText('deploy.sh', text).map((f) => f.ruleId);
    expect(ids).toEqual(['secret.github_token', 'secret.stripe_live_key', 'secret.private_key', 'secret.slack_webhook']);
  });

  it('flags generic credential assignments but not placeholders, env lookups or test paths', () => {
    expect(scanText('src/db.ts', 'const password = "hunter2hunter2";')).toHaveLength(1);
    expect(scanText('src/db.ts', 'const password = "changeme";')).toHaveLength(0);
    expect(scanText('src/db.ts', 'const apiKey = "${API_KEY}";')).toHaveLength(0);
    expect(scanText('src/db.ts', 'const token = process.env.TOKEN;')).toHaveLength(0);
    expect(scanText('test/db.test.ts', 'const password = "hunter2hunter2";')).toHaveLength(0);
    expect(scanText('README.md', 'password = "hunter2hunter2"')).toHaveLength(0);
  });

  it('flags eval, shell and sql interpolation, dangerouslySetInnerHTML and DEBUG=True by extension', () => {
    expect(scanText('a.js', 'eval(userInput)')[0]?.ruleId).toBe('code.eval');
    expect(scanText('a.py', 'eval(x)')[0]?.ruleId).toBe('code.eval');
    expect(scanText('a.rb', 'eval(x)')).toHaveLength(0);
    expect(scanText('a.ts', 'execSync(`ls ${dir}`)')[0]?.ruleId).toBe('code.shell_interpolation');
    expect(scanText('a.ts', 'db.query(`select * from t where id = ${id}`)')[0]?.ruleId).toBe('code.sql_interpolation');
    expect(scanText('a.tsx', '<div dangerouslySetInnerHTML={{ __html: html }} />')[0]?.ruleId).toBe('code.dangerously_set_inner_html');
    expect(scanText('settings.py', 'DEBUG = True')[0]?.ruleId).toBe('config.debug_true');
  });

  it('produces stable fingerprints across indentation and substitutes the location', () => {
    const a = scanText('a.js', '  eval(x)')[0]!;
    const b = scanText('a.js', 'eval(x)\n\n')[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.recommendation).toContain('a.js:1');
    expect(a.metadata).toMatchObject({ line: 1, path: 'a.js' });
  });

  it('helpers behave', () => {
    expect(maskValue('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA****');
    expect(maskValue('ab')).toBe('****');
    expect(isPlaceholderValue('your-api-key-here')).toBe(true);
    expect(isPlaceholderValue('<secret>')).toBe(true);
    expect(isPlaceholderValue('s3cr3tP@ssw0rd!')).toBe(false);
    expect(isExcludedPath('src/__mocks__/x.ts')).toBe(true);
    expect(isExcludedPath('src/app.ts')).toBe(false);
  });
});
```

`server/test/unit/code-stage.test.ts`:
```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCodeStage } from '../../src/scan/code-stage.js';

describe('runCodeStage', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'code-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('scans text files, flags committed .env files but not examples, skips binaries and node_modules', async () => {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'node_modules/x'), { recursive: true });
    await writeFile(path.join(root, 'src/config.js'), 'const key = "AKIAIOSFODNN7EXAMPLE";\n');
    await writeFile(path.join(root, 'node_modules/x/index.js'), 'const key = "AKIAIOSFODNN7EXAMPLE";\n');
    await writeFile(path.join(root, '.env'), 'SECRET=abc\n');
    await writeFile(path.join(root, '.env.example'), 'SECRET=\n');
    await writeFile(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const result = await runCodeStage({ dir: root, signal: new AbortController().signal, progress: async () => undefined });
    expect(result.findings.map((f) => `${f.ruleId}@${f.location}`).sort()).toEqual(['config.env_committed@.env', 'secret.aws_access_key@src/config.js:1']);
    expect(result.files).toBe(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w server -- rules code-stage`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the rule modules**

`server/src/scan/rules/types.ts`:
```ts
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
  skipExcludedPaths?: boolean;
}
```

`server/src/scan/rules/rules.ts`:
```ts
import type { Rule } from './types.js';

const JS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'];

export const RULES: Rule[] = [
  {
    id: 'secret.aws_access_key',
    category: 'code',
    severity: 'critical',
    title: 'AWS access key committed to the repository',
    description: 'An AWS access key id is hardcoded in source. Anyone with read access to the repository can use it.',
    recommendation: 'Rotate the AWS key found at {location}, remove it from the file, and load it from an environment variable or a secret manager.',
    whyItMatters: 'Anyone who can read this repository can act as your AWS account with whatever permissions this key has.',
    pattern: /\b(AKIA[0-9A-Z]{16})\b/,
    secret: true,
  },
  {
    id: 'secret.github_token',
    category: 'code',
    severity: 'critical',
    title: 'GitHub token committed to the repository',
    description: 'A GitHub personal access or app token is hardcoded in source.',
    recommendation: 'Revoke the GitHub token found at {location}, remove it from the file, and load it from an environment variable or a secret manager.',
    whyItMatters: 'The token grants access to GitHub resources as the user who created it, including other repositories.',
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,})\b/,
    secret: true,
  },
  {
    id: 'secret.stripe_live_key',
    category: 'code',
    severity: 'critical',
    title: 'Stripe live secret key committed to the repository',
    description: 'A Stripe live mode secret key is hardcoded in source.',
    recommendation: 'Roll the Stripe key found at {location} in the Stripe dashboard, remove it from the file, and load it from a secret manager.',
    whyItMatters: 'A live Stripe secret key can create charges and refunds and read customer data.',
    pattern: /\b(sk_live_[0-9a-zA-Z]{24,})\b/,
    secret: true,
  },
  {
    id: 'secret.private_key',
    category: 'code',
    severity: 'critical',
    title: 'Private key committed to the repository',
    description: 'A PEM encoded private key is stored in the repository.',
    recommendation: 'Remove the private key at {location}, generate a new key pair, and store private keys outside source control.',
    whyItMatters: 'A leaked private key lets an attacker impersonate the service or decrypt its traffic until the key is replaced.',
    pattern: /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/,
  },
  {
    id: 'secret.slack_webhook',
    category: 'code',
    severity: 'high',
    title: 'Slack webhook URL committed to the repository',
    description: 'A Slack incoming webhook URL is hardcoded in source.',
    recommendation: 'Regenerate the Slack webhook referenced at {location} and load the URL from configuration.',
    whyItMatters: 'Anyone with the URL can post messages into your Slack workspace as your integration.',
    pattern: /(hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+)/,
    secret: true,
  },
  {
    id: 'secret.generic_assignment',
    category: 'code',
    severity: 'high',
    title: 'Credential assigned as a string literal',
    description: 'A variable named like a password, secret, token or API key is assigned a literal value in source.',
    recommendation: 'Move the credential at {location} out of source into an environment variable or a secret manager, then rotate it.',
    whyItMatters: 'Literal credentials in source leak through clones, forks, logs and screenshots, and cannot be rotated without a code change.',
    pattern: /\b(?:password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*['"]([^'"]{8,})['"]/i,
    secret: true,
    skipExcludedPaths: true,
  },
  {
    id: 'code.eval',
    category: 'code',
    severity: 'medium',
    title: 'Use of eval',
    description: 'eval executes arbitrary code from a string. If any part of that string comes from input, it is remote code execution.',
    recommendation: 'Replace eval at {location} with JSON.parse, a safe expression parser, or explicit logic.',
    whyItMatters: 'If an attacker influences the evaluated string they can run code with the privileges of the application.',
    pattern: /\beval\s*\(/,
    extensions: [...JS, 'py'],
  },
  {
    id: 'code.shell_interpolation',
    category: 'code',
    severity: 'high',
    title: 'Shell command built from interpolated values',
    description: 'A shell command is built with template interpolation and passed to exec or execSync.',
    recommendation: 'At {location}, use execFile or spawn with an argument array instead of a shell string, and validate every value.',
    whyItMatters: 'Any interpolated value that contains shell metacharacters runs as a command on the host.',
    pattern: /\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{/,
    extensions: JS,
  },
  {
    id: 'code.sql_interpolation',
    category: 'code',
    severity: 'high',
    title: 'SQL query built from interpolated values',
    description: 'A query string is built with template interpolation and passed to a database call.',
    recommendation: 'At {location}, pass values as query parameters instead of interpolating them into the SQL string.',
    whyItMatters: 'Interpolated values let an attacker change the query, read other tables, or modify data.',
    pattern: /\.(?:query|execute|raw)\s*\(\s*`[^`]*\$\{/,
    extensions: JS,
  },
  {
    id: 'code.dangerously_set_inner_html',
    category: 'code',
    severity: 'low',
    title: 'Raw HTML rendered with dangerouslySetInnerHTML',
    description: 'React renders a raw HTML string without escaping.',
    recommendation: 'At {location}, render data as text or sanitize the HTML with a vetted library before rendering.',
    whyItMatters: 'If the HTML includes user controlled content it becomes a cross site scripting hole.',
    pattern: /dangerouslySetInnerHTML/,
    extensions: ['jsx', 'tsx', 'js'],
  },
  {
    id: 'config.debug_true',
    category: 'config',
    severity: 'low',
    title: 'Django DEBUG enabled',
    description: 'DEBUG = True is set in a Python settings file.',
    recommendation: 'At {location}, set DEBUG from the environment and keep it off outside local development.',
    whyItMatters: 'Debug pages leak settings, stack traces and sometimes secrets to anyone who triggers an error.',
    pattern: /^\s*DEBUG\s*=\s*True\b/,
    extensions: ['py'],
  },
];
```

`server/src/scan/rules/engine.ts`:
```ts
import { codeFingerprint } from '../fingerprint.js';
import type { Finding } from '../types.js';
import { RULES } from './rules.js';
import type { Rule } from './types.js';

const PLACEHOLDER = /changeme|change_me|example|placeholder|xxx|your[-_ ]?|<[^>]*>|\$\{|%[A-Z_]+%|process\.env|os\.environ|\bdummy\b|\bsample\b|\btest\b|\bfake\b|^\*+$|^\.+$|^x+$/i;
const EXCLUDED_PATH = /(^|\/)(test|tests|spec|specs|__tests__|__mocks__|fixtures?|examples?|docs?|samples?)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|\.md$|\.lock$/i;

export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER.test(value);
}

export function isExcludedPath(relPath: string): boolean {
  return EXCLUDED_PATH.test(relPath);
}

export function maskValue(value: string): string {
  return value.length <= 4 ? '****' : `${value.slice(0, 4)}****`;
}

export function extensionOf(relPath: string): string {
  const base = relPath.split('/').pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function scanText(relPath: string, text: string, rules: Rule[] = RULES): Finding[] {
  const ext = extensionOf(relPath);
  const applicable = rules.filter((r) => (!r.extensions || r.extensions.includes(ext)) && !(r.skipExcludedPaths && isExcludedPath(relPath)));
  const out: Finding[] = [];
  if (applicable.length === 0) return out;
  const seen = new Set<string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.length > 2000) continue;
    for (const rule of applicable) {
      const match = rule.pattern.exec(line);
      if (!match) continue;
      const value = match[1] ?? match[0];
      if (rule.secret && isPlaceholderValue(value)) continue;
      const fingerprint = codeFingerprint(rule.id, relPath, line);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const location = `${relPath}:${i + 1}`;
      const evidence = (rule.secret ? line.replace(value, maskValue(value)) : line).trim().slice(0, 200);
      out.push({
        fingerprint,
        category: rule.category,
        severity: rule.severity,
        ruleId: rule.id,
        title: rule.title,
        description: rule.description,
        recommendation: rule.recommendation.replace('{location}', location),
        location,
        referenceId: null,
        referenceUrl: null,
        evidence,
        metadata: { line: i + 1, path: relPath, whyItMatters: rule.whyItMatters },
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Write `server/src/scan/code-stage.ts`**

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w server -- rules code-stage`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scan): code rules for secrets and risky patterns with masked evidence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 20: Summary types, deterministic summarizer and guards

**Files:**
- Create: `server/src/summarize/types.ts`, `server/src/summarize/guards.ts`, `server/src/summarize/deterministic.ts`
- Test: `server/test/unit/deterministic.test.ts`, `server/test/unit/guards.test.ts`

**Interfaces:**
- Produces: `SummaryInput { repo: { owner, name, commitSha }; findings; warnings; stats: { files, packages } }`; `SummarizeOutcome { summary, mode: 'claude' | 'deterministic', note: string | null }`; `Summarizer { mode; summarize(input, signal): Promise<SummarizeOutcome> }`; `sanitizeSummary(summary, findings): Summary`; `highestSeverity(findings): RiskLevel`; `summarizeDeterministic(input): Summary`; `createDeterministicSummarizer(): Summarizer`.

- [ ] **Step 1: Write the failing tests**

`server/test/unit/guards.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/scan/types.js';
import { sanitizeSummary } from '../../src/summarize/guards.js';

const f = (fingerprint: string, severity: Finding['severity'] = 'high'): Finding => ({
  fingerprint, category: 'code', severity, ruleId: 'r', title: fingerprint, description: '', recommendation: '', location: 'a:1', referenceId: null, referenceUrl: null, evidence: null, metadata: {},
});

describe('sanitizeSummary', () => {
  it('drops unknown fingerprints, caps lists and repairs the risk level', () => {
    const out = sanitizeSummary(
      {
        riskLevel: 'none',
        headline: '  h  ',
        overview: 'o',
        topRisks: Array.from({ length: 7 }, (_, i) => ({ fingerprint: i < 6 ? `k${i}` : 'ghost', title: 't', whyItMatters: 'w' })),
        nextActions: [{ action: 'do it', effort: 'minutes', resolves: ['k0', 'ghost'] }, { action: '   ', effort: 'hours', resolves: [] }],
      },
      Array.from({ length: 6 }, (_, i) => f(`k${i}`, i === 0 ? 'critical' : 'low')),
    );
    expect(out.riskLevel).toBe('critical');
    expect(out.headline).toBe('h');
    expect(out.topRisks.map((r) => r.fingerprint)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
    expect(out.nextActions).toEqual([{ action: 'do it', effort: 'minutes', resolves: ['k0'] }]);
  });

  it('forces none when there are no findings', () => {
    const out = sanitizeSummary({ riskLevel: 'high', headline: 'h', overview: 'o', topRisks: [{ fingerprint: 'x', title: 't', whyItMatters: 'w' }], nextActions: [] }, []);
    expect(out.riskLevel).toBe('none');
    expect(out.topRisks).toEqual([]);
  });
});
```

`server/test/unit/deterministic.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/scan/types.js';
import { createDeterministicSummarizer, summarizeDeterministic } from '../../src/summarize/deterministic.js';
import type { SummaryInput } from '../../src/summarize/types.js';

const dep = (id: string, version: string, fixed: string | null, severity: Finding['severity']): Finding => ({
  fingerprint: `dep:npm:lodash:${id}`,
  category: 'dependency',
  severity,
  ruleId: 'osv.advisory',
  title: `Prototype pollution (lodash@${version})`,
  description: 'd',
  recommendation: fixed ? `Upgrade lodash from ${version} to ${fixed} or later.` : 'No fixed version is published for lodash.',
  location: `lodash@${version} (npm) in package-lock.json`,
  referenceId: id,
  referenceUrl: `https://osv.dev/vulnerability/${id}`,
  evidence: null,
  metadata: { ecosystem: 'npm', package: 'lodash', version, fixedVersion: fixed },
});

const secret: Finding = {
  fingerprint: 'code:secret.aws_access_key:src/config.js:abc',
  category: 'code',
  severity: 'critical',
  ruleId: 'secret.aws_access_key',
  title: 'AWS access key committed to the repository',
  description: 'd',
  recommendation: 'Rotate the AWS key found at src/config.js:3, remove it from the file, and load it from an environment variable or a secret manager.',
  location: 'src/config.js:3',
  referenceId: null,
  referenceUrl: null,
  evidence: 'const key = "AKIA****";',
  metadata: { line: 3, path: 'src/config.js', whyItMatters: 'Anyone who can read this repository can act as your AWS account.' },
};

const evalFinding: Finding = {
  fingerprint: 'code:code.eval:src/util.js:def',
  category: 'code',
  severity: 'medium',
  ruleId: 'code.eval',
  title: 'Use of eval',
  description: 'd',
  recommendation: 'Replace eval at src/util.js:9 with JSON.parse, a safe expression parser, or explicit logic.',
  location: 'src/util.js:9',
  referenceId: null,
  referenceUrl: null,
  evidence: 'eval(x)',
  metadata: { line: 9, path: 'src/util.js', whyItMatters: 'Evaluated input runs as code.' },
};

const noFix = { ...dep('GHSA-nofix', '1.0.0', null, 'low'), fingerprint: 'dep:npm:left-pad:GHSA-nofix', title: 'Something (left-pad@1.0.0)', metadata: { ecosystem: 'npm', package: 'left-pad', version: '1.0.0', fixedVersion: null } };

const input: SummaryInput = {
  repo: { owner: 'o', name: 'r', commitSha: 'a'.repeat(40) },
  findings: [evalFinding, dep('GHSA-1', '4.17.15', '4.17.19', 'high'), secret, dep('GHSA-2', '4.17.15', '4.17.21', 'high'), noFix],
  warnings: [{ code: 'no_lockfile', message: 'A manifest had no lockfile.' }],
  stats: { files: 120, packages: 40 },
};

describe('summarizeDeterministic', () => {
  it('reports no issues for an empty scan', () => {
    const s = summarizeDeterministic({ ...input, findings: [], warnings: [] });
    expect(s.riskLevel).toBe('none');
    expect(s.headline).toBe('No issues found in 120 files and 40 packages.');
    expect(s.topRisks).toEqual([]);
    expect(s.nextActions).toEqual([]);
  });

  it('orders risks by severity with secrets first and writes a counted headline', () => {
    const s = summarizeDeterministic(input);
    expect(s.riskLevel).toBe('critical');
    expect(s.headline).toBe('5 issues found (1 critical, 2 high, 1 medium, 1 low). Most urgent: AWS access key committed to the repository.');
    expect(s.topRisks.map((r) => r.fingerprint)).toEqual([secret.fingerprint, 'dep:npm:lodash:GHSA-1', 'dep:npm:lodash:GHSA-2', evalFinding.fingerprint, noFix.fingerprint]);
    expect(s.topRisks[0]?.whyItMatters).toContain('AWS account');
    expect(s.topRisks[1]?.whyItMatters).toContain('fix exists in 4.17.19');
    expect(s.overview).toContain('Overall risk is critical.');
    expect(s.overview).toContain('2 advisories affect 1 package; 2 of them have a fixed version available.');
    expect(s.overview).toContain('A manifest had no lockfile.');
  });

  it('groups dependency actions per package and orders actions by severity', () => {
    const s = summarizeDeterministic(input);
    expect(s.nextActions.map((a) => a.action)).toEqual([
      secret.recommendation,
      'Upgrade lodash from 4.17.15 to 4.17.21 or later (closes 2 advisories).',
      evalFinding.recommendation,
      'No fixed version is published for left-pad 1.0.0; review the advisory and consider replacing or isolating the package.',
    ]);
    expect(s.nextActions[1]).toMatchObject({ effort: 'minutes', resolves: ['dep:npm:lodash:GHSA-1', 'dep:npm:lodash:GHSA-2'] });
    expect(s.nextActions[2]?.effort).toBe('hours');
    expect(s.nextActions[3]?.effort).toBe('hours');
  });

  it('exposes a Summarizer with mode deterministic', async () => {
    const out = await createDeterministicSummarizer().summarize(input, new AbortController().signal);
    expect(out.mode).toBe('deterministic');
    expect(out.note).toBeNull();
    expect(out.summary.topRisks).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w server -- guards deterministic`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the modules**

`server/src/summarize/types.ts`:
```ts
import type { Finding, ScanWarning } from '../scan/types.js';
import type { Summary } from './contract.js';

export interface SummaryInput {
  repo: { owner: string; name: string; commitSha: string };
  findings: Finding[];
  warnings: ScanWarning[];
  stats: { files: number; packages: number };
}

export type SummarizerMode = 'claude' | 'deterministic';

export interface SummarizeOutcome {
  summary: Summary;
  mode: SummarizerMode;
  note: string | null;
}

export interface Summarizer {
  readonly mode: SummarizerMode;
  summarize(input: SummaryInput, signal: AbortSignal): Promise<SummarizeOutcome>;
}
```

`server/src/summarize/guards.ts`:
```ts
import { compareSeverity, type Finding } from '../scan/types.js';
import type { RiskLevel, Summary } from './contract.js';

export function highestSeverity(findings: Finding[]): RiskLevel {
  if (findings.length === 0) return 'none';
  return [...findings].sort((a, b) => compareSeverity(a.severity, b.severity))[0]!.severity;
}

export function sanitizeSummary(summary: Summary, findings: Finding[]): Summary {
  const known = new Set(findings.map((f) => f.fingerprint));
  const topRisks = summary.topRisks.filter((r) => known.has(r.fingerprint)).slice(0, 5);
  const nextActions = summary.nextActions
    .map((a) => ({ ...a, action: a.action.trim(), resolves: a.resolves.filter((fp) => known.has(fp)) }))
    .filter((a) => a.action.length > 0)
    .slice(0, 20);
  const riskLevel: RiskLevel = findings.length === 0 ? 'none' : summary.riskLevel === 'none' ? highestSeverity(findings) : summary.riskLevel;
  return {
    riskLevel,
    headline: summary.headline.trim().slice(0, 300),
    overview: summary.overview.trim().slice(0, 2000),
    topRisks,
    nextActions,
  };
}
```

`server/src/summarize/deterministic.ts`:
```ts
import { compareSeverity, SEVERITY_ORDER, type Category, type Finding, type Severity } from '../scan/types.js';
import type { Summary } from './contract.js';
import { highestSeverity, sanitizeSummary } from './guards.js';
import type { Summarizer, SummaryInput } from './types.js';

type Effort = Summary['nextActions'][number]['effort'];

const CATEGORY_RANK: Record<Category, number> = { code: 0, dependency: 1, config: 2 };
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

const isSecret = (f: Finding): boolean => f.ruleId.startsWith('secret.');

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      compareSeverity(a.severity, b.severity) ||
      Number(isSecret(b)) - Number(isSecret(a)) ||
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
      a.title.localeCompare(b.title),
  );
}

function whyItMatters(f: Finding): string {
  if (f.category === 'dependency') {
    const fixed = f.metadata.fixedVersion;
    return `${String(f.metadata.package)}@${String(f.metadata.version)} is affected by a known ${f.severity} severity vulnerability. ${
      typeof fixed === 'string' ? `A fix exists in ${fixed}.` : 'No fixed version is published yet.'
    }`;
  }
  const why = f.metadata.whyItMatters;
  return typeof why === 'string' ? why : f.description;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function effortFor(f: Finding): Effort {
  if (isSecret(f) || f.category === 'config') return 'minutes';
  return 'hours';
}

function buildHeadline(sorted: Finding[], counts: Record<Severity, number>, input: SummaryInput): string {
  if (sorted.length === 0) return `No issues found in ${plural(input.stats.files, 'file')} and ${plural(input.stats.packages, 'package')}.`;
  const parts = SEVERITIES.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`);
  return `${plural(sorted.length, 'issue')} found (${parts.join(', ')}). Most urgent: ${sorted[0]!.title}.`;
}

function buildOverview(sorted: Finding[], riskLevel: string, input: SummaryInput): string {
  const sentences: string[] = [];
  if (sorted.length === 0) {
    sentences.push(`The scan checked ${plural(input.stats.files, 'file')} and ${plural(input.stats.packages, 'package')} and found nothing to act on.`);
  } else {
    const secrets = sorted.filter(isSecret);
    const deps = sorted.filter((f) => f.category === 'dependency');
    const code = sorted.filter((f) => f.category === 'code' && !isSecret(f));
    const config = sorted.filter((f) => f.category === 'config');
    const groups: Array<[string, number]> = [
      ['leaked credentials', secrets.length],
      ['vulnerable dependencies', deps.length],
      ['risky code patterns', code.length],
      ['configuration issues', config.length],
    ];
    const [dominantName, dominantCount] = groups.sort((a, b) => b[1] - a[1])[0]!;
    sentences.push(`Overall risk is ${riskLevel}. The biggest category is ${dominantName} (${dominantCount} of ${sorted.length}).`);
    if (secrets.length > 0) sentences.push(`${plural(secrets.length, 'credential')} appear in source and should be rotated today.`);
    if (deps.length > 0) {
      const withFix = deps.filter((f) => typeof f.metadata.fixedVersion === 'string').length;
      const packages = new Set(deps.map((f) => String(f.metadata.package))).size;
      sentences.push(`${plural(deps.length, 'advisory', 'advisories')} affect ${plural(packages, 'package')}; ${withFix} of them have a fixed version available.`);
    }
  }
  for (const w of input.warnings) sentences.push(w.message);
  return sentences.join(' ');
}

function buildActions(sorted: Finding[]): Summary['nextActions'] {
  interface Draft {
    action: string;
    effort: Effort;
    resolves: string[];
    rank: number;
    count: number;
  }
  const drafts: Draft[] = [];

  for (const f of sorted.filter(isSecret)) {
    drafts.push({ action: f.recommendation, effort: 'minutes', resolves: [f.fingerprint], rank: SEVERITY_ORDER[f.severity], count: 1 });
  }

  const byPackage = new Map<string, Finding[]>();
  for (const f of sorted.filter((x) => x.category === 'dependency')) {
    const key = `${String(f.metadata.ecosystem)}:${String(f.metadata.package)}`;
    byPackage.set(key, [...(byPackage.get(key) ?? []), f]);
  }
  for (const group of byPackage.values()) {
    const top = group[0]!;
    const pkg = String(top.metadata.package);
    const version = String(top.metadata.version);
    const fixes = group.map((f) => f.metadata.fixedVersion).filter((v): v is string => typeof v === 'string');
    const fixed = fixes.length > 0 ? fixes.sort(compareVersions).at(-1)! : null;
    const count = group.length;
    const action = fixed
      ? `Upgrade ${pkg} from ${version} to ${fixed} or later${count > 1 ? ` (closes ${count} advisories)` : ''}.`
      : `No fixed version is published for ${pkg} ${version}; review the ${count > 1 ? 'advisories' : 'advisory'} and consider replacing or isolating the package.`;
    drafts.push({ action, effort: fixed ? 'minutes' : 'hours', resolves: group.map((f) => f.fingerprint), rank: Math.min(...group.map((f) => SEVERITY_ORDER[f.severity])), count });
  }

  for (const f of sorted.filter((x) => !isSecret(x) && x.category !== 'dependency')) {
    drafts.push({ action: f.recommendation, effort: effortFor(f), resolves: [f.fingerprint], rank: SEVERITY_ORDER[f.severity], count: 1 });
  }

  drafts.sort((a, b) => a.rank - b.rank || b.count - a.count || a.action.localeCompare(b.action));
  return drafts.slice(0, 20).map(({ action, effort, resolves }) => ({ action, effort, resolves }));
}

export function summarizeDeterministic(input: SummaryInput): Summary {
  const sorted = sortFindings(input.findings);
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of sorted) counts[f.severity] += 1;
  const riskLevel = highestSeverity(sorted);
  return {
    riskLevel,
    headline: buildHeadline(sorted, counts, input),
    overview: buildOverview(sorted, riskLevel, input),
    topRisks: sorted.slice(0, 5).map((f) => ({ fingerprint: f.fingerprint, title: f.title, whyItMatters: whyItMatters(f) })),
    nextActions: buildActions(sorted),
  };
}

export function createDeterministicSummarizer(): Summarizer {
  return {
    mode: 'deterministic',
    async summarize(input) {
      return { summary: sanitizeSummary(summarizeDeterministic(input), input.findings), mode: 'deterministic', note: null };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w server -- guards deterministic`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(summarize): rule-based summary with grouped actions and output guards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 21: Real pipeline wired into the worker

**Files:**
- Modify: `server/src/scan/pipeline.ts` (add `createPipeline`), `server/src/main.ts`
- Create: `server/test/fixtures/repo-vulnerable/package.json`, `package-lock.json`, `src/config.js`, `src/util.js`; `server/test/fixtures/osv/GHSA-p6mc-m468-83gw.json`
- Test: `server/test/integration/pipeline.test.ts`

**Interfaces:**
- Produces: `createPipeline({ exec, token?, osv, cache, summarizer, fetchTimeoutMs?, stageTimeoutMs?, tmpRoot?, onStage? }): Pipeline`. Stage percentages: fetching 2 to 25, dependencies 30 to 60, code 62 to 85, summarizing 88, persisting 98 (set by the handler). `stats.stageDurationsMs` has one entry per stage run.

- [ ] **Step 1: Write the fixtures**

`server/test/fixtures/repo-vulnerable/package.json`:
```json
{
  "name": "vulnerable-demo",
  "version": "1.0.0",
  "private": true,
  "dependencies": { "lodash": "4.17.15" }
}
```

`server/test/fixtures/repo-vulnerable/package-lock.json`:
```json
{
  "name": "vulnerable-demo",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": { "name": "vulnerable-demo", "version": "1.0.0", "dependencies": { "lodash": "4.17.15" } },
    "node_modules/lodash": { "version": "4.17.15", "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz" }
  }
}
```

`server/test/fixtures/repo-vulnerable/src/config.js`:
```js
module.exports = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
};
```

`server/test/fixtures/repo-vulnerable/src/util.js`:
```js
function run(expr) {
  return eval(expr);
}
module.exports = { run };
```

`server/test/fixtures/osv/GHSA-p6mc-m468-83gw.json`:
```json
{
  "id": "GHSA-p6mc-m468-83gw",
  "summary": "Prototype Pollution in lodash",
  "details": "Versions of lodash prior to 4.17.19 are vulnerable to Prototype Pollution.",
  "aliases": ["CVE-2020-8203"],
  "severity": [{ "type": "CVSS_V3", "score": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H" }],
  "database_specific": { "severity": "HIGH", "cwe_ids": ["CWE-1321"] },
  "affected": [
    { "package": { "name": "lodash", "ecosystem": "npm" }, "ranges": [{ "type": "SEMVER", "events": [{ "introduced": "3.7.0" }, { "fixed": "4.17.19" }] }] }
  ],
  "references": [{ "type": "ADVISORY", "url": "https://nvd.nist.gov/vuln/detail/CVE-2020-8203" }]
}
```

- [ ] **Step 2: Write the failing test**

`server/test/integration/pipeline.test.ts`:
```ts
import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createScan, getScan, listFindings } from '../../src/db/scans-repo.js';
import type { Exec } from '../../src/github/exec.js';
import { createMemoryVulnCache } from '../../src/osv/cache.js';
import type { OsvClient } from '../../src/osv/client.js';
import type { OsvVuln } from '../../src/osv/types.js';
import { createPipeline } from '../../src/scan/pipeline.js';
import { createScanJobHandler } from '../../src/scan/run-scan.js';
import { createDeterministicSummarizer } from '../../src/summarize/deterministic.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = path.resolve(here, '../fixtures/repo-vulnerable');
const SHA = 'c'.repeat(40);

function createFixtureExec(): Exec {
  return async (_cmd, args, opts) => {
    if (args.includes('checkout')) await cp(FIXTURE_REPO, opts.cwd!, { recursive: true });
    if (args.includes('rev-parse')) return { stdout: `${SHA}\n`, stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

describe.skipIf(!TEST_DATABASE_URL)('real pipeline', () => {
  let t: TestDb;
  let osvVuln: OsvVuln;
  beforeAll(async () => {
    t = await setupTestDb();
    osvVuln = JSON.parse(await readFile(path.resolve(here, '../fixtures/osv/GHSA-p6mc-m468-83gw.json'), 'utf8')) as OsvVuln;
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it('fetches, scans dependencies and code, summarizes and persists', async () => {
    const osv: OsvClient = {
      queryBatch: async (refs) => refs.map((r) => (r.name === 'lodash' ? [osvVuln.id] : [])),
      getVuln: async () => osvVuln,
    };
    const stages: string[] = [];
    const pipeline = createPipeline({ exec: createFixtureExec(), osv, cache: createMemoryVulnCache(), summarizer: createDeterministicSummarizer(), onStage: (s) => stages.push(s) });
    const scan = await createScan(t.db, { repoOwner: 'o', repoName: 'r', repoUrl: 'https://github.com/o/r', refRequested: null, refResolved: 'refs/heads/main', commitSha: SHA, maxAttempts: 3 });
    const handler = createScanJobHandler({ db: t.db, pipeline, logger: pino({ level: 'silent' }) });
    await handler({ id: 'j', data: { scanId: scan.id }, retryCount: 0, retryLimit: 2, signal: new AbortController().signal });

    const done = await getScan(t.db, scan.id);
    expect(done?.status).toBe('done');
    expect(done?.summary?.riskLevel).toBe('critical');
    expect(done?.stats.files).toBe(4);
    expect(done?.stats.packages).toBe(1);
    expect(Object.keys(done?.stats.stageDurationsMs ?? {}).sort()).toEqual(['code', 'dependencies', 'fetching', 'summarizing']);
    expect(stages).toEqual(['fetching', 'dependencies', 'code', 'summarizing']);
    const rules = (await listFindings(t.db, scan.id)).map((f) => f.ruleId).sort();
    expect(rules).toEqual(['code.eval', 'osv.advisory', 'secret.aws_access_key']);
    const key = (await listFindings(t.db, scan.id)).find((f) => f.ruleId === 'secret.aws_access_key');
    expect(key?.evidence).not.toContain('IOSFODNN7EXAMPLE');
    expect(done?.summary?.nextActions[0]?.action).toContain('Rotate the AWS key');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:integration -w server -- pipeline`
Expected: FAIL, `createPipeline` is not exported.

- [ ] **Step 4: Add `createPipeline` to `server/src/scan/pipeline.ts`**

Append to the file (keep the interfaces from Task 13):
```ts
import type { Exec } from '../github/exec.js';
import type { VulnCache } from '../osv/cache.js';
import type { OsvClient } from '../osv/client.js';
import type { Summarizer } from '../summarize/types.js';
import { runCodeStage } from './code-stage.js';
import { runDependencyStage } from './deps-stage.js';
import { fetchRepo } from './fetch.js';

export interface PipelineDeps {
  exec: Exec;
  token?: string | undefined;
  osv: OsvClient;
  cache: VulnCache;
  summarizer: Summarizer;
  fetchTimeoutMs?: number;
  stageTimeoutMs?: number;
  tmpRoot?: string;
  onStage?: (stage: Stage, ms: number) => void;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const stageTimeoutMs = deps.stageTimeoutMs ?? 120_000;
  const fetchTimeoutMs = deps.fetchTimeoutMs ?? 120_000;

  return {
    async run(ctx) {
      const durations: Partial<Record<Stage, number>> = {};
      const warnings: ScanWarning[] = [];
      const findings: Finding[] = [];

      const timed = async <T>(stage: Stage, fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        const started = Date.now();
        const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(stage === 'fetching' ? fetchTimeoutMs : stageTimeoutMs)]);
        try {
          return await fn(signal);
        } finally {
          const ms = Date.now() - started;
          durations[stage] = ms;
          deps.onStage?.(stage, ms);
        }
      };

      await ctx.progress('fetching', 2, `Fetching ${ctx.scan.repoOwner}/${ctx.scan.repoName} at ${ctx.scan.commitSha.slice(0, 7)}`);
      const fetched = await timed('fetching', (signal) =>
        fetchRepo({ repoUrl: ctx.scan.repoUrl, commitSha: ctx.scan.commitSha, token: deps.token, exec: deps.exec, signal, timeoutMs: fetchTimeoutMs, tmpRoot: deps.tmpRoot }),
      );

      try {
        await ctx.progress('fetching', 25, `Fetched ${fetched.fileCount} files`);

        await ctx.progress('dependencies', 30, 'Looking for dependency manifests');
        const depsResult = await timed('dependencies', (signal) =>
          runDependencyStage({ dir: fetched.dir, osv: deps.osv, cache: deps.cache, signal, log: ctx.log, progress: (pct, message) => ctx.progress('dependencies', pct, message) }),
        );
        findings.push(...depsResult.findings);
        warnings.push(...depsResult.warnings);

        await ctx.progress('code', 62, 'Scanning code for secrets and risky patterns');
        const codeResult = await timed('code', (signal) => runCodeStage({ dir: fetched.dir, signal, progress: (pct, message) => ctx.progress('code', pct, message) }));
        findings.push(...codeResult.findings);
        if (codeResult.truncated) warnings.push({ code: 'too_many_files', message: 'Only the first 5000 files were scanned for code patterns.' });

        await ctx.progress('summarizing', 88, deps.summarizer.mode === 'claude' ? 'Summarizing with Claude' : 'Summarizing');
        const outcome = await timed('summarizing', (signal) =>
          deps.summarizer.summarize(
            { repo: { owner: ctx.scan.repoOwner, name: ctx.scan.repoName, commitSha: fetched.commitSha }, findings, warnings, stats: { files: codeResult.files, packages: depsResult.packages } },
            signal,
          ),
        );

        return {
          findings,
          warnings,
          stats: { files: codeResult.files, packages: depsResult.packages, advisories: depsResult.advisories, stageDurationsMs: durations },
          summary: outcome.summary,
          summarizer: outcome.mode,
          summarizerNote: outcome.note,
          commitSha: fetched.commitSha,
        };
      } finally {
        await fetched.cleanup();
      }
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:integration -w server -- pipeline`
Expected: 1 test passes.

- [ ] **Step 6: Swap the fake pipeline in `server/src/main.ts`**

Replace the `createFakePipeline` import with:
```ts
import { createOsvClient } from './osv/client.js';
import { createDbVulnCache } from './osv/cache.js';
import { createPipeline } from './scan/pipeline.js';
import { createDeterministicSummarizer } from './summarize/deterministic.js';
```
and replace the handler construction with:
```ts
    const pipeline = createPipeline({
      exec: realExec,
      token: config.GITHUB_TOKEN,
      osv: createOsvClient(),
      cache: createDbVulnCache(db),
      summarizer: createDeterministicSummarizer(),
    });
    const handler = createScanJobHandler({ db, pipeline, logger });
```

- [ ] **Step 7: Scan a real repository in Docker**

```bash
docker compose up --build -d
curl -s -X POST localhost:8080/api/scans -H 'Content-Type: application/json' -d '{"repoUrl":"https://github.com/expressjs/express/tree/4.17.1"}'
```
Open the scan in the browser. Expected: real progress messages ("Fetched N files", "Checked N packages against OSV, N advisories found"), then a result whose headline counts real advisories for express 4.17.1 dependencies. `docker compose down`.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
npm run typecheck -w server && npm run lint -w server
git add -A
git commit -m "feat(scan): real pipeline with git fetch, osv advisories, code rules and summary

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 22: Comparison with the previous scan

**Files:**
- Create: `server/src/compare/diff.ts`
- Modify: `server/src/api/read-model.ts`
- Test: `server/test/unit/diff.test.ts`, `server/test/integration/comparison.test.ts`

**Interfaces:**
- Produces: `diffFindings(current, previous): { new, fixed, stillOpen }`; `buildComparison(q, scan, currentFindings): Promise<Comparison | null>`; `loadScanView` now fills `comparison` for done scans with a previous scan.

- [ ] **Step 1: Write the failing tests**

`server/test/unit/diff.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { diffFindings } from '../../src/compare/diff.js';
import type { Finding } from '../../src/scan/types.js';

const f = (fingerprint: string): Finding => ({ fingerprint, category: 'code', severity: 'low', ruleId: 'r', title: fingerprint, description: '', recommendation: '', location: '', referenceId: null, referenceUrl: null, evidence: null, metadata: {} });

describe('diffFindings', () => {
  it('splits findings into new, fixed and still open by fingerprint', () => {
    const diff = diffFindings([f('a'), f('b')], [f('b'), f('c')]);
    expect(diff.new.map((x) => x.fingerprint)).toEqual(['a']);
    expect(diff.fixed.map((x) => x.fingerprint)).toEqual(['c']);
    expect(diff.stillOpen.map((x) => x.fingerprint)).toEqual(['b']);
  });
});
```

`server/test/integration/comparison.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadScanView } from '../../src/api/read-model.js';
import { completeScan, createScan, startAttempt } from '../../src/db/scans-repo.js';
import type { Finding } from '../../src/scan/types.js';
import type { Summary } from '../../src/summarize/contract.js';
import { resetDb, setupTestDb, TEST_DATABASE_URL, type TestDb } from './helpers.js';

const f = (fingerprint: string): Finding => ({ fingerprint, category: 'code', severity: 'high', ruleId: 'r', title: fingerprint, description: '', recommendation: '', location: 'x:1', referenceId: null, referenceUrl: null, evidence: null, metadata: {} });
const summary: Summary = { riskLevel: 'high', headline: 'h', overview: 'o', topRisks: [], nextActions: [] };
const base = { repoOwner: 'o', repoName: 'r', repoUrl: 'https://github.com/o/r', refRequested: null, refResolved: 'refs/heads/main', maxAttempts: 3 };

describe.skipIf(!TEST_DATABASE_URL)('comparison', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await setupTestDb();
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it('diffs against the previous done scan and flags same-commit rescans', async () => {
    const first = await createScan(t.db, { ...base, commitSha: '1'.repeat(40) });
    await startAttempt(t.db, first.id, 1);
    await completeScan(t.db, first.id, { findings: [f('a'), f('b')], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: null });

    const second = await createScan(t.db, { ...base, commitSha: '2'.repeat(40) });
    await startAttempt(t.db, second.id, 1);
    await completeScan(t.db, second.id, { findings: [f('b'), f('c')], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: first.id });

    const view = await loadScanView(t.db, second.id);
    expect(view?.comparison).toMatchObject({ previousScanId: first.id, previousSha: '1'.repeat(40), sameCommit: false });
    expect(view?.comparison?.new.map((x) => x.fingerprint)).toEqual(['c']);
    expect(view?.comparison?.fixed.map((x) => x.fingerprint)).toEqual(['a']);
    expect(view?.comparison?.stillOpen.map((x) => x.fingerprint)).toEqual(['b']);

    const third = await createScan(t.db, { ...base, commitSha: '2'.repeat(40) });
    await startAttempt(t.db, third.id, 1);
    await completeScan(t.db, third.id, { findings: [f('b'), f('c')], summary, summarizer: 'deterministic', summarizerNote: null, warnings: [], stats: {}, previousScanId: second.id });
    expect((await loadScanView(t.db, third.id))?.comparison?.sameCommit).toBe(true);
    expect((await loadScanView(t.db, first.id))?.comparison).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w server -- diff && npm run test:integration -w server -- comparison`
Expected: FAIL.

- [ ] **Step 3: Write `server/src/compare/diff.ts`**

```ts
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
```

- [ ] **Step 4: Wire it into `server/src/api/read-model.ts`**

Add the import `import { diffFindings } from '../compare/diff.js';` and this function:
```ts
export async function buildComparison(q: Queryable, scan: ScanRow, current: Finding[]): Promise<Comparison | null> {
  if (!scan.previousScanId) return null;
  const previous = await getScan(q, scan.previousScanId);
  if (!previous) return null;
  const previousFindings = (await listFindings(q, previous.id)).map(toFinding);
  const diff = diffFindings(current, previousFindings);
  return { previousScanId: previous.id, previousSha: previous.commitSha, sameCommit: previous.commitSha === scan.commitSha, ...diff };
}
```
In `loadScanView`, replace `comparison: null,` with:
```ts
    comparison: findingsList ? await buildComparison(q, scan, findingsList) : null,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w server -- diff && npm run test:integration -w server -- comparison`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): compare findings with the previous scan of the same repository

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 23: Result view, history and grouped recent scans

**Files:**
- Create: `web/src/components/RiskBadge.tsx`, `TopRisks.tsx`, `NextActions.tsx`, `ComparisonSection.tsx`, `FindingsTable.tsx`, `ScanResult.tsx` (all under `web/src/components/`), `web/src/pages/RepoHistoryPage.tsx`
- Modify: `web/src/pages/ScanPage.tsx`, `web/src/pages/HomePage.tsx`, `web/src/App.tsx`
- Test: `web/src/test/ScanResult.test.tsx`, `web/src/test/FindingsTable.test.tsx`

**Interfaces:**
- Produces: `<ScanResult view />` rendering, in order: header badges, warnings, "What matters", "What is risky", "What to do next", "Since previous scan" (when `comparison` is present), "All findings"; `<FindingsTable findings />` with severity and category filters and expandable rows; route `/repos/:owner/:name`.

- [ ] **Step 1: Write the failing tests**

`web/src/test/fixtures.ts`:
```ts
import type { Finding, ScanView } from '../types';

export const finding = (over: Partial<Finding>): Finding => ({
  fingerprint: 'fp',
  category: 'code',
  severity: 'high',
  ruleId: 'rule',
  title: 'Title',
  description: 'Description',
  recommendation: 'Recommendation',
  location: 'src/a.js:1',
  referenceId: null,
  referenceUrl: null,
  evidence: null,
  metadata: {},
  ...over,
});

export const doneView: ScanView = {
  id: 's1',
  repoOwner: 'o',
  repoName: 'r',
  repoUrl: 'https://github.com/o/r',
  refRequested: null,
  refResolved: 'refs/heads/main',
  commitSha: '0123456789abcdef0123456789abcdef01234567',
  status: 'done',
  stage: null,
  progressPct: 100,
  progressMessage: 'Scan complete',
  attempts: 1,
  maxAttempts: 3,
  error: null,
  warnings: [{ code: 'osv_unavailable', message: 'The dependency vulnerability check did not run.' }],
  summary: {
    riskLevel: 'critical',
    headline: '3 issues found (1 critical, 1 high, 1 medium). Most urgent: AWS key.',
    overview: 'Overall risk is critical.',
    topRisks: [
      { fingerprint: 'aws', title: 'AWS key', whyItMatters: 'Anyone can use your AWS account.' },
      { fingerprint: 'lodash', title: 'Prototype pollution (lodash@4.17.15)', whyItMatters: 'A fix exists in 4.17.19.' },
    ],
    nextActions: [
      { action: 'Rotate the AWS key found at src/config.js:3.', effort: 'minutes', resolves: ['aws'] },
      { action: 'Upgrade lodash from 4.17.15 to 4.17.19 or later.', effort: 'minutes', resolves: ['lodash'] },
      { action: 'Replace eval at src/util.js:9.', effort: 'hours', resolves: ['eval'] },
    ],
  },
  summarizer: 'deterministic',
  summarizerNote: null,
  stats: { files: 12, packages: 3, totalMs: 4200 },
  previousScanId: 's0',
  createdAt: '2026-10-18T12:00:00Z',
  startedAt: '2026-10-18T12:00:01Z',
  finishedAt: '2026-10-18T12:00:05Z',
  events: [],
  findings: [
    finding({ fingerprint: 'aws', severity: 'critical', ruleId: 'secret.aws_access_key', title: 'AWS key', location: 'src/config.js:3', evidence: 'key = "AKIA****"' }),
    finding({ fingerprint: 'lodash', severity: 'high', category: 'dependency', ruleId: 'osv.advisory', title: 'Prototype pollution (lodash@4.17.15)', location: 'lodash@4.17.15 (npm) in package-lock.json', referenceId: 'GHSA-1', referenceUrl: 'https://osv.dev/vulnerability/GHSA-1' }),
    finding({ fingerprint: 'eval', severity: 'medium', ruleId: 'code.eval', title: 'Use of eval', location: 'src/util.js:9' }),
  ],
  comparison: {
    previousScanId: 's0',
    previousSha: 'fedcba9876543210fedcba9876543210fedcba98',
    sameCommit: false,
    new: [finding({ fingerprint: 'eval', title: 'Use of eval' })],
    fixed: [finding({ fingerprint: 'old', title: 'Old minimist advisory' })],
    stillOpen: [finding({ fingerprint: 'aws', title: 'AWS key' }), finding({ fingerprint: 'lodash', title: 'Prototype pollution (lodash@4.17.15)' })],
  },
};
```

`web/src/test/ScanResult.test.tsx`:
```tsx
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ScanResult } from '../components/ScanResult';
import { doneView } from './fixtures';

function renderResult(view = doneView) {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <ScanResult view={view} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('ScanResult', () => {
  it('renders the three product sections in order plus comparison and findings', () => {
    renderResult();
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    const order = ['What matters', 'What is risky', 'What to do next', 'Since previous scan', 'All findings'].map((t) => headings.findIndex((h) => h?.startsWith(t)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getByText(doneView.summary!.headline)).toBeInTheDocument();
    expect(screen.getByText('Anyone can use your AWS account.')).toBeInTheDocument();
    expect(screen.getByText(/1 fixed/)).toBeInTheDocument();
    expect(screen.getByText(/1 new/)).toBeInTheDocument();
    expect(screen.getByText(/2 still open/)).toBeInTheDocument();
    expect(screen.getByText('The dependency vulnerability check did not run.')).toBeInTheDocument();
  });

  it('labels same-commit rescans', () => {
    renderResult({ ...doneView, comparison: { ...doneView.comparison!, sameCommit: true } });
    expect(screen.getByText(/Same commit as your previous scan/)).toBeInTheDocument();
    expect(screen.getByText(/updated advisory data/)).toBeInTheDocument();
  });
});
```

`web/src/test/FindingsTable.test.tsx`:
```tsx
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FindingsTable } from '../components/FindingsTable';
import { doneView } from './fixtures';

describe('FindingsTable', () => {
  it('filters by severity and expands a row', () => {
    render(
      <MantineProvider>
        <FindingsTable findings={doneView.findings!} />
      </MantineProvider>,
    );
    expect(screen.getAllByRole('row')).toHaveLength(4);
    fireEvent.click(screen.getByRole('radio', { name: 'critical' }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    fireEvent.click(screen.getByText('AWS key'));
    expect(screen.getByText('key = "AKIA****"')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w web`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the components**

`web/src/components/RiskBadge.tsx`:
```tsx
import { Badge } from '@mantine/core';
import { riskColor } from '../lib/format';
import type { RiskLevel } from '../types';

export function RiskBadge({ risk, size = 'lg' }: { risk: RiskLevel; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <Badge color={riskColor(risk)} size={size} variant="filled">
      {risk === 'none' ? 'No issues' : `${risk} risk`}
    </Badge>
  );
}
```

`web/src/components/TopRisks.tsx`:
```tsx
import { Badge, Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { severityColor } from '../lib/format';
import type { Finding, Summary } from '../types';

export function TopRisks({ risks, findings }: { risks: Summary['topRisks']; findings: Finding[] }) {
  const byFingerprint = new Map(findings.map((f) => [f.fingerprint, f]));
  if (risks.length === 0) return <Text c="dimmed">Nothing stood out.</Text>;
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
      {risks.map((risk) => {
        const finding = byFingerprint.get(risk.fingerprint);
        return (
          <Card key={risk.fingerprint} withBorder radius="md" padding="md">
            <Stack gap="xs">
              <Group gap="xs">
                {finding && (
                  <Badge color={severityColor(finding.severity)} variant="light">
                    {finding.severity}
                  </Badge>
                )}
                <Text fw={600}>{risk.title}</Text>
              </Group>
              {finding && (
                <Text size="xs" c="dimmed" ff="monospace">
                  {finding.location}
                </Text>
              )}
              <Text size="sm">{risk.whyItMatters}</Text>
            </Stack>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}
```

`web/src/components/NextActions.tsx`:
```tsx
import { Badge, Collapse, Group, List, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import type { Finding, Summary } from '../types';

const EFFORT_COLOR = { minutes: 'green', hours: 'yellow', days: 'orange' } as const;

export function NextActions({ actions, findings }: { actions: Summary['nextActions']; findings: Finding[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const byFingerprint = new Map(findings.map((f) => [f.fingerprint, f]));
  if (actions.length === 0) return <Text c="dimmed">No actions needed.</Text>;
  return (
    <Stack gap="sm">
      {actions.map((action, i) => {
        const resolved = action.resolves.map((fp) => byFingerprint.get(fp)).filter((f): f is Finding => Boolean(f));
        return (
          <Paper key={`${i}-${action.action}`} withBorder radius="md" p="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Group gap="sm" align="flex-start" wrap="nowrap">
                <Badge circle size="lg" variant="filled">
                  {i + 1}
                </Badge>
                <Text>{action.action}</Text>
              </Group>
              <Badge color={EFFORT_COLOR[action.effort]} variant="light">
                {action.effort}
              </Badge>
            </Group>
            {resolved.length > 0 && (
              <Stack gap={4} mt="xs" pl={44}>
                <UnstyledButton onClick={() => setOpen(open === i ? null : i)}>
                  <Text size="xs" c="dimmed">
                    {open === i ? 'Hide' : 'Show'} the {resolved.length} finding{resolved.length === 1 ? '' : 's'} this resolves
                  </Text>
                </UnstyledButton>
                <Collapse in={open === i}>
                  <List size="sm">
                    {resolved.map((f) => (
                      <List.Item key={f.fingerprint}>{f.title}</List.Item>
                    ))}
                  </List>
                </Collapse>
              </Stack>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}
```

`web/src/components/ComparisonSection.tsx`:
```tsx
import { Accordion, Anchor, Badge, Group, List, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { shortSha } from '../lib/format';
import type { Comparison, Finding } from '../types';

function Section({ value, label, color, items }: { value: string; label: string; color: string; items: Finding[] }) {
  return (
    <Accordion.Item value={value}>
      <Accordion.Control disabled={items.length === 0}>
        <Group gap="xs">
          <Badge color={color} variant="light">
            {items.length}
          </Badge>
          <Text>{label}</Text>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <List size="sm">
          {items.map((f) => (
            <List.Item key={f.fingerprint}>
              {f.title} <Text span c="dimmed" size="xs" ff="monospace">{f.location}</Text>
            </List.Item>
          ))}
        </List>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

export function ComparisonSection({ comparison, previousFinishedAgo }: { comparison: Comparison; previousFinishedAgo: string | null }) {
  return (
    <Stack gap="sm">
      <Title order={3}>{comparison.sameCommit ? `Since previous scan: same commit as your previous scan${previousFinishedAgo ? `, ${previousFinishedAgo}` : ''}` : 'Since previous scan'}</Title>
      <Text c="dimmed" size="sm">
        {comparison.sameCommit
          ? 'Any differences below come from updated advisory data, not code changes.'
          : <>Compared with commit <Anchor component={Link} to={`/scans/${comparison.previousScanId}`} ff="monospace">{shortSha(comparison.previousSha)}</Anchor>.</>}
      </Text>
      <Text fw={500}>
        {comparison.fixed.length} fixed · {comparison.new.length} new · {comparison.stillOpen.length} still open
      </Text>
      <Accordion variant="separated" multiple>
        <Section value="fixed" label="Fixed" color="green" items={comparison.fixed} />
        <Section value="new" label="New" color="red" items={comparison.new} />
        <Section value="open" label="Still open" color="gray" items={comparison.stillOpen} />
      </Accordion>
    </Stack>
  );
}
```

`web/src/components/FindingsTable.tsx`:
```tsx
import { Anchor, Badge, Code, Collapse, Group, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { useMemo, useState } from 'react';
import { SEVERITIES, severityColor } from '../lib/format';
import type { Category, Finding, Severity } from '../types';

type SeverityFilter = 'all' | Severity;
type CategoryFilter = 'all' | Category;

export function FindingsTable({ findings }: { findings: Finding[] }) {
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(
    () => findings.filter((f) => (severity === 'all' || f.severity === severity) && (category === 'all' || f.category === category)),
    [findings, severity, category],
  );

  return (
    <Stack gap="sm">
      <Group gap="md">
        <SegmentedControl
          size="xs"
          value={severity}
          onChange={(v) => setSeverity(v as SeverityFilter)}
          data={[{ label: 'all severities', value: 'all' }, ...SEVERITIES.map((s) => ({ label: s, value: s }))]}
        />
        <SegmentedControl
          size="xs"
          value={category}
          onChange={(v) => setCategory(v as CategoryFilter)}
          data={[
            { label: 'all categories', value: 'all' },
            { label: 'dependency', value: 'dependency' },
            { label: 'code', value: 'code' },
            { label: 'config', value: 'config' },
          ]}
        />
        <Text size="sm" c="dimmed">
          {rows.length} of {findings.length}
        </Text>
      </Group>
      <Table highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={110}>Severity</Table.Th>
            <Table.Th>Finding</Table.Th>
            <Table.Th>Location</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((f) => (
            <Table.Tr key={f.fingerprint} style={{ cursor: 'pointer' }} onClick={() => setOpen(open === f.fingerprint ? null : f.fingerprint)}>
              <Table.Td>
                <Badge color={severityColor(f.severity)} variant="light">
                  {f.severity}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text fw={500}>{f.title}</Text>
                <Collapse in={open === f.fingerprint}>
                  <Stack gap="xs" mt="xs">
                    <Text size="sm">{f.description}</Text>
                    {f.evidence && <Code block>{f.evidence}</Code>}
                    <Text size="sm">
                      <Text span fw={600}>
                        Recommendation:
                      </Text>{' '}
                      {f.recommendation}
                    </Text>
                    {f.referenceUrl && (
                      <Anchor href={f.referenceUrl} target="_blank" size="sm">
                        {f.referenceId ?? f.referenceUrl}
                      </Anchor>
                    )}
                  </Stack>
                </Collapse>
              </Table.Td>
              <Table.Td>
                <Text size="xs" ff="monospace" c="dimmed">
                  {f.location}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
```

`web/src/components/ScanResult.tsx`:
```tsx
import { Alert, Badge, Group, Paper, Stack, Text, Title, Tooltip } from '@mantine/core';
import { formatDuration } from '../lib/format';
import type { ScanView } from '../types';
import { ComparisonSection } from './ComparisonSection';
import { FindingsTable } from './FindingsTable';
import { NextActions } from './NextActions';
import { RiskBadge } from './RiskBadge';
import { TopRisks } from './TopRisks';

export function ScanResult({ view }: { view: ScanView }) {
  const summary = view.summary;
  const findings = view.findings ?? [];
  if (!summary) return <Alert color="red">This scan finished without a summary.</Alert>;
  return (
    <Stack gap="xl">
      <Group gap="sm">
        <RiskBadge risk={summary.riskLevel} />
        <Tooltip label={view.summarizerNote ?? (view.summarizer === 'claude' ? 'Written by Claude from the scan findings' : 'Produced by deterministic rules')} withArrow>
          <Badge variant="outline" color={view.summarizer === 'claude' ? 'grape' : 'gray'}>
            {view.summarizer === 'claude' ? 'AI summary' : 'Rule-based summary'}
          </Badge>
        </Tooltip>
        {view.stats.totalMs !== undefined && (
          <Text size="sm" c="dimmed">
            {view.stats.files ?? 0} files · {view.stats.packages ?? 0} packages · {formatDuration(view.stats.totalMs)}
          </Text>
        )}
      </Group>

      {view.warnings.map((w) => (
        <Alert key={w.code} color="yellow" title="Heads up">
          {w.message}
        </Alert>
      ))}

      <Stack gap="sm">
        <Title order={3}>What matters</Title>
        <Paper withBorder radius="md" p="lg">
          <Stack gap="xs">
            <Title order={4}>{summary.headline}</Title>
            <Text>{summary.overview}</Text>
          </Stack>
        </Paper>
      </Stack>

      <Stack gap="sm">
        <Title order={3}>What is risky</Title>
        <TopRisks risks={summary.topRisks} findings={findings} />
      </Stack>

      <Stack gap="sm">
        <Title order={3}>What to do next</Title>
        <NextActions actions={summary.nextActions} findings={findings} />
      </Stack>

      {view.comparison && <ComparisonSection comparison={view.comparison} previousFinishedAgo={null} />}

      <Stack gap="sm">
        <Title order={3}>All findings</Title>
        {findings.length === 0 ? <Text c="dimmed">No findings.</Text> : <FindingsTable findings={findings} />}
      </Stack>
    </Stack>
  );
}
```

`web/src/pages/RepoHistoryPage.tsx`:
```tsx
import { Anchor, Divider, Paper, Skeleton, Stack, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { api } from '../api';
import { ScanListItemRow } from '../components/ScanListItemRow';
import type { ScanListItem } from '../types';

export function RepoHistoryPage() {
  const { owner = '', name = '' } = useParams();
  const [items, setItems] = useState<ScanListItem[] | null>(null);
  useEffect(() => {
    api
      .listScans(200)
      .then((r) => setItems(r.scans.filter((s) => s.repoOwner === owner && s.repoName === name)))
      .catch(() => setItems([]));
  }, [owner, name]);
  return (
    <Stack gap="md">
      <Stack gap={2}>
        <Title order={2}>
          {owner}/{name}
        </Title>
        <Anchor href={`https://github.com/${owner}/${name}`} target="_blank" size="sm">
          View on GitHub
        </Anchor>
      </Stack>
      {items === null && <Skeleton height={120} radius="md" />}
      {items !== null && items.length === 0 && <Text c="dimmed">No scans yet for this repository.</Text>}
      {items !== null && items.length > 0 && (
        <Paper withBorder px="md" radius="md">
          {items.map((item, i) => (
            <div key={item.id}>
              {i > 0 && <Divider />}
              <ScanListItemRow item={item} showRepo={false} />
            </div>
          ))}
        </Paper>
      )}
    </Stack>
  );
}
```

- [ ] **Step 4: Wire pages and routes**

In `web/src/pages/ScanPage.tsx`: delete `ScanResultBasic`, import `ScanResult` from `../components/ScanResult`, render `{view.status === 'done' && <ScanResult view={view} />}`, and remove the Mantine imports that became unused (`Paper` at least) so lint passes.

In `web/src/pages/HomePage.tsx`, replace the "Recent scans" block with a grouped version:
```tsx
      {recent.length > 0 && (
        <Stack gap="md">
          <Title order={4}>Recent scans</Title>
          {Object.entries(
            recent.reduce<Record<string, ScanListItem[]>>((acc, item) => {
              const key = `${item.repoOwner}/${item.repoName}`;
              (acc[key] ??= []).push(item);
              return acc;
            }, {}),
          ).map(([repo, items]) => (
            <Paper key={repo} withBorder px="md" py="xs" radius="md">
              <Anchor component={Link} to={`/repos/${repo}`} fw={600}>
                {repo}
              </Anchor>
              {items.map((item) => (
                <div key={item.id}>
                  <Divider />
                  <ScanListItemRow item={item} showRepo={false} />
                </div>
              ))}
            </Paper>
          ))}
        </Stack>
      )}
```
Add `import { Link } from 'react-router';` and `Anchor` to the Mantine import in HomePage.

In `web/src/App.tsx`, add `import { RepoHistoryPage } from './pages/RepoHistoryPage';` and `<Route path="/repos/:owner/:name" element={<RepoHistoryPage />} />`.

- [ ] **Step 5: Run the web tests, typecheck, lint and build**

Run: `npm test -w web && npm run typecheck -w web && npm run lint -w web && npm run build -w web`
Expected: all pass.

- [ ] **Step 6: Look at it**

Run: `docker compose up --build -d`, scan `https://github.com/expressjs/express/tree/4.17.1`, then scan `https://github.com/expressjs/express/tree/4.18.2`.
Expected: the second result shows "Since previous scan" with fixed and new counts; the home page groups both under one repository; the repo link opens the history page. `docker compose down`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): result view with what matters, what is risky, what to do next, comparison and history

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 24: Claude summarizer with guards and fallback

**Files:**
- Create: `server/src/summarize/claude.ts`, `server/src/summarize/select.ts`, `server/scripts/try-claude.ts`, `server/test/fixtures/sample-summary-input.json`
- Modify: `server/src/main.ts`
- Test: `server/test/unit/claude.test.ts`

**Interfaces:**
- Produces: `createClaudeSummarizer({ apiKey, model, logger, timeoutMs?, client? }): Summarizer`; `buildUserMessage(input): string`; `SYSTEM_PROMPT`; `withFallback(primary, fallback, logger): Summarizer`; `createSummarizer(config, logger): Summarizer` (Claude with fallback when `summarizerMode` is `claude`, deterministic otherwise).
- Server-side refusal fallbacks from the SDK are deliberately not used: the product has its own fallback to the deterministic summary, which is what a reviewer should see.

- [ ] **Step 1: Install the SDK**

Run: `npm install -w server @anthropic-ai/sdk@^0.135`

- [ ] **Step 2: Write the failing test**

`server/test/unit/claude.test.ts`:
```ts
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
  const parse = vi.fn(async () => {
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
    const params = parse.mock.calls[0]![0] as { model: string; output_config: { format: unknown }; messages: Array<{ content: string }> };
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w server -- claude`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write `server/src/summarize/claude.ts`**

```ts
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
```

If the SDK's `parse` does not accept a second `{ signal }` argument in this version, remove it; the client `timeout` still bounds the call.

- [ ] **Step 5: Write `server/src/summarize/select.ts`**

```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -w server -- claude`
Expected: 5 tests pass.

- [ ] **Step 7: Wire it into `server/src/main.ts`**

Replace the `createDeterministicSummarizer` import with `import { createSummarizer } from './summarize/select.js';` and pass `summarizer: createSummarizer(config, logger)` to `createPipeline`.

- [ ] **Step 8: Add the sample script**

`server/test/fixtures/sample-summary-input.json`: copy the `input` object from `test/unit/deterministic.test.ts` as JSON (the five findings, one warning, stats).

`server/scripts/try-claude.ts`:
```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { loadConfig } from '../src/config.js';
import { createSummarizer } from '../src/summarize/select.js';
import type { SummaryInput } from '../src/summarize/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused' });
const input = JSON.parse(await readFile(path.resolve(here, '../test/fixtures/sample-summary-input.json'), 'utf8')) as SummaryInput;
const summarizer = createSummarizer(config, pino({ level: 'warn' }));
const outcome = await summarizer.summarize(input, new AbortController().signal);
console.log(JSON.stringify(outcome, null, 2));
```

Run with a key, from `server/`: `ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/try-claude.ts > test/fixtures/claude-summary.example.json`. The output has `mode: "claude"`. Commit the file; the README quotes it. Without a key the script prints the deterministic result with `mode: "deterministic"`, which is not what the README needs, so leave the fixture uncommitted and note it in the handoff.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(summarize): claude summarizer with structured output, guards and deterministic fallback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 25: Observability: metrics, scan-scoped logs, worker health

**Files:**
- Create: `server/src/metrics.ts`
- Modify: `server/src/api/routes/health.ts`, `server/src/scan/run-scan.ts`, `server/src/main.ts`
- Test: `server/test/unit/metrics.test.ts`

**Interfaces:**
- Produces: `metrics` object with `registry`, `scansTotal` (label `status`), `scanStageDuration` (label `stage`, seconds), `scanQueueDepth`, `osvRequestsTotal` (label `outcome`), `summarizerRunsTotal` (labels `mode`, `fallback`); `registerMetricsRoute(app)` serving `GET /metrics`; `createScanJobHandler` records `scansTotal`, stage durations (from `result.stats.stageDurationsMs`) and summarizer runs; the worker samples `scanQueueDepth` every 10 seconds.

- [ ] **Step 1: Install prom-client**

Run: `npm install -w server prom-client@^15`

- [ ] **Step 2: Write the failing test**

`server/test/unit/metrics.test.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { metrics, registerMetricsRoute } from '../../src/metrics.js';

describe('metrics', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: pino({ level: 'silent' }), webDistDir: null, routes: [registerMetricsRoute] });
    await app.ready();
  });
  afterAll(() => app.close());

  it('exposes counters and histograms in prometheus format', async () => {
    metrics.scansTotal.inc({ status: 'done' });
    metrics.scanStageDuration.observe({ stage: 'fetching' }, 1.5);
    metrics.summarizerRunsTotal.inc({ mode: 'deterministic', fallback: 'false' });
    metrics.osvRequestsTotal.inc({ outcome: 'ok' });
    metrics.scanQueueDepth.set(3);
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    for (const name of ['scans_total{status="done"} 1', 'scan_stage_duration_seconds_bucket', 'scan_queue_depth 3', 'osv_requests_total{outcome="ok"} 1', 'summarizer_runs_total{mode="deterministic",fallback="false"} 1', 'process_cpu_user_seconds_total']) {
      expect(res.body).toContain(name);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w server -- metrics`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `server/src/metrics.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const metrics = {
  registry,
  scansTotal: new Counter({ name: 'scans_total', help: 'Scans by terminal status', labelNames: ['status'] as const, registers: [registry] }),
  scanStageDuration: new Histogram({
    name: 'scan_stage_duration_seconds',
    help: 'Duration of each scan stage',
    labelNames: ['stage'] as const,
    buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
    registers: [registry],
  }),
  scanQueueDepth: new Gauge({ name: 'scan_queue_depth', help: 'Scans waiting for a worker', registers: [registry] }),
  osvRequestsTotal: new Counter({ name: 'osv_requests_total', help: 'OSV API requests by outcome', labelNames: ['outcome'] as const, registers: [registry] }),
  summarizerRunsTotal: new Counter({
    name: 'summarizer_runs_total',
    help: 'Summaries produced, by mode and whether a fallback happened',
    labelNames: ['mode', 'fallback'] as const,
    registers: [registry],
  }),
};

export function registerMetricsRoute(app: FastifyInstance): void {
  app.get('/metrics', async (_req, reply) => {
    reply.type(registry.contentType);
    return registry.metrics();
  });
}
```

- [ ] **Step 5: Record metrics in the handler**

In `server/src/scan/run-scan.ts`, import `metrics` from `../metrics.js` and:
- after `completeScan`: `metrics.scansTotal.inc({ status: 'done' }); metrics.summarizerRunsTotal.inc({ mode: result.summarizer, fallback: String(result.summarizerNote?.startsWith('fallback') ?? false) }); for (const [stage, ms] of Object.entries(result.stats.stageDurationsMs ?? {})) metrics.scanStageDuration.observe({ stage }, ms / 1000);`
- in both `markFailed` branches: `metrics.scansTotal.inc({ status: 'failed' });`

In `server/src/main.ts`:
- add `import { registerMetricsRoute, metrics } from './metrics.js';` and `import { countQueued } from './db/scans-repo.js';`,
- add `registerMetricsRoute` to the `routes` array for every role (the worker's unpublished port serves it too),
- pass `onRequest: (outcome) => metrics.osvRequestsTotal.inc({ outcome })` to `createOsvClient`,
- when `runsWorker`, start a sampler:
```ts
    const sampler = setInterval(() => {
      countQueued(db)
        .then((n) => metrics.scanQueueDepth.set(n))
        .catch((err: unknown) => logger.warn({ err }, 'queue depth sample failed'));
    }, 10_000);
    sampler.unref();
```
  and `clearInterval(sampler)` in `shutdown` (declare `let sampler: ReturnType<typeof setInterval> | null = null;` above).
- change `isQueueReady` to return a `bossStarted` boolean set to true after `createBoss` resolves.

- [ ] **Step 6: Run everything and verify in Docker**

```bash
npm test -w server && npm run typecheck -w server && npm run lint -w server
docker compose up --build -d
curl -s -X POST localhost:8080/api/scans -H 'Content-Type: application/json' -d '{"repoUrl":"https://github.com/expressjs/express"}' >/dev/null
sleep 30
curl -s localhost:8080/metrics | grep -E '^(scans_total|scan_stage_duration_seconds_count|summarizer_runs_total)'
docker compose logs worker | grep '"scanId"' | head -5
docker compose down
```
Expected: the api's `/metrics` shows default metrics (scan counters live on the worker, which is not published; they are visible with `docker compose exec worker wget -qO- http://127.0.0.1:8080/metrics`). Worker log lines carry `scanId` and `attempt`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(observability): prometheus metrics, scan-scoped logs and worker health

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 26: Demo repository and smoke test

**Files:**
- Create (in a separate public repository `b-alon/scan-review-demo`): `package.json`, `package-lock.json`, `src/config.js`, `src/util.js`, `README.md`, tags `v1` and `v2`
- Create: `scripts/smoke.mjs`

**Interfaces:**
- Produces: a public repo whose `v1` tag yields at least one dependency advisory, one secret and one code finding, and whose `v2` tag fixes all three; `npm run smoke` against a running stack.

- [ ] **Step 1: Ask before creating the public repository**

Creating a public repository under the user's GitHub account is outward-facing. Ask Alon to confirm the name `scan-review-demo` and that it may be public before running any `gh repo create`. Do not proceed to Step 2 without that confirmation.

- [ ] **Step 2: Create the demo repository at `v1`**

In a scratch directory outside this project:
```bash
mkdir scan-review-demo && cd scan-review-demo && git init -b main
```

`package.json`:
```json
{
  "name": "scan-review-demo",
  "version": "1.0.0",
  "private": true,
  "description": "Deliberately vulnerable sample for the AI Scan Review demo. v1 has issues, v2 fixes them.",
  "main": "src/util.js",
  "dependencies": {
    "lodash": "4.17.15",
    "minimist": "1.2.0"
  }
}
```

`package-lock.json`:
```json
{
  "name": "scan-review-demo",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "scan-review-demo",
      "version": "1.0.0",
      "dependencies": { "lodash": "4.17.15", "minimist": "1.2.0" }
    },
    "node_modules/lodash": {
      "version": "4.17.15",
      "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz"
    },
    "node_modules/minimist": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/minimist/-/minimist-1.2.0.tgz"
    }
  }
}
```

`src/config.js`:
```js
// Demo only. This is the AWS documentation example key, not a real credential.
module.exports = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
};
```

`src/util.js`:
```js
const _ = require('lodash');

function evaluate(expression) {
  return eval(expression);
}

module.exports = { evaluate, merge: _.merge };
```

`README.md`:
```markdown
# scan-review-demo

A tiny, deliberately vulnerable repository used to demo the AI Scan Review project.

- `v1`: outdated lodash and minimist, a hardcoded example AWS key, and an `eval` call.
- `v2`: dependencies upgraded, the key moved to an environment variable, `eval` replaced.

Scan `v1`, then `v2`, to see the comparison between scans.
```

```bash
git add -A && git commit -m "v1: vulnerable sample" && git tag v1
```

- [ ] **Step 3: Move the repository to `v2`**

Edit `package.json` dependencies to `"lodash": "4.17.21"` and `"minimist": "1.2.8"`, and the matching versions and tarball URLs in `package-lock.json`.

`src/config.js`:
```js
module.exports = {
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
};
```

`src/util.js`:
```js
const _ = require('lodash');

function evaluate(expression) {
  return JSON.parse(expression);
}

module.exports = { evaluate, merge: _.merge };
```

```bash
git add -A && git commit -m "v2: fixes" && git tag v2
gh repo create b-alon/scan-review-demo --public --source . --push --description "Deliberately vulnerable sample for the AI Scan Review demo"
git push --tags
```
Expected: `https://github.com/b-alon/scan-review-demo/tree/v1` and `/tree/v2` exist.

- [ ] **Step 4: Write `scripts/smoke.mjs`**

```js
#!/usr/bin/env node
// Smoke test against a running stack: scans the demo repo at v1 then v2 and checks the comparison.
const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080';
const repo = process.env.SMOKE_REPO ?? 'https://github.com/b-alon/scan-review-demo';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000);

async function json(url, init) {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
  const body = await res.json();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function scan(ref) {
  const created = await json(`${base}/api/scans`, { method: 'POST', body: JSON.stringify({ repoUrl: repo, ref, force: true }) });
  console.log(`scan ${created.id} for ${ref} queued (${created.commitSha.slice(0, 7)})`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const view = await json(`${base}/api/scans/${created.id}`);
    if (view.status === 'done') return view;
    if (view.status === 'failed') throw new Error(`scan failed: ${view.error}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`scan ${created.id} did not finish within ${timeoutMs} ms`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
  console.log(`ok: ${message}`);
}

const health = await json(`${base}/api/ready`);
assert(health.ok === true, 'api is ready');

const v1 = await scan('v1');
const rules = new Set(v1.findings.map((f) => f.ruleId));
assert(rules.has('osv.advisory'), 'v1 has a dependency advisory');
assert(rules.has('secret.aws_access_key'), 'v1 has the example AWS key');
assert(rules.has('code.eval'), 'v1 has an eval finding');
assert(v1.summary.riskLevel === 'critical', 'v1 risk level is critical');
assert(v1.summary.nextActions.length > 0, 'v1 has next actions');
assert(!v1.findings.some((f) => (f.evidence ?? '').includes('IOSFODNN7EXAMPLE')), 'secret value is masked');

const v2 = await scan('v2');
assert(v2.comparison !== null, 'v2 has a comparison');
assert(v2.comparison.previousScanId === v1.id, 'v2 compares against v1');
assert(v2.comparison.fixed.length >= 3, `v2 reports fixed findings (${v2.comparison.fixed.length})`);
assert(!v2.findings.some((f) => f.ruleId === 'secret.aws_access_key'), 'v2 has no secret');
console.log(`smoke passed: v1 ${v1.findings.length} findings, v2 ${v2.findings.length} findings, ${v2.comparison.fixed.length} fixed`);
```

- [ ] **Step 5: Run the smoke test against Docker**

```bash
docker compose up --build -d
npm run smoke
docker compose down
```
Expected: every `ok:` line prints and the final "smoke passed" line appears.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: end-to-end smoke script against the demo repository

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 27: README

**Files:**
- Create: `README.md`

**Interfaces:**
- Produces: the document reviewers read first. Sections follow spec section 12 exactly. Plain language, no mannered prose, no filler.

- [ ] **Step 1: Write `README.md` with these sections and content**

1. **Title and one paragraph.** What it does in the customer's three questions: what matters, what is risky, what to do next. One sentence on the comparison feature.
2. **Quick start.**
   ```bash
   git clone <repo> && cd <repo>
   docker compose up
   ```
   Open `http://localhost:8080`. State the only prerequisite (Docker running), that the first run builds the image, and the `APP_PORT` override.
3. **Try it.** Scan `https://github.com/b-alon/scan-review-demo/tree/v1`, read the result, then scan `/tree/v2` and look at "Since previous scan". Enabling the AI summary: copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, `docker compose up -d`, then use "Scan again" (the freshness window reuses recent results for the same summarizer only, so a rescan after enabling the key runs fresh). Include the committed `server/test/fixtures/claude-summary.example.json` output in a collapsed block if it exists.
4. **How it works.** An ASCII diagram of `browser -> api -> postgres <- worker`, the request flow in six numbered steps (submit, resolve ref, enqueue, worker stages, notify, stream), and the stage list with what each produces.
5. **Decisions.** One short paragraph each: pg-boss over Redis (Postgres is the only dependency; retries, expiry and graceful stop come from the library), resolving refs at submit time (immediate errors, commit-keyed dedupe), SSE over polling and WebSocket (one-directional, native reconnect, polling backstop), the hybrid summarizer (same contract, zero-config default, AI when a key exists, fallback recorded), deterministic fingerprints (comparison survives line shifts), git over the GitHub API (any ref, no rate limits, private repos via a header), the freshness window and why it ignores results from a different summarizer.
6. **Security considerations.** Secret values masked before storage; the token only in a git header, redacted from logs; limits on files, file size, packages and stage time; temp directories removed; no code is executed from scanned repositories; what is not stored.
7. **What I would do next.** Zip upload with its extraction risks (path traversal, zip bombs, size limits); PR base-branch diffing; more ecosystems and lockfile formats; CVSS vectors to scores; SARIF export; auth and tenancy; a broker when throughput demands it; OpenTelemetry and an error tracker.
8. **How I used coding agents.** Honest description: Claude Code with the superpowers workflow (brainstorming the vague brief into a spec, a written implementation plan, test-first tasks), what the agent produced, what the author reviewed and changed, and where the author disagreed with the agent's first proposals (hand-rolled queue and ORM rejected in favor of pg-boss and Drizzle; freshness window added; zip upload cut). Point to `docs/superpowers/specs` and `docs/superpowers/plans`.
9. **Development.** `npm install`, `npm run dev:db`, `export DATABASE_URL=postgres://scan:scan@localhost:5433/scan`, `npm run dev` (api on 8080, Vite on 5173 proxying `/api`), `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run smoke`. The environment table from spec section 11.

- [ ] **Step 2: Read it as a reviewer**

Check: every command in the README runs as written from a fresh clone; no section claims something the code does not do; the three questions appear as the result section titles; no mannered prose.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: readme with quick start, decisions, security notes and agent workflow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 28: Release check

**Files:** none new.

- [ ] **Step 1: Fresh-clone verification**

```bash
cd "$(mktemp -d)" && git clone /Users/alonbraitstein/Development/ox-security-assignment app && cd app
docker compose down -v 2>/dev/null; docker compose up --build -d
npm run smoke
docker compose down -v
```
Expected: builds from a clean checkout, smoke passes.

- [ ] **Step 2: Full local verification**

From the project directory with the dev database up:
```bash
npm test && npm run test:integration && npm run typecheck && npm run lint && npm run build
git status --porcelain
```
Expected: all green and an empty `git status`.

- [ ] **Step 3: Review the commit log**

Run: `git log --oneline`
Expected: one commit per task with conventional messages. No commit contains a `.env` file or a token (`git log -p | grep -c 'sk-ant-'` prints 0).

- [ ] **Step 4: Hand off**

Report to Alon: what was built, what was verified and how, the demo repo link, and the one item that needs their key (the committed Claude sample output). Pushing to GitHub and sharing the link is their call.
