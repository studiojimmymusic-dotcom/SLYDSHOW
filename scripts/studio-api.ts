import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import {
  SlideCopy,
  SlideLayout,
  ensureDir,
  loadConfig,
  log,
  makePostTimestamp,
  resolvePath,
  writeJson,
} from './utils';
import { findSlideshowFromSource } from './find-slideshows';
import { extractOverlayTextFromSlideImage, type SlideTextSource } from './slide-overlay-text';
import {
  PhotoCandidate,
  downloadAndNormalize,
  fetchPhotoCandidates,
  markPinsUsed,
  pinImageKey,
} from './fetch-images';
import { postToTikTok } from './post-to-tiktok';
import type { TikTokPostMode } from './desk-settings';

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
  progress(`Found ${source.slideImages.length} photos from @${source.creator}`);

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
  return {
    tiktokId: source.tiktokId,
    creator: source.creator,
    views: source.views,
    likes: source.likes,
    comments: source.comments,
    shares: source.shares,
    saves: source.saves,
    caption: '',
    sourceCaption: source.caption || '',
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

export async function publishSelectedPhotos(
  imageUrls: string[],
  slides: SlideLayout[],
  caption: string,
  accountId?: string,
  mode: TikTokPostMode = 'inbox',
  opts?: {
    /** App screenshot for the final slide */
    lastSlideBuffer?: Buffer;
    /** @deprecated use lastSlideBuffer */
    slide6Buffer?: Buffer;
  }
): Promise<{
  postDir: string;
  zernioId?: string;
  mode: string;
  platformPostUrl: string;
  platformPostId: string;
  status: string;
  title: string;
  sourceKeys: string[];
}> {
  const contentCount = imageUrls.length;
  if (contentCount < 1 || contentCount > 5) {
    throw new Error('Pick between 1 and 5 photos before posting');
  }
  const promoBuffer = opts?.lastSlideBuffer || opts?.slide6Buffer;
  if (!promoBuffer?.length) {
    throw new Error('Upload an app screenshot for the last slide before sharing');
  }
  const total = contentCount + 1;
  if (slides.length < total) {
    throw new Error(`Need text for all ${total} slides`);
  }

  const config = loadConfig();
  const timestamp = makePostTimestamp();
  const postDir = resolvePath('posts', `studio-${timestamp}`);
  const imagesDir = path.join(postDir, 'images');

  // Always start from an empty folder — never inherit leftovers from a prior share
  if (fs.existsSync(postDir)) {
    fs.rmSync(postDir, { recursive: true, force: true });
  }
  ensureDir(imagesDir);

  const sourceKeys = imageUrls.map(pinImageKey);
  writeJson(path.join(postDir, 'sources.json'), {
    imageUrls,
    sourceKeys,
    contentCount,
    slideCount: total,
    hasPromoUpload: true,
  });

  for (let i = 0; i < contentCount; i++) {
    const outPath = path.join(imagesDir, `slide-${i + 1}-raw.jpg`);
    log('studio-api', `Download slide ${i + 1}: ${sourceKeys[i]}`);
    await downloadAndNormalize(
      imageUrls[i],
      outPath,
      config.overlays.outputWidth,
      config.overlays.outputHeight,
      'contain'
    );
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
      throw new Error(`Slide ${i + 1} did not download correctly`);
    }
  }

  const promoRaw = path.join(imagesDir, `slide-${total}-raw.jpg`);
  await sharp(promoBuffer)
    .rotate()
    .resize(config.overlays.outputWidth, config.overlays.outputHeight, {
      fit: 'cover',
      position: 'centre',
    })
    .jpeg({ quality: 92 })
    .toFile(promoRaw);
  if (!fs.existsSync(promoRaw) || fs.statSync(promoRaw).size < 1000) {
    throw new Error('Promo screenshot did not save correctly');
  }

  const layouts = slides.slice(0, total).map((layout) => ({
    headline: layout.headline,
    body: layout.body || '',
  }));

  const copy: SlideCopy = {
    hook: layouts[0]?.headline || layouts[0]?.body || 'FELAR',
    slides: layouts.map((layout) =>
      layout.headline ? `|||HEAD|||${layout.headline}|||BODY|||${layout.body}` : layout.body
    ),
    layouts,
    caption,
    hookCategory: 'studio-dashboard',
  };
  writeJson(path.join(postDir, 'copy.json'), copy);

  const record = await postToTikTok(copy, postDir, accountId, mode);
  markPinsUsed(sourceKeys);

  return {
    postDir,
    zernioId: String(record.zernioId || ''),
    mode: String(record.mode || mode),
    platformPostUrl: record.platformPostUrl ? String(record.platformPostUrl) : '',
    platformPostId: record.platformPostId ? String(record.platformPostId) : '',
    status: String(record.status || ''),
    title: String(record.title || ''),
    sourceKeys,
  };
}
