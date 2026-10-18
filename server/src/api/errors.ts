import type { FastifyInstance } from 'fastify';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function jsonNotFound(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: `No route for ${req.method} ${req.url}` } }),
  );
}
