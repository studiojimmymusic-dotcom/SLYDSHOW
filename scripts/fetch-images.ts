import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { fetchPinImage, toThumbUrl } from './pinimg';
import {
  SlideshowAnalysis,
  ensureDir,
  fetchJson,
  loadConfig,
  log,
  logError,
  readJson,
  requireEnv,
  resolvePath,
  sleep,
  writeJson,
} from './utils';

export interface PinCandidate {
  url: string;
  width: number;
  height: number;
  description: string;
}

export interface PhotoCandidate {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  description: string;
  query: string;
}

function rapidHeaders(host: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-rapidapi-host': host,
    'x-rapidapi-key': requireEnv('RAPIDAPI_KEY'),
  };
}

function collectUrls(value: unknown, out: string[] = []): string[] {
  if (!value) return out;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && /\.(jpe?g|png|webp)(\?|$)/i.test(value)) {
      out.push(value);
    } else if (/^https?:\/\/.*pinimg\.com/i.test(value)) {
      out.push(value);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/url|image|src|orig/i.test(key)) collectUrls(nested, out);
      else if (typeof nested === 'object') collectUrls(nested, out);
    }
  }
  return out;
}

function pickBestImageUrl(pin: Record<string, unknown>): string | null {
  // Prefer documented / common RapidAPI fields first
  for (const key of [
    'image_url',
    'imageUrl',
    'original',
    'orig',
    'images',
    'url',
    'image',
    'media',
  ]) {
    if (pin[key]) {
      const urls = collectUrls(pin[key]);
      // Prefer largest / originals when multiple urls exist
      const sorted = [...urls].sort((a, b) => {
        const score = (u: string) =>
          (/originals/i.test(u) ? 100 : 0) + (/736x|1200x|originals/i.test(u) ? 50 : 0) + u.length;
        return score(b) - score(a);
      });
      if (sorted.length) return sorted[0];
    }
  }
  const all = collectUrls(pin);
  return all[0] || null;
}

function normalizePin(raw: unknown): PinCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const pin = raw as Record<string, unknown>;

  // Skip video pins when possible
  if (pin.is_video === true || pin.isVideo === true || pin.video === true) {
    return null;
  }

  const url = pickBestImageUrl(pin);
  if (!url) return null;

  const images = (pin.images && typeof pin.images === 'object' ? pin.images : {}) as Record<string, unknown>;
  const width = Number(
    pin.width ?? pin.image_width ?? pin.imageWidth ?? images.width ?? (images.orig as Record<string, unknown> | undefined)?.width ?? 0
  );
  const height = Number(
    pin.height ??
      pin.image_height ??
      pin.imageHeight ??
      images.height ??
      (images.orig as Record<string, unknown> | undefined)?.height ??
      0
  );
  const description = String(pin.description ?? pin.title ?? pin.title_or_name ?? pin.alt_text ?? '');

  return {
    url,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
    description,
  };
}

function unwrapPins(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as Record<string, unknown>;

  // Common RapidAPI / Apify-style envelopes
  for (const key of ['data', 'pins', 'results', 'items', 'response', 'resource_response']) {
    const value = data[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;
      for (const nestedKey of ['pins', 'results', 'items', 'data', 'bookmark', 'resource_response']) {
        const inner = nested[nestedKey];
        if (Array.isArray(inner)) return inner;
        if (inner && typeof inner === 'object') {
          const deep = inner as Record<string, unknown>;
          if (Array.isArray(deep.data)) return deep.data as unknown[];
          if (Array.isArray(deep.results)) return deep.results as unknown[];
        }
      }
    }
  }
  return [];
}

function isRateLimit(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /429|rate limit|too many requests/i.test(msg);
}

