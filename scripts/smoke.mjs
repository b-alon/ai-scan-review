#!/usr/bin/env node
// Smoke test against a running stack: scans the demo repo at v1 then v2 and checks the comparison.
const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:8787';
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
