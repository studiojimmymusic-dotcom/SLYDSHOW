import * as path from 'path';
import { findSlideshows } from './find-slideshows';
import { remakeFromTikTokUrl } from './remake';
import { analyzeSlideshow } from './analyze-slideshow';
import { fetchImages } from './fetch-images';
import { generateCopy } from './generate-copy';
import {
  ensureDir,
  log,
  logError,
  makePostTimestamp,
  resolvePath,
  writeJson,
} from './utils';

async function runPipeline(): Promise<void> {
  const sourceArgIdx = process.argv.indexOf('--source');
  const manualSource = sourceArgIdx >= 0 ? process.argv[sourceArgIdx + 1] : undefined;

  // Simple remake mode: paste a photo carousel link
  if (manualSource) {
    await remakeFromTikTokUrl(manualSource);
    return;
  }

  console.log('FELAR Slideshow Pipeline starting...\n');
  console.log('Tip: for manual remakes use:');
  console.log('  npm run remake -- --source "https://www.tiktok.com/@user/photo/123"\n');

  log('pipeline', 'Step 1/5: Finding viral photo carousels on TikTok...');
  const candidates = await findSlideshows();

  if (candidates.length === 0) {
    console.log('No photo carousels/slideshows found.');
    console.log('Paste a TikTok photo URL instead:');
    console.log('  npm run remake -- --source "https://www.tiktok.com/@user/photo/123456789"');
    return;
  }
  console.log(`Found ${candidates.length} slideshow candidates\n`);

  let source = candidates[0];
  let analysis = null as Awaited<ReturnType<typeof analyzeSlideshow>> | null;

  for (const candidate of candidates) {
    try {
      log('pipeline', 'Step 2/5: Analyzing slideshow with OpenAI...');
      analysis = await analyzeSlideshow(candidate);
      source = candidate;
      break;
    } catch (error) {
      logError('pipeline', `Analysis failed for ${candidate.tiktokId}, trying next candidate`);
      logError('analyze-slideshow', error);
    }
  }

  if (!analysis) {
    console.log('All candidates failed analysis. Stopping.');
    return;
  }

  const timestamp = makePostTimestamp();
  const postDir = resolvePath('posts', timestamp);
  ensureDir(path.join(postDir, 'images'));
  ensureDir(path.join(postDir, 'final'));
  writeJson(path.join(postDir, 'source.json'), source);
  writeJson(path.join(postDir, 'analysis.json'), analysis);
  console.log(`Selected: ${source.creator} — ${source.views.toLocaleString()} views`);
  console.log(`Topic: ${analysis.topic}`);
  console.log(`Hook type: ${analysis.hookType}\n`);

  log('pipeline', 'Step 3/5: Writing FELAR slide copy with OpenAI...');
  let copy;
  try {
    copy = await generateCopy(analysis);
    writeJson(path.join(postDir, 'copy.json'), copy);
    console.log(`Hook: "${copy.slides[0].split('\n')[0]}"\n`);
  } catch (error) {
    logError('pipeline', error);
    console.log('Copy generation failed. Post folder kept for retry.');
    return;
  }

  log('pipeline', 'Step 4/5: Fetching Pinterest photos that match each slide...');
  try {
    await fetchImages(analysis, postDir, copy.slides);
    writeJson(path.join(postDir, 'analysis.json'), analysis);
    console.log('6 images downloaded and resized\n');
  } catch (error) {
    logError('pipeline', error);
    console.log('Image fetch failed. Post folder kept for retry.');
    return;
  }

  console.log('\nPipeline complete — photos saved locally (no auto-post).');
  console.log(`Folder: ${postDir}`);
  printPipelineCopy(copy);
}

function printPipelineCopy(copy: { slides: string[]; caption: string }): void {
  console.log('\n========================================');
  console.log('COPY THIS INTO TIKTOK');
  console.log('========================================\n');
  copy.slides.forEach((slide, i) => {
    console.log(`--- SLIDE ${i + 1} ---`);
    console.log(slide.replace(/\|\|\|HEAD\|\|\|/g, '').replace(/\|\|\|BODY\|\|\|/g, '\n').trim());
    console.log('');
  });
  console.log('--- CAPTION ---');
  console.log(copy.caption);
  console.log('\n========================================\n');
}

if (require.main === module) {
  runPipeline().catch((err) => {
    logError('pipeline', err);
    process.exit(1);
  });
}
