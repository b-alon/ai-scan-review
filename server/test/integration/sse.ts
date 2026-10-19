export interface SseEvent {
  event: string;
  data: unknown;
}

export async function readSse(url: string, opts: { until?: (events: SseEvent[]) => boolean; timeoutMs?: number } = {}): Promise<SseEvent[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  const events: SseEvent[] = [];
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`stream returned ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (chunk.startsWith(':')) continue;
        const event = /^event: (.*)$/m.exec(chunk)?.[1];
        const data = /^data: (.*)$/m.exec(chunk)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
      if (opts.until?.(events)) {
        controller.abort();
        break;
      }
    }
  } catch (err) {
    if (!(err instanceof Error && err.name === 'AbortError')) throw err;
  } finally {
    clearTimeout(timeout);
  }
  return events;
}
