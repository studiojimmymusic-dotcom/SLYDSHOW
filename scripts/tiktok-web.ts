import { SlideshowCandidate, log, logError, sleep } from './utils';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function extractAwemeId(input: string): string | null {
  const trimmed = input.trim().replace(/^['"]|['"]$/g, '');
  if (/^\d{5,}$/.test(trimmed)) return trimmed;
  const photoMatch = trimmed.match(/\/photo\/(\d+)/);
  if (photoMatch) return photoMatch[1];
  const videoMatch = trimmed.match(/\/video\/(\d+)/);
  if (videoMatch) return videoMatch[1];
  return null;
}

function firstUrl(list?: string[]): string | null {
  if (!list?.length) return null;
  return list[0] || null;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hashtagsFromCaption(caption: string): string[] {
  return (caption.match(/#([A-Za-z0-9_]+)/g) || []).map((tag) => tag.slice(1));
}

function parseFrontityState(html: string): unknown {
  const marker = 'id="__FRONTITY_CONNECT_STATE__"';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = html.indexOf('>', start) + 1;
  const jsonEnd = html.indexOf('</script>', jsonStart);
  if (jsonStart <= 0 || jsonEnd < jsonStart) return null;
  return JSON.parse(html.slice(jsonStart, jsonEnd));
}

function findVideoData(obj: unknown, awemeId: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  if (rec.imagePostInfo && rec.itemInfos) return rec;

  const itemInfos = rec.itemInfos as Record<string, unknown> | undefined;
  if (itemInfos && String(itemInfos.id) === awemeId) return rec;

  for (const value of Object.values(rec)) {
    const found = findVideoData(value, awemeId);
    if (found) return found;
  }
  return null;
}

async function fetchEmbed(awemeId: string): Promise<SlideshowCandidate> {
  const embedUrl = `https://www.tiktok.com/embed/v2/${awemeId}`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.tiktok.com/',
    },
  });
  if (!res.ok) {
    throw new Error(`TikTok embed fetch failed (${res.status})`);
  }

  const html = await res.text();
  const state = parseFrontityState(html);
  if (!state) throw new Error('TikTok embed page had no post data');

  const videoData = findVideoData(state, awemeId);
  if (!videoData) throw new Error('Could not find photo carousel data in TikTok embed');

  const imagePostInfo = videoData.imagePostInfo as
    | { displayImages?: Array<{ urlList?: string[]; url_list?: string[] }> }
    | undefined;

  const images = (imagePostInfo?.displayImages || [])
    .map((img) => firstUrl(img.urlList) || firstUrl(img.url_list))
    .filter((url): url is string => Boolean(url));

  if (images.length < 2) {
    throw new Error('This TikTok post is not a photo carousel (need at least 2 images)');
  }

  const item = (videoData.itemInfos || {}) as Record<string, unknown>;
  const author = (videoData.authorInfos || {}) as Record<string, unknown>;
  const stats = (item.stats || item.statistics || videoData.itemStats || {}) as Record<string, unknown>;
  const caption = String(item.text || item.desc || '');
  const uniqueId = String(author.uniqueId || author.unique_id || '');
  const textExtra = Array.isArray(videoData.textExtra) ? videoData.textExtra : [];
  const hashtags = textExtra
    .map((row) =>
      String((row as Record<string, unknown>).HashtagName || (row as Record<string, unknown>).hashtagName || '')
    )
    .filter(Boolean);

  for (const tag of hashtagsFromCaption(caption)) {
    if (!hashtags.includes(tag)) hashtags.push(tag);
  }

  return {
    tiktokId: String(item.id || awemeId),
    creator: uniqueId ? `@${uniqueId}` : '@unknown',
    views: asNumber(stats.playCount || stats.play_count || item.playCount),
    likes: asNumber(stats.diggCount || stats.digg_count || item.diggCount),
    comments: asNumber(stats.commentCount || stats.comment_count || item.commentCount),
    shares: asNumber(stats.shareCount || stats.share_count || item.shareCount),
    saves: asNumber(stats.collectCount || stats.collect_count || item.collectCount),
    caption,
    hashtags,
    slideImages: images,
    slideCount: images.length,
    detectedAs: 'tiktok-embed',
  };
}

async function fetchTikWm(sourceUrl: string, awemeId: string): Promise<SlideshowCandidate> {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(sourceUrl)}&hd=1`;
  log('tiktok-web', 'Trying TikWM fallback...');
  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`TikWM failed (${res.status})`);
  const payload = (await res.json()) as {
    code?: number;
    msg?: string;
    data?: {
      id?: string;
      title?: string;
      play_count?: number;
      digg_count?: number;
      comment_count?: number;
      share_count?: number;
      collect_count?: number;
      images?: string[];
      author?: { unique_id?: string };
    };
  };
  if (payload.code !== 0 || !payload.data) {
    throw new Error(`TikWM error: ${payload.msg || 'unknown'}`);
  }

  const images = (payload.data.images || []).filter(Boolean);
  if (images.length < 2) {
    throw new Error('This TikTok post is not a photo carousel (need at least 2 images)');
  }

  const caption = payload.data.title || '';
  const uniqueId = payload.data.author?.unique_id || '';

  return {
    tiktokId: String(payload.data.id || awemeId),
    creator: uniqueId ? `@${uniqueId}` : '@unknown',
    views: asNumber(payload.data.play_count),
    likes: asNumber(payload.data.digg_count),
    comments: asNumber(payload.data.comment_count),
    shares: asNumber(payload.data.share_count),
    saves: asNumber(payload.data.collect_count),
    caption,
    hashtags: hashtagsFromCaption(caption),
    slideImages: images,
    slideCount: images.length,
    detectedAs: 'tikwm',
  };
}

export async function fetchTikTokPhotoFromWeb(sourceUrl: string): Promise<SlideshowCandidate> {
  const awemeId = extractAwemeId(sourceUrl);
  if (!awemeId) {
    throw new Error(`Could not parse TikTok photo id from: ${sourceUrl}`);
  }

  const canonical = `https://www.tiktok.com/@_/photo/${awemeId}`;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log('tiktok-web', `Fetching embed ${awemeId} (attempt ${attempt}/3)`);
      return await fetchEmbed(awemeId);
    } catch (error) {
      lastError = error;
      logError('tiktok-web', `embed attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
      await sleep(1200 * attempt);
    }
  }

  try {
    return await fetchTikWm(sourceUrl.includes('tiktok.com') ? sourceUrl : canonical, awemeId);
  } catch (wmError) {
    logError('tiktok-web', wmError);
    throw new Error(
      `Could not load TikTok carousel without ScrapTik. Embed: ${lastError instanceof Error ? lastError.message : lastError}. TikWM: ${wmError instanceof Error ? wmError.message : wmError}`
    );
  }
}
