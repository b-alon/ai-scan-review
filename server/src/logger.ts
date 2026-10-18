import { pino, type Logger } from 'pino';
import type { Config } from './config.js';

export type { Logger };

export const REDACT_PATHS = [
  'req.headers.authorization',
  'headers.authorization',
  '*.token',
  '*.apiKey',
  '*.GITHUB_TOKEN',
  '*.ANTHROPIC_API_KEY',
];

export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'isProduction'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(config.isProduction
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }),
  });
}
