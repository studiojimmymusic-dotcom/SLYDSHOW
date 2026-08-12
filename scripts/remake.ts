import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import {
  SlideCopy,
  SlideLayout,
  SlideshowAnalysis,
  SlideshowCandidate,
  ensureDir,
  log,
  logError,
  makePostTimestamp,
  requireEnv,
  resolvePath,
  writeJson,
} from './utils';
import { findSlideshowFromSource } from './find-slideshows';
import { buildSlideImageQueries, fetchImages } from './fetch-images';
import { postToTikTok } from './post-to-tiktok';
import { extractOverlayTextFromSlideImage, hasOverlayCopy } from './slide-overlay-text';

async function downloadToFile(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url} (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await sharp(buffer).jpeg({ quality: 90 }).toFile(outPath);
}

function buildRemakeAnalysis(source: SlideshowCandidate, slideTexts: string[]): SlideshowAnalysis {
  const hook = (slideTexts[0] || source.caption.split('\n')[0] || 'FELAR').replace(/\n/g, ' ').trim();
  const topic = hook
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 8)
    .join(' ')
    .toLowerCase();

  return {
    hook,
    hookType: 'list_tease',
    topic: topic || 'music producer tips',
    slideStructure: 'remake of original carousel with same text',
    narrativeArc: 'listicle',
    emotionalAngle: 'relatability',
    textStyle: 'short punchy lines',
    cta: slideTexts[slideTexts.length - 1] || null,
    whyItWorked: 'Manual remake of a performing photo carousel; keep proven on-screen text.',
    visualMood: 'dark moody music studio aesthetic, cinematic producer setup',
    pinterestKeywords: [
      'music studio',
      'beat maker desk',
      'dark aesthetic headphones',
      'afrobeats producer',
    ],
    felarAngle: 'Keep original slide text, refresh visuals for FELAR.',
  };
}

const FELAR_CTA_LAYOUT: SlideLayout = {
  headline: 'BUILD YOUR BEAT STORE',
  body: 'on FELAR usefelar.com',
};

function layoutToString(layout: SlideLayout): string {
  if (layout.headline) {
    return `|||HEAD|||${layout.headline}|||BODY|||${layout.body}`;
  }
  return layout.body;
}

function buildCopy(source: SlideshowCandidate, layouts: SlideLayout[]): SlideCopy {
  const padded = [...layouts];
  while (padded.length < 4) {
    padded.push(padded[padded.length - 1] || { body: ' ' });
  }
  const five = [...padded.slice(0, 4), FELAR_CTA_LAYOUT];

  return {
    hook: five[0].headline || five[0].body.split(' ')[0],
    slides: five.map(layoutToString),
    layouts: five,
    caption: appendFelarCta(source.caption || five[0].body),
    hookCategory: 'remake',
  };
}

