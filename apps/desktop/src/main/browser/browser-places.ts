import { WebContentsView, MessageChannelMain, ipcMain, type MessagePortMain } from 'electron';
import path from 'node:path';
import type { BrowserPlace, BrowserPlaceScope } from '../../protocol/browser';

/** Min's isolated Places service: IndexedDB and ranking never run in the shell. */
export class BrowserPlaces {
  private view?: WebContentsView;
  private ready?: Promise<MessagePortMain>;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private connect(): Promise<MessagePortMain> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const view = this.view = new WebContentsView({ webPreferences: {
        partition: 'persist:setdown-places', preload: path.join(__dirname, 'places-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
      } });
      const timeout = setTimeout(() => { ipcMain.removeListener('browser:places-ready', onReady); reject(new Error('Browser library did not start.')); }, 15_000);
      const onReady = (event: Electron.IpcMainEvent) => {
        if (event.sender !== view.webContents) return;
        clearTimeout(timeout); ipcMain.removeListener('browser:places-ready', onReady);
        const { port1, port2 } = new MessageChannelMain();
        port1.on('message', ({ data }) => {
          const task = this.pending.get(data.id);
          if (!task) return;
          this.pending.delete(data.id); clearTimeout(task.timer);
          if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
        });
        port1.start(); view.webContents.postMessage('browser:places-port', null, [port2]); resolve(port1);
      };
      ipcMain.on('browser:places-ready', onReady);
      view.webContents.once('destroyed', () => {
        clearTimeout(timeout); ipcMain.removeListener('browser:places-ready', onReady);
        for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('Browser library closed.')); }
        this.pending.clear(); this.ready = undefined; this.view = undefined;
      });
      void view.webContents.loadFile(path.join(__dirname, 'places.html')).catch(reject);
    });
    return this.ready;
  }
  private async request<T>(action: string, input: unknown): Promise<T> {
    const port = await this.connect();
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Browser library request timed out.')); }, 15_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      port.postMessage({ id, action, input });
    });
  }
  search(query: string, scope: BrowserPlaceScope = 'all'): Promise<BrowserPlace[]> {
    if (!['all', 'bookmarks', 'history'].includes(scope)) throw Error('Invalid browser library scope.');
    return this.request('search', { query: String(query).slice(0, 500), scope });
  }
  deleteHistory(url?: string): Promise<void> { return this.request('delete-history', { url }); }
  update(url: string, title: string, options: { visit?: boolean; bookmarked?: boolean } = {}): Promise<void> {
    return this.request('update', { url, title: title.slice(0, 1000), ...options });
  }
  dispose() { if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close(); }
}
