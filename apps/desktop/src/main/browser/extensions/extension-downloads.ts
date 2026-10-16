import { app, type DownloadItem, type WebContents } from 'electron';
import { mkdirSync, openSync, closeSync, lstatSync } from 'node:fs';
import path from 'node:path';
import type { BrowserDownload, BrowserEvent } from '../../../protocol/browser';
import type { BrowserDownloads } from '../browser-downloads';
import type { ExtensionHostBridge } from './host-bridge';
import type { ExtensionPermissions } from './extension-permissions';
const numericId = (id: string) => parseInt(id.replaceAll('-', '').slice(0, 12), 16);
const itemInfo = (record: BrowserDownload) => ({ id: numericId(record.id), url: record.url, finalUrl: record.url, filename: record.path,
  state: record.state === 'completed' ? 'complete' : record.state === 'progressing' ? 'in_progress' : 'interrupted', paused: record.paused,
  canResume: record.resumable, bytesReceived: record.received, totalBytes: record.total, fileSize: record.total, mime: '', danger: 'safe',
  startTime: new Date(record.startedAt).toISOString(), exists: record.state === 'completed' });
type Request = { url: string; filename?: string; saveAs?: boolean; conflictAction?: string; method?: string; headers?: unknown; body?: unknown };
export class ExtensionDownloads {
  private queue = Promise.resolve();
  private pending?: { url: string; saveAs: boolean; filename?: string; resolve(id: number): void; reject(error: Error): void };
  private previous = new Map<number, ReturnType<typeof itemInfo>>();
  constructor(private readonly host: ExtensionHostBridge, private readonly permissions: ExtensionPermissions, private readonly downloads: BrowserDownloads) {
    host.handle('downloads.download', ({ extension }, details: Request) => {
      permissions.require(extension, 'downloads');
      const run = this.queue.then(() => this.start(details)); this.queue = run.then(() => undefined, () => undefined); return run;
    });
    host.handle('downloads.search', async ({ extension }, query: { id?: number; query?: string[]; state?: string; limit?: number } = {}) => {
      permissions.require(extension, 'downloads');
      if (!query || Object.keys(query).some(key => !['id', 'query', 'state', 'limit'].includes(key))) throw Error('Unsupported download query.');
      return (await downloads.list()).map(itemInfo).filter(item => (query.id === undefined || item.id === query.id) && (!query.state || item.state === query.state)
        && (!query.query || query.query.every(text => `${item.filename} ${item.url}`.toLowerCase().includes(text.toLowerCase())))).slice(0, query.limit === 0 ? undefined : query.limit ?? 1000);
    });
    for (const command of ['pause', 'resume', 'cancel', 'show', 'open'] as const) host.handle(`downloads.${command}`, async ({ extension }, id: number) => {
      permissions.require(extension, command === 'open' ? 'downloads.open' : 'downloads');
      const record = (await downloads.list()).find(row => numericId(row.id) === id); if (!record) throw Error('Download not found.');
      await downloads.command(record.id, command);
    });
  }
  private async start(details: Request): Promise<number> {
    if (!details || typeof details.url !== 'string' || !/^https?:\/\//.test(details.url)) throw Error('downloads.download currently supports HTTP(S) URLs only.');
    if (details.method && details.method !== 'GET' || details.headers || details.body || details.conflictAction && details.conflictAction !== 'uniquify') throw Error('Unsupported download options.');
    if (details.filename !== undefined && (typeof details.filename !== 'string' || !details.filename || /[\\\x00-\x1f]/.test(details.filename) || path.isAbsolute(details.filename) || details.filename.split('/').some(part => !part || part === '.' || part === '..'))) throw Error('Invalid download filename.');
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending = undefined; reject(Error('Download did not start.')); }, 30_000);
      this.pending = { url: details.url, saveAs: details.saveAs === true, filename: details.filename,
        resolve: id => { clearTimeout(timer); resolve(id); }, reject: error => { clearTimeout(timer); reject(error); } };
      try { this.host.session.downloadURL(details.url); } catch (error) { this.pending = undefined; clearTimeout(timer); reject(error); }
    });
  }
  /** Called by the single profile download owner before its unknown-source guard. */
  claim(item: DownloadItem, contents?: WebContents): boolean {
    const request = this.pending;
    if (!request || contents || !item.getURLChain().includes(request.url)) return false;
    this.pending = undefined;
    const filename = request.filename ?? path.basename(item.getFilename());
    const destination = path.join(app.getPath('downloads'), filename);
    if (request.saveAs) {
      item.setSaveDialogOptions({ title: 'Save download', defaultPath: destination });
      const id = this.downloads.track(item); request.resolve(numericId(id));
    } else {
      try {
        // Reserve the destination before will-download returns: a paused item
        // can otherwise open/truncate the initially assigned path.
        item.setSavePath(this.unique(filename));
        const id = this.downloads.track(item); request.resolve(numericId(id));
      } catch (error) { item.cancel(); request.reject(error instanceof Error ? error : Error(String(error))); }
    }
    return true;
  }
  private unique(relative: string): string {
    const root = app.getPath('downloads');
    mkdirSync(root, { recursive: true });
    let parent = root;
    for (const part of relative.split('/').slice(0, -1)) {
      parent = path.join(parent, part);
      try { mkdirSync(parent); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const info = lstatSync(parent);
      if (info.isSymbolicLink() || !info.isDirectory()) throw Error('Download folders must not be symbolic links.');
    }
    const filename = path.join(root, relative);
    for (let i = 0; i < 1000; i++) {
      const ext = path.extname(filename), candidate = i ? `${filename.slice(0, filename.length - ext.length)} (${i})${ext}` : filename;
      try { const file = openSync(candidate, 'wx'); closeSync(file); return candidate; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    throw Error('Could not allocate a download filename.');
  }
  publish(event: BrowserEvent): void {
    if (event.type !== 'download' && event.type !== 'download-removed') return;
    const id = numericId(event.type === 'download' ? event.download.id : event.id);
    for (const extension of this.host.session.extensions.getAllExtensions()) {
      if (!this.permissions.has(extension, 'downloads')) continue;
      if (event.type === 'download-removed') this.host.emit(extension.id, 'downloads.onErased', id);
      else {
        const next = itemInfo(event.download), previous = this.previous.get(id);
        if (!previous) this.host.emit(extension.id, 'downloads.onCreated', next);
        else {
          const delta: Record<string, unknown> = { id };
          for (const key of ['state', 'paused', 'filename'] as const) if (next[key] !== previous[key]) delta[key] = { previous: previous[key], current: next[key] };
          if (Object.keys(delta).length > 1) this.host.emit(extension.id, 'downloads.onChanged', delta);
        }
      }
    }
    if (event.type === 'download') this.previous.set(id, itemInfo(event.download)); else this.previous.delete(id);
  }
}
