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
