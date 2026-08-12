import {
  SlideshowCandidate,
  fetchJson,
  getSeenTiktoks,
  loadConfig,
  log,
  logError,
  markTiktoksSeen,
  requireEnv,
  resolvePath,
  sleep,
  writeJson,
} from './utils';
import { extractAwemeId, fetchTikTokPhotoFromWeb } from './tiktok-web';

const SCRAPTIK_HOST = 'scraptik.p.rapidapi.com';
const SCRAPTIK_BASE = `https://${SCRAPTIK_HOST}`;

interface RawAweme {
  aweme_id?: string | number;
  id?: string | number;
  desc?: string;
  create_time?: number;
  content_type?: string;
  statistics?: {
    play_count?: number;
    digg_count?: number;
    comment_count?: number;
    share_count?: number;
    collect_count?: number;
  };
  author?: {
    unique_id?: string;
    nickname?: string;
  };
  text_extra?: Array<{ hashtag_name?: string }>;
  cha_list?: Array<{ cha_name?: string }>;
  image_post_info?: {
    images?: Array<{
      display_image?: { url_list?: string[] };
      thumbnail?: { url_list?: string[] };
      owner_watermark_image?: { url_list?: string[] };
    }>;
  };
  imagePost?: {
    images?: Array<{
      imageURL?: { urlList?: string[] };
      imageUrl?: { urlList?: string[] };
    }>;
  };
  images?: Array<{ url_list?: string[]; urlList?: string[] } | string>;
  image_infos?: unknown;
  item_type?: number;
  aweme_type?: number;
  video?: {
    duration?: number;
    play_addr?: { url_list?: string[] };
  };
  duration?: number;
}

function rapidHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-rapidapi-key': requireEnv('RAPIDAPI_KEY'),
    'x-rapidapi-host': SCRAPTIK_HOST,
  };
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function extractHashtags(item: RawAweme, caption: string): string[] {
  const tags = new Set<string>();
  for (const extra of item.text_extra || []) {
    if (extra.hashtag_name) tags.add(extra.hashtag_name.replace(/^#/, ''));
  }
  for (const cha of item.cha_list || []) {
    if (cha.cha_name) tags.add(cha.cha_name.replace(/^#/, ''));
  }
  const fromCaption = caption.match(/#([A-Za-z0-9_]+)/g) || [];
  for (const tag of fromCaption) tags.add(tag.slice(1));
  return Array.from(tags);
}

function firstUrl(list?: string[]): string | null {
  if (!list || list.length === 0) return null;
  return list[0] || null;
}

function detectSlideshow(item: RawAweme): { isSlideshow: boolean; detectedAs: string; slideImages: string[] } {
  const images: string[] = [];

  if (item.image_post_info?.images?.length) {
    for (const img of item.image_post_info.images) {
      const url =
        firstUrl(img.display_image?.url_list) ||
        firstUrl(img.thumbnail?.url_list) ||
        firstUrl(img.owner_watermark_image?.url_list);
      if (url) images.push(url);
    }
    if (images.length > 0) {
      return { isSlideshow: true, detectedAs: 'image_post_info', slideImages: images };
    }
  }

  if (item.imagePost?.images?.length) {
    for (const img of item.imagePost.images) {
      const url = firstUrl(img.imageURL?.urlList) || firstUrl(img.imageUrl?.urlList);
      if (url) images.push(url);
    }
    if (images.length > 0) {
      return { isSlideshow: true, detectedAs: 'imagePost', slideImages: images };
    }
  }

  if (Array.isArray(item.images) && item.images.length > 0) {
    for (const img of item.images) {
      if (typeof img === 'string') {
        images.push(img);
      } else {
        const url = firstUrl(img.url_list) || firstUrl(img.urlList);
        if (url) images.push(url);
      }
    }
    if (images.length > 0) {
      return { isSlideshow: true, detectedAs: 'images', slideImages: images };
    }
  }

  if (
    item.content_type === 'image' ||
    item.item_type === 2 ||
    item.aweme_type === 2 ||
    item.aweme_type === 150 ||
    item.aweme_type === 68
  ) {
    return {
      isSlideshow: true,
      detectedAs: `type=${item.content_type || item.item_type || item.aweme_type}`,
      slideImages: [],
    };
  }

  const durationMs = item.video?.duration ?? item.duration ?? 999999;
  const durationSec = durationMs > 1000 ? durationMs / 1000 : durationMs;
  if (durationSec < 5 && images.length > 1) {
    return { isSlideshow: true, detectedAs: 'short_duration', slideImages: images };
  }

  return { isSlideshow: false, detectedAs: 'none', slideImages: [] };
}

function normalizeItem(item: RawAweme): SlideshowCandidate | null {
  const tiktokId = String(item.aweme_id ?? item.id ?? '');
  if (!tiktokId) return null;

  const { isSlideshow, detectedAs, slideImages } = detectSlideshow(item);
  // Strict: photo carousels / slideshows only — never videos
  if (!isSlideshow) return null;

  const caption = item.desc || '';
  const creator =
    item.author?.unique_id
      ? `@${item.author.unique_id}`
      : item.author?.nickname
        ? `@${item.author.nickname}`
        : '@unknown';

  return {
    tiktokId,
    creator,
    views: asNumber(item.statistics?.play_count),
    likes: asNumber(item.statistics?.digg_count),
    comments: asNumber(item.statistics?.comment_count),
    shares: asNumber(item.statistics?.share_count),
    saves: asNumber(item.statistics?.collect_count),
    caption,
    hashtags: extractHashtags(item, caption),
    slideImages,
    slideCount: slideImages.length || 0,
    detectedAs,
  };
}

function unwrapAwemes(payload: unknown): RawAweme[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as Record<string, unknown>;

  const candidates = [
    data.aweme_list,
    data.data,
    (data.data as Record<string, unknown> | undefined)?.aweme_list,
    (data.data as Record<string, unknown> | undefined)?.videos,
    data.videos,
    data.items,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c.filter((x) => x && typeof x === 'object') as RawAweme[];
    }
  }

  // /search-posts returns search_item_list[].aweme_info
  if (Array.isArray(data.search_item_list)) {
    const fromSearch: RawAweme[] = [];
    for (const row of data.search_item_list as Array<Record<string, unknown>>) {
      if (row.aweme_info && typeof row.aweme_info === 'object') {
        fromSearch.push(row.aweme_info as RawAweme);
      } else if (row.aweme && typeof row.aweme === 'object') {
        fromSearch.push(row.aweme as RawAweme);
      }
    }
    if (fromSearch.length) return fromSearch;
  }

  // search-general sometimes nests under data[0].aweme_info
  if (Array.isArray(data.data)) {
    const fromNested: RawAweme[] = [];
    for (const row of data.data as Array<Record<string, unknown>>) {
      if (row.aweme_info && typeof row.aweme_info === 'object') {
        fromNested.push(row.aweme_info as RawAweme);
      } else if (row.aweme_id || row.id) {
        fromNested.push(row as RawAweme);
      }
    }
    if (fromNested.length) return fromNested;
  }

  return [];
}

async function searchPosts(keyword: string, count: number): Promise<RawAweme[]> {
  // Current ScrapTik endpoint (replaces old /search-general)
  const url = new URL(`${SCRAPTIK_BASE}/search-posts`);
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('count', String(count));
  url.searchParams.set('offset', '0');
  url.searchParams.set('region', 'NG');
  url.searchParams.set('sort_type', '0');

  const payload = await fetchJson(url.toString(), { method: 'GET', headers: rapidHeaders() }, 'find-slideshows/search-posts');
  return unwrapAwemes(payload);
}

function extractChallengeId(payload: unknown, hashtag: string): string | null {
  const target = hashtag.replace(/^#/, '').toLowerCase();
  const rows: unknown[] = [];

  if (Array.isArray(payload)) {
    rows.push(...payload);
  } else if (payload && typeof payload === 'object') {
    const data = payload as Record<string, unknown>;
    for (const key of ['challenge_list', 'hashtag_list', 'data', 'results', 'items']) {
      if (Array.isArray(data[key])) rows.push(...(data[key] as unknown[]));
    }
    if (data.data && typeof data.data === 'object') {
      const nested = data.data as Record<string, unknown>;
      for (const key of ['challenge_list', 'hashtag_list', 'challenges']) {
        if (Array.isArray(nested[key])) rows.push(...(nested[key] as unknown[]));
      }
    }
  }

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const challenge = (item.challenge_info || item.challenge || item) as Record<string, unknown>;
    const name = String(challenge.cha_name || challenge.challenge_name || challenge.title || item.cha_name || '')
      .replace(/^#/, '')
      .toLowerCase();
    const cid = String(challenge.cid || challenge.challenge_id || item.cid || item.id || '');
    if (cid && (!name || name === target || name.includes(target))) {
      return cid;
    }
  }

  // Fallback: first cid anywhere
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const challenge = (item.challenge_info || item.challenge || item) as Record<string, unknown>;
    const cid = String(challenge.cid || challenge.challenge_id || item.cid || '');
    if (cid) return cid;
  }
  return null;
}

async function resolveHashtagCid(hashtag: string): Promise<string | null> {
  const url = new URL(`${SCRAPTIK_BASE}/search-hashtags`);
  url.searchParams.set('keyword', hashtag.replace(/^#/, ''));
  url.searchParams.set('count', '10');
  url.searchParams.set('cursor', '0');

  const payload = await fetchJson(
    url.toString(),
    { method: 'GET', headers: rapidHeaders() },
    'find-slideshows/search-hashtags'
  );
  return extractChallengeId(payload, hashtag);
}

async function searchHashtagPosts(hashtag: string, count: number, pages = 3): Promise<RawAweme[]> {
  const cid = await resolveHashtagCid(hashtag);
  if (!cid) {
    log('find-slideshows', `No challenge id found for #${hashtag}`);
    return [];
  }

  const collected: RawAweme[] = [];
  let cursor = 0;

  for (let page = 0; page < pages; page++) {
    const url = new URL(`${SCRAPTIK_BASE}/hashtag-posts`);
    url.searchParams.set('cid', cid);
    url.searchParams.set('count', String(count));
    url.searchParams.set('cursor', String(cursor));
    url.searchParams.set('region', 'US');

    const payload = await fetchJson(
      url.toString(),
      { method: 'GET', headers: rapidHeaders() },
      'find-slideshows/hashtag-posts'
    );
    const items = unwrapAwemes(payload);
    collected.push(...items);

    const data = payload as Record<string, unknown>;
    const nextCursor = Number(data.cursor ?? cursor + items.length);
    const hasMore = Boolean(data.has_more);
    if (!items.length || !hasMore) break;
    cursor = nextCursor;
    await sleep(800);
  }

  return collected;
}

async function getPostById(awemeId: string): Promise<RawAweme | null> {
  const url = new URL(`${SCRAPTIK_BASE}/get-post`);
  url.searchParams.set('aweme_id', awemeId);
  url.searchParams.set('region', 'US');

  const payload = await fetchJson(url.toString(), { method: 'GET', headers: rapidHeaders() }, 'find-slideshows/get-post');
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  if (data.aweme_detail && typeof data.aweme_detail === 'object') return data.aweme_detail as RawAweme;
  if (data.aweme && typeof data.aweme === 'object') return data.aweme as RawAweme;
  const list = unwrapAwemes(payload);
  return list[0] || null;
}

function isSubscriptionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /not subscribed|HTTP 403/i.test(msg);
}

function isQuotaOrRateError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /Too many requests|HTTP 429|MONTHLY quota|exceeded the MONTHLY/i.test(msg);
}

function ingestItems(
  items: RawAweme[],
  seen: Set<string>,
  byId: Map<string, SlideshowCandidate>,
  minViews: number
): { raw: number; kept: number; belowViews: number; videosSkipped: number } {
  let kept = 0;
  let belowViews = 0;
  let videosSkipped = 0;

  for (const item of items) {
    const normalized = normalizeItem(item);
    if (!normalized) {
      videosSkipped += 1;
      continue;
    }
    if (seen.has(normalized.tiktokId)) continue;
    if (normalized.views < minViews) {
      belowViews += 1;
      continue;
    }
    const existing = byId.get(normalized.tiktokId);
    if (!existing || normalized.views > existing.views) {
      byId.set(normalized.tiktokId, normalized);
      kept += 1;
      log(
        'find-slideshows',
        `slideshow ${normalized.tiktokId} via ${normalized.detectedAs} (${normalized.views} views, ${normalized.slideCount} images)`
      );
    }
  }

  return { raw: items.length, kept, belowViews, videosSkipped };
}

export async function findSlideshowFromSource(source: string): Promise<SlideshowCandidate | null> {
  const awemeId = extractAwemeId(source);
  if (!awemeId) {
    throw new Error(`Could not parse TikTok photo id from: ${source}`);
  }

  // Remake path never uses ScrapTik (quota is separate and currently exhausted)
  const fromWeb = await fetchTikTokPhotoFromWeb(source);
  log('find-slideshows', `Loaded ${fromWeb.slideCount} slides via ${fromWeb.detectedAs}`);
  return fromWeb;
}

export async function findSlideshows(): Promise<SlideshowCandidate[]> {
  const config = loadConfig();
  const seen = new Set(getSeenTiktoks());
  const byId = new Map<string, SlideshowCandidate>();

  // Optional manual photo URLs/IDs in config — useful when ScrapTik search returns mostly videos
  const manualSources = config.tiktok.manualPhotoSources || [];
  for (const source of manualSources) {
    try {
      const candidate = await findSlideshowFromSource(source);
      if (candidate && !seen.has(candidate.tiktokId) && candidate.views >= config.tiktok.minViews) {
        byId.set(candidate.tiktokId, candidate);
      } else if (candidate && candidate.views < config.tiktok.minViews) {
        // Still allow manual sources below minViews — user explicitly provided them
        byId.set(candidate.tiktokId, candidate);
        log('find-slideshows', `manual source below minViews kept: ${candidate.tiktokId}`);
      }
    } catch (error) {
      logError('find-slideshows', `manual source failed: ${error instanceof Error ? error.message : error}`);
      if (isQuotaOrRateError(error)) {
        throw new Error(
          'ScrapTik monthly quota exceeded on BASIC plan. Upgrade at https://rapidapi.com/scraptik-api-scraptik-api-default/api/scraptik or wait for reset.'
        );
      }
    }
    await sleep(500);
  }

  if (byId.size >= 5) {
    const candidates = Array.from(byId.values()).sort((a, b) => b.views - a.views).slice(0, 5);
    writeJson(resolvePath('data', 'candidates.json'), candidates);
    markTiktoksSeen(candidates.map((c) => c.tiktokId));
    return candidates;
  }

  log('find-slideshows', 'Slideshow-only mode: videos are ignored');
  log('find-slideshows', `Searching ${config.tiktok.searchKeywords.length} keywords via /search-posts...`);

  for (const keyword of config.tiktok.searchKeywords) {
    if (byId.size >= 5) break;
    try {
      const items = await searchPosts(keyword, config.tiktok.resultsPerSearch);
      const stats = ingestItems(items, seen, byId, config.tiktok.minViews);
      log(
        'find-slideshows',
        `keyword "${keyword}" → ${stats.raw} raw | slideshows ${stats.kept} | videos skipped ${stats.videosSkipped} | belowViews ${stats.belowViews}`
      );
    } catch (error) {
      logError('find-slideshows', `keyword "${keyword}" failed: ${error instanceof Error ? error.message : error}`);
      if (isSubscriptionError(error)) {
        throw new Error(
          'ScrapTik is not subscribed on this RapidAPI key. Open https://rapidapi.com/scraptik-api-scraptik-api-default/api/scraptik and subscribe, then retry.'
        );
      }
      if (isQuotaOrRateError(error)) {
        throw new Error(
          'ScrapTik monthly quota exceeded on BASIC plan. Upgrade at https://rapidapi.com/scraptik-api-scraptik-api-default/api/scraptik or wait for reset.'
        );
      }
    }
    await sleep(800);
  }

  log('find-slideshows', `Searching ${config.tiktok.searchHashtags.length} hashtags (multi-page) for photo carousels...`);
  for (const hashtag of config.tiktok.searchHashtags) {
    if (byId.size >= 5) break;
    try {
      const items = await searchHashtagPosts(hashtag, config.tiktok.resultsPerSearch, 3);
      const stats = ingestItems(items, seen, byId, config.tiktok.minViews);
      log(
        'find-slideshows',
        `hashtag "#${hashtag}" → ${stats.raw} raw | slideshows ${stats.kept} | videos skipped ${stats.videosSkipped} | belowViews ${stats.belowViews}`
      );
    } catch (error) {
      logError('find-slideshows', `hashtag "#${hashtag}" failed: ${error instanceof Error ? error.message : error}`);
      if (isSubscriptionError(error)) {
        throw new Error(
          'ScrapTik is not subscribed on this RapidAPI key. Open https://rapidapi.com/scraptik-api-scraptik-api-default/api/scraptik and subscribe, then retry.'
        );
      }
      if (isQuotaOrRateError(error)) {
        throw new Error(
          'ScrapTik monthly quota exceeded on BASIC plan. Upgrade at https://rapidapi.com/scraptik-api-scraptik-api-default/api/scraptik or wait for reset.'
        );
      }
    }
    await sleep(800);
  }

  const candidates = Array.from(byId.values())
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  writeJson(resolvePath('data', 'candidates.json'), candidates);
  markTiktoksSeen(candidates.map((c) => c.tiktokId));

  if (candidates.length === 0) {
    log(
      'find-slideshows',
      'No photo carousels found. ScrapTik search heavily returns videos. Add TikTok photo URLs to config.tiktok.manualPhotoSources or run: npm run pipeline -- --source "https://www.tiktok.com/@user/photo/123"'
    );
  } else {
    log('find-slideshows', `Selected top ${candidates.length} slideshow candidates`);
  }

  return candidates;
}

async function main(): Promise<void> {
  const sourceIdx = process.argv.indexOf('--source');
  if (sourceIdx >= 0 && process.argv[sourceIdx + 1]) {
    const one = await findSlideshowFromSource(process.argv[sourceIdx + 1]);
    console.log(JSON.stringify(one, null, 2));
    return;
  }
  const candidates = await findSlideshows();
  console.log(JSON.stringify(candidates, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    logError('find-slideshows', err);
    process.exit(1);
  });
}
