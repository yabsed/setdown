import { dataIcon, FAVICON_LIMITS, faviconCandidates, iconType } from '../../core/browser/favicon';

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;
type Decode = (bytes: Uint8Array, type: string) => Promise<string | null>;

/**
 * Site icons for tabs. The bytes come through the page's own browser session
 * and are decoded and scaled in the sandboxed library host: this process never
 * parses a website's image, and the shell only ever receives a small PNG.
 */
export class BrowserFavicons {
  private readonly icons = new Map<string, Promise<string | null>>();
  constructor(private readonly fetch: Fetch, private readonly decode: Decode) {}

  /** The first of a page's declared icons that loads and decodes, as a PNG data URL. */
  async resolve(urls: readonly string[]): Promise<string | null> {
    for (const url of faviconCandidates(urls)) {
      const icon = await this.icon(url);
      if (icon) return icon;
    }
    return null;
  }

  private icon(url: string): Promise<string | null> {
    const known = this.icons.get(url);
    if (known) { this.icons.delete(url); this.icons.set(url, known); return known; }
    const task = this.load(url).catch(() => null);
    this.icons.set(url, task);
    if (this.icons.size > 256) this.icons.delete(this.icons.keys().next().value!);
    // A failure may be temporary (offline, a sign-in redirect): ask again next time.
    void task.then(icon => { if (!icon && this.icons.get(url) === task) this.icons.delete(url); });
    return task;
  }

  private async load(url: string): Promise<string | null> {
    if (/^data:/i.test(url)) { const icon = dataIcon(url); return icon ? this.decode(icon.bytes, icon.type === 'image/svg+xml' ? icon.type : '') : null; }
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10_000);
    try {
      const response = await this.fetch(url, { signal: abort.signal });
      if (!response.ok || !response.body) return null;
      const chunks: Uint8Array[] = [], reader = response.body.getReader();
      for (let total = 0;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > FAVICON_LIMITS.bytes) { abort.abort(); return null; }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      return bytes.length ? await this.decode(bytes, iconType(url, response.headers.get('content-type'))) : null;
    } finally { clearTimeout(timer); }
  }
}
