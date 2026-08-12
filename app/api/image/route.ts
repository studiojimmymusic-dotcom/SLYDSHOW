import { NextResponse } from 'next/server';
import { fetchPinImage } from '../../../scripts/pinimg';

export const runtime = 'nodejs';

const ALLOWED = /(^|\.)pinimg\.com$|(^|\.)tiktokcdn\.com$|(^|\.)tiktokcdn-us\.com$/i;

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get('url') || '';
  if (!url.startsWith('https://')) {
    return NextResponse.json({ error: 'Invalid image url' }, { status: 400 });
  }

  try {
    const host = new URL(url).hostname;
    if (!ALLOWED.test(host)) {
      return NextResponse.json({ error: 'Host not allowed' }, { status: 400 });
    }

    const image = await fetchPinImage(url);
    if (!image) {
      return NextResponse.json({ error: 'Image fetch failed' }, { status: 502 });
    }

    return new NextResponse(new Uint8Array(image.buffer), {
      headers: {
        'Content-Type': image.contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Image proxy failed' }, { status: 500 });
  }
}
