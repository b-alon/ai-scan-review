import { execFile } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
}

export type Exec = (cmd: string, args: string[], opts: ExecOptions) => Promise<ExecResult>;

export class ExecError extends Error {
  constructor(
    public readonly cmd: string,
    public readonly code: number | null,
    public readonly stderr: string,
    public readonly timedOut: boolean,
  ) {
    super(timedOut ? `${cmd} timed out` : `${cmd} exited with code ${code ?? 'unknown'}`);
    this.name = 'ExecError';
  }
}

export const realExec: Exec = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, env: opts.env, signal: opts.signal, timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
          const timedOut = e.killed === true || e.name === 'AbortError' || opts.signal?.aborted === true;
          const code = typeof e.code === 'number' ? e.code : null;
          reject(new ExecError(cmd, code, String(stderr ?? ''), timedOut));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
