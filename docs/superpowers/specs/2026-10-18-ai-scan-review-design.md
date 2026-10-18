# AI Scan Review Experience: Design

Date: 2026-10-18
Status: draft for review

## 1. Purpose

A small product that lets a user submit a GitHub repository, run a security scan
on it, follow progress in real time, and read a result that answers three
questions in the customer's own words: what matters, what is risky, and what I
should do next. Rescanning the same repository shows what was fixed, what is
new, and what is still open.

Audience for this build: Ox Security reviewers evaluating a senior backend
candidate. They will clone the repo, run one command, use the UI, then read the
code and the README.

Success criteria:

- `docker compose up` brings up a working product on any machine with Docker.
- Submit, progress, result and history all work on the first try.
- The result screen reads as a product, not a scanner dump.
- The README explains the product, the technical decisions, and how coding
  agents were used.

Non-goals: authentication, multi-tenancy, zip upload, pull request base-branch
diffing, SARIF export, a general-purpose rules engine.

## 2. Architecture

Three containers from Compose: `api`, `worker`, `db`.

- `db` is Postgres 16. It is the single source of truth for queue state (via
  pg-boss tables), scan progress, results and history. Its port is not published
  to the host, so a local Postgres on 5432 never conflicts.
- `api` is a Fastify server in TypeScript. It serves the REST API under `/api`,
  the built React UI as static files with an SPA fallback, and the Server-Sent
  Events stream. It validates input, resolves refs to commits, reads from Postgres,
  inserts scans and enqueues jobs. It never fetches code or runs a scan.
- `worker` runs pg-boss handlers. It claims scan jobs, runs the pipeline,
  writes progress and results, and notifies.
- A one-shot `migrate` service applies Drizzle migrations before `api` and
  `worker` start (`depends_on` with `service_completed_successfully`).

`api` and `worker` share one Docker image and one entrypoint. A `ROLE` env var
selects `api`, `worker` or `all`. `npm run dev` runs `all` in one process
against the Compose database with its port published through a dev-only
Compose file.

Request flow:

1. UI posts a repo URL and an optional ref.
2. api parses it, resolves the ref to a commit SHA with `git ls-remote`
   (about one second, 10 s timeout), rejects bad input immediately, collapses
   duplicates of a scan already queued or running for that commit, inserts a
   `queued` scan with the SHA set, sends a pg-boss job carrying only the scan
   id, and returns 201 with the scan.
3. UI navigates to the scan page and opens the SSE stream.
4. worker picks up the job and runs the stages: fetch, dependencies, code,
   summarize. After each transition it updates the scan row, inserts a
   scan event, and runs `NOTIFY scan_updates` with the scan id, all in one
   transaction.
5. api's single `LISTEN` connection receives the notification, loads the scan,
   and pushes it to every open stream for that id.
6. On completion the worker writes findings and summary in one transaction,
   marks the scan `done`, and notifies. The UI swaps progress for the result.

### Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 24, TypeScript, ESM | Required by the brief; pinned in the image |
| HTTP | Fastify | Small, schema-first, SSE is trivial, pino logging built in |
| Queue | pg-boss | Postgres-backed with `SKIP LOCKED`, retries, backoff, expiry, graceful stop; the Node equivalent of GoodJob; no Redis |
| ORM | Drizzle | TypeScript schema, generated migrations, no codegen in the Docker build, sits on `pg` so LISTEN shares the pool |
| Validation | Zod | One schema per boundary; the summary contract is shared by both summarizers |
| UI | React 18, Vite, React Router, Mantine | Familiar; Mantine ships Stepper, Timeline, Badge, Table, Accordion and a color scheme toggle, so no hand-written component CSS; built once in the Docker image |
| Tests | Vitest | Fast, TypeScript-native |
| Git access | `git` CLI in the image | Resolves any ref, no API rate limits, private repos via token header |
| Vulnerability data | OSV.dev API | Free, no key, covers npm, PyPI, Go, RubyGems |
| AI summary | `@anthropic-ai/sdk`, model `claude-opus-5-5` by default | Structured output guarantees the contract |

Layout:

