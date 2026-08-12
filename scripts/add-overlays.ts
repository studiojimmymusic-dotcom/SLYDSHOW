import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import opentype from 'opentype.js';
import {
  OverlayConfig,
  SlideCopy,
  SlideLayout,
  SlideTextStyle,
  ensureDir,
  loadConfig,
  log,
  logError,
  resolvePath,
} from './utils';

type LoadedFont = opentype.Font;

const TIKTOK_WHITE = '#FFFFFF';
const TIKTOK_BLACK = '#000000';
const HEAD_PAD_X = 0.34;
const HEAD_PAD_Y = 0.18;
const HEAD_LINE_GAP = 0.28;
const HEAD_BODY_GAP = 0.038;
const BODY_LINE_HEIGHT = 1.34;

function loadFontFile(fontPath: string): LoadedFont {
  if (!fs.existsSync(fontPath)) {
    throw new Error(`Font not found at ${fontPath}`);
  }
  const fontBuffer = fs.readFileSync(fontPath);
  return opentype.parse(
    fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength)
  );
}

function fontMetrics(font: LoadedFont, fontSize: number) {
  const scale = fontSize / font.unitsPerEm;
  const ascender = font.ascender * scale;
  const descender = font.descender * scale;
  return {
    ascender,
    descender,
    height: ascender - descender,
  };
}

