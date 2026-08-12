'use client';

import { useEffect, useRef, useState } from 'react';
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

function OverlayLayer({
  copy,
  style,
  onStyleChange,
}: {
  copy: EditorSlideCopy;
  style: EditorSlideStyle;
  onStyleChange: (next: EditorSlideStyle) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const styleRef = useRef(style);
  styleRef.current = style;
  const [width, setWidth] = useState(320);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const sync = () => setWidth(el.clientWidth || 320);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current || !frameRef.current) return;
      const rect = frameRef.current.getBoundingClientRect();
      const y = (e.clientY - rect.top) / rect.height;
      onStyleChange({
        ...styleRef.current,
        textPositionFromTop: Math.min(0.72, Math.max(0.04, y)),
      });
    }
    function onUp() {
      dragging.current = false;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onStyleChange]);

  const headline = copy.headline.trim();
  const body = copy.body.trim();
  const headPx = Math.max(12, width * style.headSizePercent);
  const bodyPx = Math.max(12, width * style.bodySizePercent);

  return (
    <div ref={frameRef} className="absolute inset-0 select-none">
      <div
        className="absolute z-10 flex cursor-grab flex-col items-center active:cursor-grabbing"
        style={{
          top: `${style.textPositionFromTop * 100}%`,
          width: `${style.maxWidthPercent * 100}%`,
          left: `${((1 - style.maxWidthPercent) / 2) * 100}%`,
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          dragging.current = true;
        }}
      >
        {headline ? (
          style.showHeadlineBox ? (
            <span
              className="mb-3 inline-block max-w-full rounded-full bg-white px-[0.7em] py-[0.28em] text-center font-bold uppercase leading-tight tracking-wide text-[#111]"
              style={{
                fontFamily: 'var(--font-slide-overlay), sans-serif',
                fontSize: `${headPx}px`,
              }}
            >
              {headline}
            </span>
          ) : (
            <p
              className="mb-3 text-center font-bold uppercase leading-tight tracking-wide text-white"
              style={{
                fontFamily: 'var(--font-slide-overlay), sans-serif',
                fontSize: `${headPx}px`,
                textShadow:
                  '0 0 2px #000, 0 0 4px #000, 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000',
              }}
            >
              {headline}
            </p>
          )
        ) : null}
        {body ? (
          <p
            className="whitespace-pre-wrap text-center font-bold leading-[1.28] text-white"
            style={{
              fontFamily: 'var(--font-slide-overlay), sans-serif',
              fontSize: `${bodyPx}px`,
              textShadow:
                '0 0 3px #000, 0 0 6px #000, 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000',
            }}
          >
            {body}
          </p>
        ) : null}
      </div>
    </div>
  );
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-medium tracking-tight text-text-primary">
            Editor
          </h1>
          <p className="mt-1 text-[14px] text-text-secondary">
            Drag text to move it. Tune size and width, then Share to burn it onto the photos.
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
          <div className="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-[18px] bg-black">
            <img
              src={proxied(previews[active]?.src || '')}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            {style ? (
              <OverlayLayer
                copy={copy}
                style={style}
                onStyleChange={(next) => onStyleChange(active, next)}
              />
            ) : null}
          </div>
          <p className="mt-3 text-center text-[12px] text-text-tertiary">
            Drag the text block up or down
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
              placeholder="Headline (optional)"
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
                  max={72}
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
                  min={50}
                  max={95}
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
                  min={35}
                  max={90}
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
                  min={30}
                  max={70}
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
            White pill behind title
          </label>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              Caption
            </label>
            <textarea
              value={caption}
              onChange={(e) => onCaptionChange(e.target.value)}
              className="min-h-24 w-full resize-y rounded-card border border-border bg-background px-3 py-2.5 text-[13px] leading-5 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