```
/
  package.json            npm workspaces: server, web
  compose.yaml            db, migrate, api, worker
  compose.dev.yaml        publishes db on 5433 for npm run dev
  Dockerfile              multi-stage: build web, build server, runtime with git
  .env.example
  README.md
  server/
    src/
      main.ts             entrypoint, reads ROLE
      config.ts           Zod-validated env
      db/                 drizzle schema, migrations, client
      api/                fastify app, routes, sse
      queue/              pg-boss setup, job names, enqueue
      scan/               pipeline: fetch, deps, code, summarize, persist
      scan/parsers/       lockfile and manifest parsers
      scan/rules/         code pattern rules
      summarize/          contract (zod), deterministic, claude, select
      compare/            fingerprint diff
      github/             url parser, ref resolver, git commands
      osv/                client and cache
    test/                 unit and integration tests, fixtures
  web/
    src/                  React app
```

## 3. States and data model

Scan status: `queued`, `running`, `done`, `failed`.

- `queued` to `running` when a worker starts an attempt.
- `running` to `done` on success.
- `running` to `failed` on a non-retryable error, or when pg-boss exhausts
  retries.
- `running` to `queued` when an attempt fails with a retryable error and
  retries remain. The scan row records the error so the UI can show
  "retrying".

While `running`, `stage` is one of `fetching`, `dependencies`, `code`,
`summarizing`, `persisting`.

Tables (Drizzle schema):

**scans**
- `id` uuid primary key
- `repo_owner`, `repo_name` text
- `repo_url` text, normalized `https://github.com/owner/name`
- `ref_requested` text nullable (what the user asked for)
- `ref_resolved` text nullable (e.g. `refs/heads/main`, `refs/tags/v1`)
- `commit_sha` text, resolved at submit time
- `status` enum, `stage` text nullable
- `progress_pct` int, `progress_message` text
- `attempts` int, `max_attempts` int
- `error` text nullable
- `warnings` jsonb, list of `{ code, message }` (e.g. OSV unavailable)
- `summary` jsonb nullable, shape defined in section 5
- `summarizer` text nullable: `deterministic` or `claude`
- `summarizer_note` text nullable: why fallback happened, model used
- `stats` jsonb: files scanned, packages checked, per-stage durations
- `previous_scan_id` uuid nullable
- `created_at`, `started_at`, `finished_at`

**findings**
- `id` uuid, `scan_id` fk cascade
- `fingerprint` text, indexed with `scan_id`
- `category` enum: `dependency`, `code`, `config`
- `severity` enum: `critical`, `high`, `medium`, `low`
- `rule_id` text (e.g. `secret.aws_access_key`, `osv.advisory`)
- `title`, `description`, `recommendation` text
- `location` text: `path:line` for code, `package@version (ecosystem)` for
  dependencies
- `reference_id` text nullable (CVE or GHSA id), `reference_url` text nullable
- `evidence` text nullable, always redacted
- `metadata` jsonb: fixed version, package name, ecosystem, line number

**scan_events**
- `id` serial, `scan_id` fk cascade
- `stage` text, `message` text, `created_at`

**osv_vulns** (cache)
- `id` text primary key (OSV id), `payload` jsonb, `fetched_at`

Fingerprints are deterministic and survive line shifts:

- dependency: `dep:{ecosystem}:{package}:{vulnId}`
- code: `code:{ruleId}:{path}:{sha1(normalized line)}` where normalized means
  whitespace collapsed and trimmed
- config: `config:{ruleId}:{path}`

Comparison needs no extra table. On completion the worker sets
`previous_scan_id` to the most recent `done` scan for the same `repo_url`
created before this one. Reading a result diffs fingerprints: in the new scan
only is new, in the previous only is fixed, in both is still open.

## 4. API and real-time contract

All responses JSON. Errors are `{ error: { code, message } }` with 400 for
validation, 404 for unknown scan, 500 otherwise. All bodies validated with Zod.

**POST /api/scans** body `{ repoUrl: string, ref?: string }`
- Accepted URL forms: `https://github.com/owner/repo`, with or without `.git`
  or trailing slash; `git@github.com:owner/repo.git`; `/tree/<ref>`;
  `/releases/tag/<tag>`; `/commit/<sha>`; `/pull/<n>` (maps to
  `refs/pull/<n>/head`).
- Explicit `ref` overrides any ref implied by the URL. A ref may be a branch,
  a tag or a 7 to 40 character hex SHA.
