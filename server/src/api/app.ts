import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Logger } from '../logger.js';
import { HttpError, jsonNotFound } from './errors.js';
import { registerStatic } from './routes/static.js';

export type RoutePlugin = (app: FastifyInstance) => void | Promise<void>;

export interface AppDeps {
  logger: Logger;
  routes: RoutePlugin[];
  webDistDir: string | null;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as unknown as FastifyBaseLogger,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong on our side.' } });
  });

  for (const route of deps.routes) await route(app);
  if (deps.webDistDir) await registerStatic(app, deps.webDistDir);
  else jsonNotFound(app);
  return app;
}
