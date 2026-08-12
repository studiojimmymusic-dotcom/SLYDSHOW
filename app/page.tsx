'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { DeskShell } from './components/desk-shell';
import { Button, fieldClassName } from './components/ui';
import { readNdjsonStream } from './lib/ndjson';
import { loadLocalDeskSettings } from './lib/desk-settings-client';
import {
  EditorSlideCopy,
  FELAR_CTA_SLIDE,
  buildPasteCaption,
  contentSlideCount,
  fileToSlideDataUrl,
  totalSlideCount,
} from './lib/slide-style';
import {
  clearActiveStudioProject,
  createStudioProjectFromImport,
  getActiveStudioProject,
  getStudioProject,
  patchActiveStudioProject,
  setActiveStudioProjectId,
  type StudioProject,
} from './lib/studio-projects';

type SlideText = { index: number; headline?: string; body: string };
type Photo = { id: string; url: string; thumbUrl: string; description: string; query: string };
type TikTokAccount = { id: string; label: string };
type ShareMode = 'zernio' | 'inbox';

function proxied(url: string): string {
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `/api/image?url=${encodeURIComponent(url)}`;
}

function flowText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isTitleWord(word: string): boolean {
  if (!word) return false;
  if (/^[A-Z0-9][A-Z0-9'’\-]*$/.test(word)) return true;
  if (/^[A-Z][a-z'’\-]*$/.test(word)) return true;
  if (/^\d+\.?$/.test(word)) return true;
  return false;
}

/** Fix OCR wrapping a title across Title + Body. */
function repairSlide(slide: SlideText): { title: string; body: string } {
  let headline = flowText(slide.headline || '');
  let body = flowText(slide.body || '');

  const incompleteTitle =
    /^(how to|why |what |nobody |stop |don't |dont )/i.test(headline) && !/[.!?]$/.test(headline);
  const looksTruncated =
    incompleteTitle ||
    (headline.split(/\s+/).filter(Boolean).length <= 5 &&
      !/[.!?]$/.test(headline) &&
      isTitleWord(body.split(/\s+/)[0] || ''));

  if (looksTruncated && headline && body) {
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
    if (titleExtra.length) {
      headline = flowText(`${headline} ${titleExtra.join(' ')}`);
      body = flowText(words.slice(i).join(' '));
    }
  }

  return {
    title: headline ? headline.toUpperCase() : '',
    body,
  };
}

function buildEditorCopies(slides: SlideText[]): EditorSlideCopy[] {
  const needed = contentSlideCount(slides.length);
  const copies: EditorSlideCopy[] = [];
  for (let i = 0; i < needed; i++) {
    const slide = slides[i];
    if (!slide) {
      copies.push({ headline: '', body: '' });
      continue;
    }
    const fixed = repairSlide(slide);
    copies.push({ headline: fixed.title, body: fixed.body });
  }
  copies.push({ ...FELAR_CTA_SLIDE });
  return copies;
}

function PhotoImg({
  src,
  fallback,
  className,
}: {
  src: string;
  fallback?: string;
  className?: string;
}) {
  return (
    <img
      src={proxied(src)}
      alt=""
      className={className}
      onError={(e) => {
        const img = e.currentTarget;
        if (fallback && img.dataset.fallback !== '1') {
          img.dataset.fallback = '1';
          img.src = proxied(fallback);
          return;
        }
        img.style.visibility = 'hidden';
      }}
    />
  );
}

export default function StudioDeskPage() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [creator, setCreator] = useState('');
  const [views, setViews] = useState(0);
  const [slides, setSlides] = useState<SlideText[]>([]);
  const [caption, setCaption] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selected, setSelected] = useState<Photo[]>([]);
  const [slide6DataUrl, setSlide6DataUrl] = useState('');
  const [slide6Name, setSlide6Name] = useState('');
  const [posted, setPosted] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState('');
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [shareMode, setShareMode] = useState<ShareMode>('inbox');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const slide6InputRef = useRef<HTMLInputElement>(null);
  const skipNextSave = useRef(false);

  function pushLog(message: string) {
    setStatus(message);
    setLogLines((prev) => [...prev.slice(-40), message]);
  }

  function applyProject(project: StudioProject, note?: string) {
    skipNextSave.current = true;
    setProjectId(project.id);
    setProjectTitle(project.title);
    setUrl(project.sourceUrl);
    setCreator(project.creator);
    setViews(project.views);
    setSlides(project.slides);
    setCaption(project.caption);
    setSelected(project.selected);
    setPhotos(project.photos);
    setSlide6DataUrl(project.slide6DataUrl);
    setSlide6Name(project.slide6Name);
    setSearchQuery(project.searchQuery);
    setActiveStudioProjectId(project.id);
    if (note) pushLog(note);
  }

  function startBlankProject() {
    skipNextSave.current = true;
    clearActiveStudioProject();
    setProjectId('');
    setProjectTitle('');
    setUrl('');
    setCreator('');
    setViews(0);
    setSlides([]);
    setCaption('');
    setSelected([]);
    setPhotos([]);
    setSlide6DataUrl('');
    setSlide6Name('');
    setSearchQuery('');
    setPosted('');
    setLogLines([]);
    setStatus('New project — paste a TikTok photo URL');
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/');
    }
  }

  useEffect(() => {
    const local = loadLocalDeskSettings();
    if (local?.accounts.length) {
      setAccounts(local.accounts);
      setAccountId(local.activeAccountId || local.accounts[0]?.id || '');
      if (local.tiktokPostMode === 'zernio' || local.tiktokPostMode === 'inbox') {
        setShareMode(local.tiktokPostMode);
      }
    } else {
      void (async () => {
        try {
          const res = await fetch('/api/settings');
          const data = await res.json();
          if (!res.ok) return;
          const list = (data.accounts || []) as TikTokAccount[];
          setAccounts(list);
          setAccountId(data.activeAccountId || list[0]?.id || '');
          if (data.tiktokPostMode === 'zernio' || data.tiktokPostMode === 'inbox') {
            setShareMode(data.tiktokPostMode);
          }
        } catch {
          // keep empty — Share will surface the settings error
        }
      })();
    }

    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('project') || '';
    const project = (fromUrl && getStudioProject(fromUrl)) || getActiveStudioProject();
    if (project) {
      applyProject(project, `Restored project: ${project.title}`);
      if (fromUrl && fromUrl === project.id) {
        window.history.replaceState({}, '', `/?project=${encodeURIComponent(project.id)}`);
      }
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated || !projectId) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const saved = patchActiveStudioProject({
      sourceUrl: url,
      creator,
      views,
      slides,
      caption,
      selected,
      photos,
      slide6DataUrl,
      slide6Name,
      searchQuery,
    });
    if (saved) setProjectTitle(saved.title);
  }, [
    hydrated,
    projectId,
    url,
    creator,
    views,
    slides,
    caption,
    selected,
    photos,
    slide6DataUrl,
    slide6Name,
    searchQuery,
  ]);

  const photoSlots = slides.length ? contentSlideCount(slides.length) : 0;
  const totalSlots = photoSlots ? totalSlideCount(photoSlots) : 0;
  const promoSlot = totalSlots;

  const canShare =
    photoSlots > 0 && selected.length === photoSlots && Boolean(slide6DataUrl) && Boolean(accountId);

  async function analyze(e?: FormEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (busy || !url.trim()) return;

    setBusy(true);
    setPosted('');
    setSelected([]);
    setSlide6DataUrl('');
    setSlide6Name('');
    setLogLines([]);
    skipNextSave.current = true;
    setProjectId('');
    setProjectTitle('');

    pushLog('Starting import…');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await readNdjsonStream(res, pushLog);
      setCreator(String(data.creator || ''));
      setViews(Number(data.views || 0));
      const importedSlides = (data.slides || []) as SlideText[];
      setSlides(importedSlides);
      const copies = buildEditorCopies(importedSlides);
      const nextCaption = buildPasteCaption(copies);
      setCaption(nextCaption);
      pushLog(
        `Need ${contentSlideCount(importedSlides.length)} photos + app screenshot as last slide.`
      );
      pushLog('Finding studio photos…');
      const importedPhotos = await loadPhotos({
        replace: true,
        exclude: [],
        query: searchQuery,
        keepBusy: true,
      });
      const project = createStudioProjectFromImport({
        sourceUrl: url.trim(),
        creator: String(data.creator || ''),
        views: Number(data.views || 0),
        slides: importedSlides,
        caption: nextCaption,
        photos: importedPhotos,
        searchQuery,
      });
      skipNextSave.current = true;
      setProjectId(project.id);
      setProjectTitle(project.title);
      window.history.replaceState({}, '', `/?project=${encodeURIComponent(project.id)}`);
      pushLog(`Saved project: ${project.title}`);
      pushLog('Import complete');
    } catch (error) {
      pushLog(error instanceof Error ? error.message : 'Analyze failed');
    } finally {
      setBusy(false);
    }
  }

  async function searchPhotos(e?: FormEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (busy) return;
    await loadPhotos({ replace: true, exclude: selected.map((p) => p.id), query: searchQuery });
  }

  async function loadPhotos(opts?: {
    replace?: boolean;
    exclude?: string[];
    query?: string;
    keepBusy?: boolean;
  }): Promise<Photo[]> {
    const replace = opts?.replace ?? false;
    const query = (opts?.query ?? searchQuery).trim();
    const exclude =
      opts?.exclude ??
      (replace ? selected.map((p) => p.id) : [...photos.map((p) => p.id), ...selected.map((p) => p.id)]);

    if (!opts?.keepBusy) {
      setBusy(true);
      setLogLines([]);
    }

    pushLog(query ? `Searching “${query}”…` : 'Finding photos…');
    try {
      const res = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 24, excludeKeys: exclude, query }),
      });
      const data = await readNdjsonStream(res, pushLog);
      const next = (data.photos || []) as Photo[];
      setPhotos((prev) =>
        replace ? next : [...prev, ...next.filter((p) => !prev.some((x) => x.id === p.id))]
      );
      pushLog(next.length ? `${next.length} photos ready` : 'No photos for that search');
      return next;
    } catch (error) {
      pushLog(error instanceof Error ? error.message : 'Photo search failed');
      return [];
    } finally {
      if (!opts?.keepBusy) setBusy(false);
    }
  }

  function togglePhoto(photo: Photo) {
    if (!photoSlots) {
      pushLog('Import a carousel first');
      return;
    }
    setSelected((prev) => {
      if (prev.some((p) => p.id === photo.id)) return prev.filter((p) => p.id !== photo.id);
      if (prev.length >= photoSlots) return prev;
      return [...prev, photo];
    });
  }

  async function onSlide6File(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await fileToSlideDataUrl(file);
      setSlide6DataUrl(dataUrl);
      setSlide6Name(file.name);
      pushLog(`Last slide ready: ${file.name}`);
    } catch (error) {
      pushLog(error instanceof Error ? error.message : 'Could not read screenshot');
    }
  }

  async function copyText(id: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(() => setCopied(''), 1200);
  }

  async function postDraft() {
    if (!canShare) {
      pushLog('Pick photos and upload the app screenshot first');
      return;
    }

    const imageUrls = selected.slice(0, photoSlots).map((p) => p.url);
    const imageIds = selected.slice(0, photoSlots).map((p) => p.id);

    const copies = buildEditorCopies(slides);
    const slidesPayload = copies.slice(0, totalSlots).map((c) => ({
      headline: c.headline.trim() || undefined,
      body: c.body,
    }));

    const captionPayload = caption.trim() || buildPasteCaption(copies);

    setBusy(true);
    setLogLines([]);

    const accountLabel = accounts.find((a) => a.id === accountId)?.label || accountId;
    pushLog(shareMode === 'zernio' ? `Sending to Zernio draft for ${accountLabel}…` : `Sending TikTok inbox draft to ${accountLabel}…`);
    pushLog(`Photos: ${imageIds.map((id) => id.split('/').pop() || id).join(', ')} + last slide upload`);

    try {
      const res = await fetch('/api/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrls,
          slides: slidesPayload,
          caption: captionPayload,
          lastSlideDataUrl: slide6DataUrl,
          accountId,
          mode: shareMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Post failed');

      if (Array.isArray(data.sourceKeys) && data.sourceKeys.length) {
        pushLog(
          `Uploaded: ${data.sourceKeys.map((k: string) => String(k).split('/').pop()).join(', ')}`
        );
      }

      if (shareMode === 'zernio') {
        setPosted(`Zernio draft saved for ${accountLabel}${data.zernioId ? ` (${data.zernioId})` : ''}.`);
        pushLog('Saved as Zernio draft (not sent to TikTok yet).');
      } else {
        setPosted(
          `Sent to @${accountLabel}. Open TikTok → Inbox → System notifications. Missing it? Retry from Posts.`
        );
        pushLog(`Creator Inbox upload accepted${data.title ? ` — "${data.title}"` : ''}`);
        pushLog('If nothing shows: open Posts → Retry inbox, or update TikTok and clear old pending uploads (max 5/day).');
        if (data.platformPostId) pushLog(`TikTok publish id: ${data.platformPostId}`);
      }
    } catch (error) {
      pushLog(error instanceof Error ? error.message : 'Post failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DeskShell
      footer={
        <span className="font-mono">
          {photoSlots
            ? `${selected.length}/${photoSlots} photos · slide ${promoSlot} ${slide6DataUrl ? 'ready' : 'needed'}`
            : 'Import a carousel to start'}
        </span>
      }
      headerLeft={status || 'Paste a TikTok photo URL to start'}
      headerRight={
        <>
          {accounts.length > 0 ? (
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={`${fieldClassName} max-w-[180px]`}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          ) : null}
          <select
            value={shareMode}
            onChange={(e) => setShareMode(e.target.value as ShareMode)}
            className={`${fieldClassName} max-w-[160px]`}
            aria-label="Share destination"
          >
            <option value="zernio">Zernio draft</option>
            <option value="inbox">TikTok inbox</option>
          </select>
          <Button type="button" onClick={() => void postDraft()} disabled={busy || !canShare}>
            Share
          </Button>
        </>
      }
    >
      <div className="mx-auto max-w-[1080px] space-y-5">
        {logLines.length > 0 ? (
          <section className="rounded-xl border border-border bg-background p-4 shadow-[0_1px_2px_rgba(20,19,17,0.03)]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">Activity</p>
              {busy ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary">
                  <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                  Running
                </span>
              ) : null}
            </div>
            <div className="panel-scroll max-h-40 space-y-1 overflow-y-auto font-mono text-[12px] leading-5 text-text-secondary">
              {logLines.map((line, i) => (
                <p key={`${i}-${line.slice(0, 24)}`} className={i === logLines.length - 1 ? 'text-text-primary' : undefined}>
                  {line}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        {posted ? <p className="rounded-xl border border-border bg-background px-5 py-3 text-[14px] text-success">{posted}</p> : null}

        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-[28px] font-medium tracking-tight text-text-primary">Studio</h1>
              <p className="mt-1 text-[14px] text-text-secondary">
                Pick photos, upload your app screenshot as the last slide, then Share. Add the text in TikTok.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {projectId ? (
                <p className="max-w-[220px] truncate text-[12px] text-text-secondary" title={projectTitle}>
                  Saved · {projectTitle || 'Project'}
                </p>
              ) : null}
              <Link
                href="/projects"
                className="rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-medium text-text-secondary hover:text-text-primary"
              >
                Projects
              </Link>
              <Button type="button" variant="secondary" onClick={startBlankProject} disabled={busy}>
                New project
              </Button>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void analyze();
              }
            }}
            placeholder="TikTok photo URL"
            className={`${fieldClassName} min-w-0 flex-1`}
          />
          <Button type="button" variant="secondary" disabled={busy || !url.trim()} onClick={() => void analyze()}>
            {busy ? 'Working' : 'Import'}
          </Button>
        </div>

        <section className="rounded-xl border border-border bg-background p-5 shadow-[0_1px_2px_rgba(20,19,17,0.03)]">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="font-sans text-[15px] font-semibold text-text-primary">Slides</h2>
            <p className="text-[13px] text-text-secondary">
              {creator ? `${creator} · ${views.toLocaleString()} views · ${photoSlots + 1} slides` : photoSlots ? `${photoSlots} photos + app screenshot` : 'Import a carousel first'}
            </p>
          </div>

          {photoSlots ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${totalSlots}, minmax(0, 1fr))` }}>
              {Array.from({ length: photoSlots }).map((_, i) => {
                const photo = selected[i];
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => photo && togglePhoto(photo)}
                    className="overflow-hidden rounded-card border border-border bg-surface text-left"
                  >
                    <div className="relative aspect-[9/16]">
                      {photo ? (
                        <PhotoImg src={photo.thumbUrl} fallback={photo.url} className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center font-mono text-[12px] text-text-tertiary">{i + 1}</div>
                      )}
                    </div>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => slide6InputRef.current?.click()}
                className="overflow-hidden rounded-card border border-dashed border-border bg-surface text-left"
              >
                <div className="relative aspect-[9/16]">
                  {slide6DataUrl ? (
                    <img src={slide6DataUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center gap-1 px-2 text-center">
                      <span className="font-mono text-[12px] text-text-tertiary">{promoSlot}</span>
                      <span className="text-[11px] leading-4 text-text-secondary">Upload app screenshot</span>
                    </div>
                  )}
                </div>
              </button>

              <input
                ref={slide6InputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  void onSlide6File(file);
                  e.target.value = '';
                }}
              />
            </div>
          ) : (
            <div className="grid h-28 place-items-center rounded-card border border-dashed border-border">
              <p className="px-6 text-center text-[13px] text-text-secondary">Slots appear after you import a TikTok carousel.</p>
            </div>
          )}

          {slide6Name ? (
            <p className="mt-3 text-[12px] text-text-secondary">
              Slide {promoSlot}: {slide6Name}{' '}
              <button
                type="button"
                className="font-semibold text-[#B87A12] hover:underline"
                onClick={() => {
                  setSlide6DataUrl('');
                  setSlide6Name('');
                }}
              >
                Remove
              </button>
            </p>
          ) : null}
        </section>

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <section className="rounded-xl border border-border bg-background p-5 shadow-[0_1px_2px_rgba(20,19,17,0.03)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-sans text-[15px] font-semibold text-text-primary">Photos</h2>
              <button
                type="button"
                onClick={() => void loadPhotos()}
                disabled={busy}
                className="text-[12px] font-semibold text-[#B87A12] hover:underline disabled:opacity-50"
              >
                More
              </button>
            </div>
            <div className="mb-4 flex gap-2">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    void searchPhotos();
                  }
                }}
                placeholder="Search photos"
                className={`${fieldClassName} min-w-0 flex-1`}
              />
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void searchPhotos()}>
                Search
              </Button>
            </div>

            {photos.length === 0 ? (
              <div className="grid h-40 place-items-center rounded-card border border-dashed border-border">
                <p className="px-6 text-center text-[13px] leading-5 text-text-secondary">Photos appear here after you import a post or search.</p>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {photos.map((photo) => {
                  const slot = selected.findIndex((p) => p.id === photo.id);
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => togglePhoto(photo)}
                      className="relative overflow-hidden rounded-card bg-surface"
                    >
                      <PhotoImg src={photo.thumbUrl} fallback={photo.url} className="aspect-square w-full object-cover" />
                      {slot >= 0 ? (
                        <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent font-mono text-[10px] font-medium text-dark-text-on-accent">
                          {slot + 1}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-background p-5 shadow-[0_1px_2px_rgba(20,19,17,0.03)]">
            <h2 className="font-sans text-[15px] font-semibold text-text-primary">Copy</h2>
            <p className="mt-1 text-[13px] text-text-secondary">Titles/body from the imported carousel. Copy into TikTok after you Share.</p>

            {slides.length === 0 ? (
              <p className="mt-5 text-[13px] leading-5 text-text-tertiary">Slide text shows here after import.</p>
            ) : (
              <div className="mt-5 divide-y divide-border">
                {slides.map((slide) => {
                  const { title, body } = repairSlide(slide);
                  return (
                    <div key={slide.index} className="py-3 first:pt-0 last:pb-0">
                      <span className="font-mono text-[11px] text-text-tertiary">Page {slide.index}</span>

                      {title ? (
                        <div className="mt-2">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">Title</span>
                            <button
                              type="button"
                              onClick={() => void copyText(`t${slide.index}`, title)}
                              className="text-[12px] font-semibold text-[#B87A12] hover:underline"
                            >
                              {copied === `t${slide.index}` ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <p className="text-[13px] font-semibold uppercase leading-5 tracking-wide text-text-primary">{title}</p>
                        </div>
                      ) : null}

                      {body ? (
                        <div className={title ? 'mt-3' : 'mt-2'}>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">Body</span>
                            <button
                              type="button"
                              onClick={() => void copyText(`b${slide.index}`, body)}
                              className="text-[12px] font-semibold text-[#B87A12] hover:underline"
                            >
                              {copied === `b${slide.index}` ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <p className="text-[13px] leading-5 text-text-primary">{body}</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {caption ? (
                  <div className="py-3 last:pb-0">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-text-tertiary">Caption</span>
                      <button
                        type="button"
                        onClick={() => void copyText('caption', caption)}
                        className="text-[12px] font-semibold text-[#B87A12] hover:underline"
                      >
                        {copied === 'caption' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <textarea
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      className="min-h-28 w-full resize-y rounded-card border border-border bg-background px-3 py-2.5 text-[13px] leading-5 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    />
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </DeskShell>
  );
}

