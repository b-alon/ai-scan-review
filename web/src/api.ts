import type { CreateScanResponse, ScanListItem, ScanView } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? `Request failed with status ${res.status}`);
  }
  return body as T;
}

export const api = {
  createScan: (repoUrl: string, ref?: string, force = false) =>
    request<CreateScanResponse>('/api/scans', {
      method: 'POST',
      body: JSON.stringify({ repoUrl, ref: ref?.trim() ? ref.trim() : undefined, force }),
    }),
  getScan: (id: string) => request<ScanView>(`/api/scans/${id}`),
  listScans: (limit = 50) => request<{ scans: ScanListItem[] }>(`/api/scans?limit=${limit}`),
};
