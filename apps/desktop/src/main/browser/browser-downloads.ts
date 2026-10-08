import { app, shell, type DownloadItem } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { BrowserDownload, BrowserEvent, DownloadCommand } from '../../protocol/browser';

type LiveDownload = { item: DownloadItem; timer?: ReturnType<typeof setTimeout> };
const active = (record: BrowserDownload) => record.state === 'progressing' || record.resumable;

/** Min's DownloadItem event flow, with stable IDs and a durable library instead
 * of a temporary download bar. Transfer bytes stay entirely in Chromium. */
export class BrowserDownloads {
  private readonly records = new Map<string, BrowserDownload>();
  private readonly live = new Map<string, LiveDownload>();
  private ready?: Promise<void>;
  private loaded = false;
  private timer?: ReturnType<typeof setTimeout>;
  private saving = Promise.resolve();
  constructor(private readonly broadcast: (event: BrowserEvent) => void) {}
  private get file() { return path.join(app.getPath('userData'), 'browser-downloads.json'); }
  private load(): Promise<void> {
    return this.ready ??= fs.readFile(this.file, 'utf8').then(JSON.parse).catch(() => []).then((rows: unknown) => {
      if (Array.isArray(rows)) for (const row of rows.slice(0, 200)) {
        if (!row || typeof row.id !== 'string' || this.records.has(row.id)
          || typeof row.name !== 'string' || typeof row.url !== 'string' || typeof row.path !== 'string'
          || (row.path && !path.isAbsolute(row.path)) || !Number.isFinite(row.startedAt)
          || !Number.isFinite(row.received) || row.received < 0 || !Number.isFinite(row.total) || row.total < 0
          || !['progressing', 'completed', 'cancelled', 'interrupted'].includes(row.state)) continue;
        this.records.set(row.id, { id: row.id, url: row.url, name: row.name, path: row.path,
          received: row.received, total: row.total, startedAt: row.startedAt,
          state: row.state === 'progressing' ? 'interrupted' : row.state, paused: false, resumable: false });
      }
      this.loaded = true;
    });
  }
  async list(): Promise<BrowserDownload[]> { await this.load(); return this.snapshot(); }
  private snapshot() {
    return [...this.records.values()].sort((a, b) => b.startedAt - a.startedAt).map(record => ({ ...record }));
  }
  track(item: DownloadItem): void {
    void this.load();
    const id = randomUUID();
    const live: LiveDownload = { item };
    this.live.set(id, live);
    const record: BrowserDownload = { id, url: item.getURL(), name: item.getFilename(), path: '',
      state: 'progressing', received: 0, total: item.getTotalBytes(), paused: false, resumable: false, startedAt: Date.now() };
    this.records.set(id, record);
    const publish = (state: BrowserDownload['state'] = item.getState()) => {
      clearTimeout(live.timer); live.timer = undefined;
      Object.assign(record, { path: item.getSavePath(), name: path.basename(item.getSavePath()) || item.getFilename(),
        received: item.getReceivedBytes(), total: item.getTotalBytes(), state,
        paused: state === 'progressing' && item.isPaused(), resumable: this.live.has(id) && item.canResume() });
      this.broadcast({ type: 'download', download: { ...record } });
      this.persist();
    };
    // Coalesce frequent byte updates; terminal states and user commands publish
    // immediately. A late progress timer cannot overwrite a completed transfer.
    item.on('updated', (_event, state) => {
      if (state === 'interrupted' || item.isPaused()) publish(state);
      else live.timer ??= setTimeout(() => publish(), 200);
    });
    item.once('done', (_event, state) => {
      this.live.delete(id); publish(state);
      this.trim();
    });
    publish();
  }
  private trim() {
    const finished = this.snapshot().filter(record => !active(record));
    for (const record of finished.slice(200)) {
      this.records.delete(record.id);
      this.broadcast({ type: 'download-removed', id: record.id });
    }
  }
  async command(id: string, command: DownloadCommand): Promise<void> {
    await this.load();
    const record = this.records.get(id), live = this.live.get(id);
    if (!record) throw Error('Download not found.');
    if (command === 'pause' && live && record.state === 'progressing') live.item.pause();
    else if (command === 'resume' && live && (record.paused || live.item.canResume())) live.item.resume();
    else if (command === 'cancel' && live) { live.item.cancel(); return; }
    else if (command === 'remove' && !active(record)) {
      this.records.delete(id); this.broadcast({ type: 'download-removed', id }); this.persist(); return;
    } else if ((command === 'open' || command === 'show') && record.state === 'completed' && record.path) {
      await fs.access(record.path);
      if (command === 'show') shell.showItemInFolder(record.path);
      else { const error = await shell.openPath(record.path); if (error) throw Error(error); }
      return;
    } else throw Error('This download action is unavailable.');
    // pause/resume need not emit an updated event until more bytes arrive.
    record.state = live!.item.getState(); record.paused = live!.item.isPaused(); record.resumable = live!.item.canResume();
    this.broadcast({ type: 'download', download: { ...record } }); this.persist();
  }
  private persist() {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.saving = this.saving.catch(() => {}).then(async () => {
        await this.load();
        const data = JSON.stringify(this.snapshot());
        await fs.writeFile(`${this.file}.tmp`, data); await fs.rename(`${this.file}.tmp`, this.file);
      });
      void this.saving.catch(console.error);
    }, 400);
  }
  flushOnExit() {
    clearTimeout(this.timer);
    if (!this.loaded) return;
    writeFileSync(`${this.file}.shutdown`, JSON.stringify(this.snapshot()));
    renameSync(`${this.file}.shutdown`, this.file);
  }
}