function wrapByWidth(font: LoadedFont, text: string, fontSize: number, maxWidth: number): string[] {
  const raw = text.replace(/\r/g, '').trim();
  if (!raw) return [];

  const wrapParagraph = (paragraph: string): string[] => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (font.getAdvanceWidth(test, fontSize) <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  if (raw.includes('\n')) {
    const existing = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (existing.length >= 2) {
      return existing.flatMap((line) =>
        font.getAdvanceWidth(line, fontSize) > maxWidth * 1.08 ? wrapParagraph(line) : [line]
      );
    }
  }

  return balanceLines(font, wrapParagraph(raw), fontSize, maxWidth);
}

function balanceLines(font: LoadedFont, lines: string[], fontSize: number, maxWidth: number): string[] {
  if (lines.length < 2) return lines;
  const next = [...lines];
  const lastWords = next[next.length - 1].split(/\s+/);
  const prevWords = next[next.length - 2].split(/\s+/);
  if (lastWords.length === 1 && prevWords.length >= 3) {
    const moved = [...prevWords];
    const give = moved.pop();
    if (!give) return next;
    const newPrev = moved.join(' ');
    const newLast = `${give} ${next[next.length - 1]}`.trim();
    if (font.getAdvanceWidth(newLast, fontSize) <= maxWidth) {
      next[next.length - 2] = newPrev;
      next[next.length - 1] = newLast;
    }
  }
  return next.filter(Boolean);
}

function parseLayout(raw: string, layout?: SlideLayout): SlideLayout {
  if (layout) {
    return {
      headline: layout.headline?.trim() || undefined,
      body: layout.body.trim(),
    };
  }
  const marker = raw.split('|||BODY|||');
  if (raw.includes('|||HEAD|||') && marker.length === 2) {
    return {
      headline: marker[0].replace('|||HEAD|||', '').trim() || undefined,
      body: marker[1].trim(),
    };
  }
  return { body: raw.trim() };
}

function centeredPath(font: LoadedFont, text: string, x: number, baselineY: number, fontSize: number): string {
  const width = font.getAdvanceWidth(text, fontSize);
  const glyphPath = font.getPath(text, x - width / 2, baselineY, fontSize);
  return glyphPath.toPathData(2);
}

function bodyStrokeWidth(fontSize: number, config: OverlayConfig): number {
  const pct = config.strokeWidthPercent > 0 ? config.strokeWidthPercent : 0.14;
  return Math.max(10, Math.min(22, Math.round(fontSize * pct)));
}

function buildOverlaySvg(
  layout: SlideLayout,
  config: OverlayConfig,
  headFont: LoadedFont,
  bodyFont: LoadedFont,
  style?: Partial<SlideTextStyle>
): string {
  const width = config.outputWidth;
  const height = config.outputHeight;
  const body = layout.body || '';
  const headline = layout.headline || '';
  const wordCount = body.replace(/\n/g, ' ').split(/\s+/).filter(Boolean).length;

  let bodySizePercent = style?.bodySizePercent ?? 0.051;
  if (style?.bodySizePercent == null) {
    if (wordCount <= 6) bodySizePercent = 0.058;
    else if (wordCount <= 14) bodySizePercent = 0.054;
  }

  const bodySize = Math.round(width * bodySizePercent);
  const headSize = Math.round(width * (style?.headSizePercent ?? 0.043));
  const strokeWidth = bodyStrokeWidth(bodySize, config);
  const bodyLineHeight = bodySize * BODY_LINE_HEIGHT;
  const maxWidthPercent = style?.maxWidthPercent ?? config.maxWidthPercent;
  const bodyMaxWidth = width * maxWidthPercent;
  const headMaxWidth = width * Math.min(0.9, maxWidthPercent);
  const positionFromTop = style?.textPositionFromTop ?? config.textPositionFromTop;
  const showHeadlineBox = style?.showHeadlineBox !== false;

  const bodyLines = wrapByWidth(bodyFont, body, bodySize, bodyMaxWidth);
  const headLines = headline ? wrapByWidth(headFont, headline.toUpperCase(), headSize, headMaxWidth) : [];

  const x = width / 2;
  const parts: string[] = [];
  let blockTop = Math.round(height * Math.min(positionFromTop, 0.42));

  const headMetrics = fontMetrics(headFont, headSize);
  const headPadX = headSize * HEAD_PAD_X;
  const headPadY = headSize * HEAD_PAD_Y;
  const pillGap = headSize * HEAD_LINE_GAP;

  headLines.forEach((line, i) => {
    const textW = headFont.getAdvanceWidth(line, headSize);
    const boxW = Math.min(width * 0.92, textW + headPadX * 2);
    const boxH = headMetrics.height + headPadY * 2;
    const boxX = x - boxW / 2;
    const boxY = blockTop;
    const baselineY = boxY + headPadY + headMetrics.ascender;

    if (showHeadlineBox) {
      parts.push(
        `<rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${boxW.toFixed(1)}" height="${boxH.toFixed(1)}" rx="${(boxH / 2).toFixed(1)}" ry="${(boxH / 2).toFixed(1)}" fill="${TIKTOK_WHITE}"/>`
      );
      parts.push(`<path d="${centeredPath(headFont, line, x, baselineY, headSize)}" fill="${TIKTOK_BLACK}"/>`);
    } else {
      const d = centeredPath(headFont, line, x, baselineY, headSize);
      parts.push(
        `<path d="${d}" fill="${TIKTOK_WHITE}" stroke="${TIKTOK_BLACK}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"/>`
      );
    }

    blockTop += boxH + (i < headLines.length - 1 ? pillGap : 0);
  });

  if (bodyLines.length) {
    if (headLines.length) {
      blockTop += Math.round(height * HEAD_BODY_GAP);
    }
    const bodyMetrics = fontMetrics(bodyFont, bodySize);
    let bodyBaseline = blockTop + bodyMetrics.ascender;

    bodyLines.forEach((line, i) => {
      const d = centeredPath(bodyFont, line, x, bodyBaseline, bodySize);
      parts.push(
        `<path d="${d}" fill="${TIKTOK_WHITE}" stroke="${TIKTOK_BLACK}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"/>`
      );
      bodyBaseline += bodyLineHeight;
      if (i < bodyLines.length - 1) {
        bodyBaseline += bodySize * 0.02;
      }
    });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${parts.join('\n  ')}
</svg>`;
}

function overlayFonts(config: OverlayConfig): { headFont: LoadedFont; bodyFont: LoadedFont } {
  const headPath = resolvePath(config.fontPath);
  const bodyPath = resolvePath(config.bodyFontPath || config.fontPath);
  return {
    headFont: loadFontFile(headPath),
    bodyFont: loadFontFile(bodyPath),
  };
}

export async function renderOverlayToBuffer(
  imageInput: string | Buffer,
  layout: SlideLayout,
  style?: Partial<SlideTextStyle>
): Promise<Buffer> {
  const config = loadConfig().overlays;
  const { headFont, bodyFont } = overlayFonts(config);
  const svg = buildOverlaySvg(layout, config, headFont, bodyFont, style);

  return sharp(imageInput)
    .rotate()
    .resize(config.outputWidth, config.outputHeight, { fit: 'cover', position: 'centre' })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

export async function renderOverlayToFile(
  imageInput: string | Buffer,
  layout: SlideLayout,
  outputPath: string,
  style?: Partial<SlideTextStyle>
): Promise<void> {
  const buffer = await renderOverlayToBuffer(imageInput, layout, style);
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, buffer);
}

export async function addOverlay(
  imagePath: string,
  text: string,
  outputPath: string,
  config: OverlayConfig,
  layout?: SlideLayout
): Promise<void> {
  const parsed = parseLayout(text, layout);
  await renderOverlayToFile(imagePath, parsed, outputPath, {
    textPositionFromTop: config.textPositionFromTop,
    maxWidthPercent: config.maxWidthPercent,
  });
}

export async function addOverlays(copy: SlideCopy, postDir: string): Promise<string[]> {
  const config = loadConfig();
  const outputs: string[] = [];
  const finalDir = path.join(postDir, 'final');
  ensureDir(finalDir);

  for (let i = 0; i < copy.slides.length; i++) {
    const input = path.join(postDir, 'images', `slide-${i + 1}-raw.jpg`);
    const output = path.join(finalDir, `slide-${i + 1}.png`);
    try {
      if (!fs.existsSync(input)) {
        throw new Error(`Missing raw image: ${input}`);
      }
      await addOverlay(input, copy.slides[i], output, config.overlays, copy.layouts?.[i]);
      outputs.push(output);
      log('add-overlays', `Rendered slide ${i + 1}`);
    } catch (error) {
      logError('add-overlays', `Slide ${i + 1} failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (outputs.length === 0) {
    throw new Error('No slides were rendered');
  }

  return outputs;
}

async function runTest(): Promise<void> {
  const config = loadConfig();
  const testDir = resolvePath('posts', 'overlay-test');
  ensureDir(path.join(testDir, 'images'));
  ensureDir(path.join(testDir, 'final'));

  const samples = [
    {
      name: 'slide-1',
      text: 'How to become 10x\nbetter at producing\nwithout buying another\nplugin',
    },
    {
      name: 'slide-2',
      text: "|||HEAD|||1. STUDY SONGS YOU LOVE.|||BODY|||Don't just listen, analyze the drums, arrangement melodies, transitions, and sound selection.",
    },
    {
      name: 'slide-3',
      text: '|||HEAD|||Make your drums hit\nbefore you mix.|||BODY|||Better sound selection and better patterns will take you further than endless EQ.',
    },
    {
      name: 'slide-6',
      text: '|||HEAD|||Build your beat store|||BODY|||on FELAR\nusefelar.com',
    },
  ];

  for (const sample of samples) {
    const rawPath = path.join(testDir, 'images', `${sample.name}-raw.jpg`);
    await sharp({
      create: {
        width: config.overlays.outputWidth,
        height: config.overlays.outputHeight,
        channels: 3,
        background: { r: 28, g: 18, b: 22 },
      },
    })
      .jpeg()
      .toFile(rawPath);

    const out = path.join(testDir, 'final', `${sample.name}.png`);
    await addOverlay(rawPath, sample.text, out, config.overlays);
    log('add-overlays', `Test overlay written to ${out}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--test')) {
    await runTest();
    return;
  }
  console.log('Use via pipeline, or: npm run test:overlay');
}

if (require.main === module) {
  main().catch((err) => {
    logError('add-overlays', err);
    process.exit(1);
  });
}
