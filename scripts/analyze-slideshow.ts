import {
  SlideshowAnalysis,
  SlideshowCandidate,
  loadConfig,
  log,
  logError,
} from './utils';
import { chatJson } from './openai';

const SYSTEM_PROMPT = `You are a TikTok content strategist specializing in the music producer niche, particularly Nigerian and African creators. You analyze viral slideshows and extract the exact patterns that made them work so they can be adapted for FELAR, a beat selling platform for African producers.

Respond only with valid JSON. No markdown. No explanation. No preamble.`;

export async function analyzeSlideshow(source: SlideshowCandidate): Promise<SlideshowAnalysis> {
  const config = loadConfig();

  const userMessage = `Analyze this viral TikTok slideshow and extract its content pattern.

Creator: ${source.creator}
Views: ${source.views}
Likes: ${source.likes}
Comments: ${source.comments}
Shares: ${source.shares}
Saves: ${source.saves}
Caption: ${source.caption}
Hashtags: ${source.hashtags.join(', ')}
Number of slides: ${source.slideCount || 5}
Brand context: ${config.brand.description}
Audience: ${config.brand.audience}

Respond with this exact JSON:
{
  "hook": "the opening line or first slide text that stops the scroll",
  "hookType": "question | bold_claim | stat | pain_point | transformation | story | hot_take | list_tease",
  "topic": "the core topic in 4-6 words",
  "slideStructure": "brief description of how the slides progress",
  "narrativeArc": "problem_solution | before_after | listicle | journey | revelation | controversy",
  "emotionalAngle": "aspiration | fear | curiosity | relatability | validation | urgency | pride",
  "textStyle": "short punchy lines | long explanatory | single word per slide | question and answer",
  "cta": "the call to action on the last slide, or null",
  "whyItWorked": "2 sentences on what made this perform well",
  "visualMood": "description of the visual aesthetic — colors, lighting, environment",
  "pinterestKeywords": ["4 short visual search terms that match THIS post's topic, not generic studio stock"],
  "felarAngle": "how this exact format could work for FELAR's music producer audience"
}`;

  log('analyze-slideshow', `Analyzing ${source.tiktokId} from ${source.creator}...`);

  const parsed = (await chatJson(SYSTEM_PROMPT, userMessage, 1000)) as SlideshowAnalysis;
  if (!parsed.topic || !parsed.hook || !Array.isArray(parsed.pinterestKeywords)) {
    throw new Error('OpenAI analysis JSON missing required fields');
  }

  log('analyze-slideshow', `Topic: ${parsed.topic} | Hook type: ${parsed.hookType}`);
  return parsed;
}

async function main(): Promise<void> {
  const sample: SlideshowCandidate = {
    tiktokId: '0',
    creator: '@sample',
    views: 100000,
    likes: 5000,
    comments: 100,
    shares: 200,
    saves: 300,
    caption: 'How I sold my first beat as a Nigerian producer',
    hashtags: ['beatmaker', 'musicproducer'],
    slideImages: [],
    slideCount: 5,
    detectedAs: 'manual',
  };
  const analysis = await analyzeSlideshow(sample);
  console.log(JSON.stringify(analysis, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    logError('analyze-slideshow', err);
    process.exit(1);
  });
}
