import {
  generateOriginalFromPatterns,
  type IntelligenceAnalysis,
  type PatternSeed,
} from '../../../../scripts/content-intelligence';
import { FELAR_CTA_SLIDE, buildPasteCaption } from '../../../lib/slide-style';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: {
    topic?: string;
    patterns?: PatternSeed | null;
    latestAnalysis?: IntelligenceAnalysis | null;
  } = {};

  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  try {
    const draft = await generateOriginalFromPatterns({
      topic: body.topic,
      patterns: body.patterns,
      latestAnalysis: body.latestAnalysis,
    });

    let slides = draft.slides;
    if (!slides.some((slide) => /felar/i.test(`${slide.headline || ''} ${slide.body}`))) {
      slides = [
        ...slides,
        {
          index: slides.length + 1,
          headline: FELAR_CTA_SLIDE.headline,
          body: FELAR_CTA_SLIDE.body,
        },
      ];
    }
    slides = slides.map((slide, i) => ({ ...slide, index: i + 1 }));

    const copies = slides.map((slide) => ({
      headline: slide.headline || '',
      body: slide.body,
    }));

    return Response.json({
      ok: true,
      hook: draft.hook,
      format: draft.format,
      slides,
      caption: draft.caption || buildPasteCaption(copies),
      cta: draft.cta,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Generate failed' },
      { status: 500 }
    );
  }
}
