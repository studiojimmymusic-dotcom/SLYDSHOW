import { NextResponse } from 'next/server';
import { listZernioPosts } from '../../../scripts/zernio-posts';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get('page') || 1);
    const limit = Number(searchParams.get('limit') || 30);
    const accountId = searchParams.get('accountId') || undefined;

    const result = await listZernioPosts({ page, limit, accountId: accountId || undefined });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load posts' },
      { status: 500 }
    );
  }
}
