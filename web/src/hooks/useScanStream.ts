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
