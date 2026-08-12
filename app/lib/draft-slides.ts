export type SlideText = { index: number; headline?: string; body: string };

export function slidesToTranscript(slides: SlideText[]): string {
  return slides
    .map((slide) => {
      const headline = String(slide.headline || '').trim();
      const body = String(slide.body || '').trim();
      const lines = [`Slide ${slide.index}`];
      if (headline) lines.push(headline);
      if (body) lines.push(body);
      return lines.join('\n');
    })
    .join('\n\n')
    .trim();
}

/** Turn a Content Engine script into Studio slide rows. */
export function scriptToSlides(script: string, cta?: string | null): SlideText[] {
  const cleaned = String(script || '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!cleaned) return [];

  const chunks = cleaned
    .split(/\n(?=(?:slide\s*\d+[:.)-]?|\d+[.)])\s+)/i)
    .map((chunk) =>
      chunk
        .replace(/^(?:slide\s*\d+[:.)-]?|\d+[.)])\s*/i, '')
        .trim()
    )
    .filter(Boolean);

  const source = chunks.length >= 2 ? chunks : cleaned.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const slides: SlideText[] = source.slice(0, 5).map((text, i) => {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      index: i + 1,
      headline: lines[0] || undefined,
      body: lines.slice(1).join('\n'),
    };
  });

  const last = slides[slides.length - 1];
  const ctaText = String(cta || '').trim();
  if (ctaText && last && !/felar/i.test(`${last.headline || ''} ${last.body}`)) {
    const ctaLines = ctaText.split('\n').map((line) => line.trim()).filter(Boolean);
    slides.push({
      index: slides.length + 1,
      headline: ctaLines[0],
      body: ctaLines.slice(1).join('\n'),
    });
  }

  return slides.map((slide, i) => ({ ...slide, index: i + 1 }));
}
