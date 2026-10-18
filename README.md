# AI Scan Review

Connect a GitHub repository and get a security review that answers three questions: **what matters**, **what is risky**, and **what to do next**. Not a raw scanner report. Scan the same repository again later and the result shows what was fixed, what is new, and what is still open.

## Quick start

The only prerequisite is Docker.

```bash
git clone <this repository> ai-scan-review
cd ai-scan-review
docker compose up
```

Open <http://localhost:8787>. The first run builds the image and pulls Postgres, which takes a minute or two. Later runs start in seconds. If port 8787 is taken, set `APP_PORT` in a `.env` file.

## Try it

1. Scan `https://github.com/b-alon/scan-review-demo/tree/v1`. It has two vulnerable dependencies, a hardcoded AWS example key and an `eval` call. Watch the four stages run, then read the result.
2. Scan `https://github.com/b-alon/scan-review-demo/tree/v2`, where all of that is fixed. The result now has a "Since previous scan" section listing what was fixed.
3. Scan anything else, for example `https://github.com/expressjs/express/tree/4.17.1`. A branch, tag, commit or pull request URL all work, and the "Branch, tag or commit" field overrides whatever the URL implies.

### Enabling the AI summary

Without an Anthropic key the summary is written by deterministic rules, and the result carries a "Rule-based summary" badge. To switch on the AI summary:

```bash
cp .env.example .env     # set ANTHROPIC_API_KEY in it
docker compose up -d
```

Then scan again. The result carries an "AI summary" badge. A result from the last ten minutes is reused for the same commit, but only when it came from the same summarizer, so a rescan right after enabling the key runs fresh. If the model call fails for any reason, the deterministic summary is used and the badge tooltip says why.

## How it works

```
browser ──HTTP/SSE──> api ──────> Postgres <────── worker
                      │  resolve ref                 │ git fetch
                      │  (git ls-remote)             │ OSV.dev advisories
                      └──> GitHub                    │ code rules
                                                     └──> summary (rules or Claude)
```

1. The browser posts a repository URL. The api parses it, resolves the ref to a commit with `git ls-remote`, and answers immediately: a bad URL, a private repo without a token or an unknown branch is an inline form error, not a failed scan later.
2. If a scan for that commit is already queued or running, the browser joins it. If one finished in the last ten minutes, it is shown with a "Scan again" button. Otherwise a scan row is created and a job is queued with pg-boss.
3. The browser opens a Server-Sent Events stream for the scan.
4. The worker claims the job and runs the stages: fetch (shallow clone of that commit), dependencies (manifests parsed, advisories from OSV.dev), code (secret and risky-pattern rules), summarize. After every step it writes progress to Postgres and runs `NOTIFY`.
5. The api's single `LISTEN` connection receives each notification and pushes the fresh scan to every open stream. A two second poll backs this up, so a dropped notification never stalls the page.
6. On completion, findings and summary are written in one transaction, the previous scan of the same repository is linked, and the stream sends a final `done` event.

Stages, what they produce, and their limits:

| Stage | Produces | Limits |
|---|---|---|
| fetch | a temp directory with the commit's files | 120 s, removed afterwards |
| dependencies | advisories for `package-lock.json`, `package.json` (exact pins only), `requirements.txt`, `go.mod`, `Gemfile.lock`; `yarn.lock` and `pnpm-lock.yaml` count as lockfiles but are not parsed yet | manifests up to 3 directories deep, 2000 packages, 120 s |
| code | secrets (AWS, GitHub, Stripe, Slack, private keys, generic credentials), `eval`, shell and SQL interpolation, `dangerouslySetInnerHTML`, Django `DEBUG=True`, committed `.env` files | 5000 files, 512 KB per file, 120 s |
| summarize | risk level, headline, overview, top risks, ordered next actions | 60 s for the model call, then fallback |

## Decisions

**Postgres is the only dependency.** The queue (pg-boss), progress, results and history all live in one database. pg-boss gives retries with backoff, job expiry for dead workers and graceful shutdown without adding Redis. The job payload is only the scan id; our own tables are the record, pg-boss is transport. When throughput demands a broker, the swap is contained in one module.

**Refs resolve at submit time.** One `git ls-remote` costs about a second and buys immediate, specific errors and a known commit SHA before anything is queued. That SHA is what deduplicates concurrent submissions and keys the history.

**Server-Sent Events over polling or WebSocket.** Progress is one-directional, the browser's `EventSource` reconnects on its own, and nothing extra is installed. The client falls back to polling after two stream errors, and the server polls as a backstop even while listening for notifications.

**Hybrid summarizer with one contract.** Both summarizers return the same Zod-validated shape, so the UI and API never branch. The deterministic one is a rule set, not a mock: it groups advisories per package into one upgrade action, puts leaked credentials first, and writes effort estimates. The Claude one uses structured output for the same schema and is guarded: fingerprints it references are checked against real findings, and any error, timeout or refusal falls back to the rules with the reason recorded.

