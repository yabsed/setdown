import { app, clipboard, ipcMain, WebContentsView, type WebContents } from 'electron';
import path from 'node:path';
import type { WindowState } from '../windows/window-state';
import type { LocationSuggestionsContext, LocationSuggestionsRequest } from '../../protocol/desktop-api';
import type { LocationPanelAction } from '../../protocol/desktop-api';
import { readPreviewBounds } from '../../protocol/preview-preparation';
import { nativeZoomBounds } from '../windows/workspace-zoom';
import { isWebURL } from '../../core/browser/browser-url';

type Entry = { state: WindowState; view: WebContentsView; contents: WebContents;
  context: LocationSuggestionsContext; ready: Promise<void>; generation: number; visible: boolean; active: boolean; focusPending?: boolean; retire?: ReturnType<typeof setTimeout> };

/** Only the panel covers native content. Pages retain their native bounds,
 * visibility and frame delivery. Compact panels own their input; wide address
 * typing/composition stays in the shell. */
export class LocationOverlay {
  private readonly owners = new Map<number, Entry>();
  private readonly observed = new WeakSet<Electron.BrowserWindow>();
  constructor() {
    const owned = (contents: WebContents) => [...this.owners.values()].find(entry => entry.contents === contents);
    ipcMain.handle('location-overlay:context', event => owned(event.sender)?.context);
    ipcMain.on('location-overlay:panel-action', (event, action: LocationPanelAction) => {
      const entry = owned(event.sender);
      if (!entry?.active || !entry.visible || !entry.context.panel || !action || action.token !== entry.context.token
        || entry.state.window.isDestroyed()) return;
      if (action.type === 'copy') { clipboard.writeText(entry.context.panel.location); return; }
      if ((action.type === 'edit' || action.type === 'submit') && (typeof action.value !== 'string' || action.value.length > 16384)) return;
      if (action.type === 'action' && !entry.context.panel.actions.some(item => item.id === action.id && !item.disabled)) return;
      if (!['edit', 'submit', 'action', 'dismiss'].includes(action.type)) return;
      entry.state.window.webContents.send('location-overlay:panel-action', action);
      if (action.type !== 'edit') {
        this.hide(entry.state.webContentsId, action.token);
        entry.state.window.webContents.focus();
      }
    });
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
      || !Array.isArray(request.rows) || (!request.panel && request.rows.length < 1) || request.rows.length > 8
      || !request.rows.every(row => row && typeof row.title === 'string' && row.title.length <= 1000
        && typeof row.url === 'string' && row.url.length <= 16384 && isWebURL(row.url))
      || !Number.isInteger(request.selected) || request.selected < -1 || request.selected >= request.rows.length
      || state.window.isDestroyed()) return;
    if (request.panel && (!['address', 'actions'].includes(request.panel.mode)
      || typeof request.panel.location !== 'string' || request.panel.location.length > 32768
      || typeof request.panel.draft !== 'string' || request.panel.draft.length > 16384
      || !Array.isArray(request.panel.actions) || request.panel.actions.length > 64
      || !request.panel.actions.every(item => typeof item.id === 'string' && item.id.length < 100
        && typeof item.label === 'string' && item.label.length < 300 && typeof item.disabled === 'boolean'))) return;
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
      if (!this.observed.has(state.window)) {
        this.observed.add(state.window);
        state.window.on('blur', () => this.hide(owner));
        state.window.on('resize', () => { if (!this.owners.get(owner)?.context.panel) this.hide(owner, undefined, false); });
        state.window.webContents.on('did-start-navigation', (_event, _url, inPlace, main) => { if (main && !inPlace) this.hide(owner); });
        state.window.once('closed', () => this.dispose(owner));
      }
    }
    clearTimeout(entry.retire);
    if (request.panel && (!entry.active || entry.context.token !== request.token)) entry.focusPending = true;
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
    if (entry.focusPending) { entry.focusPending = false; entry.contents.focus(); }
  }
  blur(owner: number, token: string): boolean {
    const entry = this.owners.get(owner);
    if (!entry || entry.context.token !== token) return true;
    // Native focus moves before the popup renderer receives pointerdown.
    // The shell's DOM blur must not remove that renderer's pending click.
    if (entry.visible && !entry.contents.isDestroyed() && entry.contents.isFocused()) return false;
    this.hide(owner, token, false);
    return true;
  }
  hide(owner: number, token?: string, cancelEdit = true): void {
    const entry = this.owners.get(owner);
    if (!entry || !entry.active || (token !== undefined && token !== entry.context.token)) return;
    entry.generation++; entry.visible = false; entry.active = false;
    if (!entry.contents.isDestroyed()) entry.view.setVisible(false);
    if (!entry.state.window.isDestroyed()) {
      entry.state.window.contentView.removeChildView(entry.view);
      // A renderer-requested hide (for example, no search results) is only
      // presentation. It must not cancel the still-focused address edit.
      if (cancelEdit) entry.state.window.webContents.send('location-overlay:hidden', entry.context.token);
    }
    clearTimeout(entry.retire);
    entry.retire = setTimeout(() => { if (!entry.active) this.dispose(owner); }, 60_000);
    entry.retire.unref();
  }
  private dispose(owner: number) {
    const entry = this.owners.get(owner);
    if (!entry) return;
    clearTimeout(entry.retire); this.owners.delete(owner);
    if (!entry.contents.isDestroyed()) entry.contents.close();
  }
}
