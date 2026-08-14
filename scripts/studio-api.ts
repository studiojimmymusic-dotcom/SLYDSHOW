import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { log } from './utils';
import { findSlideshowFromSource } from './find-slideshows';
import { extractOverlayTextFromSlideImage, hasOverlayCopy, type SlideTextSource } from './slide-overlay-text';
import { PhotoCandidate, fetchPhotoCandidates } from './fetch-images';

export interface SlideText {
  index: number;
  headline?: string;
  body: string;
  textSource?: SlideTextSource;
}

async function downloadSlideToFile(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download slide (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await sharp(buffer).rotate().jpeg({ quality: 90 }).toFile(outPath);
}

/** Keep TikTok caption + hashtags exactly as imported — no FELAR copy injected. */
export function formatSourceCaption(caption: string, hashtags: string[] = []): string {
  let text = String(caption || '').trim();
  const tags = (hashtags || [])
    .map((tag) => String(tag || '').replace(/^#/, '').trim())
    .filter(Boolean);

  if (!tags.length) return text;

  const missing = tags.filter((tag) => !new RegExp(`#${tag}\\b`, 'i').test(text));
  if (!missing.length) return text;

  const suffix = missing.map((tag) => `#${tag}`).join(' ');
  return text ? `${text} ${suffix}` : suffix;
}

/** Overlay text first (for pasting into TikTok), original description underneath. */
export function buildImportedCaption(slides: SlideText[], sourceCaption: string): string {
  const overlay = slides
    .filter((slide) => hasOverlayCopy(slide))
    .map((slide) => {
      const title = String(slide.headline || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
      const body = String(slide.body || '')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return [title, body].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  const description = String(sourceCaption || '').trim();
  return [overlay, description].filter(Boolean).join('\n\n');
}

export interface AnalyzeResult {
  tiktokId: string;
  creator: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  caption: string;
  sourceCaption: string;
  hashtags: string[];
  slides: SlideText[];
  slideImages: string[];
}

export async function analyzeTikTokUrl(
  sourceUrl: string,
  onProgress?: (message: string) => void
): Promise<AnalyzeResult> {
  const progress = (message: string) => {
    log('studio-api', message);
    onProgress?.(message);
  };

  progress('Fetching TikTok carousel…');
  const source = await findSlideshowFromSource(sourceUrl);
  if (!source) throw new Error('Could not load TikTok post');
  if (!source.slideImages.length) {
    throw new Error('This post has no slide images. Use a TikTok photo carousel URL.');
  }

  const maxSlides = Math.min(5, source.slideImages.length);
  progress(`Found ${source.slideImages.length} photo${source.slideImages.length === 1 ? '' : 's'} from @${source.creator}`);

  const slideUrls = source.slideImages.slice(0, maxSlides);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slydshow-analyze-'));
  const slides: SlideText[] = [];

  try {
    progress('Reading TikTok overlay text (skipping designed graphics)…');
    for (let i = 0; i < slideUrls.length; i += 1) {
      const outPath = path.join(tempDir, `slide-${i + 1}.jpg`);
      progress(`Slide ${i + 1}/${slideUrls.length}…`);
      await downloadSlideToFile(slideUrls[i], outPath);
      const extracted = await extractOverlayTextFromSlideImage(outPath, i + 1, 'studio-api');
      slides.push({
        index: i + 1,
        headline: extracted.headline,
        body: extracted.body || '',
        textSource: extracted.textSource,
      });
    }

    const overlayCount = slides.filter((slide) => slide.textSource === 'overlay').length;
    progress(
      overlayCount
        ? `Found overlay text on ${overlayCount} slide${overlayCount === 1 ? '' : 's'}`
        : 'No TikTok overlay text — slides are photos or designed graphics'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  progress('Photos ready');
  const sourceCaption = formatSourceCaption(source.caption || '', source.hashtags || []);
  const importedCaption = buildImportedCaption(slides, sourceCaption);
  return {
    tiktokId: source.tiktokId,
    creator: source.creator,
    views: source.views,
    likes: source.likes,
    comments: source.comments,
    shares: source.shares,
    saves: source.saves,
    caption: importedCaption,
    sourceCaption,
    hashtags: source.hashtags || [],
    slides,
    slideImages: slideUrls,
  };
}

export async function listStudioPhotos(
  limit = 24,
  excludeKeys: string[] = [],
  query = '',
  onProgress?: (message: string) => void
): Promise<PhotoCandidate[]> {
  return fetchPhotoCandidates(limit, excludeKeys, query, onProgress);
}
