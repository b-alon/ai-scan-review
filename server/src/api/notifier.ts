import pg from 'pg';
import type { Logger } from '../logger.js';

export interface ScanNotifier {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(scanId: string, cb: () => void): () => void;
  readonly connected: boolean;
}

export function createScanNotifier(connectionString: string, logger: Logger): ScanNotifier {
  const subscribers = new Map<string, Set<() => void>>();
  let client: pg.Client | null = null;
  let connected = false;
  let stopped = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 1000;

  function dispatch(scanId: string): void {
    for (const cb of subscribers.get(scanId) ?? []) {
      try {
        cb();
      } catch (err) {
        logger.warn({ err, scanId }, 'notifier subscriber threw');
      }
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    connected = false;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, 30_000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
    reconnectTimer.unref();
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    const next = new pg.Client({ connectionString });
    next.on('notification', (msg) => {
      if (msg.channel === 'scan_updates' && msg.payload) dispatch(msg.payload);
    });
    next.on('error', (err) => {
      logger.warn({ err }, 'notifier connection error');
      if (client === next) client = null;
      scheduleReconnect();
    });
    next.on('end', () => {
      if (client === next) client = null;
      scheduleReconnect();
    });
    try {
      await next.connect();
      await next.query('LISTEN scan_updates');
      client = next;
      connected = true;
      backoffMs = 1000;
      logger.info('listening for scan updates');
    } catch (err) {
      logger.warn({ err }, 'notifier could not connect');
      scheduleReconnect();
    }
  }

  return {
    get connected() {
      return connected;
    },
    async start() {
      stopped = false;
      await connect();
    },
    async stop() {
      stopped = true;
      connected = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const current = client;
      client = null;
      if (current) await current.end().catch(() => undefined);
    },
    subscribe(scanId, cb) {
      let set = subscribers.get(scanId);
      if (!set) {
        set = new Set();
        subscribers.set(scanId, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
        if (set.size === 0) subscribers.delete(scanId);
      };
    },
  };
}
