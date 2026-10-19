# SDD ledger — plan: docs/superpowers/plans/2026-10-18-ai-scan-review.md
Spec: docs/superpowers/specs/2026-10-18-ai-scan-review-design.md (read)
Setup: Ruling: implement on branch feat/scan-review in place, no worktree — main holds only docs, nothing to isolate from, and a second directory would change the Compose project name — cost if wrong: none beyond a branch switch.
Pre-flight (shared interfaces):
- Task 3 -> 9/11/22: schema tables, ScanRow/FindingRow/EventRow, Queryable — names and types consistent.
- Task 4 -> 5/11/12/25: buildApp({ logger, routes, webDistDir }) — Task 4 omits webDistDir, Task 5 adds it and updates the health test; later tasks pass it. Consistent.
- Task 9 -> 11/13/22: repo functions (createScan, getScan, listScans, findActiveScanByCommit, findRecentDoneScanByCommit, startAttempt, updateProgress, markRetrying, markFailed, completeScan, findPreviousDoneScan, listFindings, listEvents, countFindingsBySeverity, countQueued) — consumers use the same names and signatures.
- Task 10 -> 11/13: routes take an injected enqueue(scanId); handler takes ScanJob { id, data, retryCount, retryLimit, signal } — consistent.
- Task 13 -> 21/25: Pipeline/PipelineContext/PipelineResult (commitSha optional) and createScanJobHandler({ db, pipeline, logger }) — consistent; Task 25 adds metrics inside the handler without changing the signature.
- Task 7 -> 8/11/15: ParsedRepo.refKind 'sha' only for full 40-char SHAs (short SHAs rejected); fetch stage assumes full SHA. Consistent after plan cleanup.
- Task 17 -> 18/21: OsvClient, VulnCache, fetchAdvisories({ osv, cache, packages, signal }) — consistent.
- Task 20 -> 21/24: Summarizer { mode, summarize(input, signal) } -> SummarizeOutcome — consistent.
- Task 11 -> 14/23: ScanView JSON shape mirrored in web/src/types.ts — field names match.
No unresolved conflicts.
Task 1: Ruling: lint script is 'eslint .' instead of 'eslint src test' — ESLint 10 errors on a pattern that matches no files and src is empty until Task 2 — cost if wrong: none, the flat config already ignores dist and drizzle.
Task 1: complete (commits 8dcb870..3167219, tests: npm test -w server →    Duration  81ms (import 45%, transform 21%, worker 19%, tests 14%, environment 1%))
Task 2: complete (commits 3167219..37517ff, tests: npm test -w server →    Duration  105ms (import 55%, transform 29%, tests 9%, worker 7%))
Task 3: complete (commits 37517ff..aae0304, tests: npm run test:integration -w server →    Duration  394ms (import 77%, tests 17%, transform 6%, worker 1%))
Task 4: Ruling: default app port is 8787, not 8080 — 8080 was already taken by another dev server on this machine and the spec asks for an uncommon default; applies to config default, Compose PORT/APP_PORT, Vite proxy and README in later tasks — cost if wrong: one env var.
Task 4: Ruling: loggerInstance cast to FastifyBaseLogger — pino's Logger type changes the FastifyInstance generic and breaks route plugin typing; the plan anticipated this — cost if wrong: none at runtime.
Task 4: Ruling: compose.dev.yaml publishes the db on 127.0.0.1:5433 only — background security review flagged 0.0.0.0 exposure; dev-only file — cost if wrong: none.
Task 4: complete (commits aae0304..3bf96a9, tests: npm test -w server →    Duration  232ms (import 50%, tests 40%, transform 6%, worker 3%))
Task 5: Ruling: /api/ready reports the database check as 'unavailable' and logs the error instead of echoing it — background security review flagged raw error text (could include hosts or credentials) — cost if wrong: operators read the log instead of the response.
Task 5: Ruling: web lint script is 'eslint .' to match the server — cost if wrong: none.
Task 5: complete (commits 3bf96a9..992d24f, tests: npm test →    Duration  667ms (environment 50%, import 39%, tests 6%, setup 4%, transform 1%))
Task 6: Ruling: only the api service has build:, migrate and worker reuse image ai-scan-review with pull_policy: never — three services building the same tag raced in BuildKit ("image already exists"); verified from a clean image state that Compose builds before creating the dependent containers — cost if wrong: a reviewer sees a pull error, which the clean-state test rules out.
Task 6: complete (commits 992d24f..d850149, tests: npm test -w server →    Duration  281ms (import 54%, tests 36%, transform 8%, worker 3%))
Task 7: complete (commits d850149..3bc3599, tests: npm test -w server →    Duration  319ms (tests 46%, import 44%, transform 6%, worker 3%))
Task 8: Ruling: test helper fakeExec returns { exec, calls } instead of Object.assign on a vi.fn — assigning a 'mock' property onto a vi.fn overwrites its read-only internals (plan defect) — cost if wrong: none, test-only.
Task 8: complete (commits 3bc3599..71a3ecc, tests: npm test -w server →    Duration  300ms (import 50%, tests 31%, transform 13%, worker 6%))
Task 10 (pre): Ruling: GitHub token goes to git via GIT_CONFIG_COUNT/KEY_0/VALUE_0 env vars instead of a -c argv flag — background security review: argv is readable by every local process, env only by the same user; gitAuthArgs removed, gitEnv(token) replaces it, Task 15 fetch must use env too — cost if wrong: none; requires git >= 2.31, which both the local git and node:24-alpine satisfy.
Task 10: Ruling: work() sets notifyPollingIntervalSeconds: 2 — with LISTEN/NOTIFY active pg-boss polls only every 30 s as a backstop and delayed retries are not notified, so a retry waited up to 30 s (test timed out) — cost if wrong: one cheap poll query every 2 s per worker.
Task 10: Ruling: queue test calls boss.deleteAllJobs(SCAN_QUEUE) before registering its worker — pg-boss jobs persist across runs and a leftover retry job from an aborted run polluted the attempt sequence — cost if wrong: none, test-only.
Task 10: Ruling: test:integration runs with --no-file-parallelism — integration files share one database and TRUNCATE each other mid-test when run in parallel (countQueued saw 2) — cost if wrong: slower integration runs only.
Task 10: complete (commits 6ae457d..b19c91e, tests: npm run test:integration -w server -- queue →    Duration  2.55s (tests 86%, import 13%, transform 1%))
Task 11: complete (commits 96aa906..b79b554, tests: npm run test:integration -w server →    Duration  4.19s (tests 70%, import 28%, transform 2%))
Task 12: complete (commits b79b554..bd4d566, tests: npm run test:integration -w server →              at least ~269ms faster with isolate: false — reuses workers across files instead of one per file)
Task 13: Ruling: background security review flags missing authentication/authorization and unthrottled scan creation on /api/scans — the spec lists auth and tenancy as non-goals for this POC; documented under 'what I would do next' in the README (auth, per-user scoping, rate limiting) rather than added now — cost if wrong: an exposed deployment could be used to scan arbitrary public repos; the app is meant to run locally for reviewers.
Task 13: complete (commits bd4d566..80f5ad4, tests: npm run test:integration -w server -- run-scan →    Duration  657ms (import 60%, tests 33%, transform 6%))
Task 14: Ruling: formatDuration rounds via Math.round(ms/100)/10 instead of toFixed on the raw quotient — toFixed(1) turns 0.85 into '0.8' through binary float representation; the test's conventional rounding is what a reader expects — cost if wrong: none.
Task 14: Note: browser step verified via component tests (stepper, timeline, retry alert) and the production bundle containing the pages; no interactive browser available in this session.
Task 14: complete (commits 80f5ad4..5198b19, tests: npm test -w web →    Duration  761ms (environment 66%, import 21%, setup 5%, tests 5%, transform 2%))
Task 15: complete (commits 5198b19..f99fa67, tests: npm test -w server →    Duration  329ms (tests 46%, import 38%, transform 11%, worker 4%))
Task 16: complete (commits f99fa67..adc1cb6, tests: npm test -w server →    Duration  322ms (tests 49%, import 36%, transform 11%, worker 4%))
Task 17: complete (commits adc1cb6..a0d8f71, tests: npm test -w server →    Duration  489ms (import 48%, tests 38%, transform 11%, worker 3%))
Task 18: complete (commits a0d8f71..7f354c7, tests: npm test -w server →    Duration  502ms (import 58%, tests 30%, transform 10%, worker 2%))
Task 19: Ruling: the placeholder filter applies only to secret.generic_assignment (placeholderFilter flag), not to format-matched secret rules — the filter's 'example'/'xxx' terms swallowed the AWS documentation key and Slack webhooks; a value that matches a vendor key format is worth reporting even when it contains 'example' — cost if wrong: a reviewer scanning a repo full of documentation example keys sees them flagged (critical), which is arguably correct.
Task 19: Ruling: secret.generic_assignment is fallbackOnly, skipped when a specific secret rule already matched the line — avoids reporting one token twice — cost if wrong: none.
Task 19: complete (commits 7f354c7..7f7ff33, tests: npm test -w server →    Duration  530ms (import 56%, tests 28%, transform 13%, worker 2%))
Task 20: Ruling: deterministic test expects '3 advisories affect 2 packages' — the plan's expectation miscounted its own fixture (two lodash advisories plus one left-pad advisory with no fix); the implementation counts correctly — cost if wrong: none.
Task 20: complete (commits 7f7ff33..66905bf, tests: npm test -w server →    Duration  536ms (import 57%, tests 30%, transform 10%, worker 3%))
Task 21: complete (commits 66905bf..2d182c1, tests: npm run test:integration -w server -- pipeline →    Duration  518ms (import 64%, tests 26%, transform 10%))
Task 22: complete (commits 2d182c1..c282b7d, tests: npm run test:integration -w server →              at least ~528ms faster with isolate: false — reuses workers across files instead of one per file)
Task 23: Ruling: Mantine 9 Collapse takes `expanded`, not `in` (plan used the v7 prop name) — cost if wrong: none.
Task 23: Ruling: same-commit comparison title is "Same commit as your previous scan" without the "Since previous scan:" prefix — matches the spec wording and the test; the ordering test only needs the non-same-commit title — cost if wrong: none.
Task 23: complete (commits c282b7d..ab95050, tests: npm test -w web →    Duration  1.10s (environment 60%, import 24%, tests 9%, setup 5%, transform 2%))
Task 24: Note: claude-summary.example.json not generated; needs Alon's ANTHROPIC_API_KEY (one call, about 3 cents on claude-opus-5-5). Command: cd server && ANTHROPIC_API_KEY=... npx tsx scripts/try-claude.ts > test/fixtures/claude-summary.example.json
Task 24: complete (commits ab95050..b464f9a, tests: npm test -w server →    Duration  673ms (import 53%, tests 23%, transform 22%, worker 2%))
Task 25: complete (commits b464f9a..0c733de, tests: npm test -w server →    Duration  704ms (import 60%, tests 30%, transform 8%, worker 3%))
Task 27: README written; 'read as reviewer' check deferred until the demo repo URL exists and smoke passes.
Task 26: Ruling: demo repo lives at b-alon/scan-review-demo (Alon's personal account), not alonbrt — Alon's instruction; gh switched to b-alon with his login — cost if wrong: none.
Task 26: Ruling: v2 of the demo repo pins lodash 4.18.1 and minimist 1.2.8 (not 4.17.21 / 1.2.8 as the plan said) — the plan's sed missed the lockfile package entries so v2 still scanned as vulnerable, and OSV now lists three 2026 advisories against lodash 4.17.21; v2 at 4.18.1 scans clean, which is the demo's point. Tag v2 was force-pushed once on the freshly created repo — cost if wrong: none.
Task 26: complete (commits 0c733de..7353a24, tests: npm run smoke → smoke passed: v1 10 findings, v2 0 findings, 10 fixed)
Task 27: complete (commits 0602186..7353a24, tests: npm test -w server →    Duration  670ms (import 59%, tests 29%, transform 9%, worker 3%))
Task 28: Ruling: evidence lines are passed through redactSecrets() for every rule, not only secret rules — background security review: a credential on the same line as an eval or SQL finding was stored in clear — cost if wrong: none.
Task 28: Ruling: Claude system prompt states the scan JSON is untrusted third-party content and must not be followed as instructions — background security review flagged prompt injection via file names and advisory text; output is still schema-bound and fingerprint-checked — cost if wrong: none.
Final review: fresh reviewer (fable) on 8dcb870..dab9514; verdict "with fixes": 1 critical, 6 important, 16 minor.
Final: fixed generic credential regex (leading \b blocked DB_PASSWORD etc.; quoted JSON keys added) — rules.test 'shapes real code uses' RED→GREEN
Final: fixed python eval false positive on model.eval() — rules.test eval cases RED→GREEN
Final: fixed annotated tag resolution (asks ls-remote for refs/tags/<name>^{}) — resolve-ref.test args RED→GREEN
Final: fixed zombie scans (age-bound active lookup, force bypasses in-progress, enqueue failure marks the scan failed with 503, worker fails stale scans on start) — scans-repo 'stale' and scan-routes 'forced'/'queue rejects' RED→GREEN
Final: fixed risk level floor at the worst finding — guards.test 'never below the worst finding' RED→GREEN
Final: fixed yarn/pnpm lockfile false positive (lock-marker manifests) — deps-stage 'yarn and pnpm' RED→GREEN
Final: fixed per-advisory detail failure dropping all advisories — osv.test 'skips an advisory' RED→GREEN
Final: Ruling: item 8 (python eval) re-graded Important and fixed — every PyTorch repo would show false medium findings — cost if wrong: none.
Final: Ruling: item 5 (real Claude run + README fixture) stays open for Alon — needs his API key; one documented command — cost if wrong: a reviewer who sets a key sees the fallback badge if structured output misbehaves.
Final: Ruling: 'declined to judge' list accepted as-is (non-goals, port, temp dir naming, SIGKILL temp leak inside the container, OSV pagination, PyPI normalization, CVSS scoring, PEM under fixtures, poll costs, pino-pretty, timeouts, stats.files, Vite proxy) — all are either explicit non-goals, README next steps, or no user-visible effect — cost if wrong: minor noise.
Final: minor (deferred): sql_interpolation rule requires a dot before query( (item 9)
Final: minor (deferred): raw error message shown on failed scans may include internal hosts/paths (item 10)
Final: minor (deferred): SSE route polls every 2 s even while LISTEN is connected (item 11)
Final: minor (deferred): ?limit=abc silently defaults to 50 instead of 400 (item 12)
Final: minor (deferred): home page has no empty state suggesting the demo repo (item 13)
Final: minor (deferred): same-commit comparison title omits the time ago (item 14)
Final: minor (deferred): no unique index guarding concurrent submits of the same commit (item 15)
Final: minor (deferred): git child inherits the whole process env instead of an allowlist (item 16)
Final: minor (deferred): owner/repo lowercased for display, not only for the key (item 17)
Final: minor (deferred): .env.test flagged high; .env.sample/.envrc not flagged (item 18)
Final: minor (deferred): fixed version taken from the first range, not the range containing the scanned version (item 19)
Final: minor (deferred): compose.yaml has no restart policy (item 20)
Final: minor (deferred): __test__enableSpies toggle lives in production code (item 21)
Final: minor (deferred): repo history filters the last 200 scans client-side (item 22)
Final: minor (deferred): .env.example omits DATABASE_URL, ROLE, PORT (item 23)
