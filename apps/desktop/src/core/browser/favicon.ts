/** A page's declared icons arrive unordered and without sizes; names are the only hint. */
const rank = (url: string): number => {
  if (/^data:/i.test(url)) return 5;
  const name = url.replace(/[?#].*$/, '').toLowerCase();
  if (/\.(png|webp)$/.test(name) && /(?:^|\D)(32|48|64)(?:\D|$)/.test(name.slice(name.lastIndexOf('/') + 1))) return 4;
  if (name.endsWith('.svg')) return 3;
  if (/\.(png|webp)$/.test(name)) return 2;
  return name.endsWith('.ico') ? 1 : 0;
};
export const FAVICON_LIMITS = { candidates: 3, bytes: 512 * 1024, url: 4096, dataUrl: 96 * 1024 } as const;

/** The icons worth trying for a tab, best first: small bitmaps, then vectors, then the classic favicon.ico. */
export function faviconCandidates(urls: readonly string[]): string[] {
  const usable = [...new Set(urls)].filter(url => typeof url === 'string'
    && (/^https?:\/\//i.test(url) ? url.length <= FAVICON_LIMITS.url : /^data:image\//i.test(url) && url.length <= FAVICON_LIMITS.dataUrl));
  return usable.map((url, index) => ({ url, index, score: rank(url) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, FAVICON_LIMITS.candidates).map(item => item.url);
}

/** Run in a page: the icons it declares, as the browser engine reports them. A page of a website that names none has the site's `/favicon.ico`. */
export const declaredIcons = `(() => {
  const icons = [...document.querySelectorAll('link[rel~="icon" i][href]')].slice(0, 16).map(link => link.href);
  return icons.length ? icons : [new URL('/favicon.ico', location.href).href];
})()`;

/** Bytes of a `data:image/…` icon, or null when it is not one this application decodes. */
export function dataIcon(url: string): { bytes: Uint8Array; type: string } | null {
  const match = /^data:(image\/[\w.+-]+)((?:;[\w=.+-]+)*?)(;base64)?,(.*)$/is.exec(url);
  if (!match) return null;
  try {
    const bytes = match[3] ? Uint8Array.from(atob(match[4].replace(/\s+/g, '')), char => char.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(match[4]));
    return bytes.length ? { bytes, type: match[1].toLowerCase() } : null;
  } catch { return null; }
}

/** SVG must be labelled to be decoded as an image; bitmaps are recognized from their bytes. */
export function iconType(url: string, contentType: string | null): string {
  return /svg/i.test(contentType ?? '') || /\.svg(?:$|[?#])/i.test(url) ? 'image/svg+xml' : '';
}
