'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, fieldClassName } from './ui';
import type { EditorSlideCopy, EditorSlideStyle } from '../lib/slide-style';

type SlidePreview = {
  key: string;
  src: string;
  label: string;
};

function proxied(url: string): string {
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `/api/image?url=${encodeURIComponent(url)}`;
}

function imagePayloadForPreview(src: string): { imageUrl?: string; imageDataUrl?: string } {
  if (src.startsWith('data:')) return { imageDataUrl: src };
  if (src.startsWith('/api/image?')) {
    try {
      const q = new URL(src, 'http://local').searchParams.get('url');
      if (q) return { imageUrl: q };
    } catch {
      // fall through
    }
  }
  if (src.startsWith('http')) return { imageUrl: src };
  return { imageUrl: src };
}

export function SlideEditor({
  previews,
  copies,
  styles,
  activeIndex,
  onActiveIndex,
  onCopyChange,
  onStyleChange,
  caption,
  onCaptionChange,
  onBack,
  onShare,
  busy,
  shareDisabled,
}: {
  previews: SlidePreview[];
  copies: EditorSlideCopy[];
  styles: EditorSlideStyle[];
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onCopyChange: (index: number, next: EditorSlideCopy) => void;
  onStyleChange: (index: number, next: EditorSlideStyle) => void;
  caption: string;
  onCaptionChange: (value: string) => void;
  onBack: () => void;
  onShare: () => void;
  busy: boolean;
  shareDisabled: boolean;
}) {
  const active = Math.min(Math.max(0, activeIndex), Math.max(0, previews.length - 1));
  const copy = copies[active] || { headline: '', body: '' };
  const style = styles[active];
  const previewSrc = previews[active]?.src || '';

  const [renderedPreview, setRenderedPreview] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const dragRef = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef(style);
  styleRef.current = style;

  const refreshPreview = useCallback(async () => {
    if (!previewSrc || !style) return;
    setPreviewBusy(true);
    try {
      const imagePayload = imagePayloadForPreview(
        previewSrc.startsWith('data:') ? previewSrc : proxied(previewSrc)
      );
      const res = await fetch('/api/preview-overlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...imagePayload,
          headline: copy.headline,
          body: copy.body,
          style,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setRenderedPreview(String(data.previewDataUrl || ''));
    } catch {
      setRenderedPreview('');
    } finally {
      setPreviewBusy(false);
    }
  }, [previewSrc, copy.headline, copy.body, style]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshPreview();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [refreshPreview]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragRef.current || !frameRef.current) return;
      const rect = frameRef.current.getBoundingClientRect();
      const y = (e.clientY - rect.top) / rect.height;
      onStyleChange(active, {
        ...styleRef.current,
        textPositionFromTop: Math.min(0.55, Math.max(0.04, y)),
      });
    }
    function onUp() {
      if (dragRef.current) {
        dragRef.current = false;
        void refreshPreview();
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [active, onStyleChange, refreshPreview]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-medium tracking-tight text-text-primary">
            Editor
          </h1>
          <p className="mt-1 text-[14px] text-text-secondary">
            TikTok-style preview — drag text up or down, then Share to burn it onto the photos.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button type="button" onClick={onShare} disabled={busy || shareDisabled}>
            {busy ? 'Sharing…' : 'Share'}
          </Button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {previews.map((preview, i) => (
          <button
            key={preview.key}
            type="button"
            onClick={() => onActiveIndex(i)}
            className={`relative w-[72px] shrink-0 overflow-hidden rounded-card border ${
              i === active ? 'border-accent ring-2 ring-accent/30' : 'border-border'
            }`}
          >
            <img src={proxied(preview.src)} alt="" className="aspect-[9/16] w-full object-cover" />
            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
              {preview.label}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_1fr]">
        <section className="rounded-xl border border-border bg-background p-4 shadow-[0_1px_2px_rgba(20,19,17,0.03)]">
          <div
            ref={frameRef}
            className="relative mx-auto aspect-[9/16] w-full max-w-[320px] cursor-grab overflow-hidden rounded-[18px] bg-black active:cursor-grabbing"
            onPointerDown={(e) => {
              e.preventDefault();
              dragRef.current = true;
            }}
          >
            {renderedPreview ? (
              <img
                src={renderedPreview}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <img
                src={proxied(previewSrc)}
                alt=""
                className="h-full w-full object-cover opacity-60"
                draggable={false}
              />
            )}
            {previewBusy ? (
              <div className="absolute inset-0 grid place-items-center bg-black/20">
                <span className="rounded-full bg-black/50 px-3 py-1 text-[11px] text-white">
                  Updating…
                </span>
              </div>
            ) : null}
          </div>
          <p className="mt-3 text-center text-[12px] text-text-tertiary">
            Drag on the preview to move text (TikTok Sans, same as final export)
          </p>
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-background p-5 shadow-[0_1px_2px_rgba(20,19,17,0.03)]">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              Title
            </label>
            <input
              value={copy.headline}
              onChange={(e) => onCopyChange(active, { ...copy, headline: e.target.value })}
              className={fieldClassName}
              placeholder="e.g. 1. STUDY SONGS YOU LOVE."
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              Body
            </label>
            <textarea
              value={copy.body}
              onChange={(e) => onCopyChange(active, { ...copy, body: e.target.value })}
              className="min-h-28 w-full resize-y rounded-card border border-border bg-background px-3 py-2.5 text-[13px] leading-5 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              placeholder="Body text"
            />
          </div>

          {style ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-[12px] text-text-secondary">
                Vertical position
                <input
                  type="range"
                  min={4}
                  max={55}
                  value={Math.round(style.textPositionFromTop * 100)}
                  onChange={(e) =>
                    onStyleChange(active, {
                      ...style,
                      textPositionFromTop: Number(e.target.value) / 100,
                    })
                  }
                  className="mt-2 w-full"
                />
              </label>
              <label className="block text-[12px] text-text-secondary">
                Text width
                <input
                  type="range"
                  min={60}
                  max={92}
                  value={Math.round(style.maxWidthPercent * 100)}
                  onChange={(e) =>
                    onStyleChange(active, {
                      ...style,
                      maxWidthPercent: Number(e.target.value) / 100,
                    })
                  }
                  className="mt-2 w-full"
                />
              </label>
              <label className="block text-[12px] text-text-secondary">
                Body size
                <input
                  type="range"
                  min={42}
                  max={68}
                  value={Math.round(style.bodySizePercent * 1000)}
                  onChange={(e) =>
                    onStyleChange(active, {
                      ...style,
                      bodySizePercent: Number(e.target.value) / 1000,
                    })
                  }
                  className="mt-2 w-full"
                />
              </label>
              <label className="block text-[12px] text-text-secondary">
                Title size
                <input
                  type="range"
                  min={36}
                  max={52}
                  value={Math.round(style.headSizePercent * 1000)}
                  onChange={(e) =>
                    onStyleChange(active, {
                      ...style,
                      headSizePercent: Number(e.target.value) / 1000,
                    })
                  }
                  className="mt-2 w-full"
                />
              </label>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-[13px] text-text-primary">
            <input
              type="checkbox"
              checked={style?.showHeadlineBox !== false}
              onChange={(e) =>
                style &&
                onStyleChange(active, {
                  ...style,
                  showHeadlineBox: e.target.checked,
                })
              }
            />
            White pill behind title (TikTok default)
          </label>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              Caption (copy into TikTok)
            </label>
            <textarea
              value={caption}
              onChange={(e) => onCaptionChange(e.target.value)}
              className="min-h-40 w-full resize-y rounded-card border border-border bg-background px-3 py-2.5 font-mono text-[12px] leading-5 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