**Deterministic fingerprints.** A dependency finding is ecosystem, package and advisory id. A code finding is rule, path and a hash of the matched line, not its line number. That is what lets the comparison survive unrelated edits.

**Git over the GitHub API.** `git` resolves any ref, has no rate limit, and reads private repositories through a token header. The token goes to git through config environment variables, never on the command line, which other local processes could read.

**Freshness window.** Rescanning an unchanged commit is legitimate because advisory data changes over time, so a fresh scan is always one click away. Results are reused only inside a short window and only from the same summarizer.

**Rejected on purpose.** A hand-rolled `SKIP LOCKED` queue and raw SQL were replaced by pg-boss and Drizzle during design. Zip upload was cut: it adds extraction risks (path traversal, zip bombs, size limits) and breaks commit-keyed history, and private repositories are covered by `GITHUB_TOKEN`.

## Security considerations

- Secret values are masked before they are stored: evidence keeps the first four characters followed by `****`.
- The GitHub token is passed to git through `GIT_CONFIG_*` environment variables, never in a URL, argv or a log line. Pino redacts authorization headers and token fields.
- The readiness endpoint reports the database as `unavailable` and logs the detail instead of echoing error text.
- Resource limits apply to every stage: file count, file size, package count and per-stage timeouts. Temp directories are removed in a `finally`.
- Scanned repositories are read, never executed or installed.
- The dev-only Compose file publishes the database on `127.0.0.1` only. The production Compose file does not publish it at all.
- There is no authentication or tenancy. This is a local review tool, not a hosted service; see below.

## What I would do next

- Authentication, per-user scoping of scans, and rate limiting on scan creation.
- Zip upload with a size cap, path-traversal and zip-bomb protection, keyed by content hash.
- Pull request mode: scan the head and diff against the base branch instead of the previous scan.
- More ecosystems and lockfile formats (yarn, pnpm, Cargo, Maven), and CVSS vectors scored to numbers instead of the medium default.
- SARIF export so findings land in GitHub code scanning.
- OpenTelemetry traces and an error tracker, both env-var toggles once a backend exists.
- A broker-backed queue only if throughput outgrows Postgres.

## How I used coding agents

I built this with Claude Code, with the agent running a brainstorm, spec, plan, implement workflow rather than generating code from the brief directly.

- **Brainstorm.** The agent turned the vague customer request into design questions one at a time. I made the calls that shaped the product: use well-known libraries instead of a hand-rolled queue and raw SQL (pg-boss, Drizzle), Docker Compose as the one way to run it, a component library (Mantine), a freshness window for repeated scans, real-time progress, observability, and cutting zip upload.
- **Spec and plan.** The agent wrote a design spec and then an implementation plan with the test for each step written before the code. Both are committed under `docs/superpowers/` so the reasoning is reviewable, not just the result.
- **Implement.** Each task ran test-first against a real Postgres, with a ledger of every deviation from the plan and why. Where the plan was wrong, the fix is recorded there, for example a test helper that clobbered a Vitest mock, pg-boss retry pickup latency, and a placeholder filter that swallowed the AWS example key.
- **Review.** A background security review during development flagged three things I accepted: the git token on the command line (moved to environment config), raw database error text in the readiness response (replaced with a generic status), and the dev database port bound to all interfaces (bound to localhost).

What I reviewed and changed by hand: product decisions above, the result copy, and every ruling in the ledger. What I would not trust without reading: the regexes in the code rules and the deterministic summarizer wording, both of which have tests that pin the behaviour.

## Development

```bash
npm install
npm run dev:db                                    # Postgres on localhost:5433
export DATABASE_URL=postgres://scan:scan@localhost:5433/scan
npm run dev                                       # api on 8787, Vite on 5173 proxying /api
npm test                                          # unit tests, no database or network
npm run test:integration                          # against the dev database
npm run typecheck && npm run lint
npm run smoke                                     # against a running stack
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | set by Compose | Postgres connection |
| `ROLE` | no | `all` | `api`, `worker`, or both in one process |
| `PORT` | no | `8787` | listen port inside the process |
| `APP_PORT` | no | `8787` | host port published by Compose |
| `ANTHROPIC_API_KEY` | no | unset | enables the Claude summarizer |
| `ANTHROPIC_MODEL` | no | `claude-opus-5-5` | model id |
| `GITHUB_TOKEN` | no | unset | private repositories |
| `WORKER_CONCURRENCY` | no | `2` | scans per worker |
| `SCAN_FRESHNESS_MINUTES` | no | `10` | reuse a done scan of the same commit younger than this |
| `LOG_LEVEL` | no | `info` | pino level |

Metrics are served at `/metrics` on both roles (the worker's port is not published; use `docker compose exec worker wget -qO- http://127.0.0.1:8787/metrics`). Readiness is `/api/ready`.