- Non-GitHub hosts are rejected with a clear message.
- Resolves the ref with `git ls-remote --symref` (10 s timeout). Errors are
  immediate and specific: 400 for an invalid URL or a ref that does not
  exist, 404 for a repository that is not found or is private without a
  token, 502 when GitHub cannot be reached. A SHA input is validated by
  format only; a SHA that does not exist fails at fetch time.
- If a scan for the same `repo_url` and `commit_sha` is `queued` or
  `running`, that scan is returned with 200 instead of creating a duplicate.
  A done scan of the same commit does not block a new one: advisories change
  over time, so rescanning an unchanged commit is meaningful.
- Otherwise inserts the scan with `commit_sha` and `ref_resolved` set, sends
  the pg-boss job, returns 201 with the scan.

**GET /api/scans/:id**
- Always: scan fields, progress, events timeline, warnings.
- When `done`: `summary`, `findings` sorted by severity then title, and
  `comparison`: `{ previousScanId, previousSha, sameCommit, new: Finding[],
  fixed: Finding[], stillOpen: Finding[] }` or null when there is no previous
  scan. `sameCommit` is true when the previous scan covered the same SHA, so
  the UI attributes differences to advisory data rather than code changes.
- `fixed` findings come from the previous scan's rows.

**GET /api/scans?limit=50**
- Recent scans with repo, commit, ref, status, risk level, severity counts,
  summarizer, timestamps. The UI groups by repo.

**GET /api/scans/:id/stream** (SSE)
- `snapshot` on connect, same shape as GET one.
- `progress` events on every change while not terminal.
- `done` or `failed` as a final event with the full payload, then close.
- A `: ping` comment every 15 seconds.
- If the scan is already terminal on connect, send `snapshot` then the
  terminal event and close.

**GET /api/health**
- `{ ok: true, db: "ok", summarizer: "claude" | "deterministic", version }`.

Notification path: the worker runs `NOTIFY scan_updates, '<scanId>'` after
each committed transition. The api holds one dedicated `pg` client in LISTEN
mode and keeps a map of scan id to open SSE replies. On notification it loads
the scan via the same read used by GET one and writes to each reply. If the
LISTEN client errors it reconnects with backoff; while disconnected, streams
poll the database every 2 seconds so progress never stalls.

Client fallback: if `EventSource` errors twice in a row, the UI closes it and
polls GET one every 2 seconds until terminal.

## 5. Result contract and summarizers

The summary mirrors the customer sentence. The UI uses the three parts as its
section titles.

```ts
Summary = {
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none',
  headline: string,                 // one sentence
  overview: string,                 // 2 to 4 sentences, plain language
  topRisks: Array<{                 // max 5, ordered
    fingerprint: string,
    title: string,
    whyItMatters: string,           // impact, not scanner text
  }>,
  nextActions: Array<{              // ordered by priority
    action: string,                 // imperative, names the file or package
    effort: 'minutes' | 'hours' | 'days',
    resolves: string[],             // fingerprints closed by this action
  }>,
}
```

Both summarizers return this Zod-validated shape.

### Deterministic summarizer

- `riskLevel` is the highest severity present, `none` with no findings.
- `headline`: "{n} issues found ({c} critical, {h} high, ...). Most urgent: {top
  finding title}." or "No issues found in {files} files and {packages}
  packages."
- `overview`: templated sentences covering posture, the dominant category,
  how many vulnerable packages have a fixed version, and any warnings such as
  a missing lockfile or an unavailable dependency check.
- `topRisks`: top 5 by severity, then category (secrets first), then title.
  `whyItMatters` is rule-specific text with the location substituted.
- `nextActions`:
  - each secret finding: "Rotate the {type} found in {path}:{line}, remove it
    from the file, and load it from an environment variable or secret
    manager." effort minutes
  - dependency advisories grouped by package: "Upgrade {pkg} from {v} to
    {fixed}" resolving every advisory on that package, effort minutes; without
    a fixed version: "No fixed version is published for {pkg} {v}; check the
    advisory and consider replacing or isolating it." effort hours
  - code rules: the rule's recommendation with location
  - missing lockfile: "Commit a lockfile so dependency versions are
    reproducible and scannable." effort minutes
  - ordering: severity of the findings resolved, then number resolved
- Secret and advisory findings with an exact fix are "minutes"; design-level
  code issues are "hours".

### Claude summarizer

