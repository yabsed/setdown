import { ipcMain, WebContentsView, type WebContents } from 'electron';
import path from 'node:path';
import type { WindowState } from '../windows/window-state';
import type { ApplicationMenuEntry, MenuOverlayContext } from '../../protocol/desktop-api';
import { executeApplicationMenu } from './application-menu';

/** A transparent native layer keeps menus above live web content without hiding
 * the page or replacing its video frames with a captured image. */
export class MenuOverlay {
  private readonly owners = new Map<number, { state: WindowState; view: WebContentsView; contents: WebContents;
    context: MenuOverlayContext; ready: Promise<void>; generation: number }>();
  constructor(entries: (state: WindowState, id: string) => ApplicationMenuEntry[]) {
    const owned = (id: number) => [...this.owners.values()].find(entry => entry.contents.id === id);
    ipcMain.handle('menu-overlay:context', event => owned(event.sender.id)?.context);
    ipcMain.handle('menu-overlay:entries', (event, id: string) => {
      const entry = owned(event.sender.id);
      if (entry && /^application-menu-(file|view|edit|window)$/.test(id)) entry.context.menuId = id;
      return entry ? entries(entry.state, id) : [];
    });
    ipcMain.on('menu-overlay:close', event => {
      const entry = owned(event.sender.id) ?? this.owners.get(event.sender.id);
      if (entry) this.close(entry.state.webContentsId);
    });
    ipcMain.on('menu-overlay:execute', (event, id: string) => {
      const entry = owned(event.sender.id);
      if (!entry || !entry.view.getVisible()) return;
      const find = (rows: ApplicationMenuEntry[]): ApplicationMenuEntry | undefined => {
        for (const row of rows) { if (row.id === id) return row; const nested = row.submenu && find(row.submenu); if (nested) return nested; }
      };
      const item = find(entries(entry.state, entry.context.menuId));
      if (!item?.enabled || item.submenu || item.type === 'separator') return;
      this.close(entry.state.webContentsId);
      executeApplicationMenu(id, entry.state.window);
    });
  }
  async open(state: WindowState, context: MenuOverlayContext): Promise<boolean> {
    if (!/^application-menu-(file|view|edit|window)$/.test(context.menuId)
      || !Number.isFinite(context.x) || !Number.isFinite(context.y)) return false;
    const owner = state.webContentsId;
    let entry = this.owners.get(owner);
    if (!entry) {
      const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const contents = view.webContents;
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      const url = new URL(state.window.webContents.getURL()); url.searchParams.set('menu-overlay', '1');
      entry = { state, view, contents, context, generation: 0, ready: contents.loadURL(url.href) };
      this.owners.set(owner, entry);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', event => event.preventDefault());
      state.window.on('resize', () => this.close(owner));
      state.window.on('blur', () => this.close(owner, false));
      state.window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) this.close(owner, false); });
      state.window.once('closed', () => { this.owners.delete(owner); if (!contents.isDestroyed()) contents.close(); });
    }
    entry.context = context;
    const generation = ++entry.generation;
    await entry.ready;
    if (entry.generation !== generation || state.window.isDestroyed() || entry.contents.isDestroyed()) return false;
    await entry.contents.insertCSS('html,body,#app{background:transparent!important}');
    if (entry.generation !== generation || state.window.isDestroyed()) return false;
    const [width, height] = state.window.getContentSize();
    entry.view.setBounds({ x: 0, y: 0, width, height });
    entry.contents.setZoomMode('isolated');
    entry.contents.setZoomFactor(state.window.webContents.getZoomFactor());
    state.window.contentView.addChildView(entry.view);
    entry.contents.send('menu-overlay:show', context);
    entry.view.setVisible(true); entry.contents.focus();
    return true;
  }
  close(owner: number, focus = true): void {
    const entry = this.owners.get(owner);
    if (!entry) return;
    entry.generation++;
    if (!entry.contents.isDestroyed()) entry.view.setVisible(false);
    if (!entry.state.window.isDestroyed()) {
      entry.state.window.contentView.removeChildView(entry.view);
      entry.state.window.webContents.send('menu-overlay:closed');
      if (focus && entry.state.window.isFocused()) entry.state.window.webContents.focus();
    }
  }
}
