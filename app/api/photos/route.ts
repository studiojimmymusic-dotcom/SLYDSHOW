import { listStudioPhotos } from '../../../scripts/studio-api';

export const runtime = 'nodejs';
export const maxDuration = 120;

function encode(obj: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(obj)}\n`, 'utf8');
}

export async function POST(req: Request) {
  let body: { limit?: number; excludeKeys?: string[]; query?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encode(obj));
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