- Enabled when `ANTHROPIC_API_KEY` is set. Model from `ANTHROPIC_MODEL`,
  default `claude-opus-5-5`.
- Input: repo name, commit, counts by severity and category, warnings, and the
  top 50 findings by severity as compact JSON (fingerprint, severity, title,
  location, reference, fixed version, recommendation).
- Output: the Summary schema via structured output, so the response is parsed
  into the typed shape or fails.
- System prompt asks for developer-facing language, impact over mechanism,
  concrete actions that name files and packages, merging of related findings
  into one action, and no invented findings.
- Guards: every fingerprint in `topRisks` and `resolves` is checked against the
  real findings; unknown ones are dropped. Any API error, timeout (60 s),
  refusal, or schema failure falls back to the deterministic summary. The scan
  records `summarizer` and `summarizer_note` ("fallback: timeout", model id)
  and the UI shows a badge.
- One real output is committed as a fixture and shown in the README.

## 6. Scanner pipeline

Each stage runs with its own timeout via `AbortSignal` and reports progress.
Each attempt starts by resetting the scan: delete findings for the scan id,
clear summary and warnings, set `running` and `attempts`. This makes retries
idempotent.

**Ref resolution happens in the api at submit time**, not in the worker:
- Parse URL and ref.
- Branch, tag or default: `git ls-remote --symref <url> <ref>` returns the
  full SHA and the resolved ref name. Default branch uses `HEAD`.
- SHA input: validated by format and fetched directly by the worker.
- Private repos: when `GITHUB_TOKEN` is set, pass
  `-c http.extraHeader=Authorization: Basic base64(x-access-token:TOKEN)`.
  The token never appears in the URL, in logs, or in error messages. The
  worker's fetch uses the same header.
- Timeout 10 s. "Repository not found" and auth failures produce the
  message: "Repository not found or private. Set GITHUB_TOKEN to scan private
  repositories."
- The resolver is injected into the api so route tests use a fake.

**fetching** (0 to 25%)
- Temp dir under the OS temp root, named by scan id, removed in `finally`.
- `git init`, `git remote add origin`, `git fetch --depth 1 origin <sha>`,
  `git checkout --quiet FETCH_HEAD`, with `GIT_LFS_SKIP_SMUDGE=1` and
  `GIT_TERMINAL_PROMPT=0`.
- Timeout 120 s. Counts files for stats.
- A SHA that does not exist on the remote is a non-retryable error: "Commit
  not found in this repository."

**dependencies** (25 to 60%)
- Discover manifests up to 3 directories deep, skipping `node_modules`,
  `vendor`, `.git`, `dist`, `build`.
- Parsers, each a pure function from file text to `{ ecosystem, name,
  version }[]`:
  - `package-lock.json` v1, v2 and v3
  - `package.json` fallback when no lockfile: exact versions only, and a
    `deps.no_lockfile` config finding (medium)
  - `requirements.txt`: `==` pins only
  - `go.mod`: `require` entries
  - `Gemfile.lock`: entries under `specs:`
- Unique packages capped at 2000. OSV `POST /v1/querybatch` in chunks of
  1000. For each returned vulnerability id, details come from the `osv_vulns`
  cache or `GET /v1/vulns/{id}` with concurrency 5, then cached.
- Severity: `database_specific.severity` when present (MODERATE maps to
  medium); otherwise the CVSS v3 base score parsed from `severity[].score`
  when it is numeric; otherwise medium. Fixed version: first `fixed` event in
  the affected range for the matching package.
- Dedupe: GHSA and CVE aliases of the same advisory count once, preferring
  the GHSA id for the reference and linking to osv.dev.
- Timeouts: 15 s per request, 120 s per stage. If OSV is unreachable, the
  stage records a warning `osv_unavailable`, emits no dependency findings,
  and the scan continues. The summary must say the dependency check did not
  run.

**code** (60 to 85%)
- Walk files, skipping `node_modules`, `.git`, `vendor`, `dist`, `build`,
  `.next`, `coverage`, `target`, binaries, and files over 512 KB. Cap 5000
  files.
