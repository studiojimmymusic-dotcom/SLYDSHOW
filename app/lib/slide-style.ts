export type EditorSlideStyle = {
  textPositionFromTop: number;
  maxWidthPercent: number;
  bodySizePercent: number;
  headSizePercent: number;
  showHeadlineBox: boolean;
};

export type EditorSlideCopy = {
  headline: string;
  body: string;
};

export const DEFAULT_SLIDE_STYLE: EditorSlideStyle = {
  textPositionFromTop: 0.2,
  maxWidthPercent: 0.84,
  bodySizePercent: 0.05,
  headSizePercent: 0.046,
  showHeadlineBox: true,
};

export const FELAR_SLIDE6: EditorSlideCopy = {
  headline: 'BUILD YOUR BEAT STORE',
  body: 'on FELAR\nusefelar.com',
};

export function makeDefaultStyles(count = 6): EditorSlideStyle[] {
  return Array.from({ length: count }, () => ({ ...DEFAULT_SLIDE_STYLE }));
}

/** Compress / normalize an uploaded screenshot to a JPEG data URL for slide 6. */
export async function fileToSlideDataUrl(file: File, maxSide = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare slide 6 image');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.9);
}
