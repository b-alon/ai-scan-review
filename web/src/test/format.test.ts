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
