import { app, ipcMain, BrowserWindow, type ServiceWorkerMain } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { Extension, Rectangle, Session, WebContents } from 'electron';
import type { ElectronChromeExtensions } from 'electron-chrome-extensions';
import type { BrowserExtensionAction } from '../../../protocol/browser';

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
  private pins: Record<string, boolean> = {};
  private readonly pinsFile = path.join(app.getPath('userData'), 'browser-extension-actions.json');
  constructor(host: ElectronChromeExtensions, readonly session: Session, private readonly changed: () => void) {
    try { const value = JSON.parse(readFileSync(this.pinsFile, 'utf8')); if (value && typeof value === 'object' && !Array.isArray(value)) this.pins = value; } catch { /* first launch */ }
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
      const senderWindow = event.type === 'frame' ? ctx.store.tabToWindow.get(event.sender) ?? BrowserWindow.fromWebContents(event.sender) : undefined;
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
      if (api.browserAction.popup?.extensionId === extension.id) this.dismiss();
      changed();
    });
    host.on('browser-action-popup-created', (popup: Popup) => {
      const win = popup.browserWindow, target = this.popupTab;
      if (!win || !target) return;
      const close = () => popup.destroy();
      const navigate = (_event: unknown, _url: string, _inPlace: boolean, main: boolean) => { if (main) close(); };
      const parent = ctx.store.tabToWindow.get(target);
      win.on('blur', close);
      target.once('destroyed', close); target.on('did-start-navigation', navigate);
      parent?.on('resize', close); parent?.on('move', close);
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape' && !input.isAutoRepeat && !input.isComposing) {
          event.preventDefault(); close(); if (!target.isDestroyed()) target.focus();
        }
      });
      win.webContents.setWindowOpenHandler(({ url }) => {
        // The host's tabs.create implementation adopts the browser tab in Setdown.
        void original({ type: 'frame', sender: win.webContents, senderFrame: win.webContents.mainFrame }, popup.extensionId,
          'tabs.create', { url, openerTabId: target.id }).catch(console.error);
        return { action: 'deny' };
      });
      win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(`chrome-extension://${popup.extensionId}/`)) event.preventDefault();
      });
      win.once('closed', () => {
        target.removeListener('destroyed', close); target.removeListener('did-start-navigation', navigate);
        parent?.removeListener('resize', close); parent?.removeListener('move', close);
      });
    });
    this.handle('browserAction.getUserSettings', ({ extension }) => ({ isOnToolbar: this.pins[extension.id] !== false }));
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
      return { id, pinned: this.pins[id] !== false, title: props.title || this.session.extensions.getExtension(id)?.name || id, badge: props.text || '', color: color || '#555', enabled: props.enabled !== false, icon };
    }));
  }
  pin(id: string, pinned: boolean): void {
    if (!this.session.extensions.getExtension(id)) throw Error('Unknown extension.');
    this.pins[id] = pinned;
    writeFileSync(`${this.pinsFile}.tmp`, JSON.stringify(this.pins)); renameSync(`${this.pinsFile}.tmp`, this.pinsFile);
    this.changed();
  }
  activate(id: string, tab: WebContents, bounds: Rectangle): void {
    const api = this.internal.api.browserAction, action = api.actionMap.get(id);
    if (!action || (action.tabs[tab.id]?.enabled ?? action.enabled) === false) throw Error('This extension action is unavailable.');
    const url = api.getPopupUrl(id, tab.id);
    if (url && !url.startsWith(`chrome-extension://${id}/`)) throw Error('An extension popup must belong to that extension.');
    this.popupTab = tab;
    this.internal.ctx.store.lastFocusedWindowId = this.parent(tab)?.id;
    api.activateClick({ extensionId: id, tabId: tab.id, anchorRect: bounds });
  }
  dismiss(): void { this.internal.api.browserAction.popup?.destroy(); this.internal.api.browserAction.popup = undefined; }
}
