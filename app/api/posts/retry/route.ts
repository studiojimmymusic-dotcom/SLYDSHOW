import { NextResponse } from 'next/server';
import { retryZernioPostToInbox } from '../../../../scripts/zernio-posts';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { postId?: string };
    const postId = String(body.postId || '').trim();
    if (!postId) {
      return NextResponse.json({ error: 'Missing postId' }, { status: 400 });
    }

    const result = await retryZernioPostToInbox(postId);
    return NextResponse.json({
      ...result,
      hint: 'Open TikTok → Inbox → Activity → System notifications → tap the upload.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Retry failed';
    const status = /already scheduled|already posted|24 hours/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
