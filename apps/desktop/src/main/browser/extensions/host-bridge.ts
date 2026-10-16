import { ipcMain, BrowserWindow, type ServiceWorkerMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Extension, Rectangle, Session, WebContents } from 'electron';
import type { ElectronChromeExtensions } from 'electron-chrome-extensions';
import type { BrowserExtensionAction } from '../../../protocol/browser';
import { ExtensionSurface } from './extension-surface';
import { DEFAULT_PREVIEW_THEME, type PreviewThemeId } from '../../../core/preview/preview-preferences';
import { themeProfile } from '../../../core/theme/theme-catalog';

type Context = { extension: Extension; sender: WebContents; type: 'frame' | 'service-worker' };
type Handler = (context: Context, ...args: any[]) => unknown;
type Action = { tabs: Record<number, Partial<Action>>; title?: string; text?: string; color?: string | number[]; enabled?: boolean };
type Popup = { browserWindow?: BrowserWindow; extensionId: string; destroy(): void };
/** The only dependency on private surfaces of electron-chrome-extensions 4.9.
 * Guard upgrades here; app modules must not reach into the upstream host. */
type Internals = {
  ctx: { router: {
    handle(name: string, handler: Handler): void;
    sendEvent(id: string, name: string, ...args: unknown[]): void;
    onExtensionMessage(event: any, id: string, name: string, ...args: unknown[]): Promise<unknown>;
  }; store: { on(event: string, listener: (tab: WebContents) => void): void; lastFocusedWindowId?: number; tabs: Set<WebContents>; windows: Set<BrowserWindow>; tabToWindow: Map<WebContents, BrowserWindow>; getActiveTabOfCurrentWindow(): WebContents | undefined } };
  api: { browserAction: {
    actionMap: Map<string, Action>; getAction(id: string): Action; onUpdate(): void;
    handleCRXRequest(request: { url: string }): Response;
    getPopupUrl(id: string, tab: number): string | undefined;
    activateClick(details: { extensionId: string; tabId: number; anchorRect: Rectangle }): void;
    popup?: Popup;
  } };
};
export class ExtensionHostBridge {
  private readonly internal: Internals;
  private popupTab?: WebContents;
  private surface?: ExtensionSurface;
  private sequence = 0;
  private clickWithoutPopup: Internals['api']['browserAction']['activateClick'];
  constructor(host: ElectronChromeExtensions, readonly session: Session, changed: () => void,
    private readonly theme: () => PreviewThemeId = () => DEFAULT_PREVIEW_THEME) {
    this.internal = host as unknown as Internals;
    const { ctx, api } = this.internal;
    if (!(api?.browserAction?.actionMap instanceof Map) || typeof ctx?.router?.handle !== 'function') {
      throw Error('Review the extension host adapter for the installed library version.');
    }
    const original = ctx.router.onExtensionMessage.bind(ctx.router);
    ctx.router.onExtensionMessage = async (event, id, name, ...args) => {
      const url = event.type === 'frame' ? event.senderFrame?.url : event.serviceWorker?.scope;
      if (!id || !url?.startsWith(`chrome-extension://${id}/`)) throw Error('Extension sender does not match its identity.');
      const focused = BrowserWindow.getFocusedWindow();
      const focusedOwner = focused?.getParentWindow() ?? focused;
      if (focusedOwner && ctx.store.windows.has(focusedOwner)) ctx.store.lastFocusedWindowId = focusedOwner.id;
      const senderWindow = event.type === 'frame' ? (this.surface && this.surface.contents === event.sender ? this.surface.parent : ctx.store.tabToWindow.get(event.sender) ?? BrowserWindow.fromWebContents(event.sender)) : undefined;
      const owner = senderWindow?.getParentWindow() ?? senderWindow;
      const currentId = owner && ctx.store.windows.has(owner) ? owner.id : ctx.store.lastFocusedWindowId;
      if (name === 'windows.getCurrent' && currentId !== undefined) return original(event, id, 'windows.get', currentId, ...args);
      const result = await original(event, id, name, ...args);
      // 4.9 ignores both boolean window filters. Keep its other tab filters,
      // then scope the result to the calling popup/window or the focused worker.
      if (name === 'tabs.query' && Array.isArray(result)) {
        const query = args[0] as { currentWindow?: boolean; lastFocusedWindow?: boolean } | undefined;
        return result.filter(tab => (typeof query?.currentWindow !== 'boolean' || (tab.windowId === currentId) === query.currentWindow)
          && (typeof query?.lastFocusedWindow !== 'boolean' || (tab.windowId === ctx.store.lastFocusedWindowId) === query.lastFocusedWindow));
      }
      return result;
    };
    // Credentials bypass the upstream routing delegate's debug payload logger.
    const privateMessage = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainServiceWorkerInvokeEvent, id: string, name: string, ...args: unknown[]) => {
      if (name !== 'proxy.authResponse') throw Error('Unknown private extension operation.');
      return ctx.router.onExtensionMessage(event, id, name, ...args);
    };
    ipcMain.handle('setdown:extension-private', privateMessage);
    const workers = new WeakSet<ServiceWorkerMain>();
    session.serviceWorkers.on('running-status-changed', ({ runningStatus, versionId }) => {
      if (runningStatus !== 'starting') return;
      const worker = session.serviceWorkers.getWorkerFromVersionID(versionId);
      if (worker?.scope.startsWith('chrome-extension://') && !workers.has(worker)) {
        workers.add(worker); worker.ipc.handle('setdown:extension-private', privateMessage);
      }
    });
    const update = api.browserAction.onUpdate.bind(api.browserAction);
    api.browserAction.onUpdate = () => { update(); changed(); };
    ctx.store.on('active-tab-changed', tab => { if (this.popupTab && tab !== this.popupTab) this.dismiss(); });
    session.extensions.on('extension-unloaded', (_event, extension) => {
      if (this.surface && (!this.surface.extensionId || this.surface.extensionId === extension.id)) this.dismiss();
      changed();
    });
    this.clickWithoutPopup = api.browserAction.activateClick.bind(api.browserAction);
    api.browserAction.activateClick = ({ extensionId, tabId, anchorRect }) => this.activate(extensionId, this.tab(tabId), anchorRect);
    ipcMain.handle('extension-panel:context', async event => {
      const surface = this.surface;
      if (!surface || surface.extensionId || surface.contents !== event.sender) throw Error('Unknown extension panel.');
      const { appearance, palette } = themeProfile(this.theme());
      return { items: await this.actions(surface.target.id), appearance, palette };
    });
    ipcMain.handle('extension-panel:choose', (event, id: string) => {
      const surface = this.surface;
      if (!surface || surface.extensionId || surface.contents !== event.sender) throw Error('Unknown extension panel.');
      this.activate(id, surface.target, surface.anchor);
    });
    this.handle('browserAction.getUserSettings', () => ({ isOnToolbar: false }));
    this.handle('windows.remove', (_event, id: number) => {
      const window = [...ctx.store.windows].find(window => window.id === id && !window.isDestroyed());
      if (!window) throw Error('No such browser window.');
      window.once('closed', () => { ctx.store.windows.delete(window); });
      window.close();
    });
    for (const enabled of [true, false]) this.handle(`browserAction.${enabled ? 'enable' : 'disable'}`, ({ extension }, tabId?: number) => {
      const action = api.browserAction.getAction(extension.id);
      if (tabId !== undefined) { this.tab(tabId); (action.tabs[tabId] ??= {}).enabled = enabled; }
      else action.enabled = enabled;
      api.browserAction.onUpdate();
    });
  }
  handle(name: string, callback: Handler): void {
    this.internal.ctx.router.handle(name, async (context, ...args) => {
      try { return { value: await callback(context, ...args) }; }
      catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
    });
  }
  emit(id: string, event: string, ...args: unknown[]): void { this.internal.ctx.router.sendEvent(id, event, ...args); }
  tabs(): WebContents[] { return [...this.internal.ctx.store.tabs].filter(tab => !tab.isDestroyed()); }
  tab(id: number): WebContents {
    const tab = this.tabs().find(tab => tab.id === id);
    if (!tab) throw Error('No such browser tab.'); return tab;
  }
  parent(tab: WebContents) { return this.internal.ctx.store.tabToWindow.get(tab); }
  activeTab() { return this.internal.ctx.store.getActiveTabOfCurrentWindow(); }
  async actions(tabId: number): Promise<BrowserExtensionAction[]> {
    this.tab(tabId);
    return Promise.all([...this.internal.api.browserAction.actionMap].map(async ([id, action]) => {
      const props = { ...action, ...action.tabs[tabId] };
      const response = this.internal.api.browserAction.handleCRXRequest({ url: `crx://extension-icon/${id}/20/1?tabId=${tabId}` });
      const icon = response.ok ? `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}` : null;
      const color = Array.isArray(props.color) ? `rgba(${props.color.slice(0, 3).join(',')},${(props.color[3] ?? 255) / 255})` : props.color;
      return { id, title: props.title || this.session.extensions.getExtension(id)?.name || id, badge: props.text || '', color: color || '#555', enabled: props.enabled !== false, icon };
    }));
  }
  activate(id: string, tab: WebContents, bounds: Rectangle): void {
    const api = this.internal.api.browserAction, action = api.actionMap.get(id);
    if (!action || (action.tabs[tab.id]?.enabled ?? action.enabled) === false) throw Error('This extension action is unavailable.');
    const url = api.getPopupUrl(id, tab.id);
    if (url && !url.startsWith(`chrome-extension://${id}/`)) throw Error('An extension popup must belong to that extension.');
    const toggle = this.surface?.extensionId === id && this.surface.target === tab;
    this.dismiss();
    if (toggle) return;
    this.popupTab = tab;
    const parent = this.parent(tab);
    if (!parent || parent.isDestroyed()) throw Error('The browser window is unavailable.');
    this.internal.ctx.store.lastFocusedWindowId = parent.id;
    if (!url) { this.clickWithoutPopup({ extensionId: id, tabId: tab.id, anchorRect: bounds }); return; }
    const surface = this.surface = new ExtensionSurface(id, parent, tab, bounds, { session: this.session }, () => {
      if (this.surface === surface) this.surface = undefined;
    });
    surface.contents.setWindowOpenHandler(({ url }) => {
      void this.internal.ctx.router.onExtensionMessage({ type: 'frame', sender: surface.contents, senderFrame: surface.contents.mainFrame }, id,
        'tabs.create', { url, openerTabId: tab.id }).catch(console.error);
      return { action: 'deny' };
    });
    surface.contents.on('will-navigate', (event, url) => { if (!url.startsWith(`chrome-extension://${id}/`)) event.preventDefault(); });
    void surface.load(url).catch(console.error);
  }
  async menu(tab: WebContents, bounds: Rectangle): Promise<void> {
    const toggle = this.surface && !this.surface.extensionId && this.surface.target === tab;
    this.dismiss();
    if (toggle) return;
    const sequence = this.sequence, items = await this.actions(tab.id), parent = this.parent(tab);
    if (sequence !== this.sequence || tab.isDestroyed() || !parent || parent.isDestroyed()) return;
    this.popupTab = tab;
    const zoom = parent.webContents.getZoomFactor();
    const surface = this.surface = new ExtensionSurface('', parent, tab, bounds, {
      preload: path.join(__dirname, 'extension-panel-preload.cjs'), zoom,
      width: Math.min(420, 10 + Math.max(1, items.length) * 28 + Math.max(0, items.length - 1) * 4) * zoom,
      height: 38 * zoom, radius: 6,
    }, () => { if (this.surface === surface) this.surface = undefined; });
    surface.view.setBackgroundColor(themeProfile(this.theme()).palette.chrome);
    surface.contents.on('will-navigate', event => event.preventDefault());
    await surface.load(pathToFileURL(path.join(__dirname, 'extension-panel.html')).href);
  }
  dismiss(): void {
    this.sequence++;
    this.surface?.destroy(); this.surface = undefined;
    this.internal.api.browserAction.popup?.destroy(); this.internal.api.browserAction.popup = undefined;
  }
}