- Rules are data: `{ id, category, severity, title, description,
  recommendation, whyItMatters, pattern, fileGlobs?, excludePathPattern?,
  excludeValuePattern? }`. Initial set:
  - `secret.aws_access_key` critical: `AKIA[0-9A-Z]{16}`
  - `secret.github_token` critical: `gh[pousr]_[A-Za-z0-9]{36,}`
  - `secret.private_key` critical: `-----BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY-----`
  - `secret.stripe_live_key` critical: `sk_live_[0-9a-zA-Z]{24,}`
  - `secret.slack_webhook` high: `hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/`
  - `secret.generic_assignment` high: `(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{8,}['"]`, excluding test and fixture paths and placeholder values (`changeme`, `example`, `xxx`, `${`, `process.env`, `<`)
  - `code.eval` medium: `\beval\s*\(` in js, ts, py
  - `code.shell_interpolation` high: `exec(Sync)?\(\s*` followed by a template literal containing `${` in js, ts
  - `code.sql_interpolation` high: `query\(\s*` followed by a template literal containing `${` in js, ts
  - `code.dangerously_set_inner_html` low in jsx, tsx
  - `config.env_committed` high: a `.env` file is present (not `.env.example`)
  - `config.debug_true` low: `DEBUG\s*=\s*True` in py
- Evidence is the matched line with the matched value masked to its first 4
  characters plus `****`. Line numbers are recorded in metadata and location,
  not in the fingerprint.

**summarizing** (85 to 95%)
- Select summarizer by config, run it, apply guards and fallback.
- Look up `previous_scan_id`.

**persisting** (95 to 100%)
- One transaction: insert findings, update scan with summary, stats,
  `previous_scan_id`, `done`, `finished_at`. Then notify.

Progress messages are specific: "Fetching owner/repo at 3f9a2c1", "Fetched
412 files", "Checked 212 packages against OSV, 7 advisories found", "Scanned
388 files with 12 rules", "Summarizing with Claude".

## 7. Fault tolerance

- pg-boss job options: `retryLimit: 2`, `retryBackoff: true`,
  `expireInSeconds: 600`. A worker that dies mid-scan leaves a job that
  expires and is retried by another worker.
- Error classes: `NonRetryableScanError` (commit not found, repository gone
  or access revoked between submit and fetch) marks the scan `failed`
  immediately and completes the job.
  Anything else marks the scan `queued` with the error noted and rethrows so
  pg-boss retries. On the final attempt the handler marks the scan `failed`
  with the error.
- Idempotent attempts: see section 6.
- Per-stage timeouts via `AbortSignal`; git and HTTP calls receive the
  signal.
- Partial availability: OSV down degrades to a warning, not a failure.
- Graceful shutdown: SIGTERM stops accepting jobs and waits up to 30 s for the
  current scan; api closes open streams with a final `: closing` comment and
  stops.
- Database reconnection through the `pg` pool; the LISTEN client reconnects
  with backoff and streams poll meanwhile.
- Resource limits: file count, file size, package count, stage timeouts, temp
  dir cleanup.
- Secrets: the GitHub token is never logged or embedded in URLs; evidence is
  masked before it is stored; pino redacts `authorization` headers.
- Duplicate submissions for the same commit are collapsed at the API while a
  scan for it is in flight.

## 8. UI

React, Vite, React Router and Mantine for components, layout and the light
and dark color scheme. No custom component CSS beyond theme tokens. All copy
is plain language.

Routes:

- `/` Home. A hero with the repo URL input, the optional "branch, tag or
  commit" input, and a Scan button. Below it, recent scans grouped by repo
  with status pill, risk badge, short SHA and relative time. Empty state
  suggests the demo repo.
- `/scans/:id` Scan. While not terminal: a four-step stepper (Fetch,
  Dependencies, Code, Summarize, where the last step covers both the
  summarizing and persisting stages) with the active step animated, the
  live progress message, elapsed time, and a timeline of completed steps with
  durations. On `failed`: an error card with the reason and a "Scan again"
  button. On `done`: the result view.
- `/repos/:owner/:name` History. Scans of one repo in order with risk level
  and counts, each linking to its result.

Result view, top to bottom:

1. Header: repo and ref, short SHA linking to GitHub, scanned-at time, risk
   badge, summarizer badge ("AI summary" or "Rule-based summary", with the
   fallback note on hover).
2. What matters: headline and overview.
3. What is risky: top risk cards with severity, title, location, and why it
   matters.
4. What to do next: ordered checklist with effort chips and the count of
   findings each action resolves; expanding an action lists them.
