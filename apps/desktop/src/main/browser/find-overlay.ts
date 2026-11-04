import { ipcMain, WebContentsView, type WebContents } from 'electron';
import path from 'node:path';
import type { BrowserFindAction, BrowserFindContext, BrowserFindRequest } from '../../protocol/browser-find';
import { readPreviewBounds } from '../../protocol/preview-preparation';
import type { WindowState } from '../windows/window-state';
import { nativeZoomBounds } from '../windows/workspace-zoom';
import { appZoomStep } from '../../core/zoom';

type Entry = { state: WindowState; view: WebContentsView; contents: WebContents;
  context: BrowserFindContext; ready: Promise<void>; generation: number; visible: boolean; focus: string };

/** A trusted find panel above web pages and Markdown; never resize or capture the target. */
export class BrowserFindOverlay {
  private readonly owners = new Map<number, Entry>();
  constructor(private readonly target: (owner: number, id: string) => WebContentsView | undefined,
    private readonly zoom: (step: number) => void) {
    const owned = (contents: WebContents) => [...this.owners.values()].find(entry => entry.contents === contents);
    ipcMain.handle('browser-find:context', event => owned(event.sender)?.context);
    ipcMain.on('browser-find:action', (event, raw: unknown) => {
      const entry = owned(event.sender);
      if (!entry?.visible || !raw || typeof raw !== 'object' || entry.state.window.isDestroyed()) return;
      const action = raw as BrowserFindAction;
      if (action.token !== entry.context.token || action.id !== entry.context.id
        || !this.target(entry.state.webContentsId, action.id) || typeof action.query !== 'string' || action.query.length > 1000
        || !['search', 'previous', 'next', 'close'].includes(action.command)) return;
      entry.state.window.webContents.send('browser-find:action', action);
    });
  }
  async show(state: WindowState, raw: unknown, theme: BrowserFindContext['theme']): Promise<void> {
    if (!raw || typeof raw !== 'object' || state.window.isDestroyed()) return;
    const request = raw as BrowserFindRequest, bounds = readPreviewBounds(request.bounds);
    if (!bounds || typeof request.id !== 'string' || !this.target(state.webContentsId, request.id)
      || typeof request.token !== 'string' || request.token.length > 200
      || typeof request.focus !== 'string' || request.focus.length > 200
      || typeof request.query !== 'string' || request.query.length > 1000
      || !Number.isInteger(request.active) || !Number.isInteger(request.matches)
      || request.active < 0 || request.matches < request.active) return;
    const context = { ...request, bounds, theme }, owner = state.webContentsId;
    let entry = this.owners.get(owner);
    if (!entry) {
      const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const contents = view.webContents;
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', event => event.preventDefault());
      contents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.isComposing) return;
        const step = appZoomStep(input);
        if (step !== undefined) { event.preventDefault(); this.zoom(step); return; }
        const key = input.key.toLowerCase(), modifier = input.control || input.meta;
        const command = modifier && key === 'l' ? 'focus-location'
          : modifier && key === 't' ? input.shift ? 'reopen-web-tab' : 'new-web-tab'
          : modifier && key === 'w' ? 'close-tab'
          : input.control && key === 'tab' ? input.shift ? 'previous-tab' : 'next-tab'
          : input.alt && key === 'arrowleft' ? 'navigate-back'
          : input.alt && key === 'arrowright' ? 'navigate-forward' : null;
        if (command) { event.preventDefault(); state.window.webContents.focus(); state.window.webContents.send('app:command', command); }
      });
      const url = new URL(state.window.webContents.getURL()); url.searchParams.set('browser-find-overlay', '1');
      entry = { state, view, contents, context, ready: contents.loadURL(url.href), generation: 0, visible: false, focus: '' };
      this.owners.set(owner, entry);
      state.window.webContents.on('did-start-navigation', (_event, _url, inPlace, main) => { if (main && !inPlace) this.hide(owner); });
      state.window.once('closed', () => { this.owners.delete(owner); if (!contents.isDestroyed()) contents.close(); });
    }
    entry.context = context;
    const generation = ++entry.generation;
    await entry.ready;
    if (entry.generation !== generation || state.window.isDestroyed() || entry.contents.isDestroyed()
      || !this.target(owner, context.id)) return;
    const factor = state.window.webContents.getZoomFactor();
    const rect = nativeZoomBounds(bounds, factor), [width, height] = state.window.getContentSize();
    rect.width = Math.min(rect.width, width - rect.x); rect.height = Math.min(rect.height, height - rect.y);
    if (rect.width <= 0 || rect.height <= 0) { this.hide(owner); return; }
    entry.view.setBounds(rect);
    entry.contents.setZoomMode('isolated'); entry.contents.setZoomFactor(factor);
    // Updating counts must not raise this panel above a menu or another popup.
    const children = state.window.contentView.children;
    if (!entry.visible || children.indexOf(entry.view) < children.indexOf(this.target(owner, context.id)!)) {
      state.window.contentView.addChildView(entry.view);
    }
    entry.visible = true; entry.view.setVisible(true);
    entry.contents.send('browser-find:show', context);
    if (entry.focus !== context.focus) { entry.focus = context.focus; entry.contents.focus(); }
  }
  hide(owner: number, token?: string): void {
    const entry = this.owners.get(owner);
    if (!entry || (token !== undefined && token !== entry.context.token)) return;
    entry.generation++; entry.visible = false;
    if (!entry.contents.isDestroyed()) {
      const focused = entry.contents.isFocused();
      entry.view.setVisible(false);
      if (focused && !entry.state.window.isDestroyed()) entry.state.window.webContents.focus();
    }
    if (!entry.state.window.isDestroyed()) entry.state.window.contentView.removeChildView(entry.view);
  }
}
