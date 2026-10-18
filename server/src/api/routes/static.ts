import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { jsonNotFound } from '../errors.js';

export async function registerStatic(app: FastifyInstance, webDistDir: string): Promise<void> {
  if (!existsSync(webDistDir)) {
    app.log.warn({ webDistDir }, 'web build not found; the UI will not be served');
    jsonNotFound(app);
    return;
  }
  await app.register(fastifyStatic, { root: webDistDir, prefix: '/', wildcard: true, index: ['index.html'] });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'not_found', message: `No route for ${req.method} ${req.url}` } });
    }
    return reply.sendFile('index.html');
  });
}