export function appendFelarCta(caption: string): string {
  const CTA_LINE = 'Start selling beats on FELAR → usefelar.com';
  let text = String(caption || '').trim();

  // Remove an existing CTA so we can place it before hashtags
  text = text
    .replace(/\n*Start selling beats on FELAR\s*→\s*usefelar\.com\n*/gi, '\n')
    .trim();

  const tags = text.match(/#[A-Za-z0-9_]+/g) || [];
  const uniqueTags = [...new Set(tags)];
  const body = text
    .replace(/#[A-Za-z0-9_]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return [body, CTA_LINE, uniqueTags.length ? uniqueTags.join(' ') : '']
    .filter(Boolean)
    .join('\n\n');
}

export async function remakeFromTikTokUrl(sourceUrl: string): Promise<string> {
  requireEnv('OPENAI_API_KEY');
  requireEnv('ZERNIO_API_KEY');
  // Account comes from desk settings (or ZERNIO_TIKTOK_ACCOUNT_ID fallback)

  console.log('FELAR Remake (Pinterest photos only — you add text in TikTok)\n');

  log('remake', `Fetching carousel: ${sourceUrl}`);
  const source = await findSlideshowFromSource(sourceUrl);
  if (!source) {
    throw new Error('Could not load TikTok post');
  }
  if (!source.slideImages.length) {
    throw new Error(
      'This post has no slide image URLs. Make sure it is a TikTok photo carousel (/photo/...), not a video.'
    );
  }

  const timestamp = makePostTimestamp();
  const postDir = resolvePath('posts', `remake-${timestamp}`);
  const originalsDir = path.join(postDir, 'originals');
  ensureDir(originalsDir);
  ensureDir(path.join(postDir, 'images'));
  ensureDir(path.join(postDir, 'final'));
  writeJson(path.join(postDir, 'source.json'), source);

  log('remake', `Found ${source.slideImages.length} slides from ${source.creator} (${source.views.toLocaleString()} views)`);

  // Download original slides (for OCR/vision text extraction)
  const originalPaths: string[] = [];
  const maxSlides = Math.min(5, source.slideImages.length);
  for (let i = 0; i < maxSlides; i++) {
    const out = path.join(originalsDir, `slide-${i + 1}.jpg`);
    await downloadToFile(source.slideImages[i], out);
    originalPaths.push(out);
  }

  // Extract on-screen text for content slides only (skip last — FELAR CTA)
  const layouts: SlideLayout[] = [];
  const contentCount = Math.max(1, Math.min(4, originalPaths.length - 1));
  for (let i = 0; i < contentCount; i++) {
    const extracted = await extractOverlayTextFromSlideImage(originalPaths[i], i + 1, 'remake');
    layouts.push({
      headline: extracted.headline,
      body: extracted.body || '',
    });
    log(
      'remake',
      `Slide ${i + 1}: ${extracted.textSource}${
        hasOverlayCopy(extracted)
          ? `${extracted.headline ? ` TITLE "${extracted.headline}"` : ''}${
              extracted.body ? ` BODY "${extracted.body}"` : ''
            }`
          : ''
      }`
    );
  }

  if (layouts.every((l) => !l.body.trim() && !l.headline)) {
    throw new Error('No TikTok overlay text found on this carousel (designed graphics are skipped)');
  }

  while (layouts.length < 4) {
    layouts.push(layouts[layouts.length - 1] || { body: '' });
  }
  const contentLayouts = layouts.slice(0, 4);
  log('remake', 'Last slide set to FELAR CTA → usefelar.com');

  const slideTexts = [
    ...contentLayouts.map((l) => [l.headline, l.body].filter(Boolean).join(' ')),
    [FELAR_CTA_LAYOUT.headline, FELAR_CTA_LAYOUT.body].filter(Boolean).join(' '),
  ];
  const analysis = buildRemakeAnalysis(source, slideTexts);
  analysis.slideImageQueries = await buildSlideImageQueries(slideTexts, analysis);
  writeJson(path.join(postDir, 'analysis.json'), analysis);

  log('remake', 'Fetching photos that match each slide...');
  await fetchImages(analysis, postDir, slideTexts);

  const copy = buildCopy(source, contentLayouts);
  writeJson(path.join(postDir, 'copy.json'), copy);
  writeTextGuide(postDir, copy);

  log('remake', 'Posting photos only (no text overlay)...');
  await postToTikTok(copy, postDir);

  printCopyForTikTok(copy);
  console.log(`Saved to: ${postDir}`);
  return postDir;
}

function slidePlainText(copy: SlideCopy, index: number): string {
  const layout = copy.layouts?.[index];
  if (layout) {
    const title = layout.headline ? layout.headline.toUpperCase() : '';
    const body = (layout.body || '').replace(/\s+/g, ' ').trim();
    if (title && body) return `TITLE\n${title}\n\nBODY\n${body}`;
    if (title) return `TITLE\n${title}`;
    return body;
  }
  const raw = (copy.slides[index] || '')
    .replace(/\|\|\|HEAD\|\|\|/g, '')
    .replace(/\|\|\|BODY\|\|\|/g, '\n')
    .trim();
  const [maybeHead, ...rest] = raw.split('\n');
  if (rest.length) {
    const title = maybeHead.replace(/\s+/g, ' ').trim().toUpperCase();
    const body = rest.join(' ').replace(/\s+/g, ' ').trim();
    return `TITLE\n${title}\n\nBODY\n${body}`;
  }
  return raw.replace(/\s+/g, ' ').trim();
}

function printCopyForTikTok(copy: SlideCopy): void {
  console.log('\n========================================');
  console.log('COPY THIS INTO TIKTOK');
  console.log('========================================\n');
  copy.slides.forEach((_, i) => {
    console.log(`--- SLIDE ${i + 1} ---`);
    console.log(slidePlainText(copy, i));
    console.log('');
  });
  console.log('--- CAPTION ---');
  console.log(copy.caption);
  console.log('\n========================================\n');
}

function writeTextGuide(postDir: string, copy: SlideCopy): void {
  const lines = [
    'Add this text yourself in TikTok (not burned onto the photos).',
    '',
    ...copy.slides.map((_, i) => `SLIDE ${i + 1}\n${slidePlainText(copy, i)}\n`),
    'CAPTION',
    copy.caption,
  ];
  fs.writeFileSync(path.join(postDir, 'text-guide.txt'), lines.join('\n'), 'utf8');
}

async function main(): Promise<void> {
  const sourceIdx = process.argv.indexOf('--source');
  const source = sourceIdx >= 0 ? process.argv[sourceIdx + 1] : process.argv[2];
  if (!source) {
    console.log('Usage: npm run remake -- --source "https://www.tiktok.com/@user/photo/123456789"');
    console.log('Wrap the URL in quotes so PowerShell does not split on &');
    process.exit(1);
  }
  await remakeFromTikTokUrl(source);
}

if (require.main === module) {
  main().catch((err) => {
    logError('remake', err);
    process.exit(1);
  });
}
