import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { loadConfig } from '../src/config.js';
import { createSummarizer } from '../src/summarize/select.js';
import type { SummaryInput } from '../src/summarize/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused' });
const input = JSON.parse(await readFile(path.resolve(here, '../test/fixtures/sample-summary-input.json'), 'utf8')) as SummaryInput;
const summarizer = createSummarizer(config, pino({ level: 'warn' }));
const outcome = await summarizer.summarize(input, new AbortController().signal);
console.log(JSON.stringify(outcome, null, 2));