async function searchPinterest(query: string, retries = 4): Promise<PinCandidate[]> {
  const config = loadConfig();
  const host = config.pinterest.rapidApiHost;
  const searchPath = config.pinterest.searchPath.startsWith('/')
    ? config.pinterest.searchPath
    : `/${config.pinterest.searchPath}`;

  const url = new URL(`https://${host}${searchPath}`);
  url.searchParams.set('query', query);
  url.searchParams.set('count', '40');

  log('fetch-images', `Pinterest search: "${query}"`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const payload = await fetchJson(
        url.toString(),
        { method: 'GET', headers: rapidHeaders(host) },
        'fetch-images/pinterest'
      );
      const pins = unwrapPins(payload)
        .map(normalizePin)
        .filter((p): p is PinCandidate => Boolean(p));
      log('fetch-images', `Pinterest returned ${pins.length} usable pins`);
      return pins;
    } catch (error) {
      if (isRateLimit(error) && attempt < retries) {
        const waitMs = Math.min(60_000, 12_000 * attempt);
        log('fetch-images', `Rate limited. Waiting ${Math.round(waitMs / 1000)}s, then retry (${attempt}/${retries - 1})...`);
        await sleep(waitMs);
        continue;
      }
      throw error;
    }
  }

  return [];
}

function looksLikeUnsupportedUrl(url: string): boolean {
  return /\.(heic|heif|avif|tiff|tif)(\?|$)/i.test(url);
}

function isDecodableImage(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const header = buffer.subarray(0, 12).toString('latin1');
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true; // jpeg
  if (header.startsWith('\u0089PNG')) return true;
  if (header.startsWith('RIFF') && header.includes('WEBP')) return true;
  if (header.startsWith('GIF8')) return true;
  if (header.includes('ftypheic') || header.includes('ftypheif') || header.includes('ftypavif') || header.includes('ftypmif1')) {
    return false;
  }
  return true;
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function looksLikeTextPin(pin: PinCandidate): boolean {
  const d = pin.description.toLowerCase();
  return /quote|typography|caption|text overlay|motivational|infographic|lyric poster|printable|wall art|canva|font/i.test(
    d
  );
}

export async function buildSlideImageQueries(
  _slideTexts: string[],
  _analysis: SlideshowAnalysis
): Promise<string[]> {
  const config = loadConfig();
  const needed = config.pinterest.imagesPerPost;
  const all = [...new Set([...(config.pinterest.searchQueries || []), ...(config.pinterest.preferredQueries || [])])];
  const picked = shuffle(all).slice(0, Math.max(needed, Math.min(all.length, needed)));

  log('fetch-images', `Shuffled studio queries: ${picked.join(' | ')}`);
  return picked;
}

export function pinImageKey(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const file = (parts[parts.length - 1] || url).replace(/\.(jpe?g|png|webp).*$/i, '').toLowerCase();
    if (parts.length >= 4) {
      return parts.slice(-4).join('/').replace(/\.(jpe?g|png|webp).*$/i, '').toLowerCase();
    }
    return file;
  } catch {
    return url.toLowerCase();
  }
}

function loadUsedPinKeys(): string[] {
  return readJson<string[]>(resolvePath('data', 'used-pins.json'), []);
}

export function saveUsedPinKeys(keys: string[]): void {
  writeJson(resolvePath('data', 'used-pins.json'), keys.slice(-400));
}

export function markPinsUsed(keys: string[]): void {
  saveUsedPinKeys([...loadUsedPinKeys(), ...keys]);
}


export async function fetchPhotoCandidates(
  limit = 24,
  excludeKeys: string[] = [],
  customQuery = '',
  onProgress?: (message: string) => void
): Promise<PhotoCandidate[]> {
  const progress = (message: string) => {
    log('fetch-images', message);
    onProgress?.(message);
  };

  const config = loadConfig();
  const excluded = new Set([...excludeKeys, ...loadUsedPinKeys()]);
  const typed = customQuery.replace(/\s+/g, ' ').trim();
  const queries = typed
    ? [typed]
    : shuffle([
        ...new Set([...(config.pinterest.searchQueries || []), ...(config.pinterest.preferredQueries || [])]),
      ]);
  const out: PhotoCandidate[] = [];
  let searches = 0;

  for (const query of queries) {
    if (out.length >= limit || searches >= 3) break;
    searches += 1;
    progress(`Searching Pinterest for “${query}”…`);
    try {
      const pins = selectPins(
        await searchPinterest(query),
        40,
        config.pinterest.preferPortrait,
        config.pinterest.minWidth
      );
      let added = 0;
      for (const pin of pins) {
        const id = pinImageKey(pin.url);
        if (excluded.has(id)) continue;
        excluded.add(id);
        out.push({
          id,
          url: pin.url,
          thumbUrl: toThumbUrl(pin.url),
          width: pin.width,
          height: pin.height,
          description: pin.description,
          query,
        });
        added += 1;
        if (out.length >= limit) break;
      }
      progress(`Got ${added} new photos · ${out.length}/${limit} total`);
      await sleep(1500);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      progress(`Search failed for “${query}”: ${msg}`);
      logError('fetch-images', `Candidate search failed for "${query}": ${msg}`);
    }
  }

  progress(`Returning ${out.length} photo candidates`);
  return out;
}

