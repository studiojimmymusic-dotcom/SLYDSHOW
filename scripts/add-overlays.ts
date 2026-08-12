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

function centeredPath(font: LoadedFont, text: string, x: number, y: number, fontSize: number): string {
  const width = font.getAdvanceWidth(text, fontSize);
  const glyphPath = font.getPath(text, x - width / 2, y, fontSize);
  return glyphPath.toPathData(2);
}

function buildOverlaySvg(
  layout: SlideLayout,
  config: OverlayConfig,
  font: LoadedFont,
  style?: Partial<SlideTextStyle>
): string {
  const width = config.outputWidth;
  const height = config.outputHeight;
  const body = layout.body || '';
  const headline = layout.headline || '';
  const wordCount = body.replace(/\n/g, ' ').split(/\s+/).filter(Boolean).length;

  let bodySizePercent = style?.bodySizePercent ?? 0.05;
  if (style?.bodySizePercent == null) {
    if (wordCount <= 6) bodySizePercent = 0.068;
    else if (wordCount <= 14) bodySizePercent = 0.058;
  }

  const bodySize = Math.round(width * bodySizePercent);
  const headSize = Math.round(width * (style?.headSizePercent ?? 0.046));
  const strokeWidth = Math.max(14, Math.round(bodySize * Math.max(config.strokeWidthPercent, 0.28)));
  const bodyLineHeight = bodySize * 1.28;
  const headLineHeight = headSize * 1.7;
  const maxWidthPercent = style?.maxWidthPercent ?? config.maxWidthPercent;
  const bodyMaxWidth = width * maxWidthPercent;
  const headMaxWidth = width * Math.min(0.92, maxWidthPercent);
  const positionFromTop = style?.textPositionFromTop ?? config.textPositionFromTop;
  const showHeadlineBox = style?.showHeadlineBox !== false;

  const bodyLines = wrapByWidth(font, body, bodySize, bodyMaxWidth);
  const headLines = headline ? wrapByWidth(font, headline.toUpperCase(), headSize, headMaxWidth) : [];

  const headlineTop = Math.round(height * Math.min(positionFromTop, 0.35));
  const bodyTop = headLines.length
    ? headlineTop + headLines.length * headLineHeight + Math.round(height * 0.04)
    : Math.round(height * positionFromTop);

  const x = width / 2;
  const parts: string[] = [];

  headLines.forEach((line, i) => {
    const y = headlineTop + i * headLineHeight;
    if (showHeadlineBox) {
      const textW = font.getAdvanceWidth(line, headSize);
      const padX = headSize * 0.42;
      const boxH = headSize * 1.48;
      const boxW = Math.min(width * 0.92, textW + padX * 2);
      const boxX = x - boxW / 2;
      const boxY = y - headSize * 1.08;
      parts.push(
        `<rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${boxW.toFixed(1)}" height="${boxH.toFixed(1)}" rx="${boxH / 2}" ry="${boxH / 2}" fill="#FFFFFF"/>`
      );
      parts.push(`<path d="${centeredPath(font, line, x, y, headSize)}" fill="#111111"/>`);
    } else {
      const d = centeredPath(font, line, x, y, headSize);
      parts.push(
        `<path d="${d}" fill="${config.fontColor}" stroke="${config.strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"/>`
      );
    }
  });

  bodyLines.forEach((line, i) => {
    const y = bodyTop + i * bodyLineHeight;
    const d = centeredPath(font, line, x, y, bodySize);
    parts.push(
      `<path d="${d}" fill="${config.fontColor}" stroke="${config.strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"/>`
    );
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${parts.join('\n  ')}
</svg>`;
}

export async function renderOverlayToFile(
  imageInput: string | Buffer,
  layout: SlideLayout,
  outputPath: string,
  style?: Partial<SlideTextStyle>
): Promise<void> {
  const config = loadConfig().overlays;
  const fontPath = resolvePath(config.fontPath);
  if (!fs.existsSync(fontPath)) {
    throw new Error(`Font not found at ${fontPath}. Expected Montserrat font in fonts/`);
  }

  const fontBuffer = fs.readFileSync(fontPath);
  const font = opentype.parse(
    fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength)
  );
  const svg = buildOverlaySvg(layout, config, font, style);

  ensureDir(path.dirname(outputPath));
  const pipeline = sharp(imageInput)
    .rotate()
    .resize(config.outputWidth, config.outputHeight, { fit: 'cover', position: 'centre' })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);

  if (outputPath.toLowerCase().endsWith('.png')) {
    await pipeline.png().toFile(outputPath);
  } else {
    await pipeline.jpeg({ quality: 92 }).toFile(outputPath);
  }
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
      text: "|||HEAD|||Study songs you love.|||BODY|||Don't just listen, analyze\nthe drums, arrangement\nmelodies, transitions, and\nsound selection.",
    },
    {
      name: 'slide-3',
      text: '|||HEAD|||Make your drums hit\nbefore you mix.|||BODY|||Better sound selection\nand better patterns will\ntake you further than\nendless EQ.',
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
