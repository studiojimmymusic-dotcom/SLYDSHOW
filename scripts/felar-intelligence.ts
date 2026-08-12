type SlideText = { index: number; headline?: string; body: string };

const DEFAULT_BASE = 'https://admin.usefelar.com';

export type FelarSubmitInput = {
  sourceUrl: string;
  tiktokId?: string;
  creator?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  caption?: string;
  hashtags?: string[];
  slides: SlideText[];
};

export type FelarDraft = {
  id: string;
  hook: string;
  format: string;
  script: string;
  caption: string;
  hashtags: string[];
  cta: string;
  niche: string | null;
  model: string;
};

function slidesToTranscript(slides: SlideText[]): string {
  return slides
    .map((slide) => {
      const headline = String(slide.headline || '').trim();
      const body = String(slide.body || '').trim();
      const lines = [`Slide ${slide.index}`];
      if (headline) lines.push(headline);
      if (body) lines.push(body);
      return lines.join('\n');
    })
    .join('\n\n')
    .trim();
}

function felarConfig(): { base: string; key: string } | null {
  const key = process.env.FELAR_AGENT_API_KEY?.trim() || '';
  if (!key) return null;
  const base = (process.env.FELAR_API_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '');
  return { base, key };
}

export function isFelarIntelligenceConfigured(): boolean {
  return Boolean(felarConfig());
}

async function felarFetch<T>(
  path: string,
  init: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const config = felarConfig();
  if (!config) {
    return { ok: false, error: 'FELAR intelligence is not configured.', status: 503 };
  }

  const res = await fetch(`${config.base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  let json: { ok?: boolean; error?: string; data?: T } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = {};
  }

  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      error: json.error || `FELAR request failed (${res.status})`,
      status: res.status,
    };
  }

  return { ok: true, data: json.data as T };
}

export async function submitSlideshowToFelar(input: FelarSubmitInput) {
  return felarFetch<{
    itemId: string;
    created: boolean;
    requeued: boolean;
    status: string;
  }>('/api/agent/content', {
    method: 'POST',
    body: JSON.stringify({
      sourceUrl: input.sourceUrl,
      tiktokId: input.tiktokId,
      creatorUsername: input.creator,
      views: input.views,
      likes: input.likes,
      comments: input.comments,
      shares: input.shares,
      saves: input.saves,
      caption: input.caption,
      hashtags: input.hashtags,
      transcript: slidesToTranscript(input.slides),
      category: 'slideshow',
    }),
  });
}

export async function generateFelarDraft(topic?: string) {
  return felarFetch<FelarDraft>('/api/agent/content/drafts', {
    method: 'POST',
    body: JSON.stringify({
      topic: topic?.trim() || undefined,
      seedFromPatterns: true,
    }),
  });
}
