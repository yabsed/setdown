import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, dialog, ipcMain, shell } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { CancellationTokenSource } from 'vscode-jsonrpc/node';
import type { ServerCapabilities, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';
import { languageMethods, textSynchronization, type LanguageCatalog, type LanguageConnectionDraft, type LanguageServerOptions, type LanguageDocument, type LanguageEvent, type LanguageMethod } from '../../protocol/language';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';
import { languageSupport } from '../../core/document/language-support';
import { ServerRegistry, findExecutable } from './server-registry';
import { validateLanguageDefinition, builtinLanguageServers } from '../../core/document/language-definition';
import { serverProfile, standaloneLanguageRoot } from './server-definitions';
import { ServerSession } from './server-session';

type Binding = { id: string; generation: string; uri: string; version: number; server: ServerSession; capabilities: ServerCapabilities };
type Owner = { state: WindowState; documents: Map<string, Binding>; servers: Map<string, ServerSession>;
  requests: Map<string, CancellationTokenSource> };

/** A separate server for each (window, server kind, project root). Unsaved buffers never cross windows. */
export class LanguageManager {
  private readonly owners = new Map<number, Owner>();
  private readonly watched = new Set<number>();
  private readonly draining = new Set<Promise<void>>();
  constructor(private readonly stateFor: (id: number) => WindowState | null) {}
  private registryValue: ServerRegistry | undefined;
  private readonly subscribers = new Map<number, WindowState>();
  private readonly sessions = new Map<ServerSession, { id: string; root: string; state: 'starting' | 'ready' | 'failed'; message?: string; features?: string[] }>();
  private updating: Promise<void> = Promise.resolve();
  private get registry(): ServerRegistry { return this.registryValue ??= new ServerRegistry(app.getPath('userData')); }
  private async changed(task: () => unknown | Promise<unknown>): Promise<void> {
    const update = this.updating.then(async () => {
      await task();
      await Promise.all([...this.owners.keys()].map(id => this.dispose(id)));
      for (const [id, state] of this.subscribers) {
        if (state.window.isDestroyed() || state.window.webContents.isDestroyed()) { this.subscribers.delete(id); continue; }
        state.window.webContents.send('language:event', { type: 'configuration' });
      }
    });
    this.updating = update.catch(() => {});
    return update;
  }
  private subscribe(state: WindowState): void {
    if (this.subscribers.has(state.webContentsId)) return;
    this.subscribers.set(state.webContentsId, state);
    state.window.webContents.once('destroyed', () => this.subscribers.delete(state.webContentsId));
  }
  private async catalogFor(state: WindowState): Promise<LanguageCatalog> {
    this.subscribe(state);
    await this.updating;
    const catalog = (await import('./catalog/mason.json')).default;
    const registry = this.registry;
    const definitions = registry.definitions(), routes = registry.routes();
    const packages = [...catalog.packages];
    for (const definition of definitions) if (!packages.some(item => item.id === definition.id))
      packages.push({ id: definition.id, languages: definition.languages.map(l => l.languageId), description: 'Custom language server connection.', homepage: '', licenses: [], source: { id: '' }, executables: [] } as typeof packages[number]);
    return { release: catalog.release, entries: await Promise.all(packages.map(async item => {
      const definition = definitions.find(d => d.id === item.id), options = definition && registry.options(item.id);
      const bundled = definition?.launch.kind === 'bundledNode';
      const executable = definition ? registry.executable(item.id) : undefined;
      // Only configured servers are checked; opening the full catalog doesn't spawn 331 probes.
      const resolved = executable && await findExecutable(executable);
      const owner = this.owners.get(state.webContentsId);
      return { id: item.id, name: definition?.name ?? item.id, languages: item.languages, description: item.description, homepage: item.homepage,
        configured: !!definition, bundled, custom: !!definition && !builtinLanguageServers.some(d => d.id === item.id),
        enabled: !!definition && registry.enabled(item.id), selected: routes.filter(r => r.server === item.id).map(r => r.languageId),
        executable: resolved || executable, available: !!resolved,
        options: definition ? { args: options?.args ?? definition.launch.args, settings: options?.settings ?? definition.settings,
          initializationOptions: options?.initializationOptions ?? definition.initializationOptions ?? {} } : undefined,
        sessions: [...(owner?.servers.values() ?? [])].flatMap(server => {
          const info = this.sessions.get(server); return info?.id === item.id ? [{ root: info.root, state: info.state, message: info.message, features: info.features }] : [];
        }) };
    })) };
  }
  install(): void {
    const state = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
      const owner = this.stateFor(event.sender.id);
      if (!owner || event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed())
        throw new Error('Language support is available only to the owning editor.');
      return owner;
    };
    ipcMain.handle('language:open', (event, document: LanguageDocument) => this.open(state(event), document));
    ipcMain.handle('language:change', (event, id: string, version: number, changes: TextDocumentContentChangeEvent[]) => {
      const binding = this.binding(state(event).webContentsId, id);
      if (!Number.isSafeInteger(version) || version <= binding.version || !Array.isArray(changes)
        || changes.length > 10000 || JSON.stringify(changes).length > 32 * 1024 * 1024) throw new Error('Invalid language change.');
      binding.version = version;
      if (textSynchronization(binding.capabilities).change === 0) return;
      return binding.server.notify('textDocument/didChange', { textDocument: { uri: binding.uri, version }, contentChanges: changes });
    });
    ipcMain.handle('language:request', async (event, id: string, version: number, requestId: string, method: LanguageMethod, params: unknown) => {
      const owner = this.owners.get(state(event).webContentsId);
      const binding = this.binding(event.sender.id, id);
      if (!owner || binding.version !== version || !languageMethods.includes(method)
        || typeof requestId !== 'string' || requestId.length > 128 || owner.requests.has(requestId)
        || owner.requests.size >= 64 || !params || typeof params !== 'object') throw new Error('Invalid or stale language request.');
      const token = new CancellationTokenSource();
      owner.requests.set(requestId, token);
      try {
        const result = await binding.server.request(method, method === 'completionItem/resolve' ? params
          : { ...params, textDocument: { uri: binding.uri } }, token);
        return owner.documents.get(id) === binding && binding.version === version ? result : null;
      } finally { owner.requests.delete(requestId); }
    });
    const listen = (channel: string, handler: (owner: WindowState, id: string) => void) => {
      ipcMain.on(channel, (event, id: unknown) => {
        if (typeof id !== 'string' || id.length > 128) return;
        let owner: WindowState;
        try { owner = state(event); } catch { return; }
        handler(owner, id);
      });
    };
    listen('language:cancel', (owner, id) => { this.owners.get(owner.webContentsId)?.requests.get(id)?.cancel(); });
    listen('language:close', (owner, id) => this.close(owner.webContentsId, id));
    ipcMain.on('language:saved', (event, id: string, text?: string) => {
      let owner: WindowState; try { owner = state(event); } catch { return; }
      const binding = this.owners.get(owner.webContentsId)?.documents.get(id);
      if (!binding) return;
      const save = textSynchronization(binding.capabilities).save;
      if (save && (!save.includeText || (typeof text === 'string' && text.length <= 16 * 1024 * 1024)))
        void binding.server.notify('textDocument/didSave', { textDocument: { uri: binding.uri }, ...(save.includeText ? { text } : {}) }).catch(() => {});
    });
    ipcMain.handle('language:restart', event => this.dispose(state(event).webContentsId));
    ipcMain.handle('language:configuration', async event => {
      this.subscribe(state(event)); await this.updating; return this.registry.routes();
    });
    ipcMain.handle('language:catalog', event => this.catalogFor(state(event)));
    ipcMain.handle('language:set-enabled', (event, id: string, enabled: boolean) => {
      state(event); return this.changed(() => this.registry.setEnabled(id, enabled));
    });
    ipcMain.handle('language:configure', (event, id: string, options: LanguageServerOptions) => {
      state(event); return this.changed(() => this.registry.configure(id, options));
    });
    ipcMain.handle('language:remove', (event, id: string) => { state(event); return this.changed(() => this.registry.remove(id)); });
    ipcMain.handle('language:choose-executable', async (event, id: string) => {
      const owner = state(event), definition = this.registry.definition(id);
      if (definition.launch.kind === 'bundledNode') return false;
      const result = await dialog.showOpenDialog(owner.window, { title: `Select ${definition.name} Executable`, properties: ['openFile'] });
      if (result.canceled || !result.filePaths[0] || owner.window.isDestroyed()) return false;
      await this.changed(() => this.registry.chooseExecutable(id, result.filePaths[0])); return true;
    });
    ipcMain.handle('language:add-connection', async (event, draft: LanguageConnectionDraft) => {
      const owner = state(event);
      const definition = validateLanguageDefinition({ ...draft, launch: { kind: 'native', command: 'pending', args: draft?.args } });
      const result = await dialog.showOpenDialog(owner.window, { title: `Select ${definition.name} Executable`, properties: ['openFile'] });
      if (result.canceled || !result.filePaths[0] || owner.window.isDestroyed()) return false;
      const executable = result.filePaths[0];
      if (!path.isAbsolute(executable) || !await findExecutable(executable)) throw Error('Select an executable file.');
      definition.launch = { kind: 'native', command: executable, args: draft.args };
      await this.changed(() => { this.registry.add(definition); this.registry.setEnabled(definition.id, true); }); return true;
    });
    ipcMain.handle('language:import-definition', async event => {
      const owner = state(event);
      const result = await dialog.showOpenDialog(owner.window, { title: 'Import Language Server Connection', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled || !result.filePaths[0] || owner.window.isDestroyed()) return false;
      if ((await stat(result.filePaths[0])).size > 128 * 1024) throw Error('Language definition is too large.');
      const definition = validateLanguageDefinition(JSON.parse(await readFile(result.filePaths[0], 'utf8')));
      await this.changed(() => this.registry.add(definition)); return true;
    });
    ipcMain.handle('language:homepage', async (event, id: string) => {
      state(event);
      const catalog = (await import('./catalog/mason.json')).default;
      const entry = catalog.packages.find(item => item.id === id);
      if (!entry || !/^https?:\/\//.test(entry.homepage)) throw Error('No installation page is available.');
      await shell.openExternal(entry.homepage);
    });
    let drained = false;
    app.on('will-quit', event => {
      if (drained || (!this.owners.size && !this.draining.size)) return;
      event.preventDefault();
      void Promise.all([...this.owners.keys()].map(id => this.dispose(id)))
        .then(() => Promise.all([...this.draining])).finally(() => { drained = true; app.quit(); });
    });
  }
  private emit(owner: Owner, event: LanguageEvent): void {
    if (!owner.state.window.isDestroyed() && !owner.state.window.webContents.isDestroyed())
      owner.state.window.webContents.send('language:event', event);
  }
  private binding(ownerId: number, id: string): Binding {
    const binding = this.owners.get(ownerId)?.documents.get(id);
    if (!binding) throw new Error('Language document is closed.');
    return binding;
  }
  private async open(state: WindowState, document: LanguageDocument) {
    this.subscribe(state);
    await this.updating;
    const routes = this.registry.routes();
    if (!document || typeof document.id !== 'string' || document.id.length > 128
      || typeof document.generation !== 'string' || document.generation.length > 128
      || typeof document.path !== 'string' || !path.isAbsolute(document.path) || !languageSupport(document.path, routes)
      || typeof document.text !== 'string' || document.text.length > 16 * 1024 * 1024
      || !Number.isSafeInteger(document.version) || document.version < 1) throw new Error('Invalid language document.');
    const support = languageSupport(document.path, routes)!;
    const file = canonicalPath(document.path);
    const owns = state.currentDocument?.path === file || state.rendererTabs.some(tab => !tab.isUntitled && tab.path === file)
      || state.rendererGitReview?.path === file;
    if (!owns) throw new Error('The language document is not open in this window.');
    let owner = this.owners.get(state.webContentsId);
    if (!owner) {
      owner = { state, documents: new Map(), servers: new Map(), requests: new Map() };
      this.owners.set(state.webContentsId, owner);
      if (!this.watched.has(state.webContentsId)) {
        this.watched.add(state.webContentsId);
        state.window.webContents.once('destroyed', () => { this.watched.delete(state.webContentsId); void this.dispose(state.webContentsId); });
        state.window.webContents.on('render-process-gone', () => { void this.dispose(state.webContentsId); });
        state.window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
          if (mainFrame && !inPlace) void this.dispose(state.webContentsId);
        });
      }
    }
    const uri = pathToFileURL(file).href;
    if ([...owner.documents.values()].some(other => other.id !== document.id && other.uri === uri))
      throw new Error('Language document is already connected.');
    this.close(state.webContentsId, document.id);
    const root = state.projectRoot && isInside(canonicalPath(state.projectRoot), file)
      ? canonicalPath(state.projectRoot) : standaloneLanguageRoot(file, this.registry.definition(support.server));
    const key = `${support.server}:${root}:${this.registry.fingerprint(support.server)}`;
    let server = owner.servers.get(key);
    const owned = owner;
    if (!server) {
      const definition = this.registry.definition(support.server);
      const launch = this.registry.launch(support.server, app.isPackaged);
      server = new ServerSession(launch, root, params => {
        for (const binding of owned.documents.values()) {
          // Reject unversioned/stale diagnostics rather
          // than pretending they belong to the newest unsaved buffer.
          if (binding.server === server && binding.uri === params.uri && params.version === binding.version)
            this.emit(owned, { type: 'diagnostics', id: binding.id, generation: binding.generation, version: binding.version, diagnostics: params.diagnostics });
        }
      }, message => {
        const info = server && this.sessions.get(server);
        if (info) { info.state = 'failed'; info.message = message; }
        this.emit(owned, { type: 'status', state: 'failed', message,
          documents: [...owned.documents.values()].filter(binding => binding.server === server).map(({ id, generation }) => ({ id, generation })) });
      }, serverProfile(definition, this.registry.options(support.server)));
      this.sessions.set(server, { id: support.server, root, state: 'starting' });
      owner.servers.set(key, server);
      server.watch(root);
    }
    const binding = { id: document.id, generation: document.generation, uri, version: document.version, server, capabilities: {} as ServerCapabilities };
    owner.documents.set(document.id, binding);
    this.emit(owner, { type: 'status', state: 'starting', documents: [{ id: binding.id, generation: binding.generation }] });
    const capabilities = await server.ready;
    if (this.owners.get(state.webContentsId) !== owner || owner.documents.get(document.id) !== binding)
      throw new Error('Language document closed during initialization.');
    binding.capabilities = capabilities;
    const info = this.sessions.get(server);
    if (info) {
      info.state = 'ready';
      info.features = ['completion', 'hover', 'signatureHelp', 'definition', 'references', 'documentSymbol', 'rename']
        .filter(feature => capabilities[`${feature}Provider` as keyof ServerCapabilities]);
    }
    if (textSynchronization(capabilities).openClose) await server.notify('textDocument/didOpen', { textDocument: { uri: binding.uri, languageId: support.languageId,
      version: document.version, text: document.text } });
    this.emit(owner, { type: 'status', state: 'ready', documents: [{ id: binding.id, generation: binding.generation }] });
    return { uri: binding.uri, capabilities };
  }
  private close(ownerId: number, id: string): void {
    const owner = this.owners.get(ownerId);
    const binding = owner?.documents.get(id);
    if (!owner || !binding) return;
    owner.documents.delete(id);
    if (textSynchronization(binding.capabilities).openClose) void binding.server.notify('textDocument/didClose', { textDocument: { uri: binding.uri } }).catch(() => {});
    if (![...owner.documents.values()].some(other => other.server === binding.server)) {
      for (const [root, server] of owner.servers) if (server === binding.server) owner.servers.delete(root);
      void this.stop(binding.server);
    }
  }
  private async dispose(id: number): Promise<void> {
    const owner = this.owners.get(id);
    if (!owner) return;
    this.owners.delete(id);
    for (const token of owner.requests.values()) token.cancel();
    owner.documents.clear();
    await Promise.all([...owner.servers.values()].map(server => this.stop(server)));
    owner.servers.clear();
  }
  private stop(server: ServerSession): Promise<void> {
    this.sessions.delete(server);
    const stopped = server.stop();
    this.draining.add(stopped);
    void stopped.finally(() => this.draining.delete(stopped));
    return stopped;
  }
}
