import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Queryable } from '../../db/client.js';
import { HttpError } from '../errors.js';
import type { ScanNotifier } from '../notifier.js';
import { loadScanView, type ScanView } from '../read-model.js';

export interface StreamDeps {
  db: Queryable;
  notifier: ScanNotifier;
  pollMs?: number;
  heartbeatMs?: number;
}

const isTerminal = (view: ScanView): boolean => view.status === 'done' || view.status === 'failed';

export function registerStreamRoute(app: FastifyInstance, deps: StreamDeps): void {
  const pollMs = deps.pollMs ?? 2000;
  const heartbeatMs = deps.heartbeatMs ?? 15_000;
  const openStreams = new Set<(final?: string) => void>();
  app.addHook('onClose', async () => {
    for (const close of openStreams) close('closing');
  });

  app.get('/api/scans/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const initial = z.uuid().safeParse(id).success ? await loadScanView(deps.db, id) : undefined;
    if (!initial) throw new HttpError(404, 'scan_not_found', 'No scan with that id.');

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    let closed = false;
    let lastPayload = '';
    let chain: Promise<void> = Promise.resolve();

    const write = (event: string, data: unknown): void => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const unsubscribe = deps.notifier.subscribe(id, () => push());
    const poll = setInterval(() => push(), pollMs);
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, heartbeatMs);

    function close(final?: string): void {
      if (closed) return;
      closed = true;
      openStreams.delete(close);
      unsubscribe();
      clearInterval(poll);
      clearInterval(heartbeat);
      if (final) res.write(`: ${final}\n\n`);
      res.end();
    }
    openStreams.add(close);

    function push(snapshot?: ScanView): void {
      chain = chain
        .then(async () => {
          if (closed) return;
          const view = snapshot ?? (await loadScanView(deps.db, id));
          if (!view) {
            close();
            return;
          }
          const payload = JSON.stringify(view);
          if (!snapshot && payload === lastPayload) return;
          lastPayload = payload;
          if (snapshot) write('snapshot', view);
          else if (!isTerminal(view)) write('progress', view);
          if (isTerminal(view)) {
            write(view.status, view);
            close();
          }
        })
        .catch((err: unknown) => {
          req.log.warn({ err, scanId: id }, 'stream push failed');
        });
    }

    req.raw.on('close', () => close());
    push(initial);
  });
}