function selectPins(pins: PinCandidate[], needed: number, preferPortrait: boolean, minWidth: number): PinCandidate[] {
  const usable = pins.filter((pin) => {
    if (looksLikeUnsupportedUrl(pin.url) || looksLikeTextPin(pin)) return false;
    return pin.width === 0 || pin.width >= minWidth;
  });

  const portraits = shuffle(
    usable.filter((pin) => pin.height > pin.width || (pin.width === 0 && pin.height === 0))
  );
  const rest = shuffle(usable.filter((pin) => !portraits.includes(pin)));
  const ordered = preferPortrait ? [...portraits, ...rest] : shuffle(usable);

  const selected: PinCandidate[] = [];
  const seen = new Set<string>();
  for (const pin of ordered) {
    if (selected.length >= needed) break;
    const key = pinImageKey(pin.url);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(pin);
  }
  return selected;
}

export async function downloadAndNormalize(imageUrl: string, outputPath: string, width: number, height: number): Promise<void> {
  if (looksLikeUnsupportedUrl(imageUrl)) {
    throw new Error(`Unsupported image format URL: ${imageUrl}`);
  }
  const fetched = await fetchPinImage(imageUrl);
  if (!fetched) throw new Error(`Failed to download image: ${imageUrl}`);
  const buffer = fetched.buffer;
  if (!isDecodableImage(buffer)) {
    throw new Error('Unsupported image format (heif/avif)');
  }

  ensureDir(path.dirname(outputPath));
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }

  await sharp(buffer)
    .rotate()
    .resize(width, height, {
      fit: 'cover',
      position: 'centre',
    })
    .jpeg({ quality: 90 })
    .toFile(outputPath);
}

