import * as fs from 'fs';
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
import { extractTextFromSlideImage } from './remake';
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
}

async function downloadJpeg(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url} (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await sharp(buffer).jpeg({ quality: 90 }).toFile(outPath);
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

  const tmpDir = resolvePath('posts', `_analyze-${Date.now()}`);
  ensureDir(tmpDir);

  const slides: SlideText[] = [];
  const maxSlides = Math.min(5, source.slideImages.length);
  progress(`Found ${source.slideImages.length} slides from @${source.creator} · reading ${maxSlides}`);

  for (let i = 0; i < maxSlides; i++) {
    progress(`Downloading slide ${i + 1}/${maxSlides}…`);
    const out = path.join(tmpDir, `slide-${i + 1}.jpg`);
    await downloadJpeg(source.slideImages[i], out);
    progress(`Reading text on slide ${i + 1}/${maxSlides}…`);
    const layout = await extractTextFromSlideImage(out, i + 1);
    slides.push({
      index: i + 1,
      headline: layout.headline,
      body: layout.body,
    });
    const preview = [layout.headline, layout.body].filter(Boolean).join(' · ').slice(0, 80);
    progress(`Slide ${i + 1}/${maxSlides} ready${preview ? ` — ${preview}` : ''}`);
  }

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // keep temp if cleanup fails
  }

  progress('Carousel text ready');
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
      config.overlays.outputHeight
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
