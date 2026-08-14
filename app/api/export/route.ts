import * as fs from 'fs';
import * as path from 'path';
import { NextResponse } from 'next/server';
import { fetchPinImage } from '../../../scripts/pinimg';
import { ensureDir, makePostTimestamp, resolvePath } from '../../../scripts/utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

type SlideText = { index?: number; headline?: string; body?: string };

function decodeDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) {
    return { buffer: Buffer.from(dataUrl.replace(/\s/g, ''), 'base64'), ext: 'jpg' };
  }
  const mime = match[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { buffer: Buffer.from(match[2], 'base64'), ext };
}

function extFromType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

function mimeFromExt(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; ext: string }> {
  const trimmed = url.trim();
  if (trimmed.startsWith('data:')) return decodeDataUrl(trimmed);

  const tryGeneric = async (): Promise<{ buffer: Buffer; ext: string } | null> => {
    try {
      const res = await fetch(trimmed, { redirect: 'follow' });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
        return null;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 100) return null;
      return { buffer, ext: extFromType(contentType) };
    } catch {
      return null;
    }
  };

  const isPin = /pinimg\.com/i.test(trimmed);
  if (!isPin) {
    const generic = await tryGeneric();
    if (generic) return generic;
  }

  const fetched = await fetchPinImage(trimmed);
  if (fetched) {
    return { buffer: fetched.buffer, ext: extFromType(fetched.contentType) };
  }

  const fallback = await tryGeneric();
  if (fallback) return fallback;
  throw new Error('Could not download photo');
}

function openFolder(dir: string) {
  const { execFile } = require('child_process') as typeof import('child_process');
  execFile('explorer', [dir], () => undefined);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      imageUrls?: string[];
      lastSlideDataUrl?: string;
      slide6DataUrl?: string;
      slides?: SlideText[];
      caption?: string;
    };

    const imageUrls = (body.imageUrls || []).filter(Boolean);
    if (imageUrls.length < 1 || imageUrls.length > 5) {
      return NextResponse.json({ error: 'Pick between 1 and 5 photos first' }, { status: 400 });
    }

    const files: Array<{ name: string; ext: string; data: Buffer }> = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const fetched = await downloadImage(imageUrls[i]);
      files.push({ name: `slide-${i + 1}.${fetched.ext}`, ext: fetched.ext, data: fetched.buffer });
    }

    const promoDataUrl = body.lastSlideDataUrl || body.slide6DataUrl;
    if (promoDataUrl) {
      const promo = decodeDataUrl(promoDataUrl);
      if (promo.buffer.length < 1000) {
        return NextResponse.json({ error: 'Last-slide image looks empty' }, { status: 400 });
      }
      files.push({
        name: `slide-${imageUrls.length + 1}.${promo.ext}`,
        ext: promo.ext,
        data: promo.buffer,
      });
    }

    const caption = String(body.caption || '').trim();
    const stamp = makePostTimestamp();
    const imagesDir = resolvePath('exports', `slydshow-${stamp}`);
    ensureDir(imagesDir);

    for (const file of files) {
      fs.writeFileSync(path.join(imagesDir, file.name), file.data);
    }

    let opened = false;
    try {
      openFolder(imagesDir);
      opened = true;
    } catch {
      opened = false;
    }

    return NextResponse.json({
      ok: true,
      imagesDir,
      opened,
      files: files.map((file) =>
        opened
          ? { name: file.name }
          : { name: file.name, dataUrl: `data:${mimeFromExt(file.ext)};base64,${file.data.toString('base64')}` }
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
}
