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
import { extractTextFromSlideImage, appendFelarCta } from './remake';
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
  caption: string;
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
    caption: appendFelarCta(source.caption),
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
  mode: TikTokPostMode = 'inbox'
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
  if (imageUrls.length !== 5) {
    throw new Error('Pick exactly 5 photos before posting');
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
  writeJson(path.join(postDir, 'sources.json'), { imageUrls, sourceKeys });

  for (let i = 0; i < imageUrls.length; i++) {
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

  const copy: SlideCopy = {
    hook: slides[0]?.headline || slides[0]?.body || 'FELAR',
    slides: slides.map((layout) =>
      layout.headline ? `|||HEAD|||${layout.headline}|||BODY|||${layout.body}` : layout.body
    ),
    layouts: slides,
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
