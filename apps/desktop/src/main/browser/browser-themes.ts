import { app, type WebContents, type WebFrameMain } from 'electron';
import { readFileSync, promises as fs } from 'node:fs';
import path from 'node:path';
import type { ThemeId } from '../../core/theme/theme-catalog';
import type { BrowserThemeSettings, BrowserThemeUpdate } from '../../protocol/browser-theme';

type Entry = { contents: WebContents; document: number };
type FrameState = { signature: string; token: number; document: number; url: string; requests: Set<AbortController>; bytes: number };
const webURL = (url: string) => /^https?:\/\//i.test(url);
export class BrowserThemes {
  private settings: BrowserThemeSettings = { mode: 'app', originalSites: [] };
  private loaded = false;
  private serial = 0;
  private saving = Promise.resolve();
  private frames = new WeakMap<WebFrameMain, FrameState>();
  private pending = new Map<WebContents, Set<AbortController>>();
  constructor(private readonly entries: () => Iterable<Entry>, private readonly theme: () => ThemeId,
    private readonly changed: (settings: BrowserThemeSettings) => void = () => {}) {}
  private file() { return path.join(app.getPath('userData'), 'browser-theme-settings.json'); }
  snapshot(): BrowserThemeSettings {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const value = JSON.parse(readFileSync(this.file(), 'utf8'));
        this.settings = { mode: value.mode === 'original' ? 'original' : 'app',
          originalSites: Array.isArray(value.originalSites) ? value.originalSites.filter((site: unknown) => typeof site === 'string' && webURL(site)).slice(0, 500) : [] };
      } catch { /* First run uses the app theme. */ }
    }
    return { ...this.settings, originalSites: [...this.settings.originalSites] };
  }
  async update(update: BrowserThemeUpdate, siteURL?: string): Promise<BrowserThemeSettings> {
    this.snapshot();
    if (update.mode === 'app' || update.mode === 'original') this.settings.mode = update.mode;
    if (update.site && siteURL && webURL(siteURL)) {
      const origin = new URL(siteURL).origin;
      this.settings.originalSites = this.settings.originalSites.filter(site => site !== origin);
      if (update.site.original) this.settings.originalSites.push(origin);
    }
    if (typeof update.restoreSite === 'string') this.settings.originalSites = this.settings.originalSites.filter(site => site !== update.restoreSite);
    this.refresh();
    this.changed(this.snapshot());
    const data = JSON.stringify(this.settings, null, 2), file = this.file();
    this.saving = this.saving.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, data); await fs.rename(`${file}.tmp`, file);
    });
    await this.saving;
    return this.snapshot();
  }
  refresh(): void {
    for (const entry of this.entries()) if (!entry.contents.isDestroyed())
      for (const frame of entry.contents.mainFrame.framesInSubtree) this.apply(entry, frame);
  }
  invalidateFrame(frame: WebFrameMain | null | undefined): void {
    if (!frame) return;
    for (const request of this.frames.get(frame)?.requests ?? []) request.abort();
    this.frames.delete(frame);
  }
  cancel(entry: Entry): void {
    for (const controller of this.pending.get(entry.contents) ?? []) controller.abort();
    this.pending.delete(entry.contents);
  }
  apply(entry: Entry, frame: WebFrameMain): void {
    if (frame.isDestroyed() || entry.contents.isDestroyed()) return;
    const topURL = entry.contents.getURL();
    if (!webURL(topURL) || (!webURL(frame.url) && !['about:blank', 'about:srcdoc'].includes(frame.url))) return;
    const settings = this.snapshot(), previous = this.frames.get(frame);
    const theme = settings.mode === 'app' && !settings.originalSites.includes(new URL(topURL).origin) ? this.theme() : null;
    const signature = JSON.stringify([theme, frame.url]);
    if (previous?.signature === signature && previous.document === entry.document) {
      frame.send('browser:theme-policy', { token: previous.token, url: webURL(frame.url) ? frame.url : topURL, theme });
      return;
    }
    for (const request of previous?.requests ?? []) request.abort();
    const state: FrameState = { signature, token: ++this.serial, document: entry.document, url: frame.url, requests: new Set(), bytes: 0 };
    this.frames.set(frame, state);
    frame.send('browser:theme-policy', { token: state.token, url: webURL(frame.url) ? frame.url : topURL,
      theme });
  }
  async fetch(entry: Entry, frame: WebFrameMain, request: { url?: unknown; token?: unknown }) {
    const state = this.frames.get(frame);
    if (!state || request?.token !== state.token || state.document !== entry.document || frame.isDestroyed()
      || state.url !== frame.url || typeof request.url !== 'string' || !webURL(request.url)
      || state.requests.size >= 8 || state.bytes >= 32 * 1024 * 1024) throw Error('Web theme resource request is unavailable.');
    const controller = new AbortController(); state.requests.add(controller);
    let pending = this.pending.get(entry.contents);
    if (!pending) { pending = new Set(); this.pending.set(entry.contents, pending); }
    pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    const valid = () => !controller.signal.aborted && !frame.isDestroyed() && !entry.contents.isDestroyed()
      && this.frames.get(frame) === state && state.document === entry.document && state.url === frame.url;
    try {
      let url = new URL(request.url), response: Response | undefined;
      for (let redirect = 0; redirect <= 5; redirect++) {
        if (!webURL(url.href) || url.username || url.password || !valid()) throw Error('Invalid web theme resource URL.');
        response = await entry.contents.session.fetch(url.href, { redirect: 'manual', credentials: 'include', signal: controller.signal });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || redirect === 5) throw Error('Too many web theme resource redirects.');
        url = new URL(location, url);
      }
      if (!response?.ok || !valid()) throw Error('Could not load web theme resource.');
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'text/css' && !/^image\/(png|jpeg|gif|webp|avif|svg\+xml|bmp|x-icon|vnd.microsoft.icon)$/.test(type)) {
        await response.body?.cancel(); throw Error('Only CSS and image resources can be read for web themes.');
      }
      const limit = type === 'text/css' ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error('Web theme resource is too large.'); }
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
      if (!reader) throw Error('Empty web theme resource.');
      for (;;) {
        const result = await reader.read(); if (result.done) break;
        size += result.value.length;
        if (size > limit || state.bytes + size > 32 * 1024 * 1024 || !valid()) { await reader.cancel(); throw Error('Web theme resource limit exceeded.'); }
        chunks.push(result.value);
      }
      if (!valid()) throw Error('The page changed while reading its theme resources.');
      state.bytes += size;
      return { type, bytes: Buffer.concat(chunks, size) };
    } finally { clearTimeout(timer); state.requests.delete(controller); pending.delete(controller); }
  }
}