5. Since previous scan: shown only when a previous scan exists. Counts of
   fixed, new, still open, with expandable lists, and a link to the previous
   result. When `sameCommit` is true the title reads "Same commit as your
   previous scan, {time ago}" and a note says differences come from updated
   advisory data, not code changes.
6. All findings: table with severity and category filters; rows expand to
   description, evidence, reference link, recommendation.

Progress uses `EventSource` with the polling fallback from section 4.

## 9. Testing

Vitest in `server/` and `web/`. Three layers:

- Unit, no database or network: URL and ref parser; every manifest parser
  against fixture files; OSV response mapping including alias dedupe and
  severity mapping; each code rule against positive and negative fixtures,
  including the placeholder exclusions; evidence masking; fingerprints;
  deterministic summarizer; comparison diff; Claude adapter with a mocked
  client covering schema success, unknown fingerprints dropped, and fallback
  on error.
- Integration, requires `DATABASE_URL` (the dev Compose database): Drizzle
  repository functions; API routes through `fastify.inject` with a fake ref
  resolver, including SSE snapshot and terminal events; the full worker handler with a fake git
  fetcher pointing at a fixture directory and a fake OSV client, covering
  success, retryable failure then success, and non-retryable failure.
- Smoke, `npm run smoke`: against a running stack, submits the demo repo at
  `v1`, waits for `done`, asserts findings and a summary; submits `v2`,
  asserts the comparison reports fixed findings.

Also `npm run typecheck` and `npm run lint` across both workspaces.

## 10. Demo repository

A small public repo under the candidate's account, created with the user's
approval, with two tags:

- `v1`: a `package-lock.json` pinning known-vulnerable versions (for example
  lodash 4.17.15, minimist 1.2.0), a config file containing the AWS
  documentation example key `AKIAIOSFODNN7EXAMPLE`, and an `eval` call.
- `v2`: versions upgraded, key removed, `eval` replaced.

The README walks the reviewer through scanning `v1` then `v2` to see the
comparison.

## 11. Configuration

Environment, validated by Zod at startup with clear errors:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | set by Compose | Postgres connection |
| `ROLE` | no | `all` | `api`, `worker`, or `all` |
| `PORT` | no | `8080` | api listen port |
| `ANTHROPIC_API_KEY` | no | unset | enables the Claude summarizer |
| `ANTHROPIC_MODEL` | no | `claude-opus-5-5` | model id |
| `GITHUB_TOKEN` | no | unset | private repos and higher limits |
| `WORKER_CONCURRENCY` | no | `2` | scans per worker |
| `LOG_LEVEL` | no | `info` | pino level |

`.env.example` documents all of them. Compose reads `.env` if present.

## 12. README outline

1. What it is, in the customer's three questions.
2. Quick start: `docker compose up`, open `http://localhost:8080`.
3. Try it: the demo repo at `v1`, then `v2`. Enabling the AI summary.
4. Architecture diagram and request flow.
5. Decisions and trade-offs: pg-boss over Redis, Postgres as the only
   dependency, SSE over polling and WebSocket, hybrid summarizer, deterministic
   fingerprints, git over the GitHub API.
6. Security considerations: secret masking, token handling, resource limits,
   what is deliberately not stored.
7. What I would do next: zip upload with its extraction risks, PR base
   diffing, more ecosystems, SARIF export, auth and tenancy, a broker when
   throughput demands it.
8. How I used coding agents: the workflow (brainstorm, spec, plan, TDD with
   Claude Code), what the agent produced, what I reviewed and changed, and
   where I disagreed.
9. Testing and development commands.

## 13. Build order

1. Scaffold: workspaces, TypeScript, Drizzle schema and first migration,
   Compose with db, migrate, api, worker. `docker compose up` serves a health
   endpoint.
2. Core flow with a fake pipeline: create with real ref resolution, read,
   list, SSE, pg-boss handler that walks the stages with delays. UI submit, progress, and a placeholder
   result. End-to-end in Docker.
3. Real pipeline: git resolve and fetch, manifest parsers, OSV client and
   cache, code rules, deterministic summarizer, persist.
4. Result view and history view, polished.
5. Comparison: fingerprints, previous scan lookup, diff, UI section.
6. Claude summarizer with guards and fallback; fixture from a real run.
7. Demo repo, smoke test, README.

If time runs short, step 5 is cut first, then step 6.
