import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  SlideCopy,
  fetchJson,
  loadConfig,
  log,
  logError,
  requireEnv,
  writeJson,
} from './utils';
import { resolvePostAccountId, resolveTikTokPostMode, type TikTokPostMode } from './desk-settings';

const ZERNIO_BASE = 'https://zernio.com/api/v1';

interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

interface ZernioPostResponse {
  _id?: string;
  id?: string;
  status?: string;
  platforms?: Array<{
    status?: string;
    platformPostUrl?: string;
    platformPostId?: string;
    errorMessage?: string;
  }>;
  [key: string]: unknown;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireEnv('ZERNIO_API_KEY')}`,
    'Content-Type': 'application/json',
  };
}

async function resolvePrivacyLevel(accountId: string, preferred: string): Promise<string> {
  try {
    const info = await fetchJson<{
      privacyLevels?: Array<string | { value?: string }>;
      privacy_levels?: Array<string | { value?: string }>;
    }>(
      `${ZERNIO_BASE}/accounts/${accountId}/tiktok/creator-info?mediaType=photo`,
      { method: 'GET', headers: authHeaders() },
      'post-to-tiktok/creator-info'
    );
    const raw = info.privacyLevels || info.privacy_levels || [];
    const allowed = raw
      .map((item) => (typeof item === 'string' ? item : item?.value || ''))
      .filter(Boolean);
    if (!allowed.length) return preferred;
    if (allowed.includes(preferred)) return preferred;
    if (allowed.includes('PUBLIC_TO_EVERYONE')) return 'PUBLIC_TO_EVERYONE';
    return allowed[0];
  } catch {
    return preferred;
  }
}

async function uploadImageToZernio(filePath: string): Promise<string> {
  const filename = path.basename(filePath);
  const contentType = filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const buffer = fs.readFileSync(filePath);

  const presign = await fetchJson<PresignResponse>(
    `${ZERNIO_BASE}/media/presign`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        filename,
        contentType,
        size: buffer.length,
      }),
    },
    'post-to-tiktok/presign'
  );

  const uploadRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Zernio media upload failed (${uploadRes.status}): ${text.slice(0, 300)}`);
  }

  return presign.publicUrl;
}

