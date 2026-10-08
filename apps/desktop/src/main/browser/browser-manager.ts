import { app, dialog, Menu, session, shell, WebContentsView, type Session, type WebContents, type Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs, unwatchFile, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { browserURL, isWebURL } from '../../core/browser/browser-url';
import { appZoomStep } from '../../core/zoom';
import type { BrowserCommand, BrowserEvent, BrowserPage } from '../../protocol/browser';
import type { WebHistory } from '../../core/workspace/tab-navigation';
import { readPreviewBounds, type PreviewBounds } from '../../protocol/preview-preparation';
import type { WindowState } from '../windows/window-state';
import { nativeZoomBounds, type WorkspaceZoom } from '../windows/workspace-zoom';
import type { WindowIpc } from '../ipc/window-ipc';
import { BrowserExtensions } from './browser-extensions';
import { BrowserPlaces } from './browser-places';

type Entry = { owner: number; view: WebContentsView; page: BrowserPage; navigation: number; bounds?: Rectangle;
  historyUrls: string[]; historyIndex: number; canGoBack?: boolean; canGoForward?: boolean; closing?: (value: boolean) => void };
type Options = { stateFor(id: number): WindowState | null; states(): Iterable<WindowState>; zoom: WorkspaceZoom;
  openFile(state: WindowState, file: string): Promise<unknown> };
const blankPage = (id: string, url: string): BrowserPage => ({ id, url, title: url === 'about:blank' ? 'New web tab' : url,
  startPage: url === 'about:blank', loading: false, canGoBack: false, canGoForward: false, audible: false, muted: false, error: null, protection: 'starting' });

/** Adapted from Min's viewManager: persistent page identity, popup adoption,
 * and isolated browser sessions, with Setdown's per-group bounds and ownership. */
export class BrowserManager {
  readonly views = new Map<string, Entry>();
  private readonly places = new BrowserPlaces();
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
  constructor(private readonly options: Options) {}
  private get session() {
    if (!this.profile) {
      this.profile = session.fromPartition('persist:setdown-browser');
      this.installPermissions(this.profile);
      this.profile.on('will-download', (_event, item, contents) => {
        const entry = this.forContents(contents);
        if (!entry) { item.cancel(); return; }
        const owner = this.options.stateFor(entry.owner);
        item.setSaveDialogOptions({ title: 'Save download', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
        item.once('done', (_event, result) => {
          if (result === 'completed' && item.getMimeType() === 'application/pdf' && owner && !owner.window.isDestroyed())
            void this.options.openFile(owner, item.getSavePath()).catch(error => this.error(entry, error));
        });
      });
    }
    return this.profile;
  }
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.extensions ??= new BrowserExtensions(this.session, id => this.forContentsId(id)?.view.webContents, {
        license: 'GPL-3.0',
        createTab: async details => {
          const state = details.openerTabId ? this.options.stateFor(this.forContentsId(details.openerTabId)?.owner ?? -1)
            : Array.from(this.options.states()).find(state => state.window.id === details.windowId) ?? Array.from(this.options.states()).find(state => state.window.isFocused());
          if (!state) throw Error('No browser window.');
          const entry = this.openEntry(state.webContentsId, randomUUID(), this.extensionURL(details.url ?? 'about:blank'));
          this.send(entry.owner, { type: 'open', page: entry.page, background: details.active === false });
          void this.load(entry, entry.page.url);
          return [entry.view.webContents, state.window];
        },
        selectTab: contents => { const entry = this.forContents(contents); if (entry) this.send(entry.owner, { type: 'focus', id: entry.page.id }); },
        removeTab: contents => {
          const entry = this.forContents(contents);
          if (entry && !this.transferring.has(contents.id)) void this.close(entry.owner, entry.page.id);
        },
      });
      this.ready = this.extensions.start().catch(error => { this.ready = undefined; throw error; });
    }
    return this.ready;
  }
  private extensionURL(url: string): string {
    if (this.extensions?.extensionId && url.startsWith(`chrome-extension://${this.extensions.extensionId}/`)) return url;
    return browserURL(url);
  }
  private forContents(contents: WebContents | null | undefined) { return contents && this.forContentsId(contents.id); }
  private forContentsId(id: number) { return Array.from(this.views.values()).find(entry => entry.view.webContents.id === id); }
  private owned(owner: number, id: unknown): Entry {
    const entry = typeof id === 'string' ? this.views.get(id) : undefined;
    if (!entry || entry.owner !== owner || entry.view.webContents.isDestroyed()) throw Error('This web tab does not belong to this window.');
    return entry;
  }
  owns(owner: number, id: string) { return this.views.get(id)?.owner === owner; }
  private send(owner: number, event: BrowserEvent) {
    const state = this.options.stateFor(owner);
    if (state && !state.window.isDestroyed()) state.window.webContents.send('browser:event', event);
  }
  private publish(entry: Entry) {
    if (entry.view.webContents.isDestroyed()) return;
    const wc = entry.view.webContents;
    entry.page = { ...entry.page, loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(), audible: wc.isCurrentlyAudible(), muted: wc.isAudioMuted() };
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
    state.window.once('closed', () => {
      for (const entry of [...this.views.values()]) if (entry.owner === owner) {
        this.views.delete(entry.page.id); entry.view.webContents.close();
      }
      this.owners.delete(owner);
      if (!this.owners.size) this.places.dispose();
    });
  }
  private openEntry(owner: number, id: string, url: string, existing?: WebContents): Entry {
    const state = this.options.stateFor(owner);
    if (!state || state.window.isDestroyed()) throw Error('The window no longer exists.');
    this.trackOwner(owner);
    const view = new WebContentsView({ webPreferences: { session: this.session,
      preload: path.join(__dirname, 'page-preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInSubFrames: true, safeDialogs: true, autoplayPolicy: 'document-user-activation-required' },
      ...(existing ? { webContents: existing } : {}) });
    view.setVisible(false);
    // Hidden initial navigation stays detached, preserving document IME focus.
    const entry: Entry = { owner, view, page: blankPage(id, url), navigation: 0,
      historyUrls: [], historyIndex: -1 };
    this.views.set(id, entry);
    const wc = view.webContents;
    this.options.zoom.track(wc);
    const register = () => this.extensions?.host?.addTab(wc, this.options.stateFor(entry.owner)!.window);
    void this.ensureReady().then(() => { if (!wc.isDestroyed()) { register(); entry.page.protection = 'ready'; this.publish(entry); } })
      .catch(error => { if (!wc.isDestroyed()) { entry.page.protection = 'error'; this.error(entry, error); } });
    const navigation = (_event: Electron.Event, next: string) => {
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
    wc.on('page-title-updated', (_event, title) => { entry.page.title = title; this.publish(entry); this.saved.set(id, entry.page); this.persist(); });
    wc.on('did-start-loading', () => this.publish(entry));
    wc.on('did-stop-loading', () => this.publish(entry));
    wc.on('did-finish-load', () => {
      if (isWebURL(wc.getURL())) void this.places.update(wc.getURL(), wc.getTitle(), { visit: true }).catch(console.error);
    });
    wc.on('did-fail-load', (_event, code, description, _url, main) => {
      if (main && code !== -3) this.error(entry, description);
    });
    wc.on('render-process-gone', (_event, details) => this.error(entry, `This page stopped (${details.reason}). Reload to recover.`));
    wc.on('audio-state-changed', () => this.publish(entry));
    wc.on('focus', () => { if (view.getVisible()) this.send(entry.owner, { type: 'focus', id }); });
    wc.on('found-in-page', (_event, result) => this.send(entry.owner, { type: 'find', id, active: result.activeMatchOrdinal, matches: result.matches }));
    wc.on('will-prevent-unload', event => {
      const owner = this.options.stateFor(entry.owner);
      const choice = owner && dialog.showMessageBoxSync(owner.window, { type: 'question', message: 'Leave this page?',
        detail: 'The page may have unsaved changes.', buttons: ['Stay', 'Leave'], defaultId: 0, cancelId: 0 });
      if (choice === 1) event.preventDefault(); else { entry.closing?.(false); entry.closing = undefined; }
    });
    wc.on('destroyed', () => {
      this.views.delete(id); entry.closing?.(true);
      if (this.options.stateFor(entry.owner)) { this.saved.delete(id); this.persist(); }
      this.send(entry.owner, { type: 'close', id });
    });
    wc.on('will-navigate', (event, next) => {
      if (!isWebURL(next) && next !== 'about:blank' && !next.startsWith(`chrome-extension://${this.extensions?.extensionId}/`)) {
        event.preventDefault(); void this.external(entry, next);
      }
    });
    wc.on('will-redirect', (event, next) => { if (!isWebURL(next)) event.preventDefault(); });
    wc.setWindowOpenHandler(details => {
      if (!isWebURL(details.url) && details.url !== 'about:blank'
        && !details.url.startsWith(`chrome-extension://${this.extensions?.extensionId}/`)) {
        void this.external(entry, details.url); return { action: 'deny' };
      }
      // Min's createWindow adoption preserves opener relationships, POST bodies,
      // and about:blank scripts instead of recreating a popup from its URL.
      return { action: 'allow', createWindow: options => {
        const popup = this.openEntry(entry.owner, randomUUID(), details.url, (options as Electron.BrowserWindowConstructorOptions & { webContents?: WebContents }).webContents);
        popup.page.startPage = false;
        this.send(entry.owner, { type: 'open', page: popup.page, background: details.disposition === 'background-tab' });
        return popup.view.webContents;
      } };
    });
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isComposing) return;
      const owner = this.options.stateFor(entry.owner);
      if (!owner) return;
      const step = appZoomStep(input);
      if (step !== undefined) { event.preventDefault(); this.options.zoom.change(step); return; }
      const key = input.key.toLowerCase(), modifier = input.control || input.meta;
      const command = modifier && key === 'l' ? 'focus-location' : modifier && key === 't' ? 'new-web-tab'
        : modifier && key === 'w' ? 'close-tab' : modifier && key === 'f' ? 'open-find'
        : input.control && key === 'tab' ? input.shift ? 'previous-tab' : 'next-tab' : null;
      if (command) { event.preventDefault(); owner.window.webContents.focus(); owner.window.webContents.send('app:command', command); }
      else if ((modifier && key === 'r') || key === 'f5') { event.preventDefault(); wc.reload(); }
      else if (input.alt && (key === 'arrowleft' || key === 'arrowright')) {
        event.preventDefault(); this.send(entry.owner, { type: 'history', id, direction: key === 'arrowleft' ? -1 : 1 });
      }
      else if (key === 'escape') wc.stop();
    });
    wc.on('context-menu', (_event, params) => {
      const owner = this.options.stateFor(entry.owner);
      if (!owner) return;
      const items: Electron.MenuItemConstructorOptions[] = [];
      if (isWebURL(params.linkURL)) items.push({ label: 'Open Link in New Tab', click: () => void this.openLink(entry.owner, params.linkURL) });
      if (params.isEditable) items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' });
      else if (params.selectionText) items.push({ role: 'copy' });
      items.push({ label: 'Back', enabled: entry.canGoBack || wc.navigationHistory.canGoBack(),
        click: () => this.send(entry.owner, { type: 'history', id, direction: -1 }) },
        { label: 'Forward', enabled: entry.canGoForward || wc.navigationHistory.canGoForward(),
          click: () => this.send(entry.owner, { type: 'history', id, direction: 1 }) },
        { label: 'Reload', click: () => wc.reload() }, { label: 'Open in Default Browser', click: () => void this.external(entry, wc.getURL(), true) });
      Menu.buildFromTemplate(items).popup({ window: owner.window });
    });
    return entry;
  }
  async create(owner: number, id: string, input: string, history?: WebHistory): Promise<BrowserPage> {
    if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) throw Error('Invalid web tab ID.');
    if (this.views.has(id)) return this.owned(owner, id).page;
    if (this.dormant.has(id) && this.dormant.get(id) !== owner) throw Error('This web tab does not belong to this window.');
    this.dormant.delete(id);
    const url = browserURL(input);
    if (history && (!Array.isArray(history.entries) || !history.entries.length || history.entries.length > 1000
      || !Number.isInteger(history.index) || history.index < 0 || history.index >= history.entries.length
      || history.entries.some(e => !e || (!isWebURL(e.url) && e.url !== 'about:blank') || typeof e.title !== 'string'
        || (e.pageState !== undefined && typeof e.pageState !== 'string')))) throw Error('Invalid web history.');
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
      if (navigation !== entry.navigation || this.views.get(entry.page.id) !== entry || entry.view.webContents.isDestroyed()) return;
      entry.page.error = null;
      entry.page.protection = 'ready';
      this.extensions?.host?.addTab(entry.view.webContents, this.options.stateFor(entry.owner)!.window);
      if (history) await entry.view.webContents.navigationHistory.restore(history);
      else await entry.view.webContents.loadURL(url);
    } catch (error) {
      if (navigation === entry.navigation && !entry.view.webContents.isDestroyed()
        && (error as { code?: string }).code !== 'ERR_ABORTED') this.error(entry, error);
    }
  }
  async openLink(owner: number, url: string, background = false) {
    const page = await this.create(owner, randomUUID(), url);
    this.send(owner, { type: 'open', page, background });
  }
  async close(owner: number, id: string): Promise<boolean> {
    if (this.dormant.get(id) === owner) {
      this.dormant.delete(id); this.saved.delete(id); this.persist(); return true;
    }
    const entry = this.owned(owner, id);
    if (entry.closing) return false;
    const closed = await new Promise<boolean>(resolve => {
      entry.closing = resolve;
      entry.view.webContents.close({ waitForBeforeUnload: true });
    });
    if (closed) { this.saved.delete(id); this.persist(); }
    return closed;
  }
  adopt(source: number, destination: number, id: string): boolean {
    const entry = this.owned(source, id), target = this.options.stateFor(destination);
    if (!target) return false;
    entry.view.setVisible(false);
    this.options.stateFor(source)?.window.contentView.removeChildView(entry.view);
    entry.owner = destination; entry.bounds = undefined; this.trackOwner(destination);
    // The host's removeTab hook normally closes the real page. Reparenting only
    // updates extension ownership; the live page and its opener must survive.
    this.transferring.add(entry.view.webContents.id);
    try {
      this.extensions?.host?.removeTab(entry.view.webContents);
      this.extensions?.host?.addTab(entry.view.webContents, target.window);
    } finally { this.transferring.delete(entry.view.webContents.id); }
    return true;
  }
  layout(owner: number, entries: Array<{ id: string; bounds: PreviewBounds; canGoBack?: boolean; canGoForward?: boolean }>) {
    const state = this.options.stateFor(owner);
    if (!state || !Array.isArray(entries)) return;
    const visible = new Set<string>();
    for (const item of entries.slice(0, 32)) {
      const entry = this.views.get(item.id), css = readPreviewBounds(item.bounds);
      if (!entry || entry.owner !== owner || !css || entry.view.webContents.isDestroyed()) continue;
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
    for (const [id, entry] of this.views) if (entry.owner === owner && !visible.has(id)) entry.view.setVisible(false);
  }
  private async external(entry: Entry, url: string, explicit = false) {
    const state = this.options.stateFor(entry.owner);
    if (!state || !/^(https?:|mailto:|tel:)/i.test(url)) return;
    if (!explicit) {
      const choice = await dialog.showMessageBox(state.window, { message: 'Open an external application?', detail: url,
        buttons: ['Cancel', 'Open'], defaultId: 0, cancelId: 0 });
      if (choice.response !== 1) return;
    }
    await shell.openExternal(url);
  }
  private installPermissions(profile: Session) {
    const grants = new Set<string>();
    profile.setPermissionCheckHandler((contents, permission, origin) => !!this.forContents(contents) && grants.has(`${origin}|${permission}`));
    profile.setPermissionRequestHandler((contents, permission, callback, details) => {
      const entry = this.forContents(contents), state = entry && this.options.stateFor(entry.owner);
      if (!state || !['media', 'notifications', 'geolocation', 'fullscreen', 'pointerLock', 'clipboard-sanitized-write'].includes(permission)) return callback(false);
      let origin: string;
      try { origin = new URL(details.requestingUrl || contents.getURL()).origin; } catch { return callback(false); }
      const key = `${origin}|${permission}`;
      if (grants.has(key)) return callback(true);
      void dialog.showMessageBox(state.window, { message: `Allow ${permission}?`, detail: origin,
        buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0 }).then(choice => {
        if (contents.isDestroyed()) return callback(false);
        if (choice.response === 1) grants.add(key);
        callback(choice.response === 1);
      }).catch(() => callback(false));
    });
  }
  registerIpc(channels: WindowIpc) {
    channels.handle('browser:create', (state, id: string, url: string, history?: WebHistory) => this.create(state.webContentsId, id, url, history));
    channels.handle('browser:history', (state, id: string): WebHistory => {
      const entry = this.owned(state.webContentsId, id), history = entry.view.webContents.navigationHistory;
      const entries = history.getAllEntries();
      return entries.length ? { entries, index: history.getActiveIndex() }
        : { entries: [{ url: entry.page.url, title: entry.page.title }], index: 0 };
    });
    channels.handle('browser:navigate', async (state, id: string, input: string) => {
      const entry = this.owned(state.webContentsId, id); await this.load(entry, browserURL(input));
    });
    channels.handle('browser:close', (state, id: string) => this.close(state.webContentsId, id));
    channels.on('browser:layout', (state, entries: Array<{ id: string; bounds: PreviewBounds }>) => this.layout(state.webContentsId, entries));
    channels.handle('browser:capture', async (state, id: string) => {
      const entry = this.owned(state.webContentsId, id);
      return entry.view.getVisible() ? (await entry.view.webContents.capturePage()).toDataURL() : null;
    });
    channels.handle('browser:command', async (state, id: string, command: BrowserCommand) => {
      const entry = this.owned(state.webContentsId, id), wc = entry.view.webContents;
      if (command === 'back' || command === 'forward') {
        const offset = command === 'back' ? -1 : 1;
        if (!wc.navigationHistory.canGoToOffset(offset)) return false;
        wc.navigationHistory.goToOffset(offset); return true;
      }
      else if (command === 'reload') {
        if (entry.page.protection === 'ready' && wc.getURL() === entry.page.url && !wc.isCrashed()) { entry.page.error = null; wc.reload(); }
        else await this.load(entry, entry.page.url);
      }
      else if (command === 'stop') { entry.navigation++; wc.stop(); }
      else if (command === 'focus') {
        if (state.watchedPath) { unwatchFile(state.watchedPath); state.watchedPath = null; }
        state.currentDocument = null;
        this.extensions?.host?.selectTab(wc);
        if (entry.view.getVisible()) wc.focus();
      } else if (command === 'mute') { wc.setAudioMuted(!wc.isAudioMuted()); this.publish(entry); }
      else if (command === 'external') await this.external(entry, wc.getURL(), true);
      else if (command === 'save') {
        const result = await dialog.showSaveDialog(state.window, { title: 'Save web page', defaultPath: 'page.html', filters: [{ name: 'Web page', extensions: ['html'] }] });
        if (!result.canceled && result.filePath) await wc.savePage(result.filePath, 'HTMLComplete');
      } else if (command === 'protection' && this.extensions?.extensionId) {
        const page = this.openEntry(state.webContentsId, randomUUID(), `chrome-extension://${this.extensions.extensionId}/popup-fenix.html?tabId=${wc.id}`);
        this.send(page.owner, { type: 'open', page: page.page, background: false }); void this.load(page, page.page.url);
      }
    });
    channels.on('browser:find', (state, id: string, text: string, forward: boolean = true, next: boolean = false) => {
      if (!this.owns(state.webContentsId, id)) return;
      const wc = this.owned(state.webContentsId, id).view.webContents;
      if (text) wc.findInPage(String(text).slice(0, 1000), { forward, findNext: next }); else wc.stopFindInPage('clearSelection');
    });
    channels.handle('browser:places', (_state, query: string, bookmarksOnly: boolean) => this.places.search(query, bookmarksOnly));
    channels.handle('browser:bookmark', async (_state, url: string, title: string, bookmarked: boolean) => {
      if (!isWebURL(url)) throw Error('Only web pages can be bookmarked.');
      await this.places.update(url, String(title), { bookmarked: bookmarked === true });
      for (const state of this.options.states()) this.send(state.webContentsId, { type: 'places' });
    });
    channels.handle('browser:restore', async state => {
      const own = [...this.views.values()].filter(e => e.owner === state.webContentsId).map(e => e.page);
      own.push(...[...this.dormant].filter(([, owner]) => owner === state.webContentsId).map(([id]) => this.saved.get(id)!));
      if (own.length || this.restored) return own;
      this.restored = true;
      const saved: unknown = await fs.readFile(path.join(app.getPath('userData'), 'browser-tabs.json'), 'utf8').then(JSON.parse).catch(() => []);
      if (!Array.isArray(saved)) return [];
      return saved.filter(p => p && isWebURL(p.url)).slice(0, 200).map(p => {
        const page = { ...blankPage(randomUUID(), p.url), title: String(p.title || p.url) };
        this.saved.set(page.id, page); this.dormant.set(page.id, state.webContentsId); return page;
      });
    });
  }
  dispose() { this.places.dispose(); }
}
