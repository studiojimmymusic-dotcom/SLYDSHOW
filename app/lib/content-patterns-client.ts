'use client';

export type StoredAnalysis = {
  id: string;
  sourceUrl: string;
  tiktokId: string;
  creator: string;
  views: number;
  createdAt: string;
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

const STORAGE_KEY = 'slydshow.content-intelligence.v1';
const MAX_ITEMS = 40;

type Store = { items: StoredAnalysis[] };

function emptyStore(): Store {
  return { items: [] };
}

function readStore(): Store {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { items: Array.isArray(parsed.items) ? (parsed.items as StoredAnalysis[]) : [] };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: Store): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ items: store.items.slice(0, MAX_ITEMS) })
  );
}

function tally(values: (string | null | undefined)[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value || '')
      .trim()
      .toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

export function saveIntelligenceAnalysis(
  input: Omit<StoredAnalysis, 'id' | 'createdAt'> & { id?: string }
): StoredAnalysis {
  const store = readStore();
  const id =
    input.id ||
    input.tiktokId ||
    `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const next: StoredAnalysis = {
    ...input,
    id,
    createdAt: new Date().toISOString(),
  };
  writeStore({
    items: [next, ...store.items.filter((item) => item.id !== id && item.tiktokId !== next.tiktokId)],
  });
  return next;
}

export function listIntelligenceAnalyses(): StoredAnalysis[] {
  return readStore().items;
}

export function getLatestIntelligenceAnalysis(): StoredAnalysis | null {
  return readStore().items[0] || null;
}

export function getLocalPatternSeed(): PatternSeed {
  const items = readStore().items;
  return {
    sampleSize: items.length,
    hookTypes: tally(items.map((item) => item.hookType)),
    formats: tally(items.map((item) => item.slideStructure)),
    structures: tally(items.map((item) => item.narrativeArc)),
    emotionalAngles: tally(items.map((item) => item.emotionalAngle)),
    topics: tally(items.map((item) => item.topic)),
  };
}
