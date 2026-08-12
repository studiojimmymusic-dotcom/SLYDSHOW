import {
  SlideCopy,
  SlideshowAnalysis,
  loadConfig,
  log,
  logError,
} from './utils';
import { chatJson } from './openai';

const SYSTEM_PROMPT = `You are a TikTok content writer for FELAR, a platform where Nigerian and African music producers sell beats and build their music business. Your job is to write slide text for TikTok slideshows that feel authentic to the African music producer experience — not generic, not corporate, not Western-centric.

FELAR's voice: Direct. Real. Speaks to the hustle. Understands Lagos, Afrobeats, Amapiano, drill. Talks like a producer who actually gets it.

Rules:
- 4-6 words per line maximum
- Use \\n to separate lines within a slide
- 3-4 lines per slide maximum
- No emoji (they break the rendering system)
- Write REACTIONS not labels ("This changed everything" not "Tip #1")
- The last slide is always a soft CTA pointing to FELAR
- Respond only with valid JSON. No markdown. No preamble.`;

export async function generateCopy(analysis: SlideshowAnalysis): Promise<SlideCopy> {
  const config = loadConfig();

  const userMessage = `Remake this TikTok slideshow format for FELAR.

Original hook: ${analysis.hook}
Hook type: ${analysis.hookType}
Topic: ${analysis.topic}
Narrative arc: ${analysis.narrativeArc}
Emotional angle: ${analysis.emotionalAngle}
Original text style: ${analysis.textStyle}
Why it worked: ${analysis.whyItWorked}
FELAR angle: ${analysis.felarAngle}
Brand voice: ${config.brand.voice}
Audience: ${config.brand.audience}

Write text for exactly 5 slides. The first slide must stop the scroll with a strong hook. The last slide must end with a soft CTA for FELAR (e.g. "FELAR gives you\\nyour own beat store\\nlink in bio").

Respond with this exact JSON:
{
  "hook": "the first slide hook text with \\n line breaks",
  "slides": [
    "slide 1 text with \\n line breaks",
    "slide 2 text with \\n line breaks",
    "slide 3 text with \\n line breaks",
    "slide 4 text with \\n line breaks",
    "slide 5 text (CTA slide)"
  ],
  "caption": "TikTok caption — hook line. 2-3 sentence story. Max 5 hashtags.",
  "hookCategory": "same hookType as input or adjusted"
}`;

  log('generate-copy', `Writing FELAR copy for topic: ${analysis.topic}`);

  const parsed = (await chatJson(SYSTEM_PROMPT, userMessage, 1000)) as SlideCopy;
  if (!Array.isArray(parsed.slides) || parsed.slides.length !== 5) {
    throw new Error('OpenAI copy must include exactly 5 slides');
  }

  parsed.slides = parsed.slides.map((slide) =>
    slide
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
      .replace(/[\u{2600}-\u{27BF}]/gu, '')
      .trim()
  );
  parsed.hook = parsed.slides[0];
  parsed.caption = (parsed.caption || '').trim();

  log('generate-copy', `Hook: "${parsed.slides[0].split('\n')[0]}"`);
  return parsed;
}

async function main(): Promise<void> {
  const sample: SlideshowAnalysis = {
    hook: 'Nobody told me this',
    hookType: 'hot_take',
    topic: 'selling beats online',
    slideStructure: 'problem to solution list',
    narrativeArc: 'problem_solution',
    emotionalAngle: 'aspiration',
    textStyle: 'short punchy lines',
    cta: 'link in bio',
    whyItWorked: 'Strong hook and relatable producer struggle.',
    visualMood: 'dark studio',
    pinterestKeywords: ['music studio', 'producer desk'],
    felarAngle: 'Show how FELAR helps producers sell beats.',
  };
  const copy = await generateCopy(sample);
  console.log(JSON.stringify(copy, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    logError('generate-copy', err);
    process.exit(1);
  });
}
