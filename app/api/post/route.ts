import { NextResponse } from 'next/server';
import { publishSelectedPhotos } from '../../../scripts/studio-api';
import type { TikTokPostMode } from '../../../scripts/desk-settings';
import type { SlideLayout } from '../../../scripts/utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

function parseMode(value: unknown): TikTokPostMode {
  if (value === 'live' || value === 'zernio' || value === 'inbox') return value;
  return 'inbox';
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      imageUrls?: string[];
      slides?: SlideLayout[];
      caption?: string;
      accountId?: string;
      mode?: TikTokPostMode;
    };
    if (!body.imageUrls?.length || !body.caption) {
      return NextResponse.json({ error: 'Missing photos or caption' }, { status: 400 });
    }
    const result = await publishSelectedPhotos(
      body.imageUrls,
      body.slides || [],
      body.caption,
      body.accountId,
      parseMode(body.mode)
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Post failed' },
      { status: 500 }
    );
  }
}
