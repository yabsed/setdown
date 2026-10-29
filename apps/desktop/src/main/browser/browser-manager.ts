import { app, dialog, Menu, session, shell, webFrameMain, WebContentsView, type Session, type WebContents, type Rectangle, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { browserURL, isWebURL } from '../../core/browser/browser-url';
import { browserFailure, browserFailureMessage } from '../../core/browser/browser-failure';
import { permissionSummaryLines } from './extension-package';
import { appZoomStep } from '../../core/zoom';
import type { BrowserCommand, BrowserEvent, BrowserExtensionInfo, BrowserPage, BrowserPlaceScope, DownloadCommand, ExtensionInstallKind, ExtensionPage } from '../../protocol/browser';
import type { WebHistory } from '../../core/workspace/tab-navigation';
import { readPreviewBounds, type PreviewBounds } from '../../protocol/preview-preparation';
import type { WindowState } from '../windows/window-state';
import { nativeZoomBounds, type WorkspaceZoom } from '../windows/workspace-zoom';
import type { WindowIpc } from '../ipc/window-ipc';
import { BrowserExtensions } from './browser-extensions';
import { BrowserPlaces } from './browser-places';
import { BrowserDownloads } from './browser-downloads';
import { extractReaderArticle, restoreReaderAnchor } from './browser-reader';
import { readReaderAnchor, type ReaderAnchor } from '../../core/browser/reader-article';
import { BrowserPermissions } from './browser-permissions';
import { browserContextMenu } from './browser-context-menu';
import { showReadingMenu } from '../menu/reading-menu';
import type { ReaderSnapshot } from '../../protocol/browser';
import { BrowserAuth } from './browser-auth';

type Entry = { owner: number; view: WebContentsView; contents: WebContents; page: BrowserPage; navigation: number; bounds?: Rectangle;
  document: number; reader?: { snapshot: ReaderSnapshot; document: number }; menuGeneration: number; find?: { request: number; query: string }; htmlFullscreen?: boolean;
  popups: number[]; externalRequests: number[]; externalPending?: boolean;
  historyUrls: string[]; historyIndex: number; canGoBack?: boolean; canGoForward?: boolean; closing?: (value: boolean) => void };
type Options = { stateFor(id: number): WindowState | null; states(): Iterable<WindowState>; zoom: WorkspaceZoom;
  theme?(): import('../../core/preview/preview-preferences').PreviewThemeId;
  createWindow?(): BrowserWindow;
  openFile(state: WindowState, file: string): Promise<unknown> };
const blankPage = (id: string, url: string): BrowserPage => ({ id, url, title: url === 'about:blank' ? 'New web tab' : url,
  startPage: url === 'about:blank', loading: false, canGoBack: false, canGoForward: false, audible: false, muted: false, zoomPercent: 100, error: null, protection: 'starting' });

/** Adapted from Min's viewManager: persistent page identity, popup adoption,
 * and isolated browser sessions, with Setdown's per-group bounds and ownership. */
export class BrowserManager {
  readonly views = new Map<string, Entry>();
  private readonly places = new BrowserPlaces();
  private readonly downloads = new BrowserDownloads(event => { this.extensions?.downloads?.publish(event); this.broadcast(event); });
  private profile?: Session;
  private extensions?: BrowserExtensions;
  private ready?: Promise<void>;
  private owners = new Set<number>();
  private restored = false;
  private saved = new Map<string, BrowserPage>();
  private dormant = new Map<string, number>();
  private transferring = new Set<number>();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saving = Promise.resolve();
  private extensionInstallBusy = false;
  private readonly rendererWaiters = new Map<number, () => void>();
  private readonly closedTabs = new Map<number, Array<{ url: string; title: string }>>();
  private readonly auth = new BrowserAuth((owner, id, request) => this.send(owner, { type: 'auth', id, request }));
  private readonly permissions = new BrowserPermissions(contents => {
    const entry = this.forContents(contents);
    return entry ? { id: entry.page.id, owner: entry.owner, contents: entry.contents, visible: entry.view.getVisible() } : undefined;
  }, (owner, id, requests) => this.send(owner, { type: 'permissions', id, requests }));
  constructor(private readonly options: Options) {}
  private pageZoom(entry: Entry): number { return this.options.zoom.tabFactor(`${entry.page.id}:website`); }
  private zoomPage(entry: Entry, steps: unknown, requireVisible = true): void {
    if (!this.live(entry) || (requireVisible && !entry.view.getVisible())) return;
    this.options.zoom.changeTab(`${entry.page.id}:website`, steps);
  }
  private get session() {
    if (!this.profile) {
      this.profile = session.fromPartition('persist:setdown-browser');
      // Session frame preloads follow committed subframe documents, including
      // frames created/navigated after the owning WebContents was initialized.
      this.profile.registerPreloadScript({ id: 'setdown-page-preload', type: 'frame',
        filePath: path.join(__dirname, 'page-preload.cjs') });
      this.permissions.install(this.profile);
      this.profile.on('will-download', (_event, item, contents) => {
        if (this.extensions?.downloads?.claim(item, contents)) return;
        const entry = this.forContents(contents);
        if (!entry && !(contents && this.isExtensionURL(contents.getURL()))) { item.cancel(); return; }
        item.setSaveDialogOptions({ title: 'Save download', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
        this.downloads.track(item);
      });
    }
    return this.profile;
  }
  /** Start extensions ahead of the first web tab: uBlock's first-run filter
   * compilation takes seconds on a fresh profile, and first navigation must
   * not stall on it (the extension still starts before any remote load).
   * A failed warmup is not latched; ensureReady retries on demand. */
  warmup(): void { void this.ensureReady().catch(() => undefined); }
  private ensureExtensions(): BrowserExtensions {
    if (!this.extensions) {
      this.extensions = new BrowserExtensions(this.session, id => this.forContentsId(id)?.contents, {
        license: 'GPL-3.0',
        createWindow: async details => {
          if (!this.options.createWindow) throw Error('Creating a browser window is unavailable.');
          if (details.type && details.type !== 'normal') throw Error('Only normal Setdown windows are supported.');
          if (details.incognito || details.tabId !== undefined) throw Error('Private windows and moving an existing tab through windows.create are not supported.');
          const urls = details.url === undefined ? ['about:blank'] : Array.isArray(details.url) ? details.url : [details.url];
          if (!urls.length || urls.length > 20 || urls.some(url => typeof url !== 'string')) throw Error('Invalid window URLs.');
          const window = this.options.createWindow();
          await this.waitForRenderer(window);
          const state = this.options.stateFor(window.webContents.id);
          if (!state) throw Error('The new window is unavailable.');
          for (const [index, url] of urls.entries()) {
            const entry = this.openEntry(state.webContentsId, randomUUID(), this.extensionURL(url));
            this.send(entry.owner, { type: 'open', page: entry.page, background: index > 0 });
            void this.load(entry, entry.page.url);
          }
          if (details.focused === false) window.showInactive(); else window.show();
          return window;
        },
        removeWindow: window => { if (!window.isDestroyed()) window.close(); },
        createTab: async details => {
          const state = details.openerTabId ? this.options.stateFor(this.forContentsId(details.openerTabId)?.owner ?? -1)
            : Array.from(this.options.states()).find(state => state.window.id === details.windowId) ?? Array.from(this.options.states()).find(state => state.window.isFocused());
          if (!state) throw Error('No browser window.');
          const entry = this.openEntry(state.webContentsId, randomUUID(), this.extensionURL(details.url ?? 'about:blank'));
          this.send(entry.owner, { type: 'open', page: entry.page, background: details.active === false });
          void this.load(entry, entry.page.url);
          return [entry.contents, state.window];
        },
        selectTab: contents => { const entry = this.forContents(contents); if (entry) this.send(entry.owner, { type: 'focus', id: entry.page.id }); },
        removeTab: contents => {
          const entry = this.forContents(contents);
          if (entry && !this.transferring.has(contents.id)) void this.close(entry.owner, entry.page.id);
        },
      }, { downloads: this.downloads, changed: () => this.broadcast({ type: 'extensions' }), theme: this.options.theme });
      this.extensions.prepare();
    }
    return this.extensions;
  }
  private waitForRenderer(window: BrowserWindow): Promise<void> {
    const id = window.webContents.id;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); this.rendererWaiters.delete(id); window.removeListener('closed', closed);
        if (error) reject(error); else resolve();
      };
      const closed = () => finish(Error('Window closed during creation.'));
      const timer = setTimeout(() => finish(Error('The new window did not finish initializing.')), 30_000);
      window.once('closed', closed); this.rendererWaiters.set(id, () => finish());
    });
  }
  private ensureReady(): Promise<void> {
    const extensions = this.ensureExtensions();
    this.ready ??= extensions.start().catch(error => { this.ready = undefined; throw error; });
    return this.ready;
  }
  private extensionURL(url: string): string {
    return this.extensions?.extensionURL(url) ?? browserURL(url);
  }
  private isExtensionURL(url: string): boolean { return !!this.extensions?.isExtensionURL(url); }
  private forContents(contents: WebContents | null | undefined) { return contents && this.forContentsId(contents.id); }
  private forContentsId(id: number) { return Array.from(this.views.values()).find(entry => entry.contents.id === id); }
  private owned(owner: number, id: unknown): Entry {
    const entry = typeof id === 'string' ? this.views.get(id) : undefined;
    if (!entry || entry.owner !== owner || entry.contents.isDestroyed()) throw Error('This web tab does not belong to this window.');
    return entry;
  }
  readerReady(owner: number, id: string): boolean {
    const entry = this.views.get(id);
    return !!entry && this.live(entry) && entry.owner === owner && !!entry.reader && entry.reader.document === entry.document;
  }
  async exportReader(owner: number, id: string, format: 'markdown' | 'pdf', theme: import('../../core/preview/preview-preferences').PreviewThemeId) {
    const entry = this.owned(owner, id), reader = entry.reader;
    if (!reader || reader.document !== entry.document || entry.page.url !== reader.snapshot.article.url) return { canceled: true };
    const { exportReader } = await import('./reader-exporter');
    const state = this.options.stateFor(owner);
    if (!state || state.window.isDestroyed() || !this.live(entry) || entry.owner !== owner || entry.reader !== reader || reader.document !== entry.document) return { canceled: true };
    return exportReader(state.window, reader.snapshot.article, format, theme,
      () => this.live(entry) && entry.owner === owner && entry.reader === reader && reader.document === entry.document);
  }
  owns(owner: number, id: string) { return this.views.get(id)?.owner === owner; }
  reloadFocused(owner: number, ignoreCache = false): boolean {
    const id = this.options.zoom.activeTab(owner), entry = id ? this.views.get(id) : undefined;
    if (!entry || entry.owner !== owner || entry.contents.isDestroyed()) return false;
    entry.page.error = null; entry.page.failure = undefined;
    const wc = entry.contents;
    if (wc.isCrashed() || wc.getURL() !== entry.page.url) void this.load(entry, entry.page.url);
    else if (ignoreCache) wc.reloadIgnoringCache(); else wc.reload();
    return true;
  }
  private send(owner: number, event: BrowserEvent) {
    const state = this.options.stateFor(owner);
    if (state && !state.window.isDestroyed() && !state.window.webContents.isDestroyed()) state.window.webContents.send('browser:event', event);
  }
  private broadcast(event: BrowserEvent) { for (const state of this.options.states()) this.send(state.webContentsId, event); }
  private live(entry: Entry): boolean {
    const state = this.options.stateFor(entry.owner);
    return this.views.get(entry.page.id) === entry && !entry.contents.isDestroyed()
      && !!state && !state.window.isDestroyed() && !state.window.webContents.isDestroyed();
  }
  private publish(entry: Entry) {
    if (!this.live(entry)) return;
    const wc = entry.contents;
    entry.page = { ...entry.page, loading: wc.isLoading() || entry.page.protection === 'starting', canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(), audible: wc.isCurrentlyAudible(), muted: wc.isAudioMuted(),
      zoomPercent: Math.round(this.pageZoom(entry) * 100) };
    this.send(entry.owner, { type: 'page', page: entry.page });
  }
  private error(entry: Entry, error: unknown) {
    entry.page.error = error instanceof Error ? error.message : String(error);
    this.publish(entry);
  }
  private persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }
  private serializedTabs() {
    return JSON.stringify([...this.saved.values()].filter(p => isWebURL(p.url)).map(p => ({ id: p.id, url: p.url, title: p.title })));
  }
  flush() {
    clearTimeout(this.saveTimer);
    if (!this.restored && !this.saved.size) return Promise.resolve();
    const data = this.serializedTabs();
    const file = path.join(app.getPath('userData'), 'browser-tabs.json');
    this.saving = this.saving.catch(() => {}).then(async () => { await fs.writeFile(`${file}.tmp`, data); await fs.rename(`${file}.tmp`, file); });
    void this.saving.catch(console.error);
    return this.saving;
  }
  flushOnExit() {
    this.downloads.flushOnExit();
    // will-quit cannot await promises. Commit the small tab manifest using a
    // different temporary file from any in-flight debounced write.
    if (!this.restored && !this.saved.size) return;
    const file = path.join(app.getPath('userData'), 'browser-tabs.json');
    writeFileSync(`${file}.shutdown`, this.serializedTabs());
    renameSync(`${file}.shutdown`, file);
  }
  private trackOwner(owner: number) {
    if (this.owners.has(owner)) return;
    this.owners.add(owner);
    const state = this.options.stateFor(owner)!;
    state.window.once('closed', () => this.closeOwner(owner));
  }
  private closeOwner(owner: number) {
    const entries = [...this.views.values()].filter(entry => entry.owner === owner);
    // Retire every page before closing any native contents. Closing can emit
    // synchronous loading/audio events, after the View's getter is cleared.
    for (const entry of entries) this.views.delete(entry.page.id);
    for (const entry of entries) {
      this.permissions.clear(owner, entry.page.id);
      this.auth.clear(entry.page.id);
      const resolve = entry.closing; entry.closing = undefined; resolve?.(true);
      if (!entry.contents.isDestroyed()) entry.contents.close();
    }
    for (const [id, tabOwner] of this.dormant) if (tabOwner === owner) this.dormant.delete(id);
    this.owners.delete(owner);
    this.closedTabs.delete(owner);
    if (!this.owners.size) this.places.dispose();
  }
  private openEntry(owner: number, id: string, url: string, existing?: WebContents): Entry {
    const state = this.options.stateFor(owner);
    if (!state || state.window.isDestroyed()) throw Error('The window no longer exists.');
    this.trackOwner(owner);
    const view = new WebContentsView({ webPreferences: { session: this.session,
      sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInSubFrames: true, safeDialogs: true, backgroundThrottling: true,
      autoplayPolicy: 'document-user-activation-required' },
      ...(existing ? { webContents: existing } : {}) });
    view.setVisible(false);
    // Hidden initial navigation stays detached, preserving document IME focus.
    const wc = view.webContents;
    const entry: Entry = { owner, view, contents: wc, page: blankPage(id, url), navigation: 0, document: 0, menuGeneration: 0, popups: [], externalRequests: [],
      historyUrls: [], historyIndex: -1 };
    this.views.set(id, entry);
    this.options.zoom.track(wc, () => this.publish(entry), () => this.pageZoom(entry));
    wc.on('ipc-message', (event, channel, steps) => {
      if (channel === 'browser:wheel-zoom') this.zoomPage(entry, steps);
      const frame = event.senderFrame;
      if (channel === 'browser:escape' && frame && frame === wc.focusedFrame && view.getVisible() && !entry.htmlFullscreen) {
        if (wc.isLoading()) wc.stop();
        else if (isWebURL(wc.getURL())) {
          this.options.stateFor(entry.owner)?.window.webContents.focus();
          this.send(entry.owner, { type: 'reader', id });
        }
      }
      if (channel === 'browser:frame-ready' && frame && !frame.isDestroyed()) {
        frame.send('browser:frame-policy');
      }
    });
    wc.on('did-frame-finish-load', (_event, _main, processId, routingId) => {
      const frame = webFrameMain.fromId(processId, routingId);
      if (!frame || frame.isDestroyed()) return;
      frame.send('browser:frame-policy', true);
      // Frame-local insertion is also available from a live ancestor in the
      // same renderer process, independent of the child's provisional Window.
      let policyParent: Electron.WebFrameMain | null = null;
      for (let parent = frame.parent; parent; parent = parent.parent) {
        if (!parent.isDestroyed() && parent.processId === frame.processId) {
          policyParent = parent;
        }
      }
      policyParent?.send('browser:child-frame-policy', frame.frameToken);
    });
    wc.on('zoom-changed', (_event, direction) => this.zoomPage(entry, direction === 'in' ? 1 : -1));
    wc.on('did-start-navigation', (_event, _url, inPlace, main) => {
      entry.menuGeneration++;
      if (!main || inPlace) return;
      entry.document++; entry.reader = undefined; entry.find = undefined; entry.page.error = null; entry.page.failure = undefined;
      this.send(entry.owner, { type: 'document', id });
      this.auth.clear(id);
      this.permissions.clear(entry.owner, id);
      this.send(entry.owner, { type: 'find', id, query: '', active: 0, matches: 0 });
    });
    wc.on('enter-html-full-screen', () => { entry.htmlFullscreen = true; });
    wc.on('leave-html-full-screen', () => { entry.htmlFullscreen = false; });
    wc.on('login', (event, details, authInfo, callback) => {
      if (this.extensions?.network?.auth.request(event, wc, details, authInfo, callback)) return;
      event.preventDefault(); this.auth.request(entry.owner, id, details.url, authInfo, callback);
    });
    const register = () => this.extensions?.host?.addTab(wc, this.options.stateFor(entry.owner)!.window);
    void this.ensureReady().then(() => { if (this.live(entry)) { register(); entry.page.protection = 'ready'; this.publish(entry); } })
      .catch(error => { if (this.live(entry)) { entry.page.protection = 'error'; this.error(entry, error); } });
    const navigation = (_event: Electron.Event, next: string) => {
      if (!this.live(entry)) return;
      const history = wc.navigationHistory, index = history.getActiveIndex();
      if (index > entry.historyIndex && entry.historyUrls[index] !== next) this.send(entry.owner, { type: 'navigation', id });
      entry.historyIndex = index;
      entry.historyUrls = Array.from({ length: history.length() }, (_, i) => history.getEntryAtIndex(i).url);
      entry.page.url = next; entry.page.error = null;
      if (next !== 'about:blank') entry.page.startPage = false;
      this.saved.set(id, entry.page); this.persist(); this.publish(entry);
    };
    wc.on('did-navigate', navigation);
    wc.on('did-navigate-in-page', (event, url, main) => { if (main) navigation(event, url); });
    wc.on('page-title-updated', (_event, title) => { if (!this.live(entry)) return; entry.page.title = title; this.publish(entry); this.saved.set(id, entry.page); this.persist(); });
    wc.on('did-start-loading', () => this.publish(entry));
    wc.on('did-stop-loading', () => this.publish(entry));
    wc.on('did-finish-load', () => {
      if (!this.live(entry)) return;
      if (isWebURL(wc.getURL())) void this.places.update(wc.getURL(), wc.getTitle(), { visit: true })
        .then(() => this.broadcast({ type: 'places' })).catch(console.error);
    });
    wc.on('did-fail-load', (_event, code, _description, url, main) => {
      if (!main || code === -3) return;
      entry.page.failure = browserFailure(url, code);
      if (isWebURL(url)) entry.page.url = url;
      this.error(entry, browserFailureMessage(entry.page.failure));
    });
    wc.on('render-process-gone', () => {
      this.permissions.clear(entry.owner, id); this.auth.clear(id); entry.find = undefined; entry.document++;
      entry.page.failure = { kind: 'crash', url: entry.page.url, code: 0 };
      this.error(entry, browserFailureMessage(entry.page.failure));
    });
    wc.on('audio-state-changed', () => this.publish(entry));
    wc.on('focus', () => { if (this.live(entry) && view.getVisible()) this.send(entry.owner, { type: 'focus', id }); });
    wc.on('found-in-page', (_event, result) => {
      if (entry.find?.request === result.requestId) this.send(entry.owner, { type: 'find', id, query: entry.find.query,
        active: result.activeMatchOrdinal, matches: result.matches });
    });
    wc.on('will-prevent-unload', event => {
      const owner = this.options.stateFor(entry.owner);
      const choice = owner && dialog.showMessageBoxSync(owner.window, { type: 'question', message: 'Leave this page?',
        detail: 'The page may have unsaved changes.', buttons: ['Stay', 'Leave'], defaultId: 0, cancelId: 0 });
      if (choice === 1) event.preventDefault(); else { entry.closing?.(false); entry.closing = undefined; }
    });
    wc.on('destroyed', () => {
      const resolve = entry.closing; entry.closing = undefined; resolve?.(true);
      if (this.views.get(id) !== entry) return;
      this.permissions.clear(entry.owner, id);
      this.auth.clear(id);
      this.views.delete(id);
      if (this.options.stateFor(entry.owner)) { this.saved.delete(id); this.persist(); }
      this.send(entry.owner, { type: 'close', id });
    });
    wc.on('will-navigate', (event, next) => {
      if (!isWebURL(next) && next !== 'about:blank' && !this.isExtensionURL(next)) {
        event.preventDefault(); void this.external(entry, next);
      }
    });
    wc.on('will-redirect', (event, next) => { if (!isWebURL(next)) event.preventDefault(); });
    wc.setWindowOpenHandler(details => {
      if (!isWebURL(details.url) && details.url !== 'about:blank'
        && !this.isExtensionURL(details.url)) {
        void this.external(entry, details.url); return { action: 'deny' };
      }
      // Keep genuine popup contents/opener/POST bodies. Bound unsolicited bursts
      // without treating Electron's disposition as a user-activation signal.
      const now = Date.now(); entry.popups = entry.popups.filter(time => now - time < 10_000);
      if (entry.popups.length >= 5) return { action: 'deny' };
      entry.popups.push(now);
      // Min's createWindow adoption preserves opener relationships, POST bodies,
      // and about:blank scripts instead of recreating a popup from its URL.
      // Adopted pages are independent tabs. Electron otherwise destroys them
      // with their opener, even after moving them into another workspace window.
      return { action: 'allow', outlivesOpener: true, createWindow: options => {
        const popup = this.openEntry(entry.owner, randomUUID(), details.url, (options as Electron.BrowserWindowConstructorOptions & { webContents?: WebContents }).webContents);
        popup.page.startPage = false;
        this.send(entry.owner, { type: 'open', page: popup.page, background: !entry.view.getVisible() || details.disposition === 'background-tab' });
        return popup.contents;
      } };
    });
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isComposing) return;
      const owner = this.options.stateFor(entry.owner);
      if (!owner) return;
      const step = appZoomStep(input);
      if (step !== undefined) { event.preventDefault(); this.options.zoom.change(step); return; }
      const key = input.key.toLowerCase(), modifier = input.control || input.meta;
      const command = modifier && key === 'l' ? 'focus-location' : modifier && key === 't' ? input.shift ? 'reopen-web-tab' : 'new-web-tab'
        : modifier && key === 'w' ? 'close-tab' : modifier && key === 'f' ? 'open-find'
        : input.control && key === 'tab' ? input.shift ? 'previous-tab' : 'next-tab' : null;
      if (command) { event.preventDefault(); owner.window.webContents.focus(); owner.window.webContents.send('app:command', command); }
      else if ((modifier && key === 'r') || key === 'f5') { event.preventDefault(); if (input.shift || (key === 'f5' && modifier)) wc.reloadIgnoringCache(); else wc.reload(); }
      else if (input.alt && (key === 'arrowleft' || key === 'arrowright')) {
        event.preventDefault(); this.send(entry.owner, { type: 'history', id, direction: key === 'arrowleft' ? -1 : 1 });
      }
    });
    wc.on('context-menu', (_event, params) => {
      const owner = this.options.stateFor(entry.owner);
      if (!owner) return;
      const generation = entry.menuGeneration, sourceOwner = entry.owner;
      const valid = () => !wc.isDestroyed() && entry.menuGeneration === generation && entry.owner === sourceOwner;
      const items: Array<Electron.MenuItem | Electron.MenuItemConstructorOptions> = browserContextMenu(wc, params, valid, (url, background) => {
        // Finish the native menu dispatch before constructing another native
        // view. Recheck ownership/document after leaving the menu's event loop.
        setImmediate(() => { if (valid()) void this.openLink(sourceOwner, url, background).catch(error => this.error(entry, error)); });
      },
        direction => this.send(entry.owner, { type: 'history', id, direction }),
        !!entry.canGoBack || wc.navigationHistory.canGoBack(), !!entry.canGoForward || wc.navigationHistory.canGoForward());
      const extensionItems = this.extensions?.host?.getContextMenuItems(wc, params) ?? [];
      if (extensionItems.length) items.push({ type: 'separator' }, ...extensionItems, { type: 'separator' });
      items.push({ label: 'Open in Default Browser', enabled: isWebURL(wc.getURL()), click: () => { if (valid()) void this.external(entry, wc.getURL(), true); } },
        { label: 'Site Controls…', enabled: isWebURL(wc.getURL()), click: () => { setImmediate(() => { if (valid()) this.siteMenu(entry); }); } });
      Menu.buildFromTemplate(items).popup({ window: owner.window, frame: params.frame ?? undefined });
    });
    return entry;
  }
  async create(owner: number, id: string, input: string, history?: WebHistory): Promise<BrowserPage> {
    if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) throw Error('Invalid web tab ID.');
    if (this.views.has(id)) return this.owned(owner, id).page;
    if (this.dormant.has(id) && this.dormant.get(id) !== owner) throw Error('This web tab does not belong to this window.');
    const url = browserURL(input);
    if (history && (!Array.isArray(history.entries) || !history.entries.length || history.entries.length > 1000
      || !Number.isInteger(history.index) || history.index < 0 || history.index >= history.entries.length
      || history.entries.some(e => !e || (!isWebURL(e.url) && e.url !== 'about:blank') || typeof e.title !== 'string'
        || (e.pageState !== undefined && typeof e.pageState !== 'string')))) throw Error('Invalid web history.');
    // Install session frame preloads before creating the RenderFrameHost.
    // Creating about:blank first can capture an incomplete preload registry;
    // its descendants then miss page policy and wheel handlers altogether.
    // Only the synchronous registration must precede the view: the tab can
    // appear immediately while load() still waits for uBlock to be ready
    // before any remote navigation.
    this.ensureExtensions();
    this.dormant.delete(id);
    const entry = this.openEntry(owner, id, url);
    if (history) { entry.historyUrls = history.entries.map(e => e.url); entry.historyIndex = history.index; }
    this.saved.set(id, entry.page); this.persist();
    void this.load(entry, entry.page.url, history);
    return entry.page;
  }
  private async load(entry: Entry, url: string, history?: WebHistory) {
    const navigation = ++entry.navigation;
    entry.page.url = url; entry.page.error = null; entry.page.startPage = url === 'about:blank';
    this.publish(entry);
    try {
      await this.ensureReady();
      if (navigation !== entry.navigation || !this.live(entry)) return;
      if (isWebURL(url)) this.extensions?.network?.assertReady();
      entry.page.error = null;
      entry.page.protection = 'ready';
      this.extensions?.host?.addTab(entry.contents, this.options.stateFor(entry.owner)!.window);
      if (history) await entry.contents.navigationHistory.restore(history);
      else await entry.contents.loadURL(url);
    } catch (error) {
      if (navigation === entry.navigation && !entry.contents.isDestroyed()
        && (error as { code?: string }).code !== 'ERR_ABORTED' && !entry.page.failure) this.error(entry, error);
    }
  }
  async openLink(owner: number, url: string, background = false) {
    const page = await this.create(owner, randomUUID(), url);
    this.send(owner, { type: 'open', page, background });
  }
  async close(owner: number, id: string, remember = false): Promise<boolean> {
    const page = this.saved.get(id) ?? this.views.get(id)?.page;
    const metadata = page && { url: page.url, title: page.title };
    const rememberClosed = () => {
      if (!remember || !metadata || !isWebURL(metadata.url)) return;
      const stack = this.closedTabs.get(owner) ?? [];
      stack.push(metadata); if (stack.length > 10) stack.shift(); this.closedTabs.set(owner, stack);
    };
    if (this.dormant.get(id) === owner) {
      this.dormant.delete(id); this.saved.delete(id); this.persist(); rememberClosed(); return true;
    }
    const entry = this.owned(owner, id);
    if (entry.closing) return false;
    const closed = await new Promise<boolean>(resolve => {
      entry.closing = resolve;
      entry.contents.close({ waitForBeforeUnload: true });
    });
    if (closed) { this.saved.delete(id); this.persist(); rememberClosed(); }
    return closed;
  }
  adopt(source: number, destination: number, id: string): boolean {
    const entry = this.owned(source, id), target = this.options.stateFor(destination);
    if (!target) return false;
    this.permissions.clear(source, id);
    this.auth.clear(id);
    entry.find = undefined; entry.document++;
    entry.view.setVisible(false);
    this.options.stateFor(source)?.window.contentView.removeChildView(entry.view);
    entry.owner = destination; entry.bounds = undefined; this.trackOwner(destination);
    // The host's removeTab hook normally closes the real page. Reparenting only
    // updates extension ownership; the live page and its opener must survive.
    this.transferring.add(entry.contents.id);
    try {
      this.extensions?.host?.removeTab(entry.contents);
      this.extensions?.host?.addTab(entry.contents, target.window);
    } finally { this.transferring.delete(entry.contents.id); }
    return true;
  }
  layout(owner: number, entries: Array<{ id: string; bounds: PreviewBounds; canGoBack?: boolean; canGoForward?: boolean }>) {
    const state = this.options.stateFor(owner);
    if (!state || !Array.isArray(entries)) return;
    const visible = new Set<string>();
    for (const item of entries.slice(0, 32)) {
      const entry = this.views.get(item.id), css = readPreviewBounds(item.bounds);
      if (!entry || entry.owner !== owner || !css || entry.contents.isDestroyed()) continue;
      entry.canGoBack = item.canGoBack === true; entry.canGoForward = item.canGoForward === true;
      const bounds = nativeZoomBounds(css, state.window.webContents.getZoomFactor());
      const [width, height] = state.window.getContentSize();
      bounds.width = Math.max(1, Math.min(bounds.width, width - bounds.x));
      bounds.height = Math.max(1, Math.min(bounds.height, height - bounds.y));
      if (!entry.bounds || Object.keys(bounds).some(k => bounds[k as keyof Rectangle] !== entry.bounds![k as keyof Rectangle])) {
        entry.view.setBounds(bounds); entry.bounds = bounds;
      }
      if (!state.window.contentView.children.includes(entry.view)) state.window.contentView.addChildView(entry.view);
      entry.view.setVisible(true); visible.add(item.id);
    }
    for (const [id, entry] of this.views) if (entry.owner === owner && !visible.has(id)) {
      entry.view.setVisible(false);
      // Detach hidden pages like Min: remove unused native children while
      // retaining their WebContents/form/history and Chromium's throttling.
      if (state.window.contentView.children.includes(entry.view)) state.window.contentView.removeChildView(entry.view);
    }
  }
  private async external(entry: Entry, url: string, explicit = false) {
    const state = this.options.stateFor(entry.owner);
    if (!state || !/^(https?:|mailto:|tel:)/i.test(url)) return;
    const owner = entry.owner, generation = entry.document;
    if (!explicit) {
      const now = Date.now(); entry.externalRequests = entry.externalRequests.filter(time => now - time < 20_000);
      if (entry.externalPending || entry.externalRequests.length >= 2 || !entry.view.getVisible()) return;
      entry.externalRequests.push(now); entry.externalPending = true;
      try {
      const choice = await dialog.showMessageBox(state.window, { message: 'Open an external application?', detail: url,
        buttons: ['Cancel', 'Open'], defaultId: 0, cancelId: 0 });
      if (choice.response !== 1) return;
      } finally { entry.externalPending = false; }
    }
    if (entry.contents.isDestroyed() || entry.document !== generation || entry.owner !== owner) return;
    await shell.openExternal(url);
  }
  private permissionMenu(entry: Entry) {
    const owner = entry.owner, generation = entry.document, state = this.options.stateFor(owner);
    if (!state) return;
    Menu.buildFromTemplate(this.permissions.requests(entry.page.id).map(request => ({ label: `${request.label} · ${request.origin}`, submenu: [
      { label: 'Allow for This Page', click: () => {
        if (entry.owner === owner && entry.document === generation && !entry.contents.isDestroyed()) this.permissions.respond(owner, entry.page.id, request.token, true);
      } },
      { label: 'Deny', click: () => this.permissions.respond(owner, entry.page.id, request.token, false) },
    ] }))).popup({ window: state.window });
  }
  private siteMenu(entry: Entry) {
    const wc = entry.contents, owner = entry.owner, generation = entry.document, state = this.options.stateFor(owner);
    if (!state || !isWebURL(wc.getURL())) return;
    const origin = new URL(wc.getURL()).origin;
    const valid = () => !wc.isDestroyed() && entry.owner === owner && entry.document === generation;
    Menu.buildFromTemplate([
      { label: origin, enabled: false },
      { label: entry.page.muted ? 'Unmute Tab' : 'Mute Tab', click: () => { if (valid()) { wc.setAudioMuted(!wc.isAudioMuted()); this.publish(entry); } } },
      { label: 'Reset Page Permissions', click: () => { if (valid()) { this.permissions.clear(owner, entry.page.id); wc.reload(); } } },
      { label: 'Clear This Site’s Data…', click: () => { void (async () => {
        if (!valid()) return;
        const choice = await dialog.showMessageBox(state.window, { message: 'Clear this site’s data?',
          detail: `${origin}\nThis signs you out. Cookies shared with related subdomains are also removed. Bookmarks and history are kept.`, buttons: ['Cancel', 'Clear'], defaultId: 0, cancelId: 0 });
        if (choice.response !== 1 || !valid()) return;
        await wc.session.clearData({ origins: [origin], originMatchingMode: 'origin-in-all-contexts',
          dataTypes: ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems', 'cache'] });
        if (valid()) { this.permissions.clear(owner, entry.page.id); wc.reload(); }
      })().catch(error => this.error(entry, error)); } },
    ]).popup({ window: state.window });
  }
  registerIpc(channels: WindowIpc) {
    channels.handle('browser:create', (state, id: string, url: string, history?: WebHistory) => this.create(state.webContentsId, id, url, history));
    channels.handle('browser:history', (state, id: string): WebHistory => {
      const entry = this.owned(state.webContentsId, id), history = entry.contents.navigationHistory;
      const entries = history.getAllEntries();
      return entries.length ? { entries, index: history.getActiveIndex() }
        : { entries: [{ url: entry.page.url, title: entry.page.title }], index: 0 };
    });
    channels.handle('browser:navigate', async (state, id: string, input: string) => {
      const entry = this.owned(state.webContentsId, id); await this.load(entry, browserURL(input));
    });
    channels.handle('browser:close', (state, id: string, remember?: boolean) => this.close(state.webContentsId, id, remember === true));
    channels.handle('browser:authenticate', (state, id: string, token: string, credentials: { username: string; password: string } | null) => {
      this.owned(state.webContentsId, id); this.auth.respond(state.webContentsId, id, token, credentials);
    });
    channels.handle('browser:reopen', async state => {
      const stack = this.closedTabs.get(state.webContentsId), previous = stack?.pop();
      if (!previous) return;
      try { await this.openLink(state.webContentsId, previous.url); }
      catch (error) { stack!.push(previous); throw error; }
    });
    channels.on('browser:layout', (state, entries: Array<{ id: string; bounds: PreviewBounds }>) => this.layout(state.webContentsId, entries));
    channels.handle('browser:capture', async (state, id: string) => {
      const entry = this.owned(state.webContentsId, id);
      return entry.view.getVisible() ? (await entry.contents.capturePage()).toDataURL() : null;
    });
    channels.handle('browser:reader-extract', async (state, id: string) => {
      const entry = this.owned(state.webContentsId, id);
      if (!isWebURL(entry.contents.getURL())) return null;
      const document = entry.document;
      const snapshot = await extractReaderArticle(entry.contents);
      if (!this.live(entry) || entry.owner !== state.webContentsId || document !== entry.document || snapshot?.article.url !== entry.page.url) return null;
      entry.reader = { snapshot, document }; return snapshot;
    });
    channels.handle('browser:reader-menu', (state, id: string, context: { selection: string; link: string }) => {
      const entry = this.owned(state.webContentsId, id), document = entry.document;
      if (!this.readerReady(state.webContentsId, id) || !context || typeof context.selection !== 'string' || typeof context.link !== 'string') return null;
      return showReadingMenu(state.window, { selection: context.selection, link: context.link, markdown: true, pdf: true },
        () => this.live(entry) && entry.owner === state.webContentsId && entry.document === document && !state.window.isDestroyed(),
        url => { void this.openLink(entry.owner, url); });
    });
    channels.handle('browser:reader-restore', async (state, id: string, anchor: ReaderAnchor) => {
      const entry = this.owned(state.webContentsId, id), valid = readReaderAnchor(anchor);
      return valid ? restoreReaderAnchor(entry.contents, valid) : false;
    });
    channels.handle('browser:command', async (state, id: string, command: BrowserCommand) => {
      const entry = this.owned(state.webContentsId, id), wc = entry.contents;
      if (command === 'back' || command === 'forward') {
        const offset = command === 'back' ? -1 : 1;
        if (!wc.navigationHistory.canGoToOffset(offset)) return false;
        wc.navigationHistory.goToOffset(offset); return true;
      }
      else if (command === 'reload') {
        if (entry.page.protection === 'ready' && wc.getURL() === entry.page.url && !wc.isCrashed()) { entry.page.error = null; wc.reload(); }
        else await this.load(entry, entry.page.url);
      }
      else if (command === 'reload-no-cache') {
        entry.page.error = null; entry.page.failure = undefined;
        if (wc.getURL() === entry.page.url && !wc.isCrashed()) wc.reloadIgnoringCache(); else await this.load(entry, entry.page.url);
      }
      else if (command === 'permissions') this.permissionMenu(entry);
      else if (command === 'site-info') this.siteMenu(entry);
      else if (command === 'stop') { entry.navigation++; wc.stop(); }
      else if (command === 'activate' || command === 'focus') {
        state.currentDocument = null;
        this.extensions?.host?.selectTab(wc);
        if (command === 'focus' && entry.view.getVisible()) wc.focus();
      } else if (command === 'mute') { wc.setAudioMuted(!wc.isAudioMuted()); this.publish(entry); }
      else if (command === 'zoom-in' || command === 'zoom-out' || command === 'zoom-reset') {
        this.zoomPage(entry, command === 'zoom-reset' ? 0 : command === 'zoom-in' ? 1 : -1, false);
      }
      else if (command === 'external') await this.external(entry, wc.getURL(), true);
      else if (command === 'save') {
        const result = await dialog.showSaveDialog(state.window, { title: 'Save web page', defaultPath: 'page.html', filters: [{ name: 'Web page', extensions: ['html'] }] });
        if (!result.canceled && result.filePath) await wc.savePage(result.filePath, 'HTMLComplete');
      } else if (command === 'protection' && this.extensions?.builtinPopupURL()) {
        this.extensions.bridge?.activate(this.extensions.extensionId!, wc, { x: state.window.getContentBounds().width - 40, y: 80, width: 28, height: 28 });
      }
    });
    channels.on('browser:find', (state, id: string, text: string, forward: boolean = true, next: boolean = false) => {
      if (!this.owns(state.webContentsId, id)) return;
      const entry = this.owned(state.webContentsId, id), wc = entry.contents;
      const query = typeof text === 'string' ? text.slice(0, 1000) : '';
      // Electron's findNext is Chromium's new_session flag: true starts a
      // search; false advances an existing session (despite the API name).
      if (query) entry.find = { request: wc.findInPage(query, { forward, findNext: !next || entry.find?.query !== query }), query };
      else { entry.find = undefined; wc.stopFindInPage('clearSelection'); this.send(entry.owner, { type: 'find', id, query: '', active: 0, matches: 0 }); }
    });
    channels.handle('browser:places', (_state, query: string, scope?: BrowserPlaceScope) => this.places.search(query, scope));
    channels.handle('browser:bookmark', async (_state, url: string, title: string, bookmarked: boolean) => {
      if (!isWebURL(url)) throw Error('Only web pages can be bookmarked.');
      await this.places.update(url, String(title), { bookmarked: bookmarked === true });
      this.broadcast({ type: 'places' });
    });
    channels.handle('browser:delete-history', async (_state, url?: string) => {
      if (url !== undefined && !isWebURL(url)) throw Error('Invalid history URL.');
      await this.places.deleteHistory(url); this.broadcast({ type: 'places' });
    });
    channels.on('browser:ready', state => { this.rendererWaiters.get(state.webContentsId)?.(); });
    channels.handle('browser:extensions', async (): Promise<BrowserExtensionInfo[]> => {
      await this.ensureReady();
      return this.extensions!.list();
    });
    channels.handle('browser:extension-install', async (state, kind: ExtensionInstallKind, input?: string): Promise<BrowserExtensionInfo[]> => {
      if (!['folder', 'archive', 'web-store'].includes(kind)) throw Error('Unknown extension installation source.');
      if (this.extensionInstallBusy) throw Error('Another extension installation is in progress.');
      this.extensionInstallBusy = true;
      try {
        await this.ensureReady();
        const extensions = this.extensions!;
        if (state.window.isDestroyed()) return extensions.list();
        const picked = kind === 'web-store' ? null : await dialog.showOpenDialog(state.window, kind === 'folder'
          ? { title: 'Install extension from folder', properties: ['openDirectory'] }
          : { title: 'Install extension package', properties: ['openFile'],
              filters: [{ name: 'Extension package (.zip, .crx)', extensions: ['zip', 'crx'] }] });
        if (picked && (picked.canceled || !picked.filePaths[0])) return extensions.list();
        const inspected = kind === 'web-store' ? await extensions.inspectWebStore(input) : await extensions.inspect(picked!.filePaths[0]);
        try {
          if (state.window.isDestroyed()) return extensions.list();
          const requested = permissionSummaryLines(inspected.info);
          const choice = await dialog.showMessageBox(state.window, { type: 'warning',
            message: `Install “${inspected.info.name}” ${inspected.info.version}?`,
            detail: `${kind === 'web-store' ? 'Downloaded from Chrome Web Store.\n\n' : ''}Extensions can read and change pages you visit.${requested.length ? `\n\nRequested permissions:\n${requested.join('\n')}` : ''}\n\nOnly install extensions you trust. CRX signatures are not verified.`,
            buttons: ['Cancel', 'Install'], defaultId: 0, cancelId: 0 });
          if (choice.response !== 1 || state.window.isDestroyed()) return extensions.list();
          await extensions.commit(inspected.token);
        } finally {
          await extensions.discard(inspected.token).catch(() => undefined);
        }
        this.broadcast({ type: 'extensions' });
        return extensions.list();
      } finally { this.extensionInstallBusy = false; }
    });
    channels.handle('browser:extension-set-enabled', async (_state, id: string, enabled: boolean): Promise<BrowserExtensionInfo[]> => {
      if (this.extensionInstallBusy) throw Error('Finish the current extension installation first.');
      await this.ensureReady();
      const rows = await this.extensions!.setEnabled(String(id), enabled === true);
      this.broadcast({ type: 'extensions' });
      return rows;
    });
    channels.handle('browser:extension-remove', async (state, id: string): Promise<BrowserExtensionInfo[]> => {
      if (this.extensionInstallBusy) throw Error('Finish the current extension installation first.');
      await this.ensureReady();
      const extensions = this.extensions!;
      const target = extensions.list().find(item => item.id === String(id));
      if (!target) throw Error('Unknown extension.');
      if (target.builtin) throw Error('Built-in extensions cannot be removed.');
      const choice = await dialog.showMessageBox(state.window, { type: 'warning',
        message: `Remove “${target.name}”?`, detail: 'Its installed files will be deleted.',
        buttons: ['Cancel', 'Remove'], defaultId: 0, cancelId: 0 });
      if (choice.response !== 1) return extensions.list();
      const rows = await extensions.remove(target.id);
      this.broadcast({ type: 'extensions' });
      return rows;
    });
    channels.handle('browser:extension-actions', async (state, tabId: string) => {
      const target = this.owned(state.webContentsId, tabId);
      await this.ensureReady();
      return this.extensions!.bridge!.actions(target.contents.id);
    });
    channels.handle('browser:extension-activate', async (state, id: string, tabId: string, raw: unknown) => {
      const target = this.owned(state.webContentsId, tabId), css = readPreviewBounds(raw);
      if (!css) throw Error('Invalid extension button bounds.');
      await this.ensureReady();
      this.extensions!.host!.selectTab(target.contents);
      this.extensions!.bridge!.activate(String(id), target.contents, nativeZoomBounds(css, state.window.webContents.getZoomFactor()));
    });
    channels.handle('browser:extension-menu', async (state, tabId: string, raw: unknown) => {
      const target = this.owned(state.webContentsId, tabId), css = readPreviewBounds(raw);
      if (!css) throw Error('Invalid extension menu bounds.');
      await this.ensureReady();
      const bounds = nativeZoomBounds(css, state.window.webContents.getZoomFactor());
      this.extensions!.host!.selectTab(target.contents);
      await this.extensions!.bridge!.menu(target.contents, bounds);
    });
    channels.handle('browser:extension-open', async (state, id: string, page: ExtensionPage, tabId?: string) => {
      await this.ensureReady();
      if (page !== 'options') {
        const target = tabId ? this.owned(state.webContentsId, tabId).contents : this.extensions!.bridge?.activeTab();
        if (!target || this.extensions!.bridge?.parent(target) !== state.window) throw Error('Open a web tab before using an extension.');
        this.extensions!.host!.selectTab(target);
        this.extensions!.bridge!.activate(String(id), target, { x: state.window.getContentBounds().width - 40, y: 80, width: 28, height: 28 });
        return;
      }
      const url = this.extensions!.pageURL(String(id), 'options');
      const entry = this.openEntry(state.webContentsId, randomUUID(), url);
      this.send(entry.owner, { type: 'open', page: entry.page, background: false });
      void this.load(entry, entry.page.url);
    });
    channels.handle('browser:downloads', () => this.downloads.list());
    channels.handle('browser:download-command', (_state, id: string, command: DownloadCommand) => this.downloads.command(id, command));
    channels.handle('browser:restore', async state => {
      const own = [...this.views.values()].filter(e => e.owner === state.webContentsId).map(e => e.page);
      own.push(...[...this.dormant].filter(([, owner]) => owner === state.webContentsId).map(([id]) => this.saved.get(id)!));
      // Warm extensions only for shells that actually restore web tabs, so
      // document-only launches never pay uBlock startup (or gain its
      // background page). The shell window already exists at this point.
      // Reload reconnects to this window's live pages. Fresh windows and app
      // launches start empty; old browser-tabs.json files never reopen pages.
      this.restored = true;
      if (own.length) this.warmup();
      return own;
    });
  }
  dispose() {
    for (const owner of [...this.owners]) this.closeOwner(owner);
    this.places.dispose();
  }
}
