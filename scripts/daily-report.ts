import * as fs from 'fs';
import * as path from 'path';
import {
  loadConfig,
  log,
  logError,
  readJson,
  resolvePath,
  writeJson,
} from './utils';

interface PostMeta {
  caption?: string;
  postedAt?: string;
  status?: string;
  analytics?: Record<string, unknown> | null;
  hookCategory?: string;
}

interface AnalyticsMetrics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  views?: number;
  follows?: number;
  engagementRate?: number;
}

type Verdict = 'SCALE' | 'FIX_CTA' | 'FIX_HOOK' | 'RESET' | 'NO_DATA';

function listRecentPosts(lookbackDays: number): Array<{ dir: string; meta: PostMeta; copyHook?: string; hookCategory?: string }> {
  const postsRoot = resolvePath('posts');
  if (!fs.existsSync(postsRoot)) return [];

  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const results: Array<{ dir: string; meta: PostMeta; copyHook?: string; hookCategory?: string }> = [];

  for (const name of fs.readdirSync(postsRoot)) {
    const dir = path.join(postsRoot, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const postPath = path.join(dir, 'post.json');
    if (!fs.existsSync(postPath)) continue;

    const meta = readJson<PostMeta>(postPath, {});
    const postedAt = meta.postedAt ? Date.parse(meta.postedAt) : NaN;
    if (!Number.isFinite(postedAt) || postedAt < cutoff) continue;

    let copyHook: string | undefined;
    let hookCategory: string | undefined;
    const copyPath = path.join(dir, 'copy.json');
    if (fs.existsSync(copyPath)) {
      const copy = readJson<{ hook?: string; hookCategory?: string; slides?: string[] }>(copyPath, {});
      copyHook = copy.hook || copy.slides?.[0];
      hookCategory = copy.hookCategory;
    }

    results.push({ dir, meta, copyHook, hookCategory });
  }

  return results.sort((a, b) => Date.parse(b.meta.postedAt || '') - Date.parse(a.meta.postedAt || ''));
}

function classify(views: number, engagementRate: number, highViews: number, highEngagement: number): Verdict {
  if (!views && !engagementRate) return 'NO_DATA';
  const highV = views >= highViews;
  const highE = engagementRate >= highEngagement;
  if (highV && highE) return 'SCALE';
  if (highV && !highE) return 'FIX_CTA';
  if (!highV && highE) return 'FIX_HOOK';
  return 'RESET';
}

function recommendation(verdict: Verdict): string {
  switch (verdict) {
    case 'SCALE':
      return 'Make 3 variations of this hook';
    case 'FIX_CTA':
      return 'Hook works — rewrite the last slide CTA';
    case 'FIX_HOOK':
      return 'Content is solid — rewrite the first slide hook';
    case 'RESET':
      return 'Try a completely different format';
    default:
      return 'Waiting on analytics sync (drafts may have no public metrics yet)';
  }
}

export async function generateDailyReport(): Promise<string> {
  const config = loadConfig();
  const posts = listRecentPosts(config.analytics.lookbackDays);
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(`# FELAR Slideshow Daily Report — ${today}`);
  lines.push('');
  lines.push(`Posts from last ${config.analytics.lookbackDays} days: ${posts.length}`);
  lines.push('');
  lines.push('| Post | Views | Engagement | Verdict | Recommendation |');
  lines.push('|------|------:|-----------:|---------|----------------|');

  const hookPerf = readJson<Record<string, unknown>>(resolvePath('data', 'hook-performance.json'), {});
  const categoryHits: Record<string, number> = {};

  for (const post of posts) {
    const metrics: AnalyticsMetrics = (post.meta.analytics || {}) as AnalyticsMetrics;

    const views = Number(metrics.views || metrics.impressions || 0);
    const likes = Number(metrics.likes || 0);
    const comments = Number(metrics.comments || 0);
    const shares = Number(metrics.shares || 0);
    const engagementRate =
      typeof metrics.engagementRate === 'number'
        ? metrics.engagementRate > 1
          ? metrics.engagementRate / 100
          : metrics.engagementRate
        : views > 0
          ? (likes + comments + shares) / views
          : 0;

    const verdict = classify(
      views,
      engagementRate,
      config.analytics.highViews,
      config.analytics.highEngagementRate
    );

    const label = path.basename(post.dir);
    lines.push(
      `| ${label} | ${views.toLocaleString()} | ${(engagementRate * 100).toFixed(2)}% | ${verdict} | ${recommendation(verdict)} |`
    );

    const category = post.hookCategory || 'unknown';
    if (verdict === 'SCALE' || verdict === 'FIX_CTA') {
      categoryHits[category] = (categoryHits[category] || 0) + 1;
    }

    if (post.copyHook) {
      hookPerf[post.copyHook] = {
        hookCategory: category,
        views,
        likes,
        comments,
        shares,
        engagementRate,
        verdict,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  lines.push('');
  const topCategory = Object.entries(categoryHits).sort((a, b) => b[1] - a[1])[0]?.[0] || 'n/a';
  lines.push(`## Top performing hook category`);
  lines.push(topCategory);
  lines.push('');
  lines.push('## What to make more of today');
  if (topCategory !== 'n/a') {
    lines.push(`- Double down on **${topCategory}** hooks`);
  } else {
    lines.push('- Collect more published post data before deciding');
  }
  lines.push('- Save photos from Studio, then post them yourself');
  lines.push('');

  const reportPath = resolvePath('data', 'reports', `${today}.md`);
  writeJson(resolvePath('data', 'hook-performance.json'), hookPerf);
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  log('daily-report', `Wrote ${reportPath}`);
  return reportPath;
}

async function main(): Promise<void> {
  const reportPath = await generateDailyReport();
  console.log(fs.readFileSync(reportPath, 'utf8'));
}

if (require.main === module) {
  main().catch((err) => {
    logError('daily-report', err);
    process.exit(1);
  });
}
