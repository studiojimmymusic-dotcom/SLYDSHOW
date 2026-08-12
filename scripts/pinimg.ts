const PINIMG_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://www.pinterest.com/',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

function withExt(url: string, ext: string): string {
  return url.replace(/\.(jpe?g|png|webp)(\?.*)?$/i, `.${ext}$2`);
}

function withSize(url: string, size: string): string {
  return url.replace(/\/(originals|\d+x)\//i, `/${size}/`);
}

export function toThumbUrl(url: string): string {
  return withExt(withSize(url, '474x'), 'jpg');
}

export function pinImageFallbacks(url: string): string[] {
  const out: string[] = [];
  const add = (next: string) => {
    if (next && !out.includes(next)) out.push(next);
  };

  add(url);
  add(withExt(url, 'jpg'));
  add(toThumbUrl(url));
  add(withExt(withSize(url, '736x'), 'jpg'));
  add(withSize(url, 'originals'));
  add(withExt(withSize(url, 'originals'), 'png'));
  add(withExt(withSize(url, 'originals'), 'jpg'));
  return out;
}

export async function fetchPinImage(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  for (const candidate of pinImageFallbacks(url)) {
    try {
      const res = await fetch(candidate, { headers: PINIMG_HEADERS, redirect: 'follow' });
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') || '';
      if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 100) continue;
      return {
        buffer,
        contentType: contentType.startsWith('image/') ? contentType : 'image/jpeg',
      };
    } catch {
      continue;
    }
  }
  return null;
}
