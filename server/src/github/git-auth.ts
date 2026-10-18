export function gitAuthArgs(token: string | undefined): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.extraHeader=Authorization: Basic ${basic}`];
}

export function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' };
}
