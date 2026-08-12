import { analyzeTikTokUrl } from '../../../scripts/studio-api';

export const runtime = 'nodejs';
export const maxDuration = 120;

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(obj)}\n`);
}

export async function POST(req: Request) {
  const { url } = (await req.json()) as { url?: string };
  if (!url?.trim()) {
    return new Response(encode({ type: 'error', error: 'Paste a TikTok photo URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encode(obj));
      try {
        const result = await analyzeTikTokUrl(url.trim(), (message) => {
          send({ type: 'progress', message });
        });
        send({ type: 'result', ...result });
      } catch (error) {
        send({
          type: 'error',
          error: error instanceof Error ? error.message : 'Analyze failed',
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
