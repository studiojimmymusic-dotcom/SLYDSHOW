import { randomUUID } from 'crypto';
import { fetchJson, requireEnv } from './utils';

const ZERNIO_BASE = 'https://zernio.com/api/v1';

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireEnv('ZERNIO_API_KEY')}`,
    'Content-Type': 'application/json',
  };
}

export type ZernioMediaItem = {
  type?: string;
  url?: string;
  _id?: string;
};

export type ZernioPlatform = {
  platform?: string;
  status?: string;
  platformPostUrl?: string | null;
  platformPostId?: string | null;
  errorMessage?: string | null;
  accountId?:
    | string
    | {
        _id?: string;
        id?: string;
        username?: string;
        displayName?: string;
      };
  platformSpecificData?: {
    tiktokSettings?: {
      draft?: boolean;
      description?: string;
      media_type?: string;
      photo_cover_index?: number;
    };
    tiktokPublishId?: string;
    isDraft?: boolean;
    errorMessage?: string;
  };
};

export type ZernioPost = {
  _id?: string;
  id?: string;
  content?: string;
  title?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  scheduledFor?: string;
  mediaItems?: ZernioMediaItem[];
  platforms?: ZernioPlatform[];
};

export type StudioPostSummary = {
  id: string;
  title: string;
  status: string;
  platformStatus: string;
  createdAt: string;
  username: string;
  accountId: string;
  isInboxDraft: boolean;
  slideCount: number;
  platformPostId: string;
  platformPostUrl: string;
  error: string;
  thumbUrl: string;
  canRetry: boolean;
};

function accountFields(platform?: ZernioPlatform): { accountId: string; username: string } {
  const raw = platform?.accountId;
  if (!raw) return { accountId: '', username: '' };
  if (typeof raw === 'string') return { accountId: raw, username: '' };
  return {
    accountId: String(raw._id || raw.id || ''),
    username: String(raw.username || raw.displayName || ''),
  };
}

export function summarizeZernioPost(post: ZernioPost): StudioPostSummary {
  const id = String(post._id || post.id || '');
  const platform = (post.platforms || []).find((p) => p.platform === 'tiktok') || post.platforms?.[0];
  const { accountId, username } = accountFields(platform);
  const settings = platform?.platformSpecificData?.tiktokSettings;
  const isInboxDraft = Boolean(settings?.draft || platform?.platformSpecificData?.isDraft);
  const media = (post.mediaItems || []).filter((m) => m?.url);
  const title = String(post.content || post.title || 'Untitled').trim() || 'Untitled';
  const error = String(
    platform?.errorMessage || platform?.platformSpecificData?.errorMessage || ''
  ).trim();

  return {
    id,
    title,
    status: String(post.status || ''),
    platformStatus: String(platform?.status || ''),
    createdAt: String(post.createdAt || post.scheduledFor || ''),
    username,
    accountId,
    isInboxDraft,
    slideCount: media.length,
    platformPostId: String(
      platform?.platformPostId || platform?.platformSpecificData?.tiktokPublishId || ''
    ),
    platformPostUrl: String(platform?.platformPostUrl || ''),
    error,
    thumbUrl: String(media[0]?.url || ''),
    canRetry: Boolean(accountId && media.length > 0),
  };
}

export async function listZernioPosts(opts?: {
  page?: number;
  limit?: number;
  accountId?: string;
}): Promise<{ posts: StudioPostSummary[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  const page = Math.max(1, opts?.page || 1);
  const limit = Math.min(100, Math.max(1, opts?.limit || 30));
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sortBy: 'created-desc',
    source: 'zernio',
  });
  if (opts?.accountId) params.set('accountId', opts.accountId);

  const data = await fetchJson<{
    posts?: ZernioPost[];
    pagination?: { page?: number; limit?: number; total?: number; pages?: number };
  }>(`${ZERNIO_BASE}/posts?${params.toString()}`, { method: 'GET', headers: authHeaders() }, 'zernio/list-posts');

  const posts = (data.posts || []).map(summarizeZernioPost);
  return {
    posts,
    pagination: {
      page: Number(data.pagination?.page || page),
      limit: Number(data.pagination?.limit || limit),
      total: Number(data.pagination?.total || posts.length),
      pages: Number(data.pagination?.pages || 1),
    },
  };
}

export async function getZernioPost(postId: string): Promise<ZernioPost> {
  const data = await fetchJson<{ post?: ZernioPost } & ZernioPost>(
    `${ZERNIO_BASE}/posts/${encodeURIComponent(postId)}`,
    { method: 'GET', headers: authHeaders() },
    'zernio/get-post'
  );
  return (data.post || data) as ZernioPost;
}

/**
 * Re-send an existing post to TikTok Creator Inbox.
 * Tweaks the title so Zernio's 24h content-hash dedup does not block the retry.
 */
export async function retryZernioPostToInbox(postId: string): Promise<{
  ok: true;
  zernioId: string;
  platformPostId: string;
  username: string;
  title: string;
}> {
  const original = await getZernioPost(postId);
  const platform =
    (original.platforms || []).find((p) => p.platform === 'tiktok') || original.platforms?.[0];
  const { accountId, username } = accountFields(platform);
  if (!accountId) throw new Error('This post has no TikTok account to retry');

  const mediaItems = (original.mediaItems || [])
    .filter((m) => m?.url)
    .map((m) => ({ type: 'image' as const, url: String(m.url) }));
  if (!mediaItems.length) throw new Error('This post has no images to retry');

  const baseTitle = String(original.content || original.title || 'FELAR')
    .replace(/\s*·\s*(retry|inbox|repost).*$/i, '')
    .trim()
    .slice(0, 70);
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
  const title = `${baseTitle || 'FELAR'} · retry ${stamp}`.slice(0, 90);

  const description =
    platform?.platformSpecificData?.tiktokSettings?.description ||
    String(original.content || baseTitle || '');

  // MEDIA_UPLOAD-safe payload only (no Direct Post-only fields)
  const body = {
    content: title,
    mediaItems,
    publishNow: true,
    isDraft: false,
    platforms: [{ platform: 'tiktok', accountId }],
    tiktokSettings: {
      media_type: 'photo',
      photo_cover_index: 0,
      description,
      content_preview_confirmed: true,
      express_consent_given: true,
      draft: true,
    },
  };

  const response = await fetchJson<{
    post?: ZernioPostResponseLike;
    message?: string;
    error?: string;
  } & ZernioPostResponseLike>(
    `${ZERNIO_BASE}/posts`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'x-request-id': randomUUID(),
      },
      body: JSON.stringify(body),
    },
    'zernio/retry-inbox'
  );

  const post = (response.post || response) as ZernioPostResponseLike;
  const tiktok = post.platforms?.[0];
  if (tiktok?.errorMessage) {
    throw new Error(`TikTok retry failed: ${tiktok.errorMessage}`);
  }

  return {
    ok: true,
    zernioId: String(post._id || post.id || ''),
    platformPostId: String(
      tiktok?.platformPostId || tiktok?.platformSpecificData?.tiktokPublishId || ''
    ),
    username: username || 'tiktok',
    title,
  };
}

type ZernioPostResponseLike = {
  _id?: string;
  id?: string;
  platforms?: Array<{
    platformPostId?: string;
    errorMessage?: string;
    platformSpecificData?: { tiktokPublishId?: string };
  }>;
};
