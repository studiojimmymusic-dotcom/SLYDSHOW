'use client';

export type StudioSlideText = { index: number; headline?: string; body: string };

export type StudioPhoto = {
  id: string;
  url: string;
  thumbUrl: string;
  description: string;
  query: string;
};

export type StudioProject = {
  id: string;
  createdAt: string;
  updatedAt: string;
  sourceUrl: string;
  creator: string;
  views: number;
  slides: StudioSlideText[];
  caption: string;
  selected: StudioPhoto[];
  photos: StudioPhoto[];
  slide6DataUrl: string;
  slide6Name: string;
  searchQuery: string;
  title: string;
};

type Store = {
  activeId: string;
  projects: StudioProject[];
};

const STORAGE_KEY = 'slydshow.studio-projects.v1';
const MAX_PROJECTS = 25;

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function projectTitleFromSlides(
  slides: StudioSlideText[],
  creator = '',
  sourceUrl = ''
): string {
  const first = slides[0];
  const headline = String(first?.headline || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (headline) return headline.slice(0, 80);
  const body = String(first?.body || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (body) return body.slice(0, 80);
  if (creator) return `@${creator.replace(/^@/, '')}`;
  if (sourceUrl) return sourceUrl.replace(/^https?:\/\//, '').slice(0, 80);
  return 'Untitled project';
}

function emptyStore(): Store {
  return { activeId: '', projects: [] };
}

function normalizePhoto(input: Partial<StudioPhoto> | null | undefined): StudioPhoto | null {
  const id = String(input?.id || '').trim();
  const url = String(input?.url || '').trim();
  if (!id || !url) return null;
  return {
    id,
    url,
    thumbUrl: String(input?.thumbUrl || url).trim() || url,
    description: String(input?.description || ''),
    query: String(input?.query || ''),
  };
}

export function normalizeStudioProject(input: Partial<StudioProject> | null | undefined): StudioProject | null {
  const id = String(input?.id || '').trim();
  if (!id) return null;
  const slides = Array.isArray(input?.slides)
    ? input!.slides.map((s, i) => ({
        index: Number(s?.index || i + 1),
        headline: s?.headline ? String(s.headline) : undefined,
        body: String(s?.body || ''),
      }))
    : [];
  const selected = (input?.selected || []).map(normalizePhoto).filter(Boolean) as StudioPhoto[];
  const photos = (input?.photos || []).map(normalizePhoto).filter(Boolean) as StudioPhoto[];
  const createdAt = String(input?.createdAt || nowIso());
  const sourceUrl = String(input?.sourceUrl || '').trim();
  const creator = String(input?.creator || '').trim();
  const title =
    String(input?.title || '').trim() || projectTitleFromSlides(slides, creator, sourceUrl);

  return {
    id,
    createdAt,
    updatedAt: String(input?.updatedAt || createdAt),
    sourceUrl,
    creator,
    views: Number(input?.views || 0) || 0,
    slides,
    caption: String(input?.caption || ''),
    selected,
    photos,
    slide6DataUrl: String(input?.slide6DataUrl || ''),
    slide6Name: String(input?.slide6Name || ''),
    searchQuery: String(input?.searchQuery || ''),
    title,
  };
}

function readStore(): Store {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<Store>;
    const projects = (parsed.projects || [])
      .map((p) => normalizeStudioProject(p))
      .filter(Boolean) as StudioProject[];
    let activeId = String(parsed.activeId || '').trim();
    if (activeId && !projects.some((p) => p.id === activeId)) activeId = '';
    return { activeId, projects };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: Store): Store {
  if (typeof window === 'undefined') return store;
  const trimmed: Store = {
    activeId: store.activeId,
    projects: store.projects.slice(0, MAX_PROJECTS),
  };

  const tryWrite = (payload: Store) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  };

  try {
    tryWrite(trimmed);
    return trimmed;
  } catch {
    // Quota: drop promo screenshots from older projects first
    const slimmed: Store = {
      activeId: trimmed.activeId,
      projects: trimmed.projects.map((p, i) =>
        i === 0
          ? p
          : {
              ...p,
              slide6DataUrl: '',
              slide6Name: p.slide6Name ? `${p.slide6Name} (re-upload needed)` : '',
            }
      ),
    };
    try {
      tryWrite(slimmed);
      return slimmed;
    } catch {
      const minimal: Store = {
        activeId: trimmed.activeId,
        projects: trimmed.projects.slice(0, 8).map((p, i) => ({
          ...p,
          photos: i === 0 ? p.photos.slice(0, 24) : [],
          slide6DataUrl: i === 0 ? p.slide6DataUrl : '',
          slide6Name: i === 0 ? p.slide6Name : '',
        })),
      };
      tryWrite(minimal);
      return minimal;
    }
  }
}

export function listStudioProjects(): StudioProject[] {
  return readStore().projects;
}

export function getActiveStudioProjectId(): string {
  return readStore().activeId;
}

export function getStudioProject(id: string): StudioProject | null {
  const store = readStore();
  return store.projects.find((p) => p.id === id) || null;
}

export function getActiveStudioProject(): StudioProject | null {
  const store = readStore();
  if (!store.activeId) return store.projects[0] || null;
  return store.projects.find((p) => p.id === store.activeId) || store.projects[0] || null;
}

export function setActiveStudioProjectId(id: string): void {
  const store = readStore();
  if (!id || !store.projects.some((p) => p.id === id)) {
    writeStore({ ...store, activeId: '' });
    return;
  }
  writeStore({ ...store, activeId: id });
}

export function upsertStudioProject(
  input: Partial<StudioProject> & {
    sourceUrl?: string;
    slides: StudioSlideText[];
  },
  opts?: { makeActive?: boolean }
): StudioProject {
  const store = readStore();
  const existing = input.id ? store.projects.find((p) => p.id === input.id) : undefined;
  const id = existing?.id || input.id || makeId();
  const createdAt = existing?.createdAt || input.createdAt || nowIso();
  const next = normalizeStudioProject({
    ...existing,
    ...input,
    id,
    createdAt,
    updatedAt: nowIso(),
    title:
      input.title ||
      existing?.title ||
      projectTitleFromSlides(input.slides, input.creator || existing?.creator, input.sourceUrl),
  });
  if (!next) throw new Error('Could not save project');

  const projects = [next, ...store.projects.filter((p) => p.id !== next.id)].slice(0, MAX_PROJECTS);
  writeStore({
    activeId: opts?.makeActive === false ? store.activeId : next.id,
    projects,
  });
  return next;
}

export function createStudioProjectFromImport(input: {
  sourceUrl: string;
  creator: string;
  views: number;
  slides: StudioSlideText[];
  caption: string;
  photos?: StudioPhoto[];
  searchQuery?: string;
}): StudioProject {
  return upsertStudioProject(
    {
      sourceUrl: input.sourceUrl,
      creator: input.creator,
      views: input.views,
      slides: input.slides,
      caption: input.caption,
      photos: input.photos || [],
      selected: [],
      slide6DataUrl: '',
      slide6Name: '',
      searchQuery: input.searchQuery || '',
    },
    { makeActive: true }
  );
}

export function patchActiveStudioProject(
  patch: Partial<
    Pick<
      StudioProject,
      | 'caption'
      | 'selected'
      | 'photos'
      | 'slide6DataUrl'
      | 'slide6Name'
      | 'searchQuery'
      | 'slides'
      | 'sourceUrl'
      | 'creator'
      | 'views'
    >
  >
): StudioProject | null {
  const active = getActiveStudioProject();
  if (!active) return null;
  return upsertStudioProject({ ...active, ...patch }, { makeActive: true });
}

export function deleteStudioProject(id: string): void {
  const store = readStore();
  const projects = store.projects.filter((p) => p.id !== id);
  const activeId = store.activeId === id ? projects[0]?.id || '' : store.activeId;
  writeStore({ activeId, projects });
}

export function clearActiveStudioProject(): void {
  const store = readStore();
  writeStore({ ...store, activeId: '' });
}