/** TikTok photo titles strip hashtags/URLs — empty titles break Creator Inbox notifications. */
function cleanPhotoTitle(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/@[^\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function photoTitleFromCopy(copy: SlideCopy): string {
  const candidates = [
    copy.hook,
    copy.layouts?.[0]?.headline,
    copy.layouts?.[0]?.body,
    ...(copy.slides || []).map((slide) => {
      const head = slide.match(/\|\|\|HEAD\|\|\|([\s\S]*?)\|\|\|BODY\|\|\|/);
      return head?.[1] || slide;
    }),
    copy.caption,
  ];

  for (const raw of candidates) {
    const cleaned = cleanPhotoTitle(String(raw || ''));
    if (cleaned.length >= 3) return cleaned.slice(0, 90);
  }

  return 'FELAR for producers';
}

export async function postToTikTok(
  copy: SlideCopy,
  postDir: string,
  accountIdOverride?: string,
  modeOverride?: TikTokPostMode
): Promise<Record<string, unknown>> {
  const config = loadConfig();
  const accountId = resolvePostAccountId(accountIdOverride);
  const mode = resolveTikTokPostMode(modeOverride);
  const zernioOnlyDraft = mode === 'zernio';
  const tiktokInboxDraft = mode === 'inbox';

  const finalSlides: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const png = path.join(postDir, 'final', `slide-${i}.png`);
    const jpg = path.join(postDir, 'final', `slide-${i}.jpg`);
    if (fs.existsSync(png)) finalSlides.push(png);
    else if (fs.existsSync(jpg)) finalSlides.push(jpg);
    else break;
  }
  const rawSlides: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const raw = path.join(postDir, 'images', `slide-${i}-raw.jpg`);
    if (!fs.existsSync(raw)) break;
    rawSlides.push(raw);
  }

  // Prefer burned-in overlay finals when present (studio editor / overlays enabled)
  const slidePaths = finalSlides.length > 0 ? finalSlides : rawSlides;

  if (slidePaths.length === 0) {
    throw new Error('No photos found to upload');
  }

  log('post-to-tiktok', `Uploading ${slidePaths.length} slides to Zernio...`);
  const mediaItems: Array<{ type: 'image'; url: string }> = [];
  for (const slidePath of slidePaths) {
    const publicUrl = await uploadImageToZernio(slidePath);
    mediaItems.push({ type: 'image', url: publicUrl });
    log('post-to-tiktok', `Uploaded ${path.basename(slidePath)}`);
  }

  // Inbox: SELF_ONLY + real title. Live/Zernio draft: configured privacy.
  const preferredPrivacy = tiktokInboxDraft
    ? 'SELF_ONLY'
    : config.posting.privacyLevel || 'PUBLIC_TO_EVERYONE';
  const privacyLevel = await resolvePrivacyLevel(accountId, preferredPrivacy);
  const title = photoTitleFromCopy(copy);

  // zernio = dashboard draft only (no TikTok yet)
  // inbox = publishNow + tiktokSettings.draft → Creator Inbox
  // live = publishNow without draft → profile
  const body = {
    content: title,
    mediaItems,
    publishNow: !zernioOnlyDraft,
    isDraft: zernioOnlyDraft,
    platforms: [
      {
        platform: 'tiktok',
        accountId,
      },
    ],
    tiktokSettings: {
      privacy_level: privacyLevel,
      allow_comment: true,
      ...(tiktokInboxDraft
        ? {}
        : {
            allow_duet: true,
            allow_stitch: true,
          }),
      media_type: 'photo',
      photo_cover_index: 0,
      description: copy.caption,
      auto_add_music: false,
      content_preview_confirmed: true,
      express_consent_given: true,
      draft: tiktokInboxDraft,
    },
  };

  log(
    'post-to-tiktok',
    zernioOnlyDraft
      ? 'Saving Zernio dashboard draft…'
      : tiktokInboxDraft
        ? 'Sending to TikTok Creator Inbox via Zernio…'
        : `Publishing live to TikTok (${privacyLevel}) via Zernio…`
  );

  const response = await fetchJson<ZernioPostResponse & { post?: ZernioPostResponse }>(
    `${ZERNIO_BASE}/posts`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'x-request-id': randomUUID(),
      },
      body: JSON.stringify(body),
    },
    'post-to-tiktok/create'
  );

  const post = (response.post || response) as ZernioPostResponse;
  const platform = post.platforms?.[0];
  const zernioId = String(post._id || post.id || response._id || response.id || '');
  const postRecord = {
    zernioId,
    status:
      post.status ||
      response.status ||
      (zernioOnlyDraft ? 'zernio_draft' : tiktokInboxDraft ? 'sent_to_inbox' : 'submitted'),
    postedAt: new Date().toISOString(),
    caption: copy.caption,
    title,
    slideCount: slidePaths.length,
    mode,
    tiktokInboxDraft,
    zernioOnlyDraft,
    publishNow: !zernioOnlyDraft,
    privacyLevel,
    platformPostUrl: platform?.platformPostUrl || null,
    platformPostId: platform?.platformPostId || null,
    platformError: platform?.errorMessage || null,
    tiktokId: null,
    analytics: null,
    zernioResponse: response,
  };

  writeJson(path.join(postDir, 'post.json'), postRecord);

  if (platform?.errorMessage) {
    throw new Error(`TikTok publish failed: ${platform.errorMessage}`);
  }

  if (zernioOnlyDraft) {
    console.log('\nSaved as Zernio draft');
    console.log(`Open Zernio → publish when ready${zernioId ? ` (post ${zernioId})` : ''}\n`);
  } else if (tiktokInboxDraft) {
    console.log('\nSent to TikTok Creator Inbox');
    console.log(`Title: ${title}`);
    console.log('Open TikTok → Activity → System notifications → tap the upload');
    console.log('Also check Profile → Drafts. Clear old pending inbox shares first (max 5/day).\n');
  } else {
    console.log('\nPublished live to TikTok');
    if (platform?.platformPostUrl) console.log(`URL: ${platform.platformPostUrl}`);
    console.log('Check the account profile feed.\n');
  }

  return postRecord;
}

async function main(): Promise<void> {
  const postDir = process.argv[2];
  if (!postDir) {
    console.log('Usage: ts-node scripts/post-to-tiktok.ts <postDir>');
    process.exit(1);
  }
  const copy = JSON.parse(fs.readFileSync(path.join(postDir, 'copy.json'), 'utf8')) as SlideCopy;
  await postToTikTok(copy, postDir);
}

if (require.main === module) {
  main().catch((err) => {
    logError('post-to-tiktok', err);
    process.exit(1);
  });
}
