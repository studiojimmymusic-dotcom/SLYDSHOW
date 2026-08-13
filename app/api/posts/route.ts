import { NextResponse } from 'next/server';
import { listZernioPosts, TIKTOK_PENDING_INBOX_LIMIT, isUnopenedInboxShare } from '../../../scripts/zernio-posts';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get('page') || 1);
    const limit = Number(searchParams.get('limit') || 30);
    const accountId = searchParams.get('accountId') || undefined;

    const result = await listZernioPosts({ page, limit, accountId: accountId || undefined });
    const pendingByAccount: Record<string, { username: string; count: number; titles: string[] }> = {};
    for (const post of result.posts) {
      if (!isUnopenedInboxShare(post)) continue;
      const key = post.accountId || post.username || 'unknown';
      if (!pendingByAccount[key]) {
        pendingByAccount[key] = { username: post.username, count: 0, titles: [] };
      }
      pendingByAccount[key].count += 1;
      if (pendingByAccount[key].titles.length < 5) pendingByAccount[key].titles.push(post.title);
    }
    return NextResponse.json({
      ok: true,
      ...result,
      pendingInbox: {
        limit: TIKTOK_PENDING_INBOX_LIMIT,
        accounts: Object.values(pendingByAccount),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load posts' },
      { status: 500 }
    );
  }
}
