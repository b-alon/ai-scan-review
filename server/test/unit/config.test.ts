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
