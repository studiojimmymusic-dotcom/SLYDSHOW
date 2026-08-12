import { submitSlideshowToFelar } from '../../../../scripts/felar-intelligence';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    sourceUrl?: string;
    tiktokId?: string;
    creator?: string;
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
    caption?: string;
    hashtags?: string[];
    slides?: { index: number; headline?: string; body: string }[];
  };

  if (!body.sourceUrl?.trim() && !(body.slides || []).length) {
    return Response.json({ error: 'Nothing to feed' }, { status: 400 });
  }

  const result = await submitSlideshowToFelar({
    sourceUrl: body.sourceUrl?.trim() || '',
    tiktokId: body.tiktokId,
    creator: body.creator,
    views: body.views,
    likes: body.likes,
    comments: body.comments,
    shares: body.shares,
    saves: body.saves,
    caption: body.caption,
    hashtags: body.hashtags,
    slides: body.slides || [],
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json({ ok: true, ...result.data });
}
