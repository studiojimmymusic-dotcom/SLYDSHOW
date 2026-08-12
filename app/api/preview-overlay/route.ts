import { NextResponse } from 'next/server';
import { renderOverlayToBuffer } from '../../../scripts/add-overlays';
import type { SlideLayout } from '../../../scripts/utils';
import type { PublishSlideStyle } from '../../../scripts/studio-api';

export const runtime = 'nodejs';
export const maxDuration = 60;

function decodeDataUrl(dataUrl: string): Buffer {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) {
    return Buffer.from(dataUrl.replace(/\s/g, ''), 'base64');
  }
  return Buffer.from(match[2], 'base64');
}

async function loadImageBuffer(imageUrl?: string, imageDataUrl?: string): Promise<Buffer> {
  if (imageDataUrl) {
    const buf = decodeDataUrl(imageDataUrl);
    if (buf.length < 500) throw new Error('Image data looks empty');
    return buf;
  }
  if (!imageUrl) throw new Error('Missing image');
  if (imageUrl.startsWith('data:')) return decodeDataUrl(imageUrl);
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Could not load image (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      imageUrl?: string;
      imageDataUrl?: string;
      headline?: string;
      body?: string;
      style?: PublishSlideStyle;
    };

    const imageBuffer = await loadImageBuffer(body.imageUrl, body.imageDataUrl);
    const layout: SlideLayout = {
      headline: body.headline?.trim() || undefined,
      body: body.body || '',
    };

    const preview = await renderOverlayToBuffer(imageBuffer, layout, body.style);
    const base64 = preview.toString('base64');
    return NextResponse.json({
      ok: true,
      previewDataUrl: `data:image/jpeg;base64,${base64}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Preview failed' },
      { status: 500 }
    );
  }
}
