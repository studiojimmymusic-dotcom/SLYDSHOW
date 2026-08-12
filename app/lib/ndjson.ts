export type StreamEvent =
  | { type: 'progress'; message: string }
  | { type: 'result'; [key: string]: unknown }
  | { type: 'error'; error: string };

export async function readNdjsonStream(
  res: Response,
  onProgress: (message: string) => void
): Promise<Record<string, unknown>> {
  if (!res.body) {
    const data = await res.json();
    if (!res.ok || data.type === 'error') {
      throw new Error(data.error || data.message || 'Request failed');
    }
    return data.type === 'result' ? data : data;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: Record<string, unknown> | null = null;
  let streamError = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: StreamEvent;
      try {
        event = JSON.parse(trimmed) as StreamEvent;
      } catch {
        continue;
      }
      if (event.type === 'progress' && event.message) {
        onProgress(event.message);
      } else if (event.type === 'result') {
        result = event as Record<string, unknown>;
      } else if (event.type === 'error') {
        streamError = event.error || 'Request failed';
      }
    }
  }

  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer.trim()) as StreamEvent;
      if (event.type === 'progress' && event.message) onProgress(event.message);
      if (event.type === 'result') result = event as Record<string, unknown>;
      if (event.type === 'error') streamError = event.error || 'Request failed';
    } catch {
      // ignore trailing junk
    }
  }

  if (streamError) throw new Error(streamError);
  if (!result) throw new Error('No result from server');
  return result;
}
