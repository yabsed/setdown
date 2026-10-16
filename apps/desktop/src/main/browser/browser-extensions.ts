import { app, ipcMain, webContents, type Session, type WebContents, type WebFrameMain } from 'electron';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { webStoreId } from '../../core/browser/web-store';
import {
  extensionIdFromKey, localExtensionDir, parseExtensionManifest, parseManifestEntries,
  unpackExtensionArchive, type ExtensionManifestInfo,
} from './extension-package';
import { ExtensionHostBridge } from './extensions/host-bridge';
import { ExtensionPermissions } from './extensions/extension-permissions';
import { ExtensionNetwork } from './extensions/extension-network';
import { ExtensionDownloads } from './extensions/extension-downloads';
import type { BrowserDownloads } from './browser-downloads';
import type { BrowserExtensionInfo } from '../../protocol/browser';

type StoredExtension = { dir: string; enabled: boolean; webStoreId?: string };
type LoadedExtension = { record: StoredExtension; info: ExtensionManifestInfo; electronId?: string; lastElectronId?: string; error?: string };
export type InspectedPackage = { token: string; info: ExtensionManifestInfo };

const EXTENSION_URL = /^chrome-extension:\/\/([a-p]{32})\//;

/** Hosts the built-in uBlock Origin plus user-installed extensions on one
 * persistent browser session. User extensions live under
 * `userData/extensions/<dir>` and are restored on every launch; the registry
 * in `browser-extensions.json` only records directory and enabled state. */
export class BrowserExtensions {
  host?: ElectronChromeExtensions;
  bridge?: ExtensionHostBridge;
  downloads?: ExtensionDownloads;
  network?: ExtensionNetwork;
  private permissions?: ExtensionPermissions;
  extensionId?: string;
  private pending = new Map<string, { frame: WebFrameMain; done(error?: string): void }>();
  private records: StoredExtension[] = [];
  private loaded = new Map<string, LoadedExtension>();
  private staging = new Map<string, { dir: string; info: ExtensionManifestInfo; webStoreId?: string }>();
  private builtinInfo?: ExtensionManifestInfo;
  private registryLoaded = false;
  private modifying = Promise.resolve();
  constructor(private readonly session: Session, private readonly tab: (id: number) => WebContents | undefined,
    private readonly callbacks: ConstructorParameters<typeof ElectronChromeExtensions>[0],
    private readonly services: { downloads?: BrowserDownloads; changed?(): void } = {}) {}

  private get extensionsRoot() { return path.join(app.getPath('userData'), 'extensions'); }
  private get registryFile() { return path.join(app.getPath('userData'), 'browser-extensions.json'); }

