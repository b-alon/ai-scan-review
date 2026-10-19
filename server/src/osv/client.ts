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
