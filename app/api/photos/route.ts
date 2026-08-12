import { listStudioPhotos } from '../../../scripts/studio-api';

export const runtime = 'nodejs';
export const maxDuration = 120;

function line(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

export async function POST(req: Request) {
  let body: { limit?: number; excludeKeys?: string[]; query?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(line(obj)));
      try {
        const photos = await listStudioPhotos(
          body.limit || 24,
          body.excludeKeys || [],
          body.query || '',
          (message) => send({ type: 'progress', message })
        );
        send({ type: 'result', photos });
      } catch (error) {
        send({
          type: 'error',
          error: error instanceof Error ? error.message : 'Photo search failed',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
