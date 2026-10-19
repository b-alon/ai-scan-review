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
