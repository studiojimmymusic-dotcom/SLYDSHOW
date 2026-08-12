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

function decodeDataUrl(dataUrl: string): Buffer {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) {
    return Buffer.from(dataUrl.replace(/\s/g, ''), 'base64');
  }
  return Buffer.from(match[2], 'base64');
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      imageUrls?: string[];
      slides?: SlideLayout[];
      lastSlideDataUrl?: string;
      slide6DataUrl?: string;
      caption?: string;
      accountId?: string;
      mode?: TikTokPostMode;
    };
    if (!body.imageUrls?.length || !body.caption) {
      return NextResponse.json({ error: 'Missing photos or caption' }, { status: 400 });
    }
    const promoDataUrl = body.lastSlideDataUrl || body.slide6DataUrl;
    if (!promoDataUrl) {
      return NextResponse.json(
        { error: 'Upload an app screenshot for the last slide' },
        { status: 400 }
      );
    }

    const lastSlideBuffer = decodeDataUrl(promoDataUrl);
    if (lastSlideBuffer.length < 1000) {
      return NextResponse.json({ error: 'Last-slide image looks empty' }, { status: 400 });
    }

    const result = await publishSelectedPhotos(
      body.imageUrls,
      body.slides || [],
      body.caption,
      body.accountId,
      parseMode(body.mode),
      {
        lastSlideBuffer,
      }
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Post failed' },
      { status: 500 }
    );
  }
}
