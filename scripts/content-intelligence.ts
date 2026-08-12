import { chatJson } from './openai';
import { loadConfig, log } from './utils';

export type SlideText = { index: number; headline?: string; body: string };

export type IntelligenceAnalysis = {
  hook: string;
  hookType: string;
  topic: string;
  slideStructure: string;
  narrativeArc: string;
  emotionalAngle: string;
  textStyle: string;
  cta: string | null;
  whyItWorked: string;
  felarAngle: string;
};

export type PatternSeed = {
  hookTypes: { value: string; count: number }[];
  formats: { value: string; count: number }[];
  structures: { value: string; count: number }[];
  emotionalAngles: { value: string; count: number }[];
  topics: { value: string; count: number }[];
  sampleSize: number;
};

export type OriginalCopyResult = {
  hook: string;
  format: string;
  slides: SlideText[];
  caption: string;
  cta: string;
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

function stripEmoji(value: string): string {
  return value
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .trim();
}

function formatPatternSummary(patterns: PatternSeed): string {
  const section = (label: string, items: { value: string; count: number }[]) => {
    if (!items.length) return '';
    return `${label}:\n${items
      .slice(0, 8)
      .map((item) => `- ${item.value} (${item.count}x)`)
      .join('\n')}`;
  };

  return [
    `Based on ${patterns.sampleSize} analyzed slideshow(s) in this Studio:`,
    section('Top hook types', patterns.hookTypes),
    section('Top narrative arcs', patterns.structures),
    section('Top emotional angles', patterns.emotionalAngles),
    section('Top topics', patterns.topics),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function analyzeImportedSlideshow(input: {
  creator?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  caption?: string;
  hashtags?: string[];
  slides: SlideText[];
}): Promise<IntelligenceAnalysis> {
  const config = loadConfig();
  const transcript = slidesToTranscript(input.slides);
  if (!transcript) throw new Error('No on-screen text to analyze');

  log('content-intelligence', 'Analyzing imported slideshow patterns…');

  const parsed = (await chatJson(
    `You are a content intelligence analyst for FELAR, a platform where music producers sell beats. Extract reusable patterns from viral TikTok slideshows. Do not copy the post — extract the pattern. Respond only with valid JSON.`,
    `Analyze this TikTok photo carousel.

Creator: ${input.creator || 'unknown'}
Views: ${input.views ?? 0}
Likes: ${input.likes ?? 0}
Comments: ${input.comments ?? 0}
Shares: ${input.shares ?? 0}
Saves: ${input.saves ?? 0}
Caption: ${input.caption || '(none)'}
Hashtags: ${(input.hashtags || []).join(', ') || '(none)'}
On-screen slide text:
${transcript}

Brand: ${config.brand.description}
Audience: ${config.brand.audience}

Respond with this exact JSON:
{
  "hook": "opening on-screen hook",
  "hookType": "question | bold_claim | stat | pain_point | transformation | story | hot_take | list_tease",
  "topic": "core topic in 4-6 words",
  "slideStructure": "how the slides progress",
  "narrativeArc": "problem_solution | before_after | listicle | journey | revelation | controversy",
  "emotionalAngle": "aspiration | fear | curiosity | relatability | validation | urgency | pride",
  "textStyle": "short punchy lines | long explanatory | single word per slide | question and answer",
  "cta": "last-slide CTA or null",
  "whyItWorked": "2 sentences on why this likely performed",
  "felarAngle": "how FELAR could use this pattern originally"
}`,
    1000
  )) as IntelligenceAnalysis;

  if (!parsed.hook || !parsed.topic || !parsed.hookType) {
    throw new Error('Analysis missing required fields');
  }

  return parsed;
}

export async function generateOriginalFromPatterns(input: {
  topic?: string | null;
  patterns?: PatternSeed | null;
  latestAnalysis?: IntelligenceAnalysis | null;
}): Promise<OriginalCopyResult> {
  const config = loadConfig();
  const topic = input.topic?.trim() || null;
  const patterns = input.patterns;
  const latest = input.latestAnalysis;

  if (!topic && !(patterns && patterns.sampleSize > 0) && !latest) {
    throw new Error('Import a few viral carousels first, then try Write original.');
  }

  const parts: string[] = [];
  if (topic) parts.push(`Topic / angle:\n${topic}`);
  if (patterns && patterns.sampleSize > 0) {
    parts.push(
      `Pattern inspiration (create NEW original copy — do not copy any single post):\n\n${formatPatternSummary(patterns)}`
    );
  }
  if (latest) {
    parts.push(
      `Latest import pattern seed (inspire only, do not remake verbatim):\nHook type: ${latest.hookType}\nTopic: ${latest.topic}\nArc: ${latest.narrativeArc}\nEmotion: ${latest.emotionalAngle}\nWhy it worked: ${latest.whyItWorked}\nFELAR angle: ${latest.felarAngle}`
    );
  }
  parts.push(
    `Write an original TikTok slideshow for FELAR producers.\nBrand voice: ${config.brand.voice}\nAudience: ${config.brand.audience}`
  );

  log('content-intelligence', 'Generating original slideshow copy…');

  const parsed = (await chatJson(
    `You write TikTok slideshow copy for FELAR (usefelar.com), where producers sell beats.

Voice: direct, practical, producer-to-producer. Global brand — not Nigeria-only.

Rules:
- Create ORIGINAL angles inspired by patterns — never copy or closely paraphrase a source post
- 4-6 words per line max; use \\n between lines on a slide
- 3-4 lines per slide max
- No emoji
- First slide is a scroll-stopping hook
- Last slide is a soft FELAR CTA (beat store / usefelar.com)
- Respond only with valid JSON`,
    `${parts.join('\n\n')}

Respond with this exact JSON:
{
  "hook": "slide 1 hook with \\n breaks",
  "format": "listicle | pov-story | before-after | tutorial | myth-bust",
  "slides": [
    { "headline": "optional short title", "body": "body with \\n breaks" },
    { "headline": "", "body": "..." },
    { "headline": "", "body": "..." },
    { "headline": "", "body": "..." },
    { "headline": "BUILD YOUR BEAT STORE", "body": "on FELAR\\nusefelar.com" }
  ],
  "caption": "TikTok caption ready to paste — no hashtag spam",
  "cta": "soft CTA line"
}`,
    1200
  )) as {
    hook?: string;
    format?: string;
    slides?: Array<{ headline?: string; body?: string } | string>;
    caption?: string;
    cta?: string;
  };

  const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
  if (rawSlides.length < 3) {
    throw new Error('Generated copy did not include enough slides');
  }

  const slides: SlideText[] = rawSlides.slice(0, 6).map((slide, i) => {
    if (typeof slide === 'string') {
      const lines = stripEmoji(slide)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return {
        index: i + 1,
        headline: lines[0],
        body: lines.slice(1).join('\n'),
      };
    }
    return {
      index: i + 1,
      headline: stripEmoji(String(slide.headline || '')) || undefined,
      body: stripEmoji(String(slide.body || '')),
    };
  });

  return {
    hook: stripEmoji(String(parsed.hook || slides[0]?.headline || '')),
    format: String(parsed.format || 'listicle'),
    slides,
    caption: stripEmoji(String(parsed.caption || '')),
    cta: stripEmoji(String(parsed.cta || '')),
  };
}