  private mutate<T>(task: () => Promise<T>): Promise<T> {
    const result = this.modifying.then(task);
    this.modifying = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Register the session preloads and IPC synchronously. This must be able
   * to run before a web view is created (its initial frame captures the
   * preload registry) without waiting for uBlock to finish starting. */
  prepare(): void { if (!this.host) this.installHost(); }

  async start(): Promise<void> {
    this.prepare();
    await this.loadRegistry();
    await this.startBuiltin();
    for (const record of this.records) {
      if (!record.enabled || this.loaded.get(record.dir)?.electronId) continue;
      await this.loadRecord(record).catch(() => undefined);
    }
    await this.network?.ready();
  }

  private async startBuiltin(): Promise<void> {
    if (this.extensionId) this.session.extensions.removeExtension(this.extensionId);
    let extensionPath = path.join(__dirname, 'ublock');
    if (app.isPackaged) extensionPath = extensionPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    const extension = await this.session.extensions.loadExtension(extensionPath);
    this.extensionId = extension.id;
    try { this.builtinInfo = parseExtensionManifest(extension.manifest); }
    catch { this.builtinInfo = { name: extension.name, version: extension.version, description: '', manifestVersion: 2, permissions: [], hostPermissions: [] }; }
    if (extension.name) this.builtinInfo.name = extension.name;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const background = webContents.getAllWebContents().find(wc => wc.session === this.session
        && wc.getType() === 'backgroundPage' && wc.getURL().startsWith(`chrome-extension://${extension.id}/`));
      if (background && !background.isLoading()) {
        // uBO restarts its background page on first install/version changes.
        // Electron may leave executeJavaScript pending when that context dies.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const ready = await Promise.race([
          background.mainFrame.executeJavaScript("import('./js/background.js').then(m => m.default.readyToFilter)").catch(() => false),
          new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 250); }),
        ]);
        clearTimeout(timer);
        if (ready) return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('uBlock Origin could not start. Reload this tab to try again.');
  }

  /** Staging tokens live only in memory, so a `.staging-*` directory that no
   * live token owns was abandoned (e.g. the process died while the install
   * confirmation was open). Remove it instead of accumulating copies. */
  private async clearStaleStaging(): Promise<void> {
    const live = new Set([...this.staging.values()].map(item => path.basename(item.dir)));
    const names = await fs.readdir(this.extensionsRoot).catch(() => [] as string[]);
    await Promise.all(names.filter(name => name.startsWith('.staging-') && !live.has(name))
      .map(name => fs.rm(path.join(this.extensionsRoot, name), { recursive: true, force: true }).catch(() => undefined)));
  }

  private async loadRegistry(): Promise<void> {
    if (this.registryLoaded) return;
    this.registryLoaded = true;
    await this.clearStaleStaging();
    const parsed: unknown = await fs.readFile(this.registryFile, 'utf8').then(JSON.parse).catch(() => []);
    if (!Array.isArray(parsed)) return;
    this.records = parsed.filter((item): item is StoredExtension => !!item && typeof item === 'object'
      && typeof (item as StoredExtension).dir === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test((item as StoredExtension).dir)
      && typeof (item as StoredExtension).enabled === 'boolean');
    for (const record of this.records) if (record.webStoreId !== record.dir || !/^[a-p]{32}$/.test(record.webStoreId ?? '')) delete record.webStoreId;
    for (const record of this.records) {
      const info = await this.readInstalledInfo(record.dir).catch(() => undefined);
      if (info) this.loaded.set(record.dir, { record, info });
      else this.loaded.set(record.dir, { record, info: { name: record.dir, version: '', description: '', manifestVersion: 2, permissions: [], hostPermissions: [] }, error: 'The extension files are missing or damaged.' });
    }
  }

  private async persist(): Promise<void> {
    const data = JSON.stringify(this.records, null, 2);
    await fs.writeFile(`${this.registryFile}.tmp`, data);
    await fs.rename(`${this.registryFile}.tmp`, this.registryFile);
  }

  private async readInstalledInfo(dir: string): Promise<ExtensionManifestInfo> {
    const root = path.join(this.extensionsRoot, dir);
    const raw: unknown = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    let messages: Record<string, { message?: unknown }> | undefined;
    const locale = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).default_locale : undefined;
    if (typeof locale === 'string') {
      messages = await fs.readFile(path.join(root, '_locales', locale, 'messages.json'), 'utf8')
        .then(content => JSON.parse(content) as typeof messages).catch(() => undefined);
    }
    return parseExtensionManifest(raw, messages);
  }

  private async loadRecord(record: StoredExtension): Promise<void> {
    const state = this.loaded.get(record.dir);
    const info = state?.info ?? await this.readInstalledInfo(record.dir);
    const extensionPath = path.join(this.extensionsRoot, record.dir);
    try {
      const existing = this.session.extensions.getAllExtensions().find(item => item.path === extensionPath);
      if (existing) this.session.extensions.removeExtension(existing.id);
      const extension = await this.session.extensions.loadExtension(extensionPath);
      this.loaded.set(record.dir, { record, info, electronId: extension.id });
    } catch (error) {
      this.loaded.set(record.dir, { record, info, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private unloadRecord(record: StoredExtension): void {
    const state = this.loaded.get(record.dir);
    if (state?.electronId) this.session.extensions.removeExtension(state.electronId);
    if (state) this.loaded.set(record.dir, { record, info: state.info, lastElectronId: state.electronId ?? state.lastElectronId });
  }

  /** Extracts or copies a package into a staging directory for confirmation. */
  async inspect(source: string): Promise<InspectedPackage> {
    await this.clearStaleStaging();
    const token = randomUUID();
    const dir = path.join(this.extensionsRoot, `.staging-${token}`);
    await fs.mkdir(dir, { recursive: true });
    try {
      const stat = await fs.stat(source);
      let info: ExtensionManifestInfo;
      if (stat.isDirectory()) {
        await fs.cp(source, dir, { recursive: true, dereference: true,
          filter: file => path.basename(file) !== '.git' });
        info = await this.readStagedInfo(dir);
      } else {
        const lower = source.toLowerCase();
        if (!lower.endsWith('.zip') && !lower.endsWith('.crx')) throw Error('Choose an extension folder, .zip or .crx file.');
        const entries = unpackExtensionArchive(await fs.readFile(source));
        const parsed = parseManifestEntries(entries);
        for (const entry of entries) {
          if (!entry.name.startsWith(parsed.root)) continue;
          const target = path.join(dir, entry.name.slice(parsed.root.length));
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, entry.data);
        }
        info = parsed.info;
      }
      this.staging.set(token, { dir, info });
      return { token, info };
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Use upstream download/unpack/ID handling, then our normal confirmation and
   * registry. The library must never load executable extension code here. */
  async inspectWebStore(input: unknown): Promise<InspectedPackage> {
    const id = webStoreId(input);
    if (id === this.extensionId) throw Error('The built-in extension is managed by Setdown.');
    await fs.mkdir(this.extensionsRoot, { recursive: true });
    const temporary = await fs.mkdtemp(path.join(this.extensionsRoot, '.download-'));
    try {
      // Keep the store library and network work off ordinary app startup.
      const { downloadExtension } = await import('electron-chrome-web-store');
      const source = await downloadExtension(id, temporary);
      const inspected = await this.inspect(source);
      if (!inspected.info.key || extensionIdFromKey(inspected.info.key) !== id) {
        await this.discard(inspected.token);
        throw Error('The downloaded package does not match the requested extension.');
      }
      this.staging.get(inspected.token)!.webStoreId = id;
      return inspected;
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }

  private async readStagedInfo(dir: string): Promise<ExtensionManifestInfo> {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')
      .catch(() => { throw Error('The selected folder does not contain a manifest.json.'); }));
    let messages: Record<string, { message?: unknown }> | undefined;
    const locale = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).default_locale : undefined;
    if (typeof locale === 'string') {
      messages = await fs.readFile(path.join(dir, '_locales', locale, 'messages.json'), 'utf8')
        .then(content => JSON.parse(content) as typeof messages).catch(() => undefined);
    }
    return parseExtensionManifest(raw, messages);
  }

  async discard(token: string): Promise<void> {
    const staged = this.staging.get(token);
    this.staging.delete(token);
    if (staged) await fs.rm(staged.dir, { recursive: true, force: true }).catch(() => undefined);
  }

  /** Installs a previously inspected package, replacing any same-ID install. */
  commit(token: string): Promise<BrowserExtensionInfo> { return this.mutate(() => this.commitStaged(token)); }
  private async commitStaged(token: string): Promise<BrowserExtensionInfo> {
    const staged = this.staging.get(token);
    if (!staged) throw Error('This installation has expired. Choose the file again.');
    this.staging.delete(token);
    const dirName = (staged.info.key ? extensionIdFromKey(staged.info.key) : undefined) ?? localExtensionDir(staged.info);
    if (dirName === this.extensionId) {
      await fs.rm(staged.dir, { recursive: true, force: true });
      throw Error('The built-in extension is managed by Setdown.');
    }
    const target = path.join(this.extensionsRoot, dirName);
    const previous = this.records.find(item => item.dir === dirName);
    const previousState = this.loaded.get(dirName);
    const record: StoredExtension = { dir: dirName, enabled: previous?.enabled ?? true, ...(staged.webStoreId ? { webStoreId: staged.webStoreId } : {}) };
    const backup = path.join(this.extensionsRoot, `.backup-${randomUUID()}`);
    let backedUp = false, moved = false;
    try {
      if (previous) {
        this.unloadRecord(previous);
        await fs.rename(target, backup); backedUp = true;
      }
      await fs.rename(staged.dir, target); moved = true;
      this.loaded.set(dirName, { record, info: staged.info, lastElectronId: previousState?.electronId ?? previousState?.lastElectronId });
      if (record.enabled) await this.loadRecord(record);
      this.records = [...this.records.filter(item => item !== previous), record];
      await this.persist();
    } catch (error) {
      this.unloadRecord(record);
      if (moved) await fs.rm(target, { recursive: true, force: true });
      if (backedUp) await fs.rename(backup, target);
      this.records = this.records.filter(item => item !== record);
      if (previous && !this.records.includes(previous)) this.records.push(previous);
      if (previousState && previous) {
        this.loaded.set(dirName, previousState);
        if (previous.enabled) await this.loadRecord(previous).catch(() => undefined);
      } else this.loaded.delete(dirName);
      throw error;
    } finally { await fs.rm(staged.dir, { recursive: true, force: true }); }
    if (backedUp) await fs.rm(backup, { recursive: true, force: true }).catch(console.error);
    return this.describe(record);
  }

  private describe(record: StoredExtension): BrowserExtensionInfo {
    const state = this.loaded.get(record.dir);
    const info = state?.info ?? { name: record.dir, version: '', description: '', manifestVersion: 2, permissions: [], hostPermissions: [] };
    return {
      id: state?.electronId ?? state?.lastElectronId ?? (info.key ? extensionIdFromKey(info.key) : undefined) ?? record.dir,
      name: info.name, version: info.version, description: info.description, manifestVersion: info.manifestVersion,
      enabled: record.enabled && !!state?.electronId, builtin: false,
      hasPopup: !!info.popupPath, hasOptions: !!info.optionsPath,
      permissions: info.permissions, hostPermissions: info.hostPermissions,
      error: state?.error ?? this.network?.errorFor(state?.electronId) ?? null,
      ...(record.webStoreId ? { webStoreId: record.webStoreId } : {}),
    };
  }

  list(): BrowserExtensionInfo[] {
    const rows: BrowserExtensionInfo[] = [];
    if (this.extensionId && this.builtinInfo) rows.push({
      id: this.extensionId, name: this.builtinInfo.name, version: this.builtinInfo.version,
      description: this.builtinInfo.description, manifestVersion: this.builtinInfo.manifestVersion,
      enabled: true, builtin: true, hasPopup: true, hasOptions: !!this.builtinInfo.optionsPath,
      permissions: this.builtinInfo.permissions, hostPermissions: this.builtinInfo.hostPermissions, error: null,
    });
    for (const record of this.records) rows.push(this.describe(record));
    return rows;
  }

  private resolve(handle: string): LoadedExtension {
    for (const state of this.loaded.values()) {
      if (state.electronId === handle || state.lastElectronId === handle || state.record.dir === handle
        || (state.info.key && extensionIdFromKey(state.info.key) === handle)) return state;
    }
    throw Error('Unknown extension.');
  }

  setEnabled(handle: string, enabled: boolean): Promise<BrowserExtensionInfo[]> { return this.mutate(() => this.changeEnabled(handle, enabled)); }
  private async changeEnabled(handle: string, enabled: boolean): Promise<BrowserExtensionInfo[]> {
    const state = this.resolve(handle);
    state.record.enabled = enabled;
    if (enabled) await this.loadRecord(state.record).catch(() => undefined);
    else this.unloadRecord(state.record);
    await this.network?.ready();
    await this.persist();
    return this.list();
  }

  remove(handle: string): Promise<BrowserExtensionInfo[]> { return this.mutate(() => this.removeInstalled(handle)); }
  private async removeInstalled(handle: string): Promise<BrowserExtensionInfo[]> {
    const state = this.resolve(handle);
    const id = state.electronId ?? state.lastElectronId;
    this.unloadRecord(state.record);
    if (id) { this.permissions?.forget(id); this.network?.forget(id); }
    await this.network?.ready();
    this.records = this.records.filter(item => item !== state.record);
    this.loaded.delete(state.record.dir);
    await fs.rm(path.join(this.extensionsRoot, state.record.dir), { recursive: true, force: true });
    await this.persist();
    return this.list();
  }

  /** True for `chrome-extension://` URLs of any currently loaded extension. */
  isExtensionURL(url: string): boolean {
    const match = EXTENSION_URL.exec(url);
    if (!match) return false;
    if (match[1] === this.extensionId) return true;
    for (const state of this.loaded.values()) if (state.electronId === match[1]) return true;
    return false;
  }

  extensionURL(url: string): string | undefined {
    return this.isExtensionURL(url) ? url : undefined;
  }

  pageURL(handle: string, page: 'popup' | 'options'): string {
    if (handle === this.extensionId && this.builtinInfo) {
      const relative = page === 'popup' ? (this.builtinInfo.popupPath ?? 'popup-fenix.html') : this.builtinInfo.optionsPath;
      if (!relative) throw Error(`This extension has no ${page} page.`);
      return `chrome-extension://${this.extensionId}/${relative.replace(/^\//, '')}`;
    }
    const state = this.resolve(handle);
    if (!state.electronId) throw Error('This extension is not running.');
    const relative = page === 'popup' ? state.info.popupPath : state.info.optionsPath;
    if (!relative) throw Error(`This extension has no ${page} page.`);
    return `chrome-extension://${state.electronId}/${relative.replace(/^\//, '')}`;
  }

  builtinPopupURL(): string | undefined {
    return this.extensionId ? `chrome-extension://${this.extensionId}/popup-fenix.html` : undefined;
  }

  private installHost(): void {
    this.host = new ElectronChromeExtensions({ ...this.callbacks, session: this.session, license: 'GPL-3.0' });
    this.bridge = new ExtensionHostBridge(this.host, this.session, () => this.services.changed?.());
    const permissions = this.permissions = new ExtensionPermissions(this.bridge);
    this.network = new ExtensionNetwork(this.bridge, permissions);
    if (this.services.downloads) this.downloads = new ExtensionDownloads(this.bridge, permissions, this.services.downloads);
    for (const name of ['privacy.network.networkPredictionEnabled', 'privacy.services.autofillAddressEnabled', 'privacy.services.autofillCreditCardEnabled', 'privacy.services.passwordSavingEnabled', 'privacy.websites.hyperlinkAuditingEnabled', ...['erase', 'removeFile', 'getFileIcon', 'acceptDanger', 'setUiOptions', 'showDefaultFolder'].map(name => `downloads.${name}`)]) {
      this.bridge.handle(`unsupported.${name}`, () => { throw Error(`${name} is not supported by this browser.`); });
    }
    // Replace the library's registration by its actual returned ID, keeping
    // one preload and using our packaged header/CSS compatibility adapter.
    for (const script of this.session.getPreloadScripts()) {
      if (path.basename(script.filePath) === 'chrome-extension-api.preload.js') {
        this.session.unregisterPreloadScript(script.id);
      }
    }
    this.session.registerPreloadScript({ id: 'setdown-ubo-preload', type: 'frame', filePath: path.join(__dirname, 'chrome-extension-api.preload.cjs') });
    this.session.registerPreloadScript({ id: 'setdown-extension-worker', type: 'service-worker', filePath: path.join(__dirname, 'chrome-extension-worker.preload.cjs') });
    ipcMain.on('browser:extension-builtin', event => {
      const id = EXTENSION_URL.exec(event.senderFrame?.url ?? '')?.[1];
      const extension = id && this.session.extensions.getExtension(id);
      const builtinPath = path.join(__dirname, 'ublock').replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
      event.returnValue = event.sender.session === this.session && !!extension && extension.path === builtinPath;
    });
    ipcMain.handle('browser:extension-css', async (event, id: unknown, raw: unknown, remove: unknown) => {
      const sender = event.senderFrame?.url ? EXTENSION_URL.exec(event.senderFrame.url) : null;
      if (event.sender.session !== this.session || !sender || sender[1] !== this.extensionId) throw Error('Unknown extension sender.');
      const target = typeof id === 'number' ? this.tab(id) : undefined;
      const details = raw as { code?: unknown; frameId?: unknown; allFrames?: unknown } | null;
      if (!target || !details || typeof details.code !== 'string' || details.code.length > 4_000_000) return;
      // Only web documents run the page preload that can accept styles.
      // Extension, error and not-yet-committed frames never acknowledge, so
      // asking them only stalls every insertCSS call for the full timeout.
      const frames = target.mainFrame.framesInSubtree.filter(frame => /^(?:https?|file|about):/.test(frame.url)
        && (details.allFrames === true
          || (details.frameId === undefined || details.frameId === 0 ? frame === target.mainFrame : frame.frameTreeNodeId === details.frameId)));
      await Promise.all(frames.map(frame => this.applyCSS(frame, details.code as string, remove === true)));
    });
    ipcMain.on('browser:css-result', (event, id: unknown, error: unknown) => {
      if (typeof id !== 'string') return;
      const pending = this.pending.get(id);
      if (pending && event.senderFrame === pending.frame) pending.done(typeof error === 'string' ? error : undefined);
    });
  }
  /** Cosmetic CSS is best-effort per frame. Blocked ad frames, frames that
   * navigate or are destroyed mid-request, and documents without a root
   * element never send `browser:css-result`; that must neither reject the
   * extension's insertCSS call nor spam the main-process log per frame. */
  private applyCSS(frame: WebFrameMain, code: string, remove: boolean): Promise<void> {
    return new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => done(), 5000);
      const done = () => {
        clearTimeout(timer); this.pending.delete(id);
        resolve();
      };
      this.pending.set(id, { frame, done });
      try { frame.send('browser:css', { id, code, remove }); } catch { done(); }
    });
  }
}
