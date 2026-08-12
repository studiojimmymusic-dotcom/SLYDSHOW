import * as fs from 'fs';
import * as path from 'path';
import { NextResponse } from 'next/server';
import { fetchPinImage } from '../../../scripts/pinimg';
import { ensureDir, makePostTimestamp, resolvePath, writeJson } from '../../../scripts/utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

type SlideText = { index?: number; headline?: string; body?: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      imageUrls?: string[];
      slides?: SlideText[];
      caption?: string;
    };

    const imageUrls = (body.imageUrls || []).filter(Boolean);
    if (imageUrls.length !== 5) {
      return NextResponse.json({ error: 'Pick exactly 5 photos first' }, { status: 400 });
    }

    const stamp = makePostTimestamp();
    const exportDir = resolvePath('exports', `tiktok-${stamp}`);
    const imagesDir = path.join(exportDir, 'images');
    ensureDir(imagesDir);

    for (let i = 0; i < imageUrls.length; i++) {
      const fetched = await fetchPinImage(imageUrls[i]);
      if (!fetched) {
        throw new Error(`Could not download photo ${i + 1}`);
      }
      const ext = fetched.contentType.includes('png') ? 'png' : 'jpg';
      fs.writeFileSync(path.join(imagesDir, `slide-${i + 1}.${ext}`), fetched.buffer);
    }

    const slides = body.slides || [];
    const lines = [
      'Upload these photos in TikTok as a photo carousel.',
      'Then add Title / Body text from below, pick a sound, and publish.',
      '',
      `Folder: ${exportDir}`,
      '',
    ];

    slides.forEach((slide, i) => {
      const title = (slide.headline || '').replace(/\s+/g, ' ').trim().toUpperCase();
      const bodyText = (slide.body || '').replace(/\s+/g, ' ').trim();
      lines.push(`--- SLIDE ${slide.index || i + 1} ---`);
      if (title) {
        lines.push('TITLE');
        lines.push(title);
      }
      if (bodyText) {
        lines.push('BODY');
        lines.push(bodyText);
      }
      if (!title && !bodyText) lines.push('(no text)');
      lines.push('');
    });

    if (body.caption) {
      lines.push('--- CAPTION ---');
      lines.push(body.caption.trim());
      lines.push('');
    }

    fs.writeFileSync(path.join(exportDir, 'text-guide.txt'), lines.join('\n'), 'utf8');
    writeJson(path.join(exportDir, 'meta.json'), {
      createdAt: new Date().toISOString(),
      imageCount: imageUrls.length,
      caption: body.caption || '',
      slides,
    });

    try {
      const { execFile } = await import('child_process');
      execFile('explorer', [imagesDir], () => undefined);
    } catch {
      // folder open is best-effort on Windows
    }

    return NextResponse.json({
      ok: true,
      exportDir,
      imagesDir,
      guidePath: path.join(exportDir, 'text-guide.txt'),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
}
