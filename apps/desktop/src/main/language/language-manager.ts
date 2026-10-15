import path from 'node:path';
import { createHash } from 'node:crypto';
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
import { validateLanguageDefinition } from '../../core/document/language-definition';
import { serverProfile, standaloneLanguageRoot } from './server-definitions';
import { ServerSession } from './server-session';
import { ServerDiscovery, type Discovery } from './server-discovery';
import { languageCatalog, packageDiscovery, profileSource } from './catalog/profiles';
import type { LanguageServerDefinition } from '../../core/document/language-definition';

type Binding = { id: string; generation: string; uri: string; version: number; server: ServerSession; capabilities: ServerCapabilities };
type Owner = { state: WindowState; documents: Map<string, Binding>; servers: Map<string, ServerSession>;
  requests: Map<string, CancellationTokenSource> };

/** A separate server for each (window, server kind, project root). Unsaved buffers never cross windows. */
export class LanguageManager {
  private readonly owners = new Map<number, Owner>();
  private readonly watched = new Set<number>();
  private readonly draining = new Set<Promise<void>>();
  private readonly pendingOpens = new Map<number, Map<string, symbol>>();
  private scanning?: Promise<void>;
  constructor(private readonly stateFor: (id: number) => WindowState | null, private readonly discovery = new ServerDiscovery()) {}
  private registryValue: ServerRegistry | undefined;
  private readonly subscribers = new Map<number, WindowState>();
  private readonly sessions = new Map<ServerSession, { id: string; root: string; state: 'starting' | 'ready' | 'failed'; message?: string; features?: string[] }>();
  private updating: Promise<void> = Promise.resolve();
  private get registry(): ServerRegistry { return this.registryValue ??= new ServerRegistry(app.getPath('userData')); }
  private async changed(task: () => unknown | Promise<unknown>): Promise<void> {
    const update = this.updating.then(async () => {
      const before = new Map(this.registry.definitions().map(d => [d.id, this.registry.fingerprint(d.id)]));
      const routes = this.registry.routes();
      await task();
      const after = new Map(this.registry.definitions().map(d => [d.id, this.registry.fingerprint(d.id)]));
      const affected = new Set([...before.keys(), ...after.keys()].filter(id => before.get(id) !== after.get(id)));
      const nextRoutes = this.registry.routes();
      for (const route of [...routes, ...nextRoutes]) {
        if (JSON.stringify(routes.filter(r => r.languageId === route.languageId)) !== JSON.stringify(nextRoutes.filter(r => r.languageId === route.languageId)))
          affected.add(route.server);
      }
      if (!affected.size) return;
      for (const owner of this.owners.values()) {
        const servers = [...owner.servers.values()].filter(server => affected.has(this.sessions.get(server)?.id ?? ''));
        for (const [id, binding] of owner.documents) if (servers.includes(binding.server)) owner.documents.delete(id);
        for (const [key, server] of owner.servers) if (servers.includes(server)) owner.servers.delete(key);
        await Promise.all(servers.map(server => this.stop(server)));
      }
      this.broadcast({ type: 'configuration', servers: [...affected] });
    });
    this.updating = update.catch(() => {});
    return update;
  }
  private broadcast(event: LanguageEvent): void {
    for (const [id, state] of this.subscribers) {
      if (state.window.isDestroyed() || state.window.webContents.isDestroyed()) { this.subscribers.delete(id); continue; }
      state.window.webContents.send('language:event', event);
    }
  }
  private rescan(): Promise<void> {
    if (this.scanning) return this.scanning;
    return this.scanning = (async () => {
      await this.updating;
      this.discovery.reset();
      await this.discovery.environment.resolve();
      // Eight metadata workers share directory/package caches; no candidate is executed.
      const entries = [...languageCatalog.map(item => item.id), ...this.registry.definitions().map(d => d.id)];
      await mapLimited([...new Set(entries)], id => this.discover(id, true));
      this.broadcast({ type: 'discovery' });
    })().finally(() => { this.scanning = undefined; });
  }
  private subscribe(state: WindowState): void {
    if (this.subscribers.has(state.webContentsId)) return;
    this.subscribers.set(state.webContentsId, state);
    state.window.webContents.once('destroyed', () => this.subscribers.delete(state.webContentsId));
  }
  private async discover(id: string, resolveEnvironment = false): Promise<Discovery | undefined> {
    const definition = this.registry.definitions().find(d => d.id === id);
    if (definition?.launch.kind === 'bundledNode') return undefined;
    const snapshot = resolveEnvironment ? await this.discovery.environment.resolve() : this.discovery.environment.peek();
    const commands = definition ? [this.registry.executable(id, snapshot.env)]
      : languageCatalog.find(p => p.id === id)?.executables ?? [];
    const results = await Promise.all(commands.map(command => this.discovery.find(command, {
      ...packageDiscovery(id), python: definition?.discovery === 'python' || packageDiscovery(id).python,
      npmPackage: definition?.npmPackage ?? packageDiscovery(id).npmPackage, resolveEnvironment,
    })));
    const candidates = [...new Map(results.flatMap(r => r.candidates).map(c => [c.id, c])).values()];
    return { candidates, selected: candidates.length === 1 ? candidates[0] : results.length === 1 ? results[0].selected : undefined,
      searched: [...new Set(results.flatMap(r => r.searched))], environment: snapshot };
  }
  private async catalogFor(state: WindowState): Promise<LanguageCatalog> {
    this.subscribe(state);
    await this.updating;
    const catalog = (await import('./catalog/mason.json')).default;
    const registry = this.registry;
    const definitions = registry.definitions(), routes = registry.routes();
    const packages = [...languageCatalog];
    for (const definition of definitions) if (!packages.some(item => item.id === definition.id))
      packages.push({ id: definition.id, languages: definition.languages.map(l => l.languageId), description: 'Custom language server connection.', homepage: '', licenses: [], source: { id: '' }, executables: [] } as typeof packages[number]);
    const entries = await mapLimited(packages, async item => {
      const definition = definitions.find(d => d.id === item.id), options = definition && registry.options(item.id);
      const bundled = definition?.launch.kind === 'bundledNode';
      const executable = definition ? registry.executable(item.id, this.discovery.environment.peek().env) : undefined;
      const found = await this.discover(item.id);
      const resolved = bundled ? executable : found?.selected?.path;
      const owner = this.owners.get(state.webContentsId);
      return { id: item.id, name: definition?.name ?? item.id, languages: item.languages, description: item.description, homepage: item.homepage,
        configured: !!definition, bundled, custom: !!definition && registry.isCustom(item.id),
        enabled: !!definition && registry.enabled(item.id), selected: [] as string[],
        executable: resolved || executable, available: !!resolved, automatic: !!definition && registry.automatic(item.id),
        canDetect: !!definition && registry.canDetect(item.id), candidates: found?.candidates, selectionNeeded: !!found?.candidates.length && !found.selected,
        discoveryMessage: found?.environment.message, searched: found?.searched,
        profileSource: definition?.provenance ? `${definition.provenance.source} · ${definition.provenance.profile}` : undefined,
        setupNote: definition?.setupNote,
        options: definition ? { args: options?.args ?? definition.launch.args, settings: options?.settings ?? definition.settings,
          initializationOptions: options?.initializationOptions ?? definition.initializationOptions ?? {} } : undefined,
        sessions: [...(owner?.servers.values() ?? [])].flatMap(server => {
          const info = this.sessions.get(server); return info?.id === item.id ? [{ root: info.root, state: info.state, message: info.message, features: info.features }] : [];
        }) };
    });
    // Report the same primary-server policy as document opening. Multiple installed
    // alternatives require an explicit choice, never an arbitrary catalog ordering.
    for (const languageId of new Set(routes.map(r => r.languageId))) {
      const matching = entries.filter(e => e.enabled && e.available && routes.some(r => r.languageId === languageId && r.server === e.id));
      const preferred = registry.preferred(languageId);
      const chosen = matching.find(e => e.id === preferred) ?? (!preferred && (matching.find(e => e.bundled) ?? (matching.length === 1 ? matching[0] : undefined)));
      if (chosen) chosen.selected.push(languageId);
    }
    return { release: catalog.release, profileSource, profiles: definitions.length, entries };
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
    ipcMain.handle('language:rescan', event => { this.subscribe(state(event)); return this.rescan(); });
    ipcMain.handle('language:automatic', (event, id: string) => { state(event); return this.changed(() => this.registry.useAutomatic(id)); });
    ipcMain.handle('language:select-candidate', async (event, id: string, candidateId: string) => {
      const owner = state(event), definition = this.registry.definition(id);
      if (definition.launch.kind !== 'native' || typeof candidateId !== 'string') throw Error('Invalid executable selection.');
      const found = await this.discover(id);
      const candidate = found?.candidates.find(c => c.id === candidateId);
      if (!candidate || owner.window.isDestroyed()) throw Error('Executable candidate is no longer available. Rescan installed servers.');
      await this.changed(() => this.registry.chooseExecutable(id, candidate.path, !!candidate.runtime));
    });
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
      if (draft.candidateId !== undefined) {
        if (typeof draft.candidateId !== 'string') throw Error('Invalid executable selection.');
        const candidate = (await this.discover(definition.id))?.candidates.find(c => c.id === draft.candidateId);
        if (!candidate || owner.window.isDestroyed()) throw Error('Installation changed. Rescan installed servers.');
        definition.launch = { kind: 'native', command: candidate.runtime ?? candidate.path,
          args: [...(candidate.runtime ? [candidate.path] : []), ...draft.args] };
        await this.changed(() => { this.registry.add(definition); this.registry.setEnabled(definition.id, true); });
        return true;
      }
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
      const entry = languageCatalog.find(item => item.id === id);
      if (!entry || !/^https?:\/\//.test(entry.homepage)) throw Error('No installation page is available.');
      await shell.openExternal(entry.homepage);
    });
    let drained = false;
    app.on('will-quit', event => {
      this.discovery.dispose();
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
    let support = languageSupport(document.path, routes)!;
    const file = canonicalPath(document.path);
    const owns = () => state.currentDocument?.path === file || state.rendererTabs.some(tab => !tab.isUntitled && tab.path === file)
      || state.rendererGitReview?.path === file;
    if (!owns()) throw new Error('The language document is not open in this window.');
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
    const candidates = this.registry.candidates(document.path);
    const configurations = new Map(candidates.map(c => [c.server, this.registry.fingerprint(c.server)]));
    const rootFor = (definition: LanguageServerDefinition) => state.projectRoot && isInside(canonicalPath(state.projectRoot), file)
      ? canonicalPath(state.projectRoot) : standaloneLanguageRoot(file, definition);
    let definition = this.registry.definition(support.server), root = rootFor(definition);
    const pending = this.pendingOpens.get(state.webContentsId) ?? new Map<string, symbol>();
    this.pendingOpens.set(state.webContentsId, pending);
    const opening = Symbol(document.id); pending.set(document.id, opening);
    const activeServer = () => [...owner.servers.values()].find(server => {
      const info = this.sessions.get(server);
      return info && candidates.some(c => c.server === info.id)
        && info.root === rootFor(this.registry.definition(info.id)) && info.state !== 'failed';
    });
    let server = activeServer();
    let launch;
    const current = () => pending.get(document.id) === opening && this.owners.get(state.webContentsId) === owner
      && !state.window.isDestroyed() && !state.window.webContents.isDestroyed() && owns()
      && JSON.stringify(this.registry.candidates(document.path)) === JSON.stringify(candidates)
      && candidates.every(c => this.registry.fingerprint(c.server) === configurations.get(c.server));
    try {
      if (!server) for (;;) {
        const revision = this.discovery.generation;
        try {
          const bundled = candidates.find(c => this.registry.definition(c.server).launch.kind === 'bundledNode');
          const available: { support: typeof support; found?: Discovery }[] = bundled ? [{ support: bundled }]
            : await mapLimited(candidates, async candidate => ({ support: candidate, found: await this.discover(candidate.server, true) }));
          if (revision !== this.discovery.generation) continue;
          if (!current()) throw Error('Language document closed or configuration changed during discovery.');
          const installed = available.filter(c => !c.found || c.found.selected);
          const ambiguous = available.some(c => c.found && c.found.candidates.length && !c.found.selected);
          if (installed.length !== 1 || ambiguous) {
            if (candidates.length === 1 && (!this.registry.automatic(support.server)
              || path.isAbsolute(this.registry.executable(support.server, this.discovery.environment.peek().env))) && !ambiguous && !installed.length)
              throw Error(`${definition.name}: Executable not found. Rescan installed servers or choose an executable in Language Support.`);
            return { unavailable: installed.length > 1 || ambiguous ? 'selection-needed' as const : 'missing' as const };
          }
          support = installed[0].support;
          definition = this.registry.definition(support.server); root = rootFor(definition);
          const found = installed[0].found;
          launch = this.registry.launch(support.server, app.isPackaged, found?.environment.env, found?.selected?.path);
          if (found?.selected?.runtime) launch = { ...launch, executable: found.selected.runtime, args: [found.selected.path, ...launch.args] };
          break;
        } catch (error) { if (revision === this.discovery.generation) throw error; }
      }
      if (!current()) throw Error('Language document closed or configuration changed during discovery.');
      // A concurrent document or a rescan may have retained this workspace's session.
      server = activeServer();
      if (server) {
        const id = this.sessions.get(server)!.id;
        support = candidates.find(c => c.server === id)!;
        definition = this.registry.definition(support.server); root = rootFor(definition);
      }
    } finally { if (pending.get(document.id) === opening) pending.delete(document.id); }
    const configuration = configurations.get(support.server)!;
    const owned = owner;
    if (!server) {
      if (!launch) throw Error('Language session closed during discovery.');
      const fingerprint = createHash('sha256').update(JSON.stringify([configuration, launch])).digest('hex').slice(0, 24);
      const key = `${support.server}:${root}:${fingerprint}`;
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
    return { uri: binding.uri, capabilities, server: support.server };
  }
  private close(ownerId: number, id: string): void {
    this.pendingOpens.get(ownerId)?.delete(id);
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
    this.pendingOpens.delete(id);
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

/** Bound filesystem/metadata work even when the catalog contains hundreds of entries. */
async function mapLimited<T, R>(items: T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    for (;;) { const index = cursor++; if (index >= items.length) return; results[index] = await task(items[index]); }
  }));
  return results;
}
