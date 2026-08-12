import { analyzeImportedSlideshow } from '../../../../scripts/content-intelligence';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

  const slides = body.slides || [];
  if (!slides.length) {
    return Response.json({ error: 'Import a carousel with on-screen text first' }, { status: 400 });
  }

  try {
    const analysis = await analyzeImportedSlideshow({
      creator: body.creator,
      views: body.views,
      likes: body.likes,
      comments: body.comments,
      shares: body.shares,
      saves: body.saves,
      caption: body.caption,
      hashtags: body.hashtags,
      slides,
    });

    return Response.json({
      ok: true,
      sourceUrl: body.sourceUrl || '',
      tiktokId: body.tiktokId || '',
      creator: body.creator || '',
      views: Number(body.views || 0),
      analysis,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