async function generateWithGemini(
  analysis: SlideshowAnalysis,
  index: number,
  outputPath: string,
  width: number,
  height: number
): Promise<void> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const prompt = `Create a vertical portrait photo for a TikTok slideshow about: ${analysis.topic}.
Visual mood: ${analysis.visualMood}
Keywords: ${(analysis.pinterestKeywords || []).join(', ')}
This specific slide should look like: ${analysis.slideImageQueries?.[index - 1] || analysis.topic}
Style: photorealistic music production scene, cinematic lighting, no text, no watermarks, no logos.
Aspect ratio: 2:3 portrait. Slide variation ${index}.`;

  const endpoint =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent';

  log('fetch-images', `Gemini fallback for slide ${index}...`);
  const payload = await fetchJson<{
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
    }>;
  }>(
    `${endpoint}?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    },
    'fetch-images/gemini'
  );

  const parts = payload.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new Error('Gemini did not return image data');
  }

  const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
  await sharp(buffer)
    .rotate()
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 90 })
    .toFile(outputPath);
}

export async function fetchImages(
  analysis: SlideshowAnalysis,
  postDir: string,
  slideTexts: string[] = []
): Promise<string[]> {
  const config = loadConfig();
  const imagesDir = path.join(postDir, 'images');
  ensureDir(imagesDir);

  const { outputWidth, outputHeight } = config.overlays;
  const needed = config.pinterest.imagesPerPost;
  const saved: string[] = [];
  const usedKeys = new Set<string>(loadUsedPinKeys());
  const usedThisRun: string[] = [];
  const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());

  const queries = await buildSlideImageQueries(slideTexts, analysis);
  analysis.slideImageQueries = queries;

  const searchCache = new Map<string, PinCandidate[]>();
  const leftover: PinCandidate[] = [];

  async function tryPins(pins: PinCandidate[], outPath: string, label: string): Promise<boolean> {
    for (const pin of shuffle(pins)) {
      const key = pinImageKey(pin.url);
      if (usedKeys.has(key)) continue;
      try {
        log('fetch-images', label);
        await downloadAndNormalize(pin.url, outPath, outputWidth, outputHeight);
        usedKeys.add(key);
        usedThisRun.push(key);
        return true;
      } catch (error) {
        logError(
          'fetch-images',
          `Pin failed, trying next: ${error instanceof Error ? error.message : error}`
        );
      }
    }
    return false;
  }

  for (let i = 0; i < needed; i++) {
    const outPath = path.join(imagesDir, `slide-${i + 1}-raw.jpg`);
    const query = queries[i] || config.pinterest.preferredQueries?.[0] || 'music studio aesthetic';
    let savedThis = false;

    try {
      if (!searchCache.has(query)) {
        const pins = selectPins(
          await searchPinterest(query),
          24,
          config.pinterest.preferPortrait,
          config.pinterest.minWidth
        );
        searchCache.set(query, pins);
        leftover.push(...pins);
        await sleep(2500);
      }
      savedThis = await tryPins(
        searchCache.get(query) || [],
        outPath,
        `Slide ${i + 1} photo: "${query}"`
      );
    } catch (error) {
      logError(
        'fetch-images',
        `Pinterest search failed for slide ${i + 1}: ${error instanceof Error ? error.message : error}`
      );
    }

    if (!savedThis) {
      savedThis = await tryPins(leftover, outPath, `Slide ${i + 1} using leftover unused pin`);
    }

    if (!savedThis) {
      const thisCarousel = new Set(usedThisRun);
      const recycled = leftover.filter((pin) => !thisCarousel.has(pinImageKey(pin.url)));
      savedThis = await tryPins(
        recycled.map((pin) => {
          usedKeys.delete(pinImageKey(pin.url));
          return pin;
        }),
        outPath,
        `Slide ${i + 1} recycled an older pin, still unique in this carousel`
      );
    }

    if (!savedThis && hasGemini) {
      try {
        await generateWithGemini(analysis, i + 1, outPath, outputWidth, outputHeight);
        savedThis = true;
      } catch (geminiError) {
        logError(
          'fetch-images',
          `Slide ${i + 1} Gemini fallback failed: ${geminiError instanceof Error ? geminiError.message : geminiError}`
        );
      }
    }

    if (!savedThis && saved.length > 0) {
      fs.copyFileSync(saved[saved.length - 1], outPath);
      log('fetch-images', `Slide ${i + 1} reused previous photo so the carousel still has 5 slides`);
      savedThis = true;
    }

    if (savedThis && !saved.includes(outPath)) {
      saved.push(outPath);
    }

    if (!savedThis) {
      logError('fetch-images', `Could not source an image for slide ${i + 1}`);
    }
  }

  if (saved.length > 0 && saved.length < needed) {
    const last = saved[saved.length - 1];
    for (let i = saved.length; i < needed; i++) {
      const outPath = path.join(imagesDir, `slide-${i + 1}-raw.jpg`);
      fs.copyFileSync(last, outPath);
      saved.push(outPath);
      log('fetch-images', `Filled slide ${i + 1} from an earlier photo`);
    }
  }

  if (saved.length < needed) {
    throw new Error(`Only saved ${saved.length}/${needed} images`);
  }

  saveUsedPinKeys([...loadUsedPinKeys(), ...usedThisRun]);
  log('fetch-images', `${saved.length} unique images ready in ${imagesDir}`);
  return saved;
}

async function main(): Promise<void> {
  const analysisPath = process.argv[2];
  const postDir = process.argv[3] || resolvePath('posts', 'manual-test');
  if (!analysisPath) {
    console.log('Usage: ts-node scripts/fetch-images.ts <analysis.json> [postDir]');
    process.exit(1);
  }
  const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8')) as SlideshowAnalysis;
  await fetchImages(analysis, postDir);
}

if (require.main === module) {
  main().catch((err) => {
    logError('fetch-images', err);
    process.exit(1);
  });
}
