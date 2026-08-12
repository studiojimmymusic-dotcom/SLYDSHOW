import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as dotenv from 'dotenv';
import bundledConfig from '../config.json';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function findRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'config.json'))) return dir;
  }
  return process.cwd();
}

export const ROOT = findRoot();

export interface BrandConfig {
  name: string;
  description: string;
  audience: string;
  voice: string;
  topics: string[];
  avoidTopics: string[];
}

export interface TikTokConfig {
  searchKeywords: string[];
  searchHashtags: string[];
  minViews: number;
  slideshowOnly: boolean;
  resultsPerSearch: number;
  manualPhotoSources?: string[];
}

export interface PinterestConfig {
  rapidApiHost: string;
  searchPath: string;
  imagesPerPost: number;
  preferPortrait: boolean;
  minWidth: number;
  searchTermTemplate: string;
  searchQueries: string[];
  preferredQueries: string[];
}

export interface OverlayConfig {
  enabled: boolean;
  fontPath: string;
  fontColor: string;
  strokeColor: string;
  strokeWidthPercent: number;
  textPositionFromTop: number;
  maxWidthPercent: number;
  outputWidth: number;
  outputHeight: number;
}

export interface PostingConfig {
  privacyLevel: string;
  postAsDraft: boolean;
  schedule: string[];
}

export interface AnalyticsConfig {
  highViews: number;
  highEngagementRate: number;
  lookbackDays: number;
}

export interface OpenAIConfig {
  model: string;
}

export interface AppConfig {
  brand: BrandConfig;
  tiktok: TikTokConfig;
  pinterest: PinterestConfig;
  overlays: OverlayConfig;
  posting: PostingConfig;
  analytics: AnalyticsConfig;
  openai?: OpenAIConfig;
}

export interface SlideshowCandidate {
  tiktokId: string;
  creator: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  caption: string;
  hashtags: string[];
  slideImages: string[];
  slideCount: number;
  detectedAs: string;
}

export interface SlideshowAnalysis {
  hook: string;
  hookType: string;
  topic: string;
  slideStructure: string;
  narrativeArc: string;
  emotionalAngle: string;
  textStyle: string;
  cta: string | null;
  whyItWorked: string;
  visualMood: string;
  pinterestKeywords: string[];
  slideImageQueries?: string[];
  felarAngle: string;
}

export interface SlideLayout {
  headline?: string;
  body: string;
}

export interface SlideCopy {
  hook: string;
  slides: string[];
  layouts?: SlideLayout[];
  caption: string;
  hookCategory: string;
}

export function loadConfig(): AppConfig {
  const candidates = [
    path.join(process.cwd(), 'config.json'),
    path.join(ROOT, 'config.json'),
    path.resolve(__dirname, '../config.json'),
  ];
  for (const configPath of candidates) {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig;
    }
  }
  // Bundled fallback for Vercel serverless (file tracing may omit loose config.json)
  return bundledConfig as AppConfig;
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function log(step: string, message: string): void {
  console.log(`[${step}] ${message}`);
}

export function logError(step: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[${step}] ERROR: ${msg}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makePostTimestamp(date = new Date()): string {
  // Include seconds + random suffix so rapid shares never reuse the same folder
  // (Vercel /tmp is warm across requests; minute-level stamps caused stale images).
  const iso = date.toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${iso.slice(0, 19)}-${rand}`;
}

export function resolvePath(...parts: string[]): string {
  // Vercel serverless FS is read-only except /tmp
  const runtimeRoots = new Set(['posts', 'data', 'exports']);
  if (process.env.VERCEL && parts[0] && runtimeRoots.has(parts[0])) {
    return path.join(os.tmpdir(), 'slydshow', ...parts);
  }
  return path.join(ROOT, ...parts);
}

export async function fetchJson<T = unknown>(
  url: string,
  options: RequestInit = {},
  step = 'api'
): Promise<T> {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} ${res.statusText}: ${typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500)}`
      );
    }
    return body as T;
  } catch (error) {
    logError(step, error);
    throw error;
  }
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Model response was not valid JSON');
  }
}

export function getSeenTiktoks(): string[] {
  return readJson<string[]>(resolvePath('data', 'seen-tiktoks.json'), []);
}

export function markTiktokSeen(id: string): void {
  const seen = new Set(getSeenTiktoks());
  seen.add(id);
  writeJson(resolvePath('data', 'seen-tiktoks.json'), Array.from(seen));
}

export function markTiktoksSeen(ids: string[]): void {
  const seen = new Set(getSeenTiktoks());
  for (const id of ids) seen.add(id);
  writeJson(resolvePath('data', 'seen-tiktoks.json'), Array.from(seen));
}
