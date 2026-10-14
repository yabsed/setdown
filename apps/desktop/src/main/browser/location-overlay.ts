import { app, ipcMain, WebContentsView, type WebContents } from 'electron';
import path from 'node:path';
import type { WindowState } from '../windows/window-state';
import type { LocationSuggestionsContext, LocationSuggestionsRequest } from '../../protocol/desktop-api';
import { readPreviewBounds } from '../../protocol/preview-preparation';
import { nativeZoomBounds } from '../windows/workspace-zoom';
import { isWebURL } from '../../core/browser/browser-url';

type Entry = { state: WindowState; view: WebContentsView; contents: WebContents;
  context: LocationSuggestionsContext; ready: Promise<void>; generation: number; visible: boolean; active: boolean };

/** Only the dropdown covers native content. Pages retain their native bounds,
 * visibility and frame delivery; typing/composition stays in the shell input. */
export class LocationOverlay {
  private readonly owners = new Map<number, Entry>();
  constructor() {
    const owned = (contents: WebContents) => [...this.owners.values()].find(entry => entry.contents === contents);
    ipcMain.handle('location-overlay:context', event => owned(event.sender)?.context);
    ipcMain.on('location-overlay:choose', (event, token: unknown, index: unknown) => {
      const entry = owned(event.sender);
      if (!entry?.visible || token !== entry.context.token || !Number.isInteger(index)) return;
      const row = entry.context.rows[index as number];
      if (!row || entry.state.window.isDestroyed()) return;
      const context = entry.context;
      entry.state.window.webContents.send('location-overlay:choice', { token, url: row.url });
      this.hide(entry.state.webContentsId, context.token);
    });
    // Clicking another native page must dismiss the dropdown even though the
    // shell's input can remain its document.activeElement across native focus.
    app.on('web-contents-created', (_event, contents) => contents.on('focus', () => {
      for (const [owner, entry] of this.owners) {
        if (contents !== entry.contents && contents.id !== owner) this.hide(owner);
      }
    }));
  }
  async show(state: WindowState, raw: unknown, theme: LocationSuggestionsContext['theme']): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const request = raw as LocationSuggestionsRequest;
    const bounds = readPreviewBounds(request.bounds);
    if (!bounds || typeof request.token !== 'string' || request.token.length > 200
      || !Array.isArray(request.rows) || request.rows.length < 1 || request.rows.length > 8
      || !request.rows.every(row => row && typeof row.title === 'string' && row.title.length <= 1000
        && typeof row.url === 'string' && row.url.length <= 16384 && isWebURL(row.url))
      || !Number.isInteger(request.selected) || request.selected < -1 || request.selected >= request.rows.length
      || state.window.isDestroyed()) return;
    const context: LocationSuggestionsContext = { ...request, bounds, theme };
    const owner = state.webContentsId;
    let entry = this.owners.get(owner);
    if (!entry) {
      const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const contents = view.webContents;
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', event => event.preventDefault());
      const url = new URL(state.window.webContents.getURL()); url.searchParams.set('location-overlay', '1');
      entry = { state, view, contents, context, ready: contents.loadURL(url.href), generation: 0, visible: false, active: false };
      this.owners.set(owner, entry);
      state.window.on('blur', () => this.hide(owner));
      state.window.on('resize', () => this.hide(owner));
      state.window.webContents.on('did-start-navigation', (_event, _url, inPlace, main) => { if (main && !inPlace) this.hide(owner); });
      state.window.once('closed', () => {
        this.owners.delete(owner);
        if (!contents.isDestroyed()) contents.close();
      });
    }
    entry.context = context; entry.active = true;
    const generation = ++entry.generation;
    await entry.ready;
    if (entry.generation !== generation || state.window.isDestroyed() || entry.contents.isDestroyed()) return;
    const factor = state.window.webContents.getZoomFactor();
    const rect = nativeZoomBounds(bounds, factor), [width, height] = state.window.getContentSize();
    rect.width = Math.min(rect.width, width - rect.x); rect.height = Math.min(rect.height, height - rect.y);
    if (rect.width <= 0 || rect.height <= 0) { this.hide(owner); return; }
    entry.view.setBounds(rect);
    entry.contents.setZoomMode('isolated'); entry.contents.setZoomFactor(factor);
    state.window.contentView.addChildView(entry.view);
    entry.contents.send('location-overlay:show', context);
    entry.visible = true; entry.view.setVisible(true);
    // Deliberately no focus(): the address input owns keyboard and IME.
  }
  hide(owner: number, token?: string): void {
    const entry = this.owners.get(owner);
    if (!entry || !entry.active || (token !== undefined && token !== entry.context.token)) return;
    entry.generation++; entry.visible = false; entry.active = false;
    if (!entry.contents.isDestroyed()) entry.view.setVisible(false);
    if (!entry.state.window.isDestroyed()) {
      entry.state.window.contentView.removeChildView(entry.view);
      entry.state.window.webContents.send('location-overlay:hidden', entry.context.token);
    }
  }
}
