import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, dialog, ipcMain, shell } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import { CancellationTokenSource } from 'vscode-jsonrpc/node';
import type { WorkspaceEdit, ApplyWorkspaceEditResult, ServerCapabilities, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';
import { languageMethods, textSynchronization, type LanguageCapabilities, type LanguageCatalog, type LanguageCatalogEntry, type LanguageConnectionDraft, type LanguageServerOptions, type LanguageDocument, type LanguageEvent, type LanguageMethod } from '../../protocol/language';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';
import { ServerRegistry, findExecutable } from './server-registry';
import { validateLanguageDefinition } from '../../core/document/language-definition';
import { languageRoot, type LanguageRoot } from './language-root';
import { fileOperationMethod, filteredFileOperation, type LanguageFileOperation } from './file-operations';
import { ServerItems } from './server-items';
import { featureNames, isDocumentMethod, resolveMethods } from '../../protocol/language-features';
import { ServerSession } from './server-session';
import { ServerDiscovery, type Discovery } from './server-discovery';
import { languageCatalog, packageDiscovery, profileSource } from './catalog/profiles';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import { NotebookLanguageHost } from './notebook-language-host';
import { serverProfile } from './server-definitions';
import { AnalysisContextService, type AnalysisPlan } from './analysis-context';
import { analysisPreferences } from './analysis-preferences';
import { AnalysisPreparation } from './analysis-preparation';
import { LanguageServiceSupervisor } from './language-supervisor';
import type { AnalysisObservation, AnalysisSelection, DocumentAnalysis } from '../../core/document/analysis-context';
import { languageFailure } from '../../protocol/language-request';

type Binding = { languageId: string; id: string; generation: string; uri: string; version: number; server: ServerSession; capabilities: LanguageCapabilities };
type Owner = { state: WindowState; documents: Map<string, Binding>; servers: Map<string, ServerSession>;
  requests: Map<string, CancellationTokenSource> };

/** A separate server for each (window, server kind, project root). Unsaved buffers never cross windows. */
export class LanguageManager {
  private readonly contexts = new AnalysisContextService();
  private readonly supervisor = new LanguageServiceSupervisor();
  private readonly preparation = new AnalysisPreparation();
  private readonly analysisRevisions = new Map<string, number>();
  private readonly notebooks = new NotebookLanguageHost();
  private readonly owners = new Map<number, Owner>();
  private readonly watched = new Set<number>();
  private readonly draining = new Set<Promise<void>>();
  private readonly pendingOpens = new Map<number, Map<string, symbol>>();
  private readonly items = new Map<ServerSession, ServerItems>();
  private readonly commands = new Map<ServerSession, Binding>();
  private readonly editRequests = new Map<string, { owner: Owner; server: ServerSession; finish(result: ApplyWorkspaceEditResult): void }>();
  private activityTimer?: ReturnType<typeof setTimeout>;
  private scanning?: Promise<void>;
  constructor(private readonly stateFor: (id: number) => WindowState | null, private readonly discovery = new ServerDiscovery()) {}
  private registryValue: ServerRegistry | undefined;
  private readonly subscribers = new Map<number, WindowState>();
  private readonly sessions = new Map<ServerSession, { plan?: AnalysisPlan; recoveryKey?: string; unwatch?: () => void; id: string; root: string; rootReason?: string; configuration?: string; state: 'starting' | 'ready' | 'failed'; message?: string; features?: string[] }>();
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
    const entries: LanguageCatalogEntry[] = await mapLimited(packages, async item => {
      const definition = definitions.find(d => d.id === item.id), options = definition && registry.options(item.id, state.projectRoot ?? undefined);
      const bundled = definition?.launch.kind === 'bundledNode';
      const executable = definition ? registry.executable(item.id, this.discovery.environment.peek().env) : undefined;
      const found = await this.discover(item.id);
      const resolved = bundled ? executable : found?.selected?.path;
      const owner = this.owners.get(state.webContentsId);
      return { id: item.id, name: definition?.name ?? item.id, languages: item.languages, description: item.description, homepage: item.homepage,
        role: definition ? registry.role(item.id, state.projectRoot ?? undefined) : undefined, projectRoot: state.projectRoot ?? undefined,
        globalOptions: definition ? { args: registry.options(item.id).args ?? definition.launch.args, settings: registry.options(item.id).settings ?? definition.settings, initializationOptions: registry.options(item.id).initializationOptions ?? definition.initializationOptions ?? {}, root: registry.options(item.id).root, role: registry.role(item.id), formatting: registry.options(item.id).formatting } : undefined,
        configured: !!definition, bundled, custom: !!definition && registry.isCustom(item.id),
        managed: !!definition && (registry.isCustom(item.id) || Object.keys(options ?? {}).length > 0 || !!executable && path.isAbsolute(executable)),
        discoverable: definition ? registry.canDetect(item.id) : item.executables.length > 0,
        enabled: !!definition && registry.enabled(item.id), selected: [] as string[],
        executable: resolved || executable, available: !!resolved, automatic: !!definition && registry.automatic(item.id),
        canDetect: !!definition && registry.canDetect(item.id), candidates: found?.candidates, selectionNeeded: !!found?.candidates.length && !found.selected,
        discoveryMessage: found?.environment.message, searched: found?.searched,
        profileSource: definition?.provenance ? `${definition.provenance.source} · ${definition.provenance.profile}` : undefined,
        setupNote: definition?.setupNote,
        options: definition ? { role: registry.role(item.id, state.projectRoot ?? undefined), formatting: options?.formatting, scope: state.projectRoot ?? undefined, args: options?.args ?? definition.launch.args, settings: options?.settings ?? definition.settings,
          initializationOptions: serverProfile(definition, options).initializationOptions ?? {}, root: options?.root } : undefined,
        sessions: [...(owner?.servers.values() ?? [])].flatMap(server => {
          const info = this.sessions.get(server); return info?.id === item.id ? [{ root: info.root, rootReason: info.rootReason, state: info.state, message: info.message, features: info.features, context: [...server.context ?? []].map(([key, value]) => `${key}: ${value}`), logs: server.logs, progress: [...(server.progress?.values() ?? [])] }] : [];
        }) };
    });
    // Report the same primary-server policy as document opening. Multiple installed
    // alternatives require an explicit choice, never an arbitrary catalog ordering.
    for (const languageId of new Set(routes.map(r => r.languageId))) {
      const matching = entries.filter(e => e.role !== 'supplementary' && e.enabled && e.available && routes.some(r => r.languageId === languageId && r.server === e.id));
      const preferred = registry.preferred(languageId);
      const chosen = matching.find(e => e.id === preferred) ?? (!preferred && (matching.find(e => e.bundled) ?? (matching.length === 1 ? matching[0] : undefined)));
      if (chosen) chosen.selected.push(languageId);
    }
    for (const entry of entries) if (entry.role === 'supplementary' && entry.enabled && entry.available) entry.selected = entry.languages;
    entries.push({ id: 'notebook-python', name: 'Notebook Python', languages: ['python'],
      description: 'Cell-aware Python analysis for Jupyter notebooks, using the Python environment selected in the notebook.',
      homepage: '', configured: true, bundled: true, custom: false, enabled: true, selected: ['Python notebooks'],
      available: true, notebook: true, sessions: this.notebooks.snapshot(state.webContentsId) });
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
    ipcMain.handle('language:notebook-change', (event, id, version, cells) => this.notebooks.change(state(event).webContentsId, id, version, cells));
    ipcMain.handle('language:change', (event, id: string, version: number, changes: TextDocumentContentChangeEvent[]) => {
      const binding = this.binding(state(event).webContentsId, id);
      if (!Number.isSafeInteger(version) || version <= binding.version || !Array.isArray(changes)
        || changes.length > 10000 || JSON.stringify(changes).length > 32 * 1024 * 1024) throw new Error('Invalid language change.');
      binding.version = version;
      this.items.get(binding.server)?.forget(id, false);
      if (textSynchronization(binding.capabilities).change === 0) return;
      return binding.server.notify('textDocument/didChange', { textDocument: { uri: binding.uri, version }, contentChanges: changes });
    });
    ipcMain.handle('language:request', async (event, id: string, version: number, requestId: string, method: LanguageMethod, params: unknown) => {
      const sender = state(event);
      if (this.notebooks.has(sender.webContentsId, id)) return this.notebooks.request(sender.webContentsId, id, version, requestId, method, params).catch(languageFailure);
      const owner = this.owners.get(state(event).webContentsId);
      const binding = this.binding(event.sender.id, id);
      if (!owner || binding.version !== version || !languageMethods.includes(method)
        || typeof requestId !== 'string' || requestId.length > 128 || owner.requests.has(requestId)
        || owner.requests.size >= 64 || !params || typeof params !== 'object' || JSON.stringify(params).length > 4 * 1024 * 1024) throw new Error('Invalid or stale language request.');
      const origin = { document: id, generation: binding.generation, version };
      const items = this.items.get(binding.server)!;
      const command = method === 'workspace/executeCommand';
      const itemMethod = method in resolveMethods || command;
      const requestParams = itemMethod ? items.resolve(method, params, origin)
        : isDocumentMethod(method) ? { ...params, textDocument: { uri: binding.uri } } : params;
      if (command && this.commands.has(binding.server)) throw Error('A language command is already running.');
      const token = new CancellationTokenSource();
      owner.requests.set(requestId, token);
      if (command) this.commands.set(binding.server, binding);
      try {
        if (method === 'textDocument/willSaveWaitUntil') {
          const sync = binding.capabilities.textDocumentSync;
          if (typeof sync !== 'object' || ![1, 2, 3].includes((params as { reason: number }).reason)) return [];
          if (sync.willSave) await binding.server.notify('textDocument/willSave', requestParams);
          if (!sync.willSaveWaitUntil) return [];
        }
        const result = await binding.server.request(method, requestParams, token, method === 'textDocument/willSaveWaitUntil' ? 1500 : undefined);
        return owner.documents.get(id) === binding && binding.version === version
          ? items.remember(method, result, origin) : null;
      } catch (error) { return languageFailure(error); } finally {
        owner.requests.delete(requestId);
        if (command) this.commands.delete(binding.server);
      }
    });
    ipcMain.on('language:edit-applied', (event, requestId: string, applied: boolean, failureReason?: string) => {
      let sender: WindowState; try { sender = state(event); } catch { return; }
      const proposal = this.editRequests.get(requestId);
      if (!proposal || proposal.owner.state !== sender || typeof applied !== 'boolean') return;
      proposal.finish({ applied, failureReason: typeof failureReason === 'string' ? failureReason.slice(0, 1000) : undefined });
    });
    const listen = (channel: string, handler: (owner: WindowState, id: string) => void) => {
      ipcMain.on(channel, (event, id: unknown) => {
        if (typeof id !== 'string' || id.length > 128) return;
        let owner: WindowState;
        try { owner = state(event); } catch { return; }
        handler(owner, id);
      });
    };
    listen('language:cancel', (owner, id) => { this.notebooks.cancel(owner.webContentsId, id); this.owners.get(owner.webContentsId)?.requests.get(id)?.cancel(); });
    listen('language:close', (owner, id) => this.close(owner.webContentsId, id));
    ipcMain.on('language:release-items', (event, id: string, handles: unknown) => {
      let sender: WindowState; try { sender = state(event); } catch { return; }
      if (!Array.isArray(handles) || handles.length > 100000 || handles.some(value => typeof value !== 'string' || value.length > 128)) return;
      if (this.notebooks.has(sender.webContentsId, id)) { this.notebooks.releaseItems(sender.webContentsId, id, handles); return; }
      const binding = this.owners.get(sender.webContentsId)?.documents.get(id);
      if (binding) this.items.get(binding.server)?.release(handles, { document: id, generation: binding.generation });
    });
    ipcMain.on('language:saved', (event, id: string, text?: string) => {
      let owner: WindowState; try { owner = state(event); } catch { return; }
      const binding = this.owners.get(owner.webContentsId)?.documents.get(id);
      if (!binding) return;
      const save = textSynchronization(binding.capabilities).save;
      if (save && (!save.includeText || (typeof text === 'string' && text.length <= 16 * 1024 * 1024)))
        void binding.server.notify('textDocument/didSave', { textDocument: { uri: binding.uri }, ...(save.includeText ? { text } : {}) }).catch(() => {});
    });
    ipcMain.handle('language:restart', async (event, file?: string, provider?: string) => {
      const owner = state(event);
      if (file !== undefined) {
        const resource = this.ownedFile(owner, file);
        const current = this.owners.get(owner.webContentsId);
        const servers = new Set([...current?.documents.values() ?? []].filter(b => b.uri === pathToFileURL(resource).href && (!provider || this.sessions.get(b.server)?.id === provider)).map(b => b.server));
        for (const server of servers) { const key = this.sessions.get(server)?.recoveryKey; if (key) this.supervisor.reset(key); await this.reconnect(current!, server); }
        return;
      } await this.dispose(owner.webContentsId);
      if (!owner.window.webContents.isDestroyed()) owner.window.webContents.send('language:event', { type: 'configuration', servers: ['notebook-python'] });
    });
    ipcMain.handle('language:configuration', async event => {
      const owner = state(event); this.subscribe(owner); await this.updating; return this.registry.associations();
    });
    ipcMain.handle('language:answer-message', (event, file: string, provider: string, request: string, action?: number) => {
      const owner = state(event), resource = this.ownedFile(owner, file);
      const binding = [...this.owners.get(owner.webContentsId)?.documents.values() ?? []].find(b => b.uri === pathToFileURL(resource).href && this.sessions.get(b.server)?.id === provider);
      if (!binding || typeof request !== 'string') throw Error('The language service is no longer connected.');
      binding.server.answerMessage(request, action);
    });
    ipcMain.handle('language:environment', (event, file: string, language: string) => this.documentEnvironment(state(event), file, language, true));
    ipcMain.handle('language:select-environment', (event, file: string, language: string, selection: AnalysisSelection) => this.selectEnvironment(state(event), file, language, selection));
    ipcMain.handle('language:prepare-environment', async (event, file: string, language: string) => {
      const owner = state(event), context = await this.documentEnvironment(owner, file, language, true);
      if (!context.preparation) throw Error('No supported project configuration was found.');
      const result = await this.preparation.run(owner.webContentsId, context.root, context.preparation, this.discovery);
      this.ownedFile(owner, file);
      if (!(await stat(result.database)).isFile()) throw Error('Configuration completed without a compilation database. Choose a build folder or inspect the build configuration.\n' + result.output);
      await this.updateEnvironment(context.root, language, () => analysisPreferences.set(context.root, 'compilation', result.database));
      return { output: result.output };
    });
    ipcMain.handle('language:cancel-preparation', async (event, file: string, language: string) => { const owner = state(event), context = await this.documentEnvironment(owner, file, language); this.preparation.cancel(owner.webContentsId, context.root); });
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
      state(event); return this.changed(() => this.registry.configure(id, options, options.scope));
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
      this.discovery.dispose(); this.preparation.dispose(); this.supervisor.dispose();
      if (drained || (!this.owners.size && !this.draining.size && !this.notebooks.running)) return;
      event.preventDefault();
      void Promise.all([this.notebooks.dispose(), ...[...this.owners.keys()].map(id => this.dispose(id))])
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
    if (document?.notebook === 'python') return this.notebooks.open(state, document);
    this.subscribe(state);
    await this.updating;
    const routes = this.registry.routes(document?.path);
    const languagePath = document?.path;
    if (!document || typeof document.id !== 'string' || document.id.length > 128
      || typeof document.generation !== 'string' || document.generation.length > 128
      || typeof document.path !== 'string' || !path.isAbsolute(document.path)
      || (document.server !== undefined && (typeof document.server !== 'string' || !routes.some(route => route.server === document.server)))
      || (document.languageId !== undefined && (typeof document.languageId !== 'string' || !routes.some(route => route.languageId === document.languageId)))
      || (document.notebook !== undefined)
      || typeof document.text !== 'string' || document.text.length > 16 * 1024 * 1024
      || !Number.isSafeInteger(document.version) || document.version < 1) throw new Error('Invalid language document.');
    const candidates = this.registry.candidates(languagePath, document.server, document.languageId);
    if (!candidates.length) return { unavailable: 'missing' as const };
    let support = candidates[0];
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
    this.close(state.webContentsId, document.id);
    const configurations = new Map(candidates.map(c => [c.server, this.registry.fingerprint(c.server, file)]));
    const roots = new Map<string, LanguageRoot>();
    const rootFor = (definition: LanguageServerDefinition) => {
      if (!roots.has(definition.id)) roots.set(definition.id, languageRoot(file, definition,
        state.projectRoot ? canonicalPath(state.projectRoot) : undefined, this.registry.options(definition.id, file).root));
      return roots.get(definition.id)!.path;
    };
    let definition = this.registry.definition(support.server), root = rootFor(definition);
    const pending = this.pendingOpens.get(state.webContentsId) ?? new Map<string, symbol>();
    this.pendingOpens.set(state.webContentsId, pending);
    const opening = Symbol(document.id); pending.set(document.id, opening);
    const activeServer = () => [...owner.servers.values()].find(server => {
      const info = this.sessions.get(server);
      return info && candidates.some(c => c.server === info.id)
        && info.root === rootFor(this.registry.definition(info.id)) && info.configuration === JSON.stringify(this.registry.options(info.id, file)) && info.state !== 'failed';
    });
    let server = activeServer();
    let launch;
    let plan: AnalysisPlan | undefined;
    const analysisRevision = this.analysisRevisions.get(root) ?? 0;
    const current = () => analysisRevision === (this.analysisRevisions.get(root) ?? 0) && pending.get(document.id) === opening && this.owners.get(state.webContentsId) === owner
      && !state.window.isDestroyed() && !state.window.webContents.isDestroyed() && owns()
      && JSON.stringify(this.registry.candidates(languagePath, document.server, document.languageId)) === JSON.stringify(candidates)
      && candidates.every(c => this.registry.fingerprint(c.server, file) === configurations.get(c.server));
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
          launch = this.registry.launch(support.server, app.isPackaged, found?.environment.env, found?.selected?.path, file);
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
      if (!server) {
        plan = await this.contexts.resolve(root, roots.get(support.server)?.reason ?? 'Project', definition, this.registry.options(support.server, file));
        if (!current()) throw Error('Language document closed or configuration changed while resolving its environment.');
        // Another document may have finished resolving the same context meanwhile.
        server = activeServer();
        if (!server && launch && definition.id === 'clangd') launch = this.contexts.launch(plan, launch, definition);
      }
    } finally { if (pending.get(document.id) === opening) pending.delete(document.id); }
    const configuration = configurations.get(support.server)!;
    const owned = owner;
    if (!server) {
      if (!launch) throw Error('Language session closed during discovery.');
      const fingerprint = createHash('sha256').update(JSON.stringify([configuration, launch, this.registry.options(support.server, file)])).digest('hex').slice(0, 24);
      const key = `${support.server}:${root}:${fingerprint}`;
      if (!plan) throw Error('No analysis launch plan.');
      const profile = plan.profile;
      const recoveryKey = `${state.webContentsId}:${support.server}:${root}`;
      server = new ServerSession(launch, root, params => {
        for (const binding of owned.documents.values()) {
          // Versionless push diagnostics are best-effort observations, never used as edit versions.
          if (binding.server === server && binding.uri === params.uri && (params.version === undefined || params.version === binding.version))
            this.emit(owned, { type: 'diagnostics', server: this.sessions.get(binding.server)?.id, id: binding.id, generation: binding.generation, version: binding.version, unversioned: params.version === undefined, diagnostics: params.diagnostics });
        }
      }, message => {
        const info = server && this.sessions.get(server);
        if (!info || !server) return;
        info.state = 'failed';
        const recovering = this.supervisor.schedule(recoveryKey, () => {
          if (server && this.sessions.has(server) && this.owners.get(state.webContentsId) === owned)
            void this.reconnect(owned, server).catch(error => console.warn('Language recovery failed', error));
        });
        info.message = `${message}\n${recovering ? `Reconnecting (${recovering.attempt}/3)…` : 'Automatic recovery paused after repeated failures. Restart this service to try again.'}`;
        this.emit(owned, { type: 'status', state: 'failed', message: info.message,
          documents: [...owned.documents.values()].filter(binding => binding.server === server).map(({ id, generation }) => ({ id, generation })) });
      }, profile, {
        filesChanged: paths => {
          if (!server || !this.sessions.has(server) || !plan?.inputs.some(input => paths.includes(input))) return;
          this.contexts.invalidate(root);
          void this.reconnect(owned, server);
        },
        configuration: scopeUri => {
          let resource = file;
          try { if (scopeUri?.startsWith('file:')) resource = fileURLToPath(scopeUri); } catch { /* Invalid scopes use the session document. */ }
          const settings = this.registry.options(definition.id, isInside(root, canonicalPath(resource)) ? resource : file).settings ?? definition.settings;
          return plan!.configuration(settings);
        },
        refresh: feature => this.emit(owned, { type: 'refresh', feature,
          documents: [...owned.documents.values()].filter(b => b.server === server).map(({ id, generation }) => ({ id, generation })) }),
        capabilitiesChanged: () => {
          for (const binding of owned.documents.values()) if (binding.server === server) {
            binding.capabilities = server!.capabilities.forDocument(binding.uri, binding.languageId);
            const info = this.sessions.get(server!); if (info) info.features = featureNames(binding.capabilities);
            this.emit(owned, { type: 'capabilities', id: binding.id, generation: binding.generation, capabilities: binding.capabilities });
          }
        },
        activity: () => {
          if (!this.activityTimer) this.activityTimer = setTimeout(() => {
            this.activityTimer = undefined; this.broadcast({ type: 'activity' });
            for (const owner of this.owners.values()) for (const binding of owner.documents.values()) {
              const info = this.sessions.get(binding.server);
              if (info) this.emit(owner, { type: 'context', id: binding.id, generation: binding.generation,
                messages: binding.server.messages, analysis: this.observation(binding.server), context: [`Project: ${info.root}`, ...[...binding.server.context ?? []].map(([key, value]) => `${key}: ${value}`), ...binding.server.progress?.values() ?? []] });
            }
          }, 500);
        },
        applyEdit: params => this.applyEdit(owned, server!, params.edit),
      });
      for (const evidence of plan.context.evidence) server.context?.set(evidence.split(': ')[0], evidence.split(': ').slice(1).join(': '));
      this.items.set(server, new ServerItems());
      this.sessions.set(server, { plan, recoveryKey, id: support.server, root, rootReason: roots.get(support.server)?.reason, configuration: JSON.stringify(this.registry.options(support.server, file)), state: 'starting' });
      owner.servers.set(key, server);
      server.watch(root);
      const instance = server, watchedInputs = plan.inputs;
      const onInput = (current: import('node:fs').Stats, previous: import('node:fs').Stats) => { if ((current.mtimeMs !== previous.mtimeMs || current.size !== previous.size || current.ino !== previous.ino) && this.sessions.has(instance)) { this.contexts.invalidate(root); void this.reconnect(owned, instance); } };
      for (const input of watchedInputs) watchFile(input, { persistent: false, interval: 1500 }, onInput);
      this.sessions.get(server)!.unwatch = () => { for (const input of watchedInputs) unwatchFile(input, onInput); };
    }
    if ([...owner.documents.values()].some(other => other.id !== document.id && other.uri === uri && other.server === server))
      throw new Error('This provider already owns the document.');
    const binding = { languageId: support.languageId, id: document.id, generation: document.generation, uri, version: document.version, server, capabilities: {} as ServerCapabilities };
    owner.documents.set(document.id, binding);
    this.emit(owner, { type: 'status', state: 'starting', server: { id: support.server, name: definition.name }, documents: [{ id: binding.id, generation: binding.generation }] });
    await server.ready.catch(error => { throw Error(this.sessions.get(server)?.message ?? String(error)); });
    const capabilities = server.capabilities.forDocument(uri, support.languageId);
    if (this.owners.get(state.webContentsId) !== owner || owner.documents.get(document.id) !== binding)
      throw new Error('Language document closed during initialization.');
    binding.capabilities = capabilities;
    const info = this.sessions.get(server);
    if (info) {
      info.state = 'ready';
      info.features = featureNames(capabilities);
    }
    if (textSynchronization(capabilities).openClose) await server.notify('textDocument/didOpen', { textDocument: { uri: binding.uri, languageId: support.languageId,
      version: document.version, text: document.text } });
    this.emit(owner, { type: 'status', state: 'ready', documents: [{ id: binding.id, generation: binding.generation }] });
    return { messages: server.messages, analysis: this.observation(server), name: definition.name, uri: binding.uri, capabilities, server: support.server, context: [`Project: ${root}`, `Root: ${roots.get(support.server)?.reason ?? 'server session'}`, ...[...server.context ?? []].map(([key, value]) => `${key}: ${value}`)] };
  }
  private ownedFile(state: WindowState, file: string): string {
    if (typeof file !== 'string' || file.length > 4096 || file.includes('\0') || !path.isAbsolute(file)
      || state.window.isDestroyed() || state.window.webContents.isDestroyed()) throw Error('Invalid analysis document.');
    const resource = canonicalPath(file);
    if (!(state.currentDocument?.path === resource || state.rendererTabs.some(tab => !tab.isUntitled && tab.path === resource) || state.rendererGitReview?.path === resource))
      throw Error('The analysis document is not open in this window.');
    return resource;
  }
  private async documentEnvironment(state: WindowState, file: string, language: string, refresh = false): Promise<DocumentAnalysis> {
    const resource = this.ownedFile(state, file); await this.updating;
    if (typeof language !== 'string' || language.length > 80) throw Error('Invalid language.');
    const definitions = this.registry.definitions().filter(d => d.languages.some(l => (l.monacoId ?? l.languageId) === language || l.languageId === language));
    const candidates = this.registry.candidates(resource, undefined, language);
    const definition = definitions.find(d => d.id === candidates[0]?.server) ?? definitions[0];
    if (!definition) return { id: language, root: path.dirname(resource), rootReason: 'File directory', environment: 'usable', choices: [], issues: [], evidence: [], servers: [] };
    const options = this.registry.options(definition.id, resource), root = languageRoot(resource, definition, state.projectRoot ?? undefined, options.root);
    const plan = await this.contexts.resolve(root.path, root.reason, definition, options, refresh);
    this.ownedFile(state, resource);
    const running = [...this.owners.get(state.webContentsId)?.documents.values() ?? []].find(b => b.uri === pathToFileURL(resource).href && this.registry.role(this.sessions.get(b.server)?.id ?? definition.id, resource) === 'primary');
    const selected = running ? this.sessions.get(running.server)?.id : this.registry.preferred(language, resource) ?? candidates.find(c => this.registry.definition(c.server).launch.kind === 'bundledNode')?.server ?? candidates[0]?.server;
    return { ...plan.context, servers: definitions.map(d => ({ id: d.id, name: d.name, selected: d.id === selected, enabled: this.registry.enabled(d.id, resource), role: this.registry.role(d.id, resource) })) };
  }
  private async selectEnvironment(state: WindowState, file: string, language: string, selection: AnalysisSelection): Promise<DocumentAnalysis> {
    if (!selection || !['python', 'typescript', 'compilation', 'server'].includes(selection.kind) || typeof selection.value !== 'string' || selection.value.length > 128) throw Error('Invalid environment selection.');
    const context = await this.documentEnvironment(state, file, language, true);
    if (selection.kind === 'server') {
      if (selection.value === 'off') {
        await this.updateEnvironment(context.root, language, () => { for (const server of context.servers) this.registry.setEnabled(server.id, false, context.root); });
        return this.documentEnvironment(state, file, language, true);
      }
      const server = context.servers.find(s => s.id === selection.value && s.role === 'primary');
      if (!server) throw Error('Unknown analysis provider.');
      await this.updateEnvironment(context.root, language, () => this.registry.setEnabled(server.id, true, context.root));
    } else {
      if (selection.kind !== context.kind) throw Error('This environment does not apply to the document.');
      let selected: string | undefined;
      if (selection.value === 'browse') {
        const result = await dialog.showOpenDialog(state.window, { title: context.label, properties: [selection.kind === 'compilation' ? 'openDirectory' : 'openFile'] });
        if (result.canceled || !result.filePaths[0]) return context;
        selected = selection.kind === 'compilation' ? path.join(result.filePaths[0], 'compile_commands.json') : result.filePaths[0];
        if (selection.kind === 'python' ? !await findExecutable(selected) : !(await stat(selected)).isFile()) throw Error('Choose an existing analysis environment.');
        if (selection.kind === 'typescript' && path.basename(selected) !== 'tsserver.js') throw Error('Select typescript/lib/tsserver.js.');
      } else if (selection.value !== 'automatic') {
        const candidate = context.choices.find(c => c.id === selection.value && c.available);
        if (!candidate) throw Error('This environment is no longer available. Refresh the list.');
        selected = selection.kind === 'typescript' && candidate.source === 'Bundled' ? 'bundled' : candidate.path;
      }
      this.ownedFile(state, file);
      const kind = selection.kind;
      await this.updateEnvironment(context.root, language, () => analysisPreferences.set(context.root, kind, selected));
    }
    return this.documentEnvironment(state, file, language, true);
  }
  private async updateEnvironment(root: string, language: string, task: () => void): Promise<void> {
    const update = this.updating.then(async () => {
      task(); this.analysisRevisions.set(root, (this.analysisRevisions.get(root) ?? 0) + 1); this.contexts.invalidate(root);
      const ids = this.registry.definitions().filter(d => d.languages.some(l => (l.monacoId ?? l.languageId) === language || l.languageId === language)).map(d => d.id);
      for (const owner of this.owners.values()) for (const server of [...owner.servers.values()]) {
        const info = this.sessions.get(server);
        if (info?.root === root && ids.includes(info.id)) { if (info.recoveryKey) this.supervisor.reset(info.recoveryKey); await this.reconnect(owner, server, false); }
      }
      this.broadcast({ type: 'environment', root, language });
      this.broadcast({ type: 'configuration', servers: ids, roots: [root] });
    });
    this.updating = update.catch(() => {}); return update;
  }
  private observation(server: ServerSession): AnalysisObservation | undefined {
    const plan = this.sessions.get(server)?.plan;
    return plan && { context: plan.context, analysis: server.progress?.size ? 'working' : 'waiting', scope: 'open-files', freshness: 'none', progress: [...server.progress?.values() ?? []] };
  }
  private async reconnect(owner: Owner, server: ServerSession, notify = true): Promise<void> {
    const info = this.sessions.get(server); if (!info) return;
    this.contexts.invalidate(info.root);
    const documents = [...owner.documents.values()].filter(b => b.server === server).map(({ id, generation }) => ({ id, generation }));
    for (const document of documents) owner.documents.delete(document.id);
    for (const [key, instance] of owner.servers) if (instance === server) owner.servers.delete(key);
    await this.stop(server);
    if (notify && documents.length && this.owners.get(owner.state.webContentsId) === owner) this.emit(owner, { type: 'configuration', servers: [info.id], documents });
  }
  async fileOperation(state: WindowState, operation: LanguageFileOperation, phase: 'will' | 'did'): Promise<void> {
    const owner = this.owners.get(state.webContentsId);
    if (!owner) return;
    for (const server of owner.servers.values()) {
      if (this.sessions.get(server)?.state !== 'ready') continue;
      const versions = [...owner.documents.values()].filter(binding => binding.server === server).map(({ id, generation, version }) => ({ id, generation, version }));
      const method = fileOperationMethod(operation, phase);
      const params = filteredFileOperation(operation, server.capabilities.fileOperation(method));
      if (!params.files.length) continue;
      if (phase === 'did') { await server.notify(method, params).catch(() => {}); continue; }
      const edit = await server.request<WorkspaceEdit | null>(method, params, undefined, 2000);
      if (edit) {
        const binding = [...owner.documents.values()].find(b => b.server === server);
        if (!binding) throw Error('Language session closed during the file operation.');
        const result = await this.applyEdit(owner, server, edit, { binding, versions });
        if (!result.applied) throw Error(result.failureReason ?? 'Could not apply language file-operation edits.');
        for (const entry of versions) entry.version = owner.documents.get(entry.id)?.version ?? entry.version;
      }
    }
  }
  private async applyEdit(owner: Owner, server: ServerSession, edit: WorkspaceEdit, fileOperation?: { binding: Binding; versions: { id: string; generation: string; version: number }[] }): Promise<ApplyWorkspaceEditResult> {
    const binding = fileOperation?.binding ?? this.commands.get(server);
    if (!binding || owner.documents.get(binding.id) !== binding) return { applied: false, failureReason: 'No active user command accepts edits.' };
    try {
      if (JSON.stringify(edit).length > 8 * 1024 * 1024) throw Error('Workspace edit is too large.');
      const uris = edit.documentChanges ? edit.documentChanges.map(change => {
        if (!('textDocument' in change)) throw Error('File operations are not supported by this edit transaction.');
        return change.textDocument.uri;
      }) : Object.keys(edit.changes ?? {});
      const root = this.sessions.get(server)?.root;
      if (!root || uris.length > 200) throw Error('Invalid workspace edit.');
      for (const uri of uris) {
        const parsed = new URL(uri);
        if (parsed.protocol !== 'file:' || parsed.search || parsed.hash || !isInside(root, canonicalPath(fileURLToPath(uri))))
          throw Error('Workspace edits must remain inside the language workspace.');
      }
    } catch (error) { return { applied: false, failureReason: String(error) }; }
    return new Promise(resolve => {
      const requestId = randomUUID();
      const timer = setTimeout(() => finish({ applied: false, failureReason: 'Editor did not accept the edit in time.' }), 10_000);
      const finish = (result: ApplyWorkspaceEditResult) => { clearTimeout(timer); this.editRequests.delete(requestId); resolve(result); };
      this.editRequests.set(requestId, { owner, server, finish });
      this.emit(owner, { type: 'apply-edit', id: binding.id, generation: binding.generation, requestId, versions: fileOperation?.versions, edit });
    });
  }
  private close(ownerId: number, id: string): void {
    this.notebooks.close(ownerId, id);
    this.pendingOpens.get(ownerId)?.delete(id);
    const owner = this.owners.get(ownerId);
    const binding = owner?.documents.get(id);
    if (!owner || !binding) return;
    owner.documents.delete(id);
    this.items.get(binding.server)?.forget(id);
    if (textSynchronization(binding.capabilities).openClose) void binding.server.notify('textDocument/didClose', { textDocument: { uri: binding.uri } }).catch(() => {});
    if (![...owner.documents.values()].some(other => other.server === binding.server)) {
      for (const [root, server] of owner.servers) if (server === binding.server) owner.servers.delete(root);
      void this.stop(binding.server);
    }
  }
  private async dispose(id: number): Promise<void> {
    this.preparation.cancel(id);
    const notebooks = this.notebooks.dispose(id);
    this.pendingOpens.delete(id);
    const owner = this.owners.get(id);
    if (!owner) { await notebooks; return; }
    this.owners.delete(id);
    for (const token of owner.requests.values()) token.cancel();
    owner.documents.clear();
    await Promise.all([notebooks, ...[...owner.servers.values()].map(server => this.stop(server))]);
    owner.servers.clear();
  }
  private stop(server: ServerSession): Promise<void> {
    const info = this.sessions.get(server); info?.unwatch?.(); if (info?.recoveryKey) this.supervisor.cancel(info.recoveryKey);
    this.sessions.delete(server);
    this.items.delete(server); this.commands.delete(server);
    for (const proposal of this.editRequests.values()) if (proposal.server === server) proposal.finish({ applied: false, failureReason: 'Language session closed.' });
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
