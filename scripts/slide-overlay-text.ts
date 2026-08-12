import * as fs from 'fs';
import { SlideLayout, extractJsonObject, log } from './utils';
import { getOpenAI, getOpenAIModel } from './openai';

export type SlideTextSource = 'overlay' | 'graphic' | 'none';

export interface ExtractedSlideText extends SlideLayout {
  textSource: SlideTextSource;
}

function flowText(value: string): string {
  return value
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTitleWord(word: string): boolean {
  if (!word) return false;
  if (/^[A-Z0-9][A-Z0-9'’\-]*$/.test(word)) return true;
  if (/^[A-Z][a-z'’\-]*$/.test(word)) return true;
  if (/^\d+\.?$/.test(word)) return true;
  return false;
}

function rejoinSplitTitle(headline: string, body: string): { headline: string; body: string } {
  if (!headline || !body) return { headline, body };

  const incompleteTitle =
    /^(how to|why |what |nobody |stop |don't |dont )/i.test(headline) && !/[.!?]$/.test(headline);

  const looksTruncated =
    incompleteTitle ||
    (headline.split(/\s+/).length <= 5 && !/[.!?]$/.test(headline) && isTitleWord(body.split(/\s+/)[0] || ''));

  if (!looksTruncated) return { headline, body };

  const words = body.split(/\s+/).filter(Boolean);
  const titleExtra: string[] = [];
  let i = 0;

  while (i < words.length) {
    const word = words[i];
    const next = words[i + 1];
    if (/^[A-Z]/.test(word) && next && /^[a-z]/.test(next)) break;
    if (/^[a-z]/.test(word)) break;
    if (!isTitleWord(word)) break;
    titleExtra.push(word);
    i += 1;
  }

  if (!titleExtra.length) return { headline, body };

  return {
    headline: flowText(`${headline} ${titleExtra.join(' ')}`),
    body: flowText(words.slice(i).join(' ')),
  };
}

function normalizeOverlayLayout(layout: SlideLayout): SlideLayout {
  let headline = flowText(layout.headline || '');
  let body = flowText(layout.body || '');

  ({ headline, body } = rejoinSplitTitle(headline, body));

  if (!headline && body && /^(how to|why |what |nobody )/i.test(body) && body.length <= 90) {
    return { headline: body.toUpperCase(), body: '' };
  }

  return {
    headline: headline ? headline.toUpperCase() : undefined,
    body,
  };
}

const SYSTEM_PROMPT = `You classify and extract text from TikTok photo carousel slides.

There are two very different kinds of on-screen text:

1. TikTok OVERLAY text — added in TikTok's editor on top of a real photo/scene.
   Signs: a photograph or real-world scene is visible underneath; text looks like TikTok UI (white letters with black outline/stroke, or black text inside a white rounded pill/box); usually one headline and maybe one subtitle.

2. Designed GRAPHIC text — baked into an infographic, chart, diagram, quote card, or Canva-style template.
   Signs: the whole slide is a designed graphic (funnel diagram, panning chart, label lists, icons, arrows, decorative layout); text is part of the design, not TikTok overlay; often multiple labels/colors tied to the illustration.

Return JSON only. Do not invent text. No emoji.`;

const USER_PROMPT = (index: number) => `Analyze slide ${index}.

Return JSON:
{
  "textSource": "overlay | graphic | none",
  "headline": "short boxed headline or main overlay title, else empty string",
  "body": "overlay subtitle/body text as one flowing line, else empty string"
}

Rules:
- textSource = "overlay" ONLY when text was added in TikTok on top of a photo/scene.
- textSource = "graphic" for infographics, diagrams, charts, funnel graphics, label lists, quote cards, or any slide where text is part of the design.
- textSource = "none" when there is no readable text.
- If textSource is "graphic" or "none", headline and body MUST be empty strings.
- If textSource is "overlay", extract exact overlay copy only:
  - headline = text inside a white pill/box OR the main white outlined title
  - body = secondary white outlined subtitle text
- Collapse wrapped title lines into one headline string. Never split one title across headline and body.`;

export async function extractOverlayTextFromSlideImage(
  imagePath: string,
  index: number,
  logTag = 'slide-overlay-text'
): Promise<ExtractedSlideText> {
  const client = getOpenAI();
  const model = getOpenAIModel();
  const bytes = fs.readFileSync(imagePath);
  const b64 = bytes.toString('base64');

  log(logTag, `Classifying slide ${index} text…`);

  const response = await client.chat.completions.create({
    model,
    max_tokens: 400,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: USER_PROMPT(index) },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${b64}` },
          },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return { textSource: 'none', body: '' };

  const parsed = extractJsonObject(content) as {
    textSource?: string;
    headline?: string;
    body?: string;
    text?: string;
  };

  const rawSource = String(parsed.textSource || '').toLowerCase();
  const textSource: SlideTextSource =
    rawSource === 'overlay' ? 'overlay' : rawSource === 'graphic' ? 'graphic' : 'none';

  if (textSource !== 'overlay') {
    log(logTag, `Slide ${index}: ${textSource} (no overlay copy)`);
    return { textSource, body: '' };
  }

  const normalized = normalizeOverlayLayout({
    headline: parsed.headline || '',
    body: parsed.body || parsed.text || '',
  });

  if (!normalized.headline && !normalized.body) {
    log(logTag, `Slide ${index}: overlay detected but no text read`);
    return { textSource: 'none', body: '' };
  }

  log(
    logTag,
    `Slide ${index}: overlay${normalized.headline ? ` TITLE "${normalized.headline}"` : ''}${
      normalized.body ? ` BODY "${normalized.body}"` : ''
    }`
  );

  return {
    textSource: 'overlay',
    headline: normalized.headline,
    body: normalized.body || '',
  };
}

export function hasOverlayCopy(slide: Pick<ExtractedSlideText, 'headline' | 'body' | 'textSource'>): boolean {
  if (slide.textSource && slide.textSource !== 'overlay') return false;
  return Boolean(String(slide.headline || '').trim() || String(slide.body || '').trim());
}
