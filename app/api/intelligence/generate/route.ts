import { generateFelarDraft } from '../../../../scripts/felar-intelligence';
import { scriptToSlides } from '../../../lib/draft-slides';
import { FELAR_CTA_SLIDE, buildPasteCaption } from '../../../lib/slide-style';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  let topic = '';
  try {
    const body = (await req.json()) as { topic?: string };
    topic = String(body.topic || '').trim();
  } catch {
    topic = '';
  }

  const result = await generateFelarDraft(topic || undefined);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  const draft = result.data;
  let slides = scriptToSlides(draft.script, draft.cta);
  if (slides.length === 0 && draft.hook) {
    slides = [{ index: 1, headline: draft.hook, body: '' }];
  }
  if (!slides.some((slide) => /felar/i.test(`${slide.headline || ''} ${slide.body}`))) {
    slides.push({
      index: slides.length + 1,
      headline: FELAR_CTA_SLIDE.headline,
      body: FELAR_CTA_SLIDE.body,
    });
  }
  slides = slides.map((slide, i) => ({ ...slide, index: i + 1 }));

  const copies = slides.map((slide) => ({
    headline: slide.headline || '',
    body: slide.body,
  }));
  const caption =
    String(draft.caption || '').trim() ||
    buildPasteCaption(copies);

  return Response.json({
    ok: true,
    draftId: draft.id,
    hook: draft.hook,
    format: draft.format,
    niche: draft.niche,
    slides,
    caption,
  });
}
