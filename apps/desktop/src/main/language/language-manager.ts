import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, ipcMain, shell } from 'electron';
import { pathDialog } from '../dialogs/path-picker';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import { CancellationTokenSource } from 'vscode-jsonrpc/node';
import type { WorkspaceEdit, ApplyWorkspaceEditResult, ServerCapabilities, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';
import { languageMethods, textSynchronization, type LanguageCapabilities, type LanguageCatalog, type LanguageCatalogEntry, type LanguageServerOptions, type LanguageDocument, type LanguageEvent, type LanguageIssue, type LanguageMethod, type LanguageAnswer } from '../../protocol/language';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';
import { ServerRegistry, findExecutable, type Companion } from './server-registry';
import { validateLanguageDefinition } from '../../core/document/language-definition';
import { languageRoot, type LanguageRoot } from './language-root';
import { languageSupport } from '../../core/document/language-support';
import { fileOperationMethod, filteredFileOperation, type LanguageFileOperation } from './file-operations';
import { ServerItems } from './server-items';
import { documentRequest, featureNames, resolveMethods } from '../../protocol/language-features';
import { ServerSession } from './server-session';
import { supportedTool } from '../../core/document/supported-languages';
import { ServerDiscovery, type Discovery } from './server-discovery';
import { writeLanguageAnswer } from './language-answers';
import { languageCatalog, packageDiscovery, profileSource } from './catalog/profiles';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import { NotebookLanguageHost } from './notebook-language-host';
import { serverProfile } from './server-definitions';
import { AnalysisContextService, type AnalysisPlan } from './analysis-context';
import { analysisPreferences } from './analysis-preferences';
import { AnalysisPreparation } from './analysis-preparation';
import { LanguageServiceSupervisor } from './language-supervisor';
import { preparationIssue, runtimeHelp, sessionIssue } from './language-issue';
import { configuredJavaHome, isJdtls, javaPlan, javaSettings, jdtlsJava, toolRuntime, type JavaPlan, type ToolRuntime } from './tool-runtime';
import { kotlinInitializationOptions } from './kotlin-options';
import { answersRequest, autoInsertion, companionLanguages, isClangd, isGopls, isJsonServer, isKotlinServer, isSvelteServer, isTypeScriptServer, jsonLanguageStatus, restartsTool, schemaLines, setting, svelteAsksAboutRename, svelteRenameChanges, svelteRenameEdits, svelteScriptChanged, svelteScriptLanguages, toolFamily, typescriptOptions, withSetting } from './extension-rules';
import { isOwnAction, isToolCommand, toolMessage } from '../../protocol/language-tools';
import { toolRules, withRules } from './tool-rules';
import { contributed, joinSettings, withContributions, type Contribution, describeContributions } from './tool-contributions';
import type { ToolAction, ToolRulesFactory } from './tool-signals';
import { javaRules } from './java-signals';
import { isKotlinReload, kotlinReloadFailure, kotlinReloadParams, kotlinRules } from './kotlin-signals';
import { goTagsCommand, goTestProgram } from './go-project';
import { goplsOwnOptions } from './go-gopls-rules';
import { kotlinProjectJdk } from './kotlin-project-jdk';
import type { KotlinJdkPlan } from './kotlin-jdk';
import { intelephenseNodeArguments, intelephenseRules, licenceKeyProblem } from './intelephense-rules';
import { pythonCancellation, temporaryFolderOf } from './python-cancellation';
import { pyrightThread } from './pyright-thread';
import { yamlDetectionAfterPick, yamlDetectionSetting, yamlFileSchemasMethod, yamlSchemasAfterPick, yamlSchemasSetting } from './yaml-schema-choice';
import { JsonSchemaContent, schemaDownloadSettings } from './json-schema-content';
import { withBuiltinJsonSchemas } from './json-builtin-schema-files';
import type { AnalysisObservation, AnalysisSelection, DocumentAnalysis } from '../../core/document/analysis-context';
import { languageFailure } from '../../protocol/language-request';
import { AutomaticDownloadsDisabled, LanguageProvisioner, mergeLanguageSettings, protocolLanguageId } from './language-provisioner';
import { setAsideNote } from './program-health';
import type { PreparedLanguageServer } from './zed-language-host';
import { RuntimeLanguageCatalog } from './runtime-language-catalog';
import { ZedProjectSettings } from './zed-project-settings';
import { catalogLanguage, languageDefinitions } from '../../core/document/language-catalog';
import { ProjectLanguages } from './project-languages';

type Binding = { languageId: string; id: string; generation: string; uri: string; version: number; server: ServerSession; capabilities: LanguageCapabilities };
type Owner = { state: WindowState; documents: Map<string, Binding>; servers: Map<string, ServerSession>;
  requests: Map<string, CancellationTokenSource> };
export type AutomaticLanguagePackages = Pick<LanguageProvisioner, 'rank' | 'canPrepare' | 'prepare' | 'highlight' | 'dispose'> & Partial<Pick<LanguageProvisioner, 'installation' | 'usesZed' | 'projectEnvironment' | 'resetEnvironment' | 'pythonEnvironments' | 'contributions' | 'setAside' | 'setAsideProgram' | 'tryProgramsAgain'>>;

/** A separate server for each (window, server kind, project root). Unsaved buffers never cross windows. */
/** How long quitting waits for language tools to shut down: above the 3 s the project host gives
 * its servers (`SHUTDOWN_LIMIT`) and the 1.5 s after which a session's process is killed. */
const quitDrainLimit = 6000;
export class LanguageManager {
  /** Ordinary Python files see the environments Zed's search finds; a failed search leaves the ones
   * Setdown finds itself. The search reads the environment the tools get (PYENV_ROOT, CONDA_*, PATH),
   * so it waits for that environment as Setdown's own search does. */
  private readonly contexts = new AnalysisContextService(async root => {
    if (!this.provisioner.pythonEnvironments) return [];
    try { return await this.provisioner.pythonEnvironments(root, (await this.discovery.environment.resolve()).env); }
    catch (error) { console.warn('Could not list Python environments', error); return []; }
  });
  private readonly supervisor = new LanguageServiceSupervisor();
  private readonly preparation = new AnalysisPreparation();
  private provisionerValue?: AutomaticLanguagePackages;
  private catalogValue?: RuntimeLanguageCatalog;
  private get packageCatalog(): RuntimeLanguageCatalog { return this.catalogValue ??= new RuntimeLanguageCatalog(path.join(app.getPath('userData'),'language-packages')); }
  private get provisioner(): AutomaticLanguagePackages {
    return this.provisionerValue ??= this.packagePreparation ?? new LanguageProvisioner(path.join(app.getPath('userData'), 'language-packages'), this.hostExecutable, fetch, this.packageCatalog);
  }
  private get hostExecutable(): string {
    return path.join(__dirname, 'language-host', process.platform === 'win32' ? 'setdown-language-host.exe' : 'setdown-language-host').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  }
  private schemasValue?: JsonSchemaContent;
  /** The schemas the JSON server asks its editor for: checked against the trusted domains, downloaded and kept. */
  private get schemas(): JsonSchemaContent { return this.schemasValue ??= new JsonSchemaContent({ directory: path.join(app.getPath('userData'), 'language-packages', 'json-schemas') }); }
  private projectsValue?: ProjectLanguages | null;
  /** Zed's project engine, for the ordinary files of the tools that have moved to it. */
  private get projects(): ProjectLanguages | undefined {
    if (this.projectsValue === undefined) this.projectsValue = this.projectEngine !== undefined ? this.projectEngine
      // A stand-in for tool preparation (in tests) has no Zed host behind it.
      : this.packagePreparation ? null : new ProjectLanguages({ directory: path.join(app.getPath('userData'), 'language-packages'), executable: this.hostExecutable,
        home: app.getPath('home'), packaged: app.isPackaged, registry: () => this.registry, catalog: () => this.packageCatalog,
        schemas: this.schemas, toolEnvironment: () => this.discovery.environment.peek().env,
        programs: { find: async program => this.provisioner.setAsideProgram?.(program), add: async (program, reason) => await this.provisioner.setAside?.(program, reason) ?? false },
        writeSettings: (tool, resource, root, entries) => this.writeSettings(tool, resource, root, entries),
        emit: (state, event) => { if (!state.window.isDestroyed() && !state.window.webContents.isDestroyed()) state.window.webContents.send('language:event', event); } });
    return this.projectsValue ?? undefined;
  }
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
  constructor(private readonly stateFor: (id: number) => WindowState | null, private readonly discovery = new ServerDiscovery(), private readonly packagePreparation?: AutomaticLanguagePackages,
    private readonly projectEngine?: ProjectLanguages | null) {}
  private zedSettingsValue?: ZedProjectSettings;
  private get zedSettings(): ZedProjectSettings {
    return this.zedSettingsValue ??= new ZedProjectSettings({ home: app.getPath('home'), changed: servers => this.zedSettingsChanged(servers) });
  }
  private zedSettingsChanged(names: string[]): void {
    const update = this.updating.then(async () => {
      this.contexts.invalidate();
      const affected = new Set(this.registry.definitions().filter(definition =>
        [definition.id, definition.provenance?.profile, definition.launch.kind === 'native' ? definition.launch.command : undefined,
          this.packageCatalog.binding(definition.id)?.server].some(name => !!name && names.includes(name))).map(definition => definition.id));
      for (const owner of this.owners.values()) {
        const servers = [...owner.servers.values()].filter(server => {
          const info = this.sessions.get(server);
          return info && info.configuration !== JSON.stringify(this.registry.options(info.id, info.resource));
        });
        for (const server of servers) affected.add(this.sessions.get(server)!.id);
        for (const [id, binding] of owner.documents) if (servers.includes(binding.server)) owner.documents.delete(id);
        for (const [key, server] of owner.servers) if (servers.includes(server)) owner.servers.delete(key);
        await Promise.all(servers.map(server => this.stop(server)));
      }
      // Includes documents still awaiting provisioning: their fingerprint fence cancels the old request.
      this.broadcast({ type: 'configuration', servers: [...affected] });
    });
    this.updating = update.catch(error => console.warn('Could not apply Zed language settings', error));
  }
  private registryValue: ServerRegistry | undefined;
  private readonly subscribers = new Map<number, WindowState>();
  private readonly sessions = new Map<ServerSession, { plan?: AnalysisPlan; recoveryKey?: string; unwatch?: () => void; id: string; root: string; resource?: string; rootReason?: string; configuration?: string; state: 'starting' | 'ready' | 'failed'; message?: string; issue?: LanguageIssue; settling?: Promise<void>; features?: string[];
    /** What Setdown adds to kotlin-lsp's initialization options beside the settings; sent again with every reload. */
    kotlinAdded?: Record<string, unknown>;
    /** What other tools' extensions added to this tool when it was started (`tool-contributions.ts`). Absent for a tool its own extension set up. */
    contributed?: string }>();
  /** Initialization options for the next start of a tool in a project, used once: Intelephense
   * rebuilds its index when it is started with `clearCache`. */
  private readonly startOnce = new Map<string, Record<string, unknown>>();
  private updating: Promise<void> = Promise.resolve();
  private get registry(): ServerRegistry { return this.registryValue ??= new ServerRegistry(app.getPath('userData'),()=>this.packageCatalog.profiles,
    (definition, resource) => this.zedSettings.options(definition, resource, this.packageCatalog.binding(definition.id)?.server),
    language => this.packageCatalog.definition(language)?.servers ?? []); }
  private async changed(task: () => unknown | Promise<unknown>): Promise<void> {
    const update = this.updating.then(async () => {
      const before = new Map(this.registry.definitions().map(d => [d.id, this.registry.fingerprint(d.id)]));
      const active = new Map([...this.sessions].map(([server, info]) => [server, info.resource ? this.registry.sessionFingerprint(info.id, info.resource) : undefined]));
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
      await this.projectsValue?.configure().catch(error => console.warn('Could not apply language settings to Zed', error));
      const retainedDocuments: { id: string; generation: string }[] = [];
      for (const owner of this.owners.values()) {
        const servers = [...owner.servers.values()].filter(server => {
          const info = this.sessions.get(server);
          if (!info || !affected.has(info.id)) return false;
          return !after.has(info.id) || !info.resource || active.get(server) !== this.registry.sessionFingerprint(info.id, info.resource);
        });
        for (const binding of owner.documents.values()) if (!servers.includes(binding.server)) retainedDocuments.push({ id: binding.id, generation: binding.generation });
        for (const [id, binding] of owner.documents) if (servers.includes(binding.server)) owner.documents.delete(id);
        for (const [key, server] of owner.servers) if (servers.includes(server)) owner.servers.delete(key);
        await Promise.all(servers.map(server => this.stop(server)));
      }
      this.broadcast({ type: 'configuration', servers: [...affected], retainedDocuments });
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
      this.provisionerValue?.resetEnvironment?.();
      // Forgets what was found, so documents without a tool look again. Nothing is scanned here.
      await this.discovery.environment.resolve();
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
    // A Zed extension names its server, and the profile keeps that name as its command.
    // The name is not a program to look up: `java`, `cmake` and `gem` exist on PATH and
    // are not language servers. The extension's adapter owns the lookup.
    if (definition?.provenance?.source === 'Zed' && commands.every(command => !path.isAbsolute(command)))
      return { candidates: [], searched: [], environment: snapshot };
    const results = await Promise.all(commands.map(command => this.discovery.find(command, {
      ...packageDiscovery(id), python: definition?.discovery === 'python' || packageDiscovery(id).python,
      npmPackage: definition?.npmPackage ?? packageDiscovery(id).npmPackage, resolveEnvironment,
    })));
    const candidates = [...new Map(results.flatMap(r => r.candidates).map(c => [c.id, c])).values()];
    // The first match in search order is the one to run; a person who wants another names its path.
    return { candidates, selected: results.length === 1 ? results[0].selected : candidates[0],
      searched: [...new Set(results.flatMap(r => r.searched))], environment: snapshot };
  }
  /** Reads settings and the receipts of prepared tools. Only `inspect`, the one tool a person
   * opened, is looked up on this computer; nothing lists what else is installed. */
  private async catalogFor(state: WindowState, file?: string, inspect?: string): Promise<LanguageCatalog> {
    this.subscribe(state);
    await this.updating;
    const resource = file === undefined ? undefined : this.ownedFile(state, file);
    const catalog = (await import('./catalog/mason.json')).default;
    const registry = this.registry;
    const definitions = registry.definitions();
    // A catalog entry without a connection profile cannot run; it is not offered.
    const packages = languageCatalog.filter(item => definitions.some(d => d.id === item.id));
    for (const definition of definitions) if (!packages.some(item => item.id === definition.id))
      packages.push({ id: definition.id, languages: definition.languages.map(l => l.languageId), description: 'Custom language server connection.', homepage: '', licenses: [], source: { id: '' }, executables: [] } as typeof packages[number]);
    const entries: LanguageCatalogEntry[] = await mapLimited(packages, async item => {
      const definition = definitions.find(d => d.id === item.id), options = definition && registry.options(item.id, resource);
      const projectRoot = definition && resource ? languageRoot(resource, definition, state.projectRoot ?? undefined, options?.root).path : undefined;
      const bundled = definition?.launch.kind === 'bundledNode';
      const executable = definition ? registry.executable(item.id, this.discovery.environment.peek().env) : undefined;
      // A path a person named, or their own connection, is checked for existence; that reads one file.
      const named = !!definition && !bundled && (registry.isCustom(item.id) || path.isAbsolute(executable ?? ''));
      const found = item.id === inspect || named ? await this.discover(item.id, item.id === inspect) : undefined;
      const managedPreparation = definition && !registry.isCustom(item.id) && !path.isAbsolute(executable ?? '') && this.provisioner.canPrepare(definition);
      // A receipt of a prepared tool is a small file Setdown wrote; reading it scans nothing.
      const preparation = managedPreparation ? await this.provisioner.installation?.(item.id) : undefined;
      const resolved = bundled ? executable : found?.selected?.path;
      const owner = this.owners.get(state.webContentsId);
      return { id: item.id, name: definition?.name ?? item.id, languages: item.languages, description: item.description, homepage: item.homepage,
        role: definition ? registry.role(item.id, resource ?? projectRoot) : undefined, projectRoot,
        globalOptions: definition ? { automaticInstall:registry.options(item.id).automaticInstall,args: registry.options(item.id).args ?? definition.launch.args, settings: registry.options(item.id).settings ?? definition.settings, initializationOptions: registry.options(item.id).initializationOptions ?? definition.initializationOptions ?? {}, root: registry.options(item.id).root, role: registry.role(item.id), formatting: registry.options(item.id).formatting } : undefined,
        configured: !!definition, bundled, custom: !!definition && registry.isCustom(item.id),
        preparation: preparation || (managedPreparation ? { state: 'available' as const, downloadsAllowed: registry.automaticInstall(item.id), asks: registry.asksBeforeInstalling(item.id) } : undefined),
        managed: !!definition && (registry.isCustom(item.id) || Object.keys(options ?? {}).length > 0 || !!executable && path.isAbsolute(executable)),
        enabled: !!definition && registry.enabled(item.id), selected: [] as string[],
        executable: resolved || executable, available: bundled || found ? !!resolved : undefined, automatic: !!definition && registry.automatic(item.id),
        canDetect: !!definition && registry.canDetect(item.id),
        chosen: !!definition && !bundled && path.isAbsolute(executable ?? ''),
        profileSource: definition?.provenance ? `${definition.provenance.source} · ${definition.provenance.profile}` : undefined,
        setupNote: definition?.setupNote,
        options: definition ? { automaticInstall:options?.automaticInstall,role: registry.role(item.id, resource ?? projectRoot), formatting: options?.formatting, scope: projectRoot, args: options?.args ?? definition.launch.args, settings: options?.settings ?? definition.settings,
          initializationOptions: serverProfile(definition, options).initializationOptions ?? {}, root: options?.root } : undefined,
        sessions: [...[...(owner?.servers.values() ?? [])].flatMap(server => {
          const info = this.sessions.get(server); return info?.id === item.id ? [{ root: info.root, rootReason: info.rootReason, state: info.state, message: info.message, issue: info.issue, features: info.features, context: [...server.context ?? []].map(([key, value]) => `${key}: ${value}`), logs: server.logs, progress: [...(server.progress?.values() ?? [])] }] : [];
        }), ...this.projectsValue?.sessions(state.webContentsId, item.id) ?? []] };
    });
    entries.push({ id: 'notebook-python', name: 'Notebook Python', languages: ['python'],
      description: 'Cell-aware Python analysis for Jupyter notebooks, using the Python environment selected in the notebook.',
      homepage: '', configured: true, bundled: true, custom: false, enabled: true, selected: ['Python notebooks'],
      available: true, notebook: true, sessions: this.notebooks.snapshot(state.webContentsId) });
    // Dialects share their language's editor id (TSX is edited as TypeScript). The language
    // is listed once, under its own name and not under the name of its last dialect.
    const named = new Map<string, typeof languageDefinitions[number]>();
    for (const language of [...languageDefinitions, ...this.packageCatalog.languages])
      if (!named.has(language.id) || language.sourceId === language.id) named.set(language.id, language);
    const languages = [...named.values()].map(language => ({ id: language.id, name: language.label ?? language.name,
      selection: registry.analysisSelection(language.id), defaultServer: registry.defaultServer(language.id),
      servers: definitions.filter(d => registry.role(d.id) === 'primary' && this.mainFor(d, language.id)).map(d => d.id) }));
    for (const definition of definitions.filter(d => registry.isCustom(d.id))) for (const language of definition.languages) if (!languages.some(l => l.id === language.languageId))
      languages.push({ id: language.languageId, name: language.languageId, selection: registry.analysisSelection(language.languageId), defaultServer: registry.defaultServer(language.languageId),
        servers: definitions.filter(d => registry.role(d.id) === 'primary' && this.mainFor(d, language.languageId)).map(d => d.id) });
    for (const entry of entries) if (!entry.notebook) entry.selected = languages.filter(language => language.defaultServer === entry.id).map(language => language.id);
    return { release: catalog.release, profileSource, profiles: definitions.length, entries, automaticInstall: registry.automaticInstall(), languages };
  }
  install(): void {
    const state = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
      const owner = this.stateFor(event.sender.id);
      if (!owner || event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed())
        throw new Error('Language support is available only to the owning editor.');
      return owner;
    };
    ipcMain.handle('language:open', (event, document: LanguageDocument) => this.open(state(event), document));
    ipcMain.handle('language:definitions', (event,file?:string) => {
      const owner=state(event);this.subscribe(owner);if(file)this.ownedFile(owner,file);
      this.packageCatalog.schedule(async apply => { await this.changed(apply); this.broadcast({type:'configuration',servers:[]}); },!!file&&!catalogLanguage(file));
      return this.packageCatalog.languages;
    });
    ipcMain.handle('language:highlight', async (event, file: string, languageId: string, text: string) => {
      const owner = state(event); this.ownedFile(owner,file);
      if (typeof languageId !== 'string' || languageId.length > 100 || typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024)
        throw Error('Invalid syntax document.');
      const result = await this.provisioner.highlight(languageId,text);
      this.ownedFile(owner,file); return result;
    });
    ipcMain.handle('language:notebook-change', (event, id, version, cells) => this.notebooks.change(state(event).webContentsId, id, version, cells));
    ipcMain.handle('language:change', (event, id: string, version: number, changes: TextDocumentContentChangeEvent[]) => {
      const sender = state(event);
      if (this.projectsValue?.has(sender.webContentsId, id)) return this.projectsValue.change(sender.webContentsId, id, version, changes);
      const binding = this.binding(sender.webContentsId, id);
      if (!Number.isSafeInteger(version) || version <= binding.version || !Array.isArray(changes)
        || changes.length > 10000 || JSON.stringify(changes).length > 32 * 1024 * 1024) throw new Error('Invalid language change.');
      binding.version = version;
      this.items.get(binding.server)?.forget(id, false);
      this.scriptChanged(sender.webContentsId, binding, changes);
      if (textSynchronization(binding.capabilities).change === 0) return;
      return binding.server.notify('textDocument/didChange', { textDocument: { uri: binding.uri, version }, contentChanges: changes });
    });
    ipcMain.handle('language:request', async (event, id: string, version: number, requestId: string, method: LanguageMethod, params: unknown) => {
      const sender = state(event);
      if (this.notebooks.has(sender.webContentsId, id)) return this.notebooks.request(sender.webContentsId, id, version, requestId, method, params).catch(languageFailure);
      if (this.projectsValue?.has(sender.webContentsId, id)) return this.projectsValue.request(sender.webContentsId, id, version, requestId, method, params);
      const owner = this.owners.get(state(event).webContentsId);
      const binding = this.binding(event.sender.id, id);
      if (!owner || binding.version !== version || !languageMethods.includes(method)
        || typeof requestId !== 'string' || requestId.length > 128 || owner.requests.has(requestId)
        || owner.requests.size >= 64 || !params || typeof params !== 'object' || JSON.stringify(params).length > 4 * 1024 * 1024) throw new Error('Invalid or stale language request.');
      if (!answersRequest(this.registry.definitions().find(definition => definition.id === this.sessions.get(binding.server)?.id), method)) throw new Error('This tool does not answer that request.');
      let made: ReturnType<typeof toolMessage>;
      if (isOwnAction(method)) {
        if (method !== 'setdown/go.modifyTags') return this.ownAction(owner, binding, method, params as Record<string, unknown>).catch(languageFailure);
        // Sent as a command of gopls, which then changes the struct itself (`go-project.ts`).
        const info = this.sessions.get(binding.server), definition = info && this.registry.definition(info.id);
        const tags = info && goTagsCommand(binding.uri, params as Record<string, unknown>, this.registry.options(info.id, info.resource).settings ?? definition?.settings);
        if (!tags) throw new Error('Select the fields of a struct in a Go file.');
        if ('ask' in tags) return tags;
        made = { method: 'workspace/executeCommand', params: tags, notification: false };
      }
      const origin = { document: id, generation: binding.generation, version };
      const items = this.items.get(binding.server)!;
      // A tool's own request (`language-tools.ts`): its name and parameter are made here.
      const own = made ?? toolMessage(method, params as Record<string, unknown>, binding.uri);
      const command = method === 'workspace/executeCommand' || isToolCommand(method) || !!made;
      const itemMethod = method in resolveMethods || method === 'workspace/executeCommand';
      const requestParams = itemMethod ? items.resolve(method, params, origin)
        : made ? made.params : documentRequest(method, params, binding.uri);
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
        if (own?.notification) { await binding.server.notify(own.method, own.params); return null; }
        const result = await binding.server.request(own?.method ?? method, requestParams, token, method === 'textDocument/willSaveWaitUntil' ? 1500 : own ? 60_000 : undefined);
        return owner.documents.get(id) === binding && binding.version === version
          ? items.remember(method, result, origin) : null;
      } catch (error) { return languageFailure(error); } finally {
        owner.requests.delete(requestId);
        if (command) this.commands.delete(binding.server);
      }
    });
    ipcMain.on('language:edit-applied', (event, requestId: string, applied: boolean, failureReason?: string) => {
      let sender: WindowState; try { sender = state(event); } catch { return; }
      if (typeof applied !== 'boolean' || this.projectsValue?.editApplied(sender, requestId, applied, failureReason)) return;
      const proposal = this.editRequests.get(requestId);
      if (!proposal || proposal.owner.state !== sender) return;
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
    listen('language:cancel', (owner, id) => { this.notebooks.cancel(owner.webContentsId, id); this.projectsValue?.cancel(owner.webContentsId, id); this.owners.get(owner.webContentsId)?.requests.get(id)?.cancel(); });
    listen('language:close', (owner, id) => this.close(owner.webContentsId, id));
    ipcMain.on('language:release-items', (event, id: string, handles: unknown) => {
      let sender: WindowState; try { sender = state(event); } catch { return; }
      if (!Array.isArray(handles) || handles.length > 100000 || handles.some(value => typeof value !== 'string' || value.length > 128)) return;
      if (this.notebooks.has(sender.webContentsId, id)) { this.notebooks.releaseItems(sender.webContentsId, id, handles); return; }
      if (this.projectsValue?.has(sender.webContentsId, id)) { this.projectsValue.releaseItems(sender.webContentsId, id, handles); return; }
      const binding = this.owners.get(sender.webContentsId)?.documents.get(id);
      if (binding) this.items.get(binding.server)?.release(handles, { document: id, generation: binding.generation });
    });
    ipcMain.on('language:saved', (event, id: string, text?: string) => {
      let owner: WindowState; try { owner = state(event); } catch { return; }
      if (this.projectsValue?.has(owner.webContentsId, id)) { this.projectsValue.saved(owner.webContentsId, id); return; }
      const binding = this.owners.get(owner.webContentsId)?.documents.get(id);
      if (!binding) return;
      const save = textSynchronization(binding.capabilities).save;
      if (save && (!save.includeText || (typeof text === 'string' && text.length <= 16 * 1024 * 1024)))
        void binding.server.notify('textDocument/didSave', { textDocument: { uri: binding.uri }, ...(save.includeText ? { text } : {}) }).catch(() => {});
    });
    ipcMain.handle('language:restart', async (event, file?: string, provider?: string) => {
      const owner = state(event);
      // A restart is how a person says that something outside changed: a program set aside is started again.
      await this.provisioner.tryProgramsAgain?.();
      if (file !== undefined) {
        const resource = this.ownedFile(owner, file);
        if (provider === 'notebook-python') { this.notebooks.resetRecovery(owner.webContentsId, resource); return; }
        const current = this.owners.get(owner.webContentsId);
        const servers = new Set([...current?.documents.values() ?? []].filter(b => b.uri === pathToFileURL(resource).href && (!provider || this.sessions.get(b.server)?.id === provider)).map(b => b.server));
        for (const server of servers) { const key = this.sessions.get(server)?.recoveryKey; if (key) this.supervisor.reset(key); await this.reconnect(current!, server); }
        await this.projectsValue?.restart(owner.webContentsId, resource, provider);
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
    ipcMain.handle('language:catalog', async (event, file?: string, inspect?: string) => {
      if (inspect !== undefined && (typeof inspect !== 'string' || inspect.length > 128)) throw Error('Invalid tool.');
      return this.catalogFor(state(event), file, inspect);
    });
    ipcMain.handle('language:rescan', event => { this.subscribe(state(event)); return this.rescan(); });
    ipcMain.handle('language:answer', (event, file: string, answer: LanguageAnswer) => { this.ownedFile(state(event), file); return writeLanguageAnswer(app.getPath('userData'), answer); });
    ipcMain.handle('language:automatic', (event, id: string) => { state(event); return this.changed(() => this.registry.useAutomatic(id)); });
    ipcMain.handle('language:set-enabled', (event, id: string, enabled: boolean) => {
      state(event); return this.changed(() => this.registry.setEnabled(id, enabled));
    });
    ipcMain.handle('language:set-automatic-install', (event, enabled: boolean) => {
      state(event); return this.changed(() => this.registry.setAutomaticInstall(enabled));
    });
    ipcMain.handle('language:set-default', (event, language: string, value: string) => {
      state(event); return this.changed(() => this.registry.selectAnalysis(language, value));
    });
    ipcMain.handle('language:configure', (event, id: string, options: LanguageServerOptions) => {
      state(event); return this.changed(() => this.registry.configure(id, options, options.scope));
    });
    ipcMain.handle('language:remove', (event, id: string) => { state(event); return this.changed(() => this.registry.remove(id)); });
    ipcMain.handle('language:choose-executable', async (event, id: string) => {
      const owner = state(event), definition = this.registry.definition(id);
      if (definition.launch.kind === 'bundledNode') return false;
      const result = await pathDialog.showOpenDialog(owner.window, { title: `Select ${definition.name} Executable`, properties: ['openFile'] });
      if (result.canceled || !result.filePaths[0] || owner.window.isDestroyed()) return false;
      await this.changed(() => this.registry.chooseExecutable(id, result.filePaths[0])); return true;
    });
    ipcMain.handle('language:import-definition', async event => {
      const owner = state(event);
      const result = await pathDialog.showOpenDialog(owner.window, { title: 'Import Language Server Connection', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled || !result.filePaths[0] || owner.window.isDestroyed()) return false;
      if ((await stat(result.filePaths[0])).size > 128 * 1024) throw Error('Language definition is too large.');
      const definition = validateLanguageDefinition(JSON.parse(await readFile(result.filePaths[0], 'utf8')));
      await this.changed(() => this.registry.add(definition)); return true;
    });
    ipcMain.handle('language:homepage', async (event, id: string, runtime?: string) => {
      state(event);
      // Only pages from the shipped tables are opened; a renderer cannot supply a URL.
      const page = runtime === undefined ? languageCatalog.find(item => item.id === id)?.homepage
        : typeof runtime === 'string' && Object.hasOwn(runtimeHelp, runtime) ? runtimeHelp[runtime] : undefined;
      if (!page || !/^https?:\/\//.test(page)) throw Error('No installation page is available.');
      await shell.openExternal(page);
    });
    ipcMain.handle('language:allow-download', (event, id: string) => {
      state(event);
      return this.changed(() => this.registry.allowDownload(id));
    });
    let drained = false;
    app.on('will-quit', event => {
      this.discovery.dispose(); this.preparation.dispose(); this.supervisor.dispose(); this.provisionerValue?.dispose(); this.catalogValue?.dispose(); this.zedSettingsValue?.dispose();
      if (drained || (!this.owners.size && !this.draining.size && !this.notebooks.running && !this.projectsValue)) return;
      event.preventDefault();
      const left = Promise.all([this.notebooks.dispose(), this.projectsValue?.dispose(), ...[...this.owners.keys()].map(id => this.dispose(id))])
        .then(() => Promise.all([...this.draining])).catch(() => {});
      // The tools have a bounded time to leave. A tool or a host that never answers must not keep
      // a process without windows alive: it would hold the app's single-instance lock, and every
      // later start of the app would be handed to a process whose services are gone.
      const limit = new Promise<void>(resolve => { setTimeout(resolve, quitDrainLimit); });
      void Promise.race([left, limit]).finally(() => { drained = true; app.quit(); });
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
    // A window that shows only notebooks must still hear environment and level changes:
    // the notebook reconnects on the same broadcast as ordinary documents.
    this.subscribe(state);
    if (document?.notebook === 'python') return this.notebooks.open(state, document);
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
    // From here a tool is looked for, fetched or started for this document, which takes seconds
    // when an extension is loaded first or the computer is searched. The document hears it now:
    // until there is an answer, "nothing checks this file" would be a guess, and a wrong one.
    this.emit(owner, { type: 'status', state: 'starting', server: { id: support.server, name: this.registry.definition(support.server).name },
      documents: [{ id: document.id, generation: document.generation }] });
    const projects = this.projects;
    if (projects) {
      // The tool this language starts first. When Zed's project engine serves it, Zed opens
      // the file; otherwise everything below still runs on Setdown's own client.
      const first = [...candidates].sort((a, b) => this.provisioner.rank(this.registry.definition(a.server), a.languageId) - this.provisioner.rank(this.registry.definition(b.server), b.languageId))[0];
      const tool = this.registry.definition(first.server);
      const served = projects.eligible(tool, file, first.languageId) ? await projects.target(tool) : undefined;
      if (served) {
        if (!owns() || this.owners.get(state.webContentsId) !== owner) throw new Error('The language document is not open in this window.');
        return projects.open(state, document, file, { tool: tool.id, toolName: tool.name, server: served, primary: document.server === undefined, languageId: first.languageId }, tool);
      }
    }
    const configurations = new Map(candidates.map(c => [c.server, this.registry.fingerprint(c.server, file)]));
    const roots = new Map<string, LanguageRoot>();
    const rootFor = (definition: LanguageServerDefinition) => {
      const language = candidates.find(candidate => candidate.server === definition.id)?.languageId;
      if (!roots.has(definition.id)) roots.set(definition.id, languageRoot(file, { ...definition, languages: this.registry.projectLanguages(definition.id, language, file) },
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
    let prepared: PreparedLanguageServer | undefined;
    // The program the tool was found in, before a runtime was put in front of it, and the program
    // of this computer that was passed by for it because it cannot run (`program-health.ts`).
    let program: string | undefined;
    let passedBy: PreparedLanguageServer['instead'];
    let plan: AnalysisPlan | undefined;
    let runtime: ToolRuntime | undefined;
    // What was decided about Java when the tool is jdt.ls: the JDK it runs on and the JDKs a project may use.
    let java: JavaPlan | undefined;
    let kotlinJdk: KotlinJdkPlan = {};
    let additions: Contribution[] | undefined;
    let created = false;
    const named = () => ({ id: support.server, name: definition.name });
    // A connection that cannot be prepared reports why before the request is rejected,
    // so the document shows the cause and its repair instead of a bare error.
    const reject = (message: string, issue: LanguageIssue): never => {
      if (pending.get(document.id) === opening) this.emit(owner, { type: 'status', state: 'failed', message, issue, server: named(), documents: [{ id: document.id, generation: document.generation }] });
      throw Error(message);
    };
    const prepare = async (environment: NodeJS.ProcessEnv) => {
      const target = named();
      // A tool Setdown installed once was asked for then; another project reuses that answer.
      const automaticInstall = this.registry.automaticInstall(support.server, file)
        || this.registry.asksBeforeInstalling(support.server, file) && !!await this.provisioner.installation?.(support.server);
      const options = this.registry.options(support.server, file);
      // The Zed Java extension starts jdt.ls on `java_home`, else on the environment's Java, and
      // refuses one that is too old. It is told the JDK the VS Code Java extension would run on.
      java = isJdtls(definition) ? await javaPlan(environment, options.settings ?? definition.settings) : undefined;
      // VS Code's Java extension brings a Java of its own. Setdown has none, so where no JDK of
      // this computer is new enough and the person named none, the Zed extension downloads one
      // (`jdk_auto_download`), under the same leave as the download of the tool itself.
      const written = options.settings ?? definition.settings;
      const settings = java?.tooling ? { settings: { ...written, java_home: java.tooling.home } }
        : java && automaticInstall && !configuredJavaHome(written) && written?.jdk_auto_download === undefined ? { settings: { ...written, jdk_auto_download: true } } : {};
      return this.provisioner.prepare(definition, support.languageId, root, environment,
        { ...options, ...settings, automaticInstall }, message => {
          if (current()) this.emit(owner, { type: 'status', state: 'starting', preparing: true, message, server: target, documents: [{ id: document.id, generation: document.generation }] });
        }).catch(error => {
          if (error instanceof AutomaticDownloadsDisabled || !current()) throw error;
          const issue = preparationIssue(error, false, java && { required: jdtlsJava, found: java.found });
          return reject(String(error instanceof Error ? error.message : error), issue.kind === 'no-installer'
            ? { ...issue, help: /^https?:\/\//.test(languageCatalog.find(item => item.id === support.server)?.homepage ?? '') } : issue);
        });
    };
    const ranked = <T extends { server: string; languageId: string }>(items: T[]) => [...items].sort((a, b) =>
      this.provisioner.rank(this.registry.definition(a.server), a.languageId) - this.provisioner.rank(this.registry.definition(b.server), b.languageId));
    const analysisRevision = this.analysisRevisions.get(root) ?? 0;
    const current = () => analysisRevision === (this.analysisRevisions.get(root) ?? 0) && pending.get(document.id) === opening && this.owners.get(state.webContentsId) === owner
      && !state.window.isDestroyed() && !state.window.webContents.isDestroyed() && owns()
      && JSON.stringify(this.registry.candidates(languagePath, document.server, document.languageId)) === JSON.stringify(candidates)
      && candidates.every(c => this.registry.fingerprint(c.server, file) === configurations.get(c.server));
    try {
      if (!server) for (;;) {
        const revision = this.discovery.generation;
        try {
          // A supported Zed adapter owns external lookup, validation and managed
          // preparation. The global metadata scan must never short-circuit it.
          const zed = (await mapLimited(candidates, async candidate => {
            const d = this.registry.definition(candidate.server);
            return d.launch.kind !== 'bundledNode' && !this.registry.isCustom(d.id)
              && !path.isAbsolute(this.registry.executable(d.id, this.discovery.environment.peek().env))
              && await this.provisioner.usesZed?.(d) ? candidate : undefined;
          })).filter((candidate): candidate is typeof support => !!candidate);
          if (revision !== this.discovery.generation) continue;
          if (!current()) throw Error('Language document closed or configuration changed during adapter selection.');
          if (zed.length) {
            // Several tools can serve a language with no declared default. The language's
            // own order decides; the person can still choose another tool for the project.
            support = ranked(zed)[0]; definition = this.registry.definition(support.server); root = rootFor(definition);
            const inherited = this.discovery.environment.peek().env;
            const environment = await this.provisioner.projectEnvironment?.(root, inherited) ?? inherited;
            // Without leave to download, an extension is not loaded and cannot look for its tool.
            // A program already on this computer still runs: it is looked up by name below.
            prepared = await prepare(environment).catch(error => { if (error instanceof AutomaticDownloadsDisabled) return undefined; throw error; });
            if (revision !== this.discovery.generation) continue;
            if (!current()) throw Error('Language document closed or configuration changed during Zed preparation.');
            if (prepared) {
              const { NODE_OPTIONS: _node, NODE_PATH: _path, ELECTRON_RUN_AS_NODE: _electron, ...env } = environment;
              launch = { executable: prepared.executable, args: prepared.args, env: { ...env, ...prepared.env } };
              program = prepared.executable; passedBy = prepared.instead;
              break;
            }
          }
          const bundled = candidates.find(c => this.registry.definition(c.server).launch.kind === 'bundledNode');
          const available: { support: typeof support; found?: Discovery }[] = bundled ? [{ support: bundled }]
            : await mapLimited(candidates, async candidate => ({ support: candidate, found: await this.discover(candidate.server, true) }));
          if (revision !== this.discovery.generation) continue;
          if (!current()) throw Error('Language document closed or configuration changed during discovery.');
          // A program of this computer that was found unable to run is passed by where Setdown can
          // prepare the tool itself. One the person named is used as it is.
          const aside = new Map<string, PreparedLanguageServer['instead']>();
          for (const { support: candidate, found } of available) {
            const d = this.registry.definition(candidate.server), at = found?.selected?.path;
            if (!at || this.registry.isCustom(d.id) || path.isAbsolute(this.registry.executable(d.id, this.discovery.environment.peek().env)) || !this.provisioner.canPrepare(d)
              || !this.registry.automaticInstall(d.id, file)) continue;
            const entry = await this.provisioner.setAsideProgram?.(at);
            if (entry) aside.set(candidate.server, { program: at, ...(entry.detail ? { detail: entry.detail } : {}) });
          }
          if (revision !== this.discovery.generation) continue;
          if (!current()) throw Error('Language document closed or configuration changed during discovery.');
          const installed = available.filter(c => (!c.found || c.found.selected) && !aside.has(c.support.server));
          if (!installed.length) {
            const installable = candidates.filter(candidate => {
              const d = this.registry.definition(candidate.server);
              return !this.registry.isCustom(d.id) && !path.isAbsolute(this.registry.executable(d.id,this.discovery.environment.peek().env))
                && this.provisioner.canPrepare(d);
            }).sort((a,b) => this.provisioner.rank(this.registry.definition(a.server),a.languageId) - this.provisioner.rank(this.registry.definition(b.server),b.languageId));
            if (installable.length) {
              support = installable[0]; definition = this.registry.definition(support.server); root = rootFor(definition);
              const environment = this.discovery.environment.peek().env;
              prepared = await prepare(environment);
              if (!current()) throw Error('Language document closed or configuration changed during installation.');
              const {NODE_OPTIONS:_node,NODE_PATH:_path,ELECTRON_RUN_AS_NODE:_electron,...env} = environment;
              launch = {executable:prepared.executable,args:prepared.args,env:{...env,...prepared.env}};
              program = prepared.executable; passedBy = prepared.instead ?? aside.get(support.server);
              break;
            }
          }
          if (!installed.length) {
            const selected = this.registry.executable(support.server, this.discovery.environment.peek().env);
            const help = /^https?:\/\//.test(languageCatalog.find(item => item.id === support.server)?.homepage ?? '');
            if (candidates.length === 1 && (!this.registry.automatic(support.server) || path.isAbsolute(selected)))
              reject(`${definition.name}: Program not found. Install it, or choose its program in Language Support.`,
                path.isAbsolute(selected) ? { kind: 'executable', path: selected, missing: true, automatic: this.registry.canDetect(support.server) && !this.registry.isCustom(support.server) } : { kind: 'no-installer', help });
            return { unavailable: 'missing' as const, issue: { kind: 'no-installer' as const, help }, server: named() };
          }
          // Several installed tools: the language's own order decides, as it does for managed ones.
          installed.sort((a, b) => this.provisioner.rank(this.registry.definition(a.support.server), a.support.languageId) - this.provisioner.rank(this.registry.definition(b.support.server), b.support.languageId));
          support = installed[0].support;
          definition = this.registry.definition(support.server); root = rootFor(definition);
          const found = installed[0].found;
          program = found?.selected?.path;
          launch = this.registry.launch(support.server, app.isPackaged, found?.environment.env, found?.selected?.path, file);
          if (found?.selected?.runtime) launch = { ...launch, executable: found.selected.runtime, args: [found.selected.path, ...launch.args] };
          break;
        } catch (error) {
          if (revision !== this.discovery.generation) continue;
          if (error instanceof AutomaticDownloadsDisabled) {
            const optional = this.registry.asksBeforeInstalling(support.server, file);
            // The person turned this language's own tool off. An extension that also lists the
            // language is not offered in its place; it runs once it is installed or selected.
            if (optional && supportedTool(support.languageId)) return { unavailable: 'missing' as const, server: named() };
            return { unavailable: 'missing' as const, message: error.message,
              issue: { kind: 'downloads-off' as const, ...(optional ? { optional: true } : {}) }, server: named() };
          }
          throw error;
        }
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
        plan = await this.contexts.resolve(root, roots.get(support.server)?.reason ?? 'Project', { ...definition, languages: this.registry.projectLanguages(definition.id, support.languageId, file) }, this.registry.options(support.server, file));
        if (!current()) throw Error('Language document closed or configuration changed while resolving its environment.');
        // Another document may have finished resolving the same context meanwhile.
        server = activeServer();
        if (!server && launch && definition.id === 'clangd') launch = this.contexts.launch(plan, launch, definition);
      }
      if (!server && launch) {
        // The tool may need a newer runtime than the project it analyzes.
        runtime = await toolRuntime(launch, undefined, this.registry.options(support.server, file).settings ?? definition.settings);
        if (!current()) throw Error('Language document closed or configuration changed while choosing a tool runtime.');
        launch = runtime.launch; java = runtime.java ?? java; server = activeServer();
      }
      if (!server && launch && isKotlinServer(definition)) {
        // The JDK the project's build files ask for (`kotlin-jdk.ts`): the import runs on it.
        kotlinJdk = await kotlinProjectJdk(root, launch.env ?? process.env, this.registry.options(support.server, file).settings ?? definition.settings);
        if (!current()) throw Error('Language document closed or configuration changed while choosing the project JDK.');
        if (kotlinJdk.env) launch = { ...launch, env: { ...launch.env, ...kotlinJdk.env } };
        server = activeServer();
      }
      if (!server && launch && !prepared) {
        // What the extensions of other tools add to a tool they did not set up (`tool-contributions.ts`).
        additions = await this.contributionsFor(definition, root, launch.env ?? this.discovery.environment.peek().env);
        if (!current()) throw Error('Language document closed or configuration changed while asking what other tools add.');
        server = activeServer();
      }
      if (!server && launch && toolFamily(definition) === 'intelephense') {
        // `intelephense.maxMemory`, as the extension passes it to the runtime.
        const memory = intelephenseNodeArguments(this.registry.options(support.server, file).settings ?? definition.settings);
        if (memory.length) launch = { ...launch, args: [...memory, ...launch.args] };
      }
    } finally { if (pending.get(document.id) === opening) pending.delete(document.id); }
    const configuration = configurations.get(support.server)!;
    const owned = owner;
    if (!server) {
      if (!launch) throw Error('Language session closed during discovery.');
      const fingerprint = createHash('sha256').update(JSON.stringify([configuration, launch, this.registry.options(support.server, file), ...(additions?.length ? [additions] : [])])).digest('hex').slice(0, 24);
      const key = `${support.server}:${root}:${fingerprint}`;
      if (!plan) throw Error('No analysis launch plan.');
      const preparedProfile = prepared ? {...plan.profile,configuration:mergeLanguageSettings(prepared.settings,plan.profile.configuration),
        initializationOptions:mergeLanguageSettings(prepared.initializationOptions,plan.profile.initializationOptions)} : plan.profile;
      // jdt.ls learns the JDKs of this computer before it imports the project, as the VS Code Java
      // extension tells it: in the initialization options and again with the settings. The list
      // starts from the runtimes the person wrote in either place.
      const written = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const runtimeSettings = java ? javaSettings(java, mergeLanguageSettings(written(preparedProfile.initializationOptions?.settings), preparedProfile.configuration)) : {};
      const javaProfile = java ? { ...preparedProfile, configuration: mergeLanguageSettings(preparedProfile.configuration, runtimeSettings),
        initializationOptions: mergeLanguageSettings(preparedProfile.initializationOptions, { settings: runtimeSettings }) } : preparedProfile;
      // tsserver loads the Svelte plugin when the person turned it on for the Svelte tool. It is
      // looked for in the project, then where the Svelte tool was installed.
      const svelteTool = isTypeScriptServer(definition) ? this.registry.definitions().find(isSvelteServer) : undefined;
      // tsserver may download type packages where Setdown may download tools for this project,
      // unless the person wrote the option themselves.
      const ownOptions = this.registry.options(support.server, file).initializationOptions ?? definition.initializationOptions;
      const scriptProfile = isTypeScriptServer(definition) ? { ...javaProfile, initializationOptions: typescriptOptions(javaProfile.configuration, javaProfile.initializationOptions,
        { svelte: svelteTool && (this.registry.options(svelteTool.id, file).settings ?? svelteTool.settings), places: [root, path.join(app.getPath('userData'), 'language-packages', 'extensions', 'work', 'svelte')],
          downloads: ownOptions?.disableAutomaticTypingAcquisition === undefined ? this.registry.automaticInstall(support.server, file) : undefined }) } : javaProfile;
      // What other tools' extensions add lies under what the person and the tool's own extension wrote.
      const joinedProfile = withContributions(scriptProfile, additions ?? []);
      const addedSettings = contributed(additions ?? []).settings;
      // JetBrains' Kotlin server is told the JDK, the build tool and the projects when it starts,
      // as its VS Code extension tells it. The Zed extension that starts it here sends nothing.
      const kotlin = isKotlinServer(definition) ? kotlinInitializationOptions(joinedProfile.configuration, [pathToFileURL(root).href]) : undefined;
      const kotlinAdded = kotlinJdk.defaultSdk ? { defaultSdk: kotlinJdk.defaultSdk } : {};
      const kotlinProfile = kotlin ? { ...joinedProfile, initializationOptions: mergeLanguageSettings({ ...kotlinAdded, ...kotlin.options }, joinedProfile.initializationOptions) } : joinedProfile;
      // What the tool's own extension listens to and answers beyond the protocol.
      // The JSON server knows the schemas VS Code has built in for a file name (`json-builtin-schemas.ts`).
      const toolProfile = isJsonServer(definition) ? { ...kotlinProfile, configuration: withBuiltinJsonSchemas(kotlinProfile.configuration) } : kotlinProfile;
      const once = this.startOnce.get(`${support.server}:${root}`); this.startOnce.delete(`${support.server}:${root}`);
      const factories: Partial<Record<string, ToolRulesFactory>> = { kotlin: kotlinRules,
        ...(java ? { jdtls: javaRules(java.installed) } : {}),
        // The licence key is one of the person's own initialization options; what it adds is that the index is made anew when asked.
        intelephense: intelephenseRules({ clearCache: once?.clearCache === true }) };
      const profile = withRules(toolProfile, toolRules(definition, { name: definition.name, root, settings: toolProfile.configuration }, factories));
      const tool = definition;
      const recoveryKey = `${state.webContentsId}:${support.server}:${root}`;
      const pinned = prepared ? undefined : this.registry.options(support.server).executable;
      const repair = this.registry.canDetect(support.server) && !this.registry.isCustom(support.server);
      const runtimeFound = runtime?.found ?? java?.found;
      const located = program;
      // Pyright is told of a cancelled request through a file, as its own extension tells it:
      // it reads no message while it analyses (`python-cancellation.ts`). The same argument
      // starts its background thread, so it is given only to a server that can run one (`pyright-thread.ts`).
      const thread = toolFamily(definition) === 'pyright' ? await pyrightThread(launch) : undefined;
      const cancellation = thread ? pythonCancellation(temporaryFolderOf(launch.env ?? process.env)) : undefined;
      const started = thread && cancellation?.args.length ? { ...launch, args: [...thread.nodeArguments, ...launch.args, ...cancellation.args], cancellation: cancellation.strategy, dispose: cancellation.dispose } : launch;
      server = new ServerSession(started, root, params => {
        for (const binding of owned.documents.values()) {
          // Versionless push diagnostics are best-effort observations, never used as edit versions.
          if (binding.server === server && binding.uri === params.uri && (params.version === undefined || params.version === binding.version))
            this.emit(owned, { type: 'diagnostics', server: this.sessions.get(binding.server)?.id, id: binding.id, generation: binding.generation, version: binding.version, unversioned: params.version === undefined, diagnostics: params.diagnostics });
        }
      }, message => {
        const info = server && this.sessions.get(server);
        if (!info || !server) return;
        const ended = server;
        info.state = 'failed'; info.message = message;
        // The process can still be writing its reason; classify once it has finished.
        info.settling = (async () => {
          const facts = await ended.failureFacts?.();
          if (this.sessions.get(ended) !== info) return;
          const found = facts ? sessionIssue({ ...facts, pinned, runtimeFound }) : { kind: 'crashed' as const };
          const issue = info.issue = found.kind === 'executable' ? { ...found, automatic: repair }
            : found.kind === 'no-installer' ? { ...found, help: /^https?:\/\//.test(languageCatalog.find(item => item.id === tool.id)?.homepage ?? '') } : found;
          // A program that is not a language tool or is not on this computer, or a missing runtime, ends the same way every time.
          const repeats = issue.kind === 'executable' || issue.kind === 'runtime' || issue.kind === 'no-installer' || issue.kind === 'outdated';
          // The program was found on this computer and Setdown can prepare the tool itself: the
          // program is set aside and the tool starts again from Setdown's own copy
          // (`program-health.ts`). A build that says it has expired stays aside across restarts
          // of the app; a program that is no language tool, only for this run.
          if ((issue.kind === 'outdated' || issue.kind === 'executable') && located && await this.setAside(tool, located, issue, file)) {
            if (this.sessions.get(ended) !== info || this.owners.get(state.webContentsId) !== owned) return;
            this.supervisor.reset(recoveryKey);
            void this.reconnect(owned, ended).catch(error => console.warn('Language recovery failed', error));
            return;
          }
          const recovering = repeats ? undefined : this.supervisor.schedule(recoveryKey, () => {
            if (this.sessions.has(ended) && this.owners.get(state.webContentsId) === owned)
              void this.reconnect(owned, ended).catch(error => console.warn('Language recovery failed', error));
          });
          // A program of this computer that did not start, or stopped, three times in a row:
          // Setdown's own copy is tried before the person is asked to do anything. For this run
          // only: what failed may mend itself (a project being built, a full disk).
          if (!recovering && !repeats && (issue.kind === 'startup' || issue.kind === 'crashed') && located && await this.setAside(tool, located, issue, file)) {
            if (this.sessions.get(ended) !== info || this.owners.get(state.webContentsId) !== owned) return;
            this.supervisor.reset(recoveryKey);
            void this.reconnect(owned, ended).catch(error => console.warn('Language recovery failed', error));
            return;
          }
          info.message = `${message}\n${recovering ? `Reconnecting (${recovering.attempt}/3)…` : repeats ? 'It will not start until its setup changes.' : 'Automatic recovery paused after repeated failures. Restart this service to try again.'}`;
          this.emit(owned, { type: 'status', state: 'failed', message: info.message, issue, recovery: { retrying: !!recovering, attempt: recovering?.attempt },
            documents: [...owned.documents.values()].filter(binding => binding.server === ended).map(({ id, generation }) => ({ id, generation })) });
        })();
      }, profile, {
        filesChanged: paths => {
          // The project's own inputs, and the files a tool reads once when it starts.
          if (!server || !this.sessions.has(server) || !(plan?.inputs.some(input => paths.includes(input)) || paths.some(changed => restartsTool(tool, changed)))) return;
          this.contexts.invalidate(root);
          void this.reconnect(owned, server);
        },
        configuration: scopeUri => {
          let resource = file;
          try { if (scopeUri?.startsWith('file:')) resource = fileURLToPath(scopeUri); } catch { /* Invalid scopes use the session document. */ }
          const settings = this.registry.options(definition.id, isInside(root, canonicalPath(resource)) ? resource : file).settings ?? definition.settings;
          const merged = joinSettings(addedSettings, mergeLanguageSettings(prepared?.settings,plan!.configuration(settings),runtimeSettings));
          // gopls asks for its section and replaces each option it is sent, so the answer is the whole set (`go-gopls-rules.ts`).
          return isJsonServer(tool) ? withBuiltinJsonSchemas(merged) : isGopls(tool) ? { ...merged, gopls: goplsOwnOptions(merged) } : merged;
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
        act: action => this.toolAction(owned, server!, action),
        peer: (family, method, params) => this.askPeer(owned, server!, family, method, params),
        schemaContent: address => this.schemas.content(address, schemaDownloadSettings(withBuiltinJsonSchemas(this.registry.options(tool.id, file).settings ?? tool.settings))),
      });
      for (const evidence of plan.context.evidence) server.context?.set(evidence.split(': ')[0], evidence.split(': ').slice(1).join(': '));
      const runtimeNote = runtime?.note ?? java?.note;
      if (runtimeNote) server.context?.set('Tool runtime', runtimeNote);
      if (kotlin?.problems.length) server.context?.set('Settings not sent', kotlin.problems.join('; '));
      if (kotlinJdk.note) server.context?.set('Project JDK', kotlinJdk.note);
      const added = describeContributions(additions ?? []);
      if (added) server.context?.set('Added by other tools', added);
      this.items.set(server, new ServerItems());
      this.sessions.set(server, { plan, recoveryKey, id: support.server, root, resource: file, rootReason: roots.get(support.server)?.reason, configuration: JSON.stringify(this.registry.options(support.server, file)), state: 'starting', ...(kotlin ? { kotlinAdded } : {}),
        ...(additions ? { contributed: JSON.stringify(additions) } : {}) });
      // Said in the panel beside the project and its root: a program of this computer was passed by, and why.
      if (passedBy) { server.context?.set('Program', `${launch.executable} (Setdown's own copy)`); server.context?.set('Not used', setAsideNote(definition.name, passedBy.program, passedBy.detail)); }
      owner.servers.set(key, server); created = true;
      server.watch(root);
      const instance = server, watchedInputs = plan.inputs;
      const onInput = (current: import('node:fs').Stats, previous: import('node:fs').Stats) => { if ((current.mtimeMs !== previous.mtimeMs || current.size !== previous.size || current.ino !== previous.ino) && this.sessions.has(instance)) { this.contexts.invalidate(root); void this.reconnect(owned, instance); } };
      for (const input of watchedInputs) watchFile(input, { persistent: false, interval: 1500 }, onInput);
      this.sessions.get(server)!.unwatch = () => { for (const input of watchedInputs) unwatchFile(input, onInput); };
    }
    if ([...owner.documents.values()].some(other => other.id !== document.id && other.uri === uri && other.server === server))
      throw new Error('This provider already owns the document.');
    // A companion is told the language by the name the plugin that made it one uses.
    const wireLanguage = this.registry.companionLanguage(support.server, support.languageId, file)
      ?? this.packageCatalog.binding(support.server)?.languageIds?.[support.languageId] ?? prepared?.languageId ?? protocolLanguageId(support.languageId);
    const binding = { languageId: wireLanguage, id: document.id, generation: document.generation, uri, version: document.version, server, capabilities: {} as ServerCapabilities };
    owner.documents.set(document.id, binding);
    this.emit(owner, { type: 'status', state: 'starting', server: { id: support.server, name: definition.name }, documents: [{ id: binding.id, generation: binding.generation }] });
    await server.ready.catch(async error => { const info = this.sessions.get(server); await info?.settling; throw Error(info?.message ?? String(error)); });
    const capabilities = server.capabilities.forDocument(uri, wireLanguage);
    if (this.owners.get(state.webContentsId) !== owner || owner.documents.get(document.id) !== binding)
      throw new Error('Language document closed during initialization.');
    binding.capabilities = capabilities;
    const info = this.sessions.get(server);
    if (info) {
      info.state = 'ready';
      info.features = featureNames(capabilities);
    }
    if (textSynchronization(capabilities).openClose) await server.notify('textDocument/didOpen', { textDocument: { uri: binding.uri, languageId: wireLanguage,
      version: document.version, text: document.text } });
    this.emit(owner, { type: 'status', state: 'ready', documents: [{ id: binding.id, generation: binding.generation }] });
    // A tool that was just set up may have brought a plugin for another tool, and a tool that was
    // just started may answer for more languages than its own.
    if (created) void this.refreshContributions(root).catch(error => console.warn('Could not ask what language tools add to each other', error));
    const autoInsert = autoInsertion(definition, this.registry.options(support.server, file).settings ?? definition.settings);
    // Which schemas the JSON server checks this file against, as its extension shows them.
    const schemas = isJsonServer(definition) ? await server.request(jsonLanguageStatus, binding.uri, undefined, 3000).then(schemaLines, () => []) : [];
    const family = toolFamily(definition);
    return { ...(autoInsert ? { autoInsert } : {}), ...(isClangd(definition) ? { companion: true } : {}), ...(family ? { tool: family } : {}),
      messages: server.messages, analysis: this.observation(server), name: definition.name, uri: binding.uri, capabilities, server: support.server, context: [`Project: ${root}`, `Root: ${roots.get(support.server)?.reason ?? 'server session'}`, ...schemas, ...[...server.context ?? []].map(([key, value]) => `${key}: ${value}`)] };
  }
  /** The names a Zed extension may know a tool by. */
  private zedNames(definition: LanguageServerDefinition): string[] {
    return [...new Set([definition.id, definition.provenance?.profile, definition.launch.kind === 'native' ? definition.launch.command : undefined,
      this.packageCatalog.binding(definition.id)?.server].filter((name): name is string => !!name))];
  }
  /** What the extensions of other tools add to a tool Setdown starts itself, for one project. */
  private async contributionsFor(definition: LanguageServerDefinition, root: string, env: NodeJS.ProcessEnv): Promise<Contribution[]> {
    if (!this.provisioner.contributions) return [];
    const names = this.zedNames(definition);
    const found = await this.provisioner.contributions(names, root, env).catch(error => { console.warn(`Could not ask what other tools add to ${definition.name}`, error); return {} as Record<string, Contribution[]>; });
    return names.flatMap(name => found[name] ?? []);
  }
  /** The languages of Setdown that a tool's plugin means by a name. The plugin uses the name the
   * tool is told: Zed's name in small letters where the tool has none of its own (`vue.js`), else
   * the protocol's (`vue`). The same files can be known under another id in another catalog
   * (`vue` and `vue-js` are both `.vue`), so every id those files are opened under counts. */
  private languagesNamed(name: string): string[] {
    const lower = name.toLowerCase();
    const wired = new Set(this.packageCatalog.bindings.flatMap(binding => [
      ...Object.entries(binding.languages).filter(([, zed]) => zed.toLowerCase() === lower).map(([id]) => id),
      ...Object.entries(binding.languageIds ?? {}).filter(([, wire]) => wire === name).map(([id]) => id)]));
    const known = [...this.packageCatalog.languages, ...languageDefinitions].filter(language => wired.has(language.id) || wired.has(language.sourceId)
      || [language.id, language.sourceId, language.zedName, language.label].some(value => value?.toLowerCase() === lower));
    const ids = new Set([...wired, ...known.flatMap(language => [language.id, language.sourceId])]);
    const extensions = new Set(known.flatMap(language => language.extensions.map(extension => extension.toLowerCase())));
    return [...new Set(this.registry.definitions().flatMap(definition => definition.languages)
      .filter(language => ids.has(language.languageId) || language.extensions.some(extension => extensions.has(extension.toLowerCase()))).map(language => language.languageId))];
  }
  private contributing: Promise<void> = Promise.resolve();
  private guestLanguages(definition: LanguageServerDefinition) { return this.packageCatalog.guestLanguages(definition); }
  private mainFor(definition: LanguageServerDefinition, language: string) { return this.packageCatalog.mainFor(definition, language); }
  private companionProjectsFile() { return path.join(app.getPath('userData'), 'language-packages', 'companion-projects.json'); }
  private companionProjectsValue?: Promise<Map<string, Set<string>>>;
  /** The projects each such tool has run in, so that it joins the project's other files from the first one opened. */
  private companionProjects(): Promise<Map<string, Set<string>>> {
    return this.companionProjectsValue ??= (async () => {
      try {
        const saved = JSON.parse(await readFile(this.companionProjectsFile(), 'utf8'));
        if (saved?.version !== 1 || !saved.tools || typeof saved.tools !== 'object') return new Map();
        return new Map(Object.entries(saved.tools as Record<string, unknown>).filter((entry): entry is [string, string[]] =>
          Array.isArray(entry[1]) && entry[1].length <= 256 && entry[1].every(root => typeof root === 'string' && path.isAbsolute(root))).map(([id, roots]) => [id, new Set(roots)]));
      } catch { return new Map(); }
    })();
  }
  /** Works out again which tools answer for languages beside the language's own tool
   * (`Companion` in `server-registry.ts`), after a tool was started.
   *  - The extensions are asked what they add to the tools Setdown starts itself
   *    (`tool-contributions.ts`). A tool whose plugins name other languages becomes their
   *    companion, and a running tool that would now get other additions is started again.
   *  - A tool that runs in a project joins the other languages its extension attaches it to. */
  private refreshContributions(root: string): Promise<void> {
    const next = this.contributing.catch(() => {}).then(async () => {
      const env = this.discovery.environment.peek().env;
      const running = [...this.sessions].filter(([, info]) => info.contributed !== undefined);
      // The tools Setdown brings itself can become companions before they run; the others are asked about once they run.
      const tools = new Map(this.registry.definitions().filter(definition => definition.launch.kind === 'bundledNode').map(definition => [definition.id, definition]));
      for (const [, info] of running) tools.set(info.id, this.registry.definition(info.id));
      const roots = new Set([root, ...running.map(([, info]) => info.root)]);
      const answers = new Map<string, Contribution[]>();
      if (this.provisioner.contributions) for (const place of roots) {
        const names = [...new Set([...tools.values()].flatMap(definition => this.zedNames(definition)))];
        const found = await this.provisioner.contributions(names, place, env);
        for (const definition of tools.values()) answers.set(`${definition.id}\n${place}`, this.zedNames(definition).flatMap(name => found[name] ?? []));
      }
      const companions: Companion[] = [];
      for (const definition of tools.values()) {
        const languages = new Map<string, string>();
        for (const place of roots) {
          const options = withContributions({ initializationOptions: {}, configuration: {} }, answers.get(`${definition.id}\n${place}`) ?? []).initializationOptions;
          for (const name of companionLanguages(definition, options)) for (const language of this.languagesNamed(name))
            if (!definition.languages.some(own => own.languageId === language)) languages.set(language, name);
        }
        for (const [language, wire] of languages) companions.push({ tool: definition.id, language, wire });
      }
      const projects = await this.companionProjects();
      let learned = false;
      for (const [, info] of this.sessions) {
        if (info.state === 'failed' || !this.guestLanguages(this.registry.definition(info.id)).size) continue;
        const known = projects.get(info.id) ?? new Set<string>();
        if (!known.has(info.root)) { known.add(info.root); projects.set(info.id, known); learned = true; }
      }
      if (learned) await writeFile(this.companionProjectsFile(), JSON.stringify({ version: 1, tools: Object.fromEntries([...projects].map(([id, places]) => [id, [...places].slice(-256)])) }), { mode: 0o600 }).catch(() => {});
      for (const [id, places] of projects) {
        const definition = this.registry.definitions().find(candidate => candidate.id === id);
        if (!definition || !places.size) continue;
        for (const [language, wire] of this.guestLanguages(definition)) companions.push({ tool: id, language, ...(wire ? { wire } : {}), roots: [...places] });
      }
      const update = this.updating.then(() => {
        const before = JSON.stringify(this.registry.associations());
        if (!this.registry.setCompanions(companions)) return;
        if (JSON.stringify(this.registry.associations()) === before) return;
        // Routes were added or taken away; no running tool is touched. Every open document keeps its tools and asks for the new ones.
        const retainedDocuments = [...this.owners.values()].flatMap(owner => [...owner.documents.values()].map(({ id, generation }) => ({ id, generation })));
        this.broadcast({ type: 'configuration', servers: [...new Set(companions.map(item => item.tool))], retainedDocuments });
      });
      this.updating = update.catch(() => {});
      await update;
      for (const [server, info] of running) {
        if (this.sessions.get(server) !== info || info.contributed === JSON.stringify(answers.get(`${info.id}\n${info.root}`) ?? [])) continue;
        const owner = [...this.owners.values()].find(owner => [...owner.servers.values()].includes(server));
        if (owner) await this.reconnect(owner, server);
      }
    });
    this.contributing = next.catch(() => {});
    return next;
  }
  /** A question one tool has for another tool of the same project (`relays` in `tool-signals.ts`):
   * Vue's tool asks TypeScript's server about types. The other tool is started for the same file a
   * moment after the first, so it is waited for while it is on its way: while the companions are
   * being worked out, and then while the file has a route to such a tool. */
  private async askPeer(owner: Owner, from: ServerSession, family: string, method: string, params: unknown): Promise<unknown> {
    const origin = this.sessions.get(from);
    if (!origin) throw Error('The asking tool has stopped.');
    const related = (root: string) => root === origin.root || isInside(root, origin.root) || isInside(origin.root, root);
    const find = () => [...owner.servers.values()].find(server => {
      const info = this.sessions.get(server);
      return !!info && server !== from && info.state !== 'failed' && toolFamily(this.registry.definition(info.id)) === family && related(info.root);
    });
    const coming = () => !!origin.resource && this.registry.routes(origin.resource).some(route => route.server !== origin.id
      && toolFamily(this.registry.definition(route.server)) === family && !!languageSupport(origin.resource!, [route]));
    let peer = find();
    if (!peer) await this.contributing;
    for (const until = Date.now() + 30_000; !(peer ??= find()) && coming() && Date.now() < until && this.sessions.get(from) === origin;)
      await new Promise(resolve => setTimeout(resolve, 150));
    if (!peer) throw Error(`No ${family} tool is running for this project.`);
    await peer.ready;
    return peer.request(method, params, undefined, 20_000);
  }
  /** What a button of a tool's own notice does (`tool-signals.ts`). */
  private async toolAction(owner: Owner, server: ServerSession, action: ToolAction): Promise<void> {
    const info = this.sessions.get(server);
    if (!info || this.owners.get(owner.state.webContentsId) !== owner) return;
    // Whether what follows the effect is still to be done (`ToolAction.next`).
    let follows = true;
    if ('link' in action) {
      if (!/^https:\/\//.test(action.link)) throw Error('Only https pages are opened.');
      await shell.openExternal(action.link);
    } else if ('restart' in action) {
      if (info.recoveryKey) this.supervisor.reset(info.recoveryKey);
      await this.reconnect(owner, server); follows = false;
    } else if ('notify' in action) await server.notify(action.notify.method, action.notify.params);
    else if ('request' in action) {
      if (isKotlinReload(action)) await this.kotlinReload(server);
      else await server.request(action.request.method, action.request.params, undefined, 60_000);
    } else if ('command' in action) {
      // The tool may change files while its command runs, as for a command the editor starts.
      // An extension's command of this kind may run a build tool, which takes minutes.
      const binding = [...owner.documents.values()].find(document => document.server === server);
      if (this.commands.has(server)) throw Error('A language command is already running.');
      if (binding) this.commands.set(server, binding);
      try {
        const answer = await server.request<unknown>('workspace/executeCommand', action.command, undefined, 10 * 60_000);
        follows = answer !== null && answer !== undefined && answer !== '';
      } finally { if (binding && this.commands.get(server) === binding) this.commands.delete(server); }
    } else if ('setting' in action) {
      // Written for this project, over what the person chose themselves. The changed settings
      // start the tool again, as any change of them does, so nothing is left to follow.
      await this.writeSettings(info.id, info.resource, info.root, [[action.setting.name, action.setting.value]]);
      follows = this.sessions.has(server);
    }
    if (follows && action.next && this.sessions.has(server)) await this.toolAction(owner, server, action.next);
  }
  /** Writes settings of a tool by their VS Code names, over what the person chose themselves:
   * for the project in `root`, or without one for every project. Running tools then get them
   * as after any change of the settings. */
  private async writeSettings(id: string, resource: string | undefined, root: string | undefined, entries: [string, unknown][]): Promise<void> {
    const options = root ? this.registry.chosenFor(id, resource) : this.registry.chosen(id), definition = this.registry.definition(id);
    const settings = entries.reduce((written, [name, value]) => withSetting(written, name, value), options.settings ?? definition.settings);
    await this.changed(() => this.registry.configure(id, { args: options.args, settings, initializationOptions: options.initializationOptions,
      root: options.root, role: options.role, formatting: options.formatting, automaticInstall: options.automaticInstall }, root));
  }
  /** `intellij/reloadWorkspace`: kotlin-lsp imports the project again with the initialization
   * options of this moment, as its extension's "Reload workspace" sends them (`kotlin-signals.ts`). */
  private async kotlinReload(server: ServerSession): Promise<void> {
    const info = this.sessions.get(server); if (!info) return;
    const definition = this.registry.definition(info.id), options = this.registry.options(info.id, info.resource);
    const { params } = kotlinReloadParams(options.settings ?? definition.settings, [pathToFileURL(info.root).href], info.kotlinAdded);
    const sent = { initializationOptions: mergeLanguageSettings(params.initializationOptions, options.initializationOptions ?? definition.initializationOptions) };
    try { await server.request('intellij/reloadWorkspace', sent, undefined, 10 * 60_000); server.signal({ log: ['Workspace reloaded'] }); }
    catch (error) { const message = kotlinReloadFailure(error); if (message) throw Error(message); }
  }
  /** A command of a tool's extension that takes more than one message to the tool
   * (`protocol/language-tools.ts`, the rows marked `own`). */
  private async ownAction(owner: Owner, binding: Binding, method: string, params: Record<string, unknown>): Promise<unknown> {
    const server = binding.server, info = this.sessions.get(server);
    if (!info) throw Error('The tool is not running.');
    const definition = this.registry.definition(info.id);
    if (method === 'setdown/kotlin.reloadWorkspace') { await this.kotlinReload(server); return true; }
    if (method === 'setdown/go.testCommand') {
      // The `go test` of a "run test" lens, as on the project engine's path (`project-languages.ts` `goAction`).
      const settings = this.registry.options(info.id, info.resource).settings ?? definition.settings;
      return goTestProgram(params.arguments, settings, info.root, this.discovery.environment.peek().env) ?? null;
    }
    // "Go: Choose Go Environment" changes the Go of the project engine, which runs gopls for
    // every project that has no settings of its own.
    if (method === 'setdown/go.versions' || method === 'setdown/go.chooseVersion') throw Error('This project has its own language settings, so its Go is the one of its environment.');
    if (method === 'setdown/intelephense.indexWorkspace') {
      // extension.ts `indexWorkspace`: the tool is stopped and started again with `clearCache: true`.
      this.startOnce.set(`${info.id}:${info.root}`, { clearCache: true });
      if (info.recoveryKey) this.supervisor.reset(info.recoveryKey);
      await this.reconnect(owner, server); return true;
    }
    if (method === 'setdown/intelephense.licenceKey') {
      // extension.ts `enterLicenceKey`: the key is kept, an empty one removes it, and the tool
      // starts again with a fresh index. It is the person's, not the project's, so it is kept
      // with what they chose for the tool everywhere. The tool activates the key itself.
      const key = typeof params.key === 'string' ? params.key.trim() : '';
      const problem = licenceKeyProblem(key); if (problem) throw Error(problem);
      const chosen = this.registry.chosen(info.id);
      const { licenceKey: _removed, ...initializationOptions } = { ...(chosen.initializationOptions ?? {}) } as Record<string, unknown>;
      this.startOnce.set(`${info.id}:${info.root}`, { clearCache: true });
      await this.changed(() => this.registry.configure(info.id, { args: chosen.args, settings: chosen.settings,
        initializationOptions: key ? { ...initializationOptions, licenceKey: key } : Object.keys(initializationOptions).length ? initializationOptions : undefined,
        root: chosen.root, role: chosen.role, formatting: chosen.formatting, automaticInstall: chosen.automaticInstall }));
      // An unchanged key changes no setting, and the index is still to be made anew.
      if (this.sessions.has(server)) await this.reconnect(owner, server);
      return true;
    }
    if (method === 'setdown/yaml.selectSchemas') {
      // vscode-yaml `showSchemaSelection`, as on the project engine's path (`project-languages.ts` `selectSchemas`).
      const selected = Array.isArray(params.selected) ? params.selected.filter((uri): uri is string => typeof uri === 'string' && uri.length <= 2048).slice(0, 32) : [];
      const inUse = await server.request<unknown>(yamlFileSchemasMethod, binding.uri, undefined, 10_000).catch(() => []);
      const used = (Array.isArray(inUse) ? inUse : []).flatMap(entry => typeof (entry as { uri?: unknown } | null)?.uri === 'string' ? [(entry as { uri: string }).uri] : []);
      const settings = this.registry.chosen(info.id).settings ?? definition.settings, place = { uri: binding.uri, folder: info.root };
      const detection = yamlDetectionAfterPick(setting(settings, yamlDetectionSetting), place, selected);
      await this.writeSettings(info.id, info.resource, undefined, [[yamlSchemasSetting, yamlSchemasAfterPick(setting(settings, yamlSchemasSetting), place, selected, used)],
        ...(detection === undefined ? [] : [[yamlDetectionSetting, detection] as [string, unknown]])]);
      return true;
    }
    throw Error(`${definition.name} has no such command.`);
  }
  /** After a rename the Svelte tool says which imports now point at the wrong place, and its
   * extension applies them (`extension-rules.ts` `svelteRenameChanges`). */
  private async svelteRenamed(owner: Owner, server: ServerSession, operation: LanguageFileOperation): Promise<void> {
    const info = this.sessions.get(server), file = operation.files[0];
    const tool = info && this.registry.definitions().find(definition => definition.id === info.id);
    if (!info || !tool || !isSvelteServer(tool) || operation.kind !== 'rename' || !file?.to) return;
    const oldUri = pathToFileURL(file.path).href, newUri = pathToFileURL(file.to).href;
    if (!svelteAsksAboutRename(oldUri)) return;
    const binding = [...owner.documents.values()].find(document => document.server === server);
    if (!binding) return;
    const settings = this.registry.options(tool.id, info.resource).settings ?? tool.settings;
    const answer = await server.request<unknown>(svelteRenameEdits, { oldUri, newUri }, undefined, 10_000).catch(() => null);
    const changes = svelteRenameChanges(answer, setting(settings, 'svelte.enable-ts-plugin') === true);
    if (!changes.length || owner.documents.get(binding.id) !== binding) return;
    const versions = [...owner.documents.values()].filter(document => document.server === server).map(({ id, generation, version }) => ({ id, generation, version }));
    const result = await this.applyEdit(owner, server, { documentChanges: changes.map(change => ({ textDocument: { uri: change.uri, version: null }, edits: change.edits })) }, { binding, versions });
    if (!result.applied) console.warn('Svelte import updates were not applied:', result.failureReason);
  }
  /** The Svelte tool reads TypeScript and JavaScript files from disk. Its extension tells it
   * each unsaved change of one, so a component is checked against the text in the editor. */
  private scriptChanged(windowId: number, binding: Binding, changes: TextDocumentContentChangeEvent[]): void {
    if (!svelteScriptLanguages.includes(binding.languageId)) return;
    const owner = this.owners.get(windowId); if (!owner) return;
    let file: string; try { file = canonicalPath(fileURLToPath(binding.uri)); } catch { return; }
    for (const server of new Set(owner.servers.values())) {
      const info = this.sessions.get(server);
      const tool = info && this.registry.definitions().find(definition => definition.id === info.id);
      if (!info || !tool || info.state !== 'ready' || server === binding.server || !isInside(info.root, file) || !isSvelteServer(tool)) continue;
      void server.notify(svelteScriptChanged, { uri: binding.uri, changes }).catch(() => {});
    }
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
    const running = [...this.owners.get(state.webContentsId)?.documents.values() ?? []].find(b => b.uri === pathToFileURL(resource).href && this.registry.role(this.sessions.get(b.server)?.id ?? '', resource) === 'primary');
    const primaryCandidates = candidates.filter(candidate => this.registry.role(candidate.server, resource) === 'primary');
    const selected = running ? this.sessions.get(running.server)?.id : primaryCandidates.length === 1 ? primaryCandidates[0].server : undefined;
    const analysisSelection = this.registry.analysisSelection(language, resource);
    const definition = definitions.find(d => d.id === selected);
    const rootDefinition = definition ?? definitions.find(d => this.registry.role(d.id, resource) === 'primary');
    const options = rootDefinition ? this.registry.options(rootDefinition.id, resource) : {};
    const root = rootDefinition ? languageRoot(resource, { ...rootDefinition, languages: rootDefinition.languages.filter(l => (l.monacoId ?? l.languageId) === language || l.languageId === language) }, state.projectRoot ?? undefined, options.root)
      : languageRoot(resource, { languages: [], rootMarkers: [] }, state.projectRoot ?? undefined);
    // A guest of this language is listed as an additional tool: it is not offered as the main one.
    const servers = definitions.map(d => ({ id: d.id, name: d.name, selected: d.id === selected, enabled: this.registry.enabledFor(d.id, language, resource),
      role: this.mainFor(d, language) ? this.registry.role(d.id, resource) : 'supplementary' as const }));
    if (!definition) return { id: language, root: root.path, rootReason: root.reason, environment: 'usable', choices: [], issues: [], evidence: [], servers, analysisSelection };
    const plan = await this.contexts.resolve(root.path, root.reason, { ...definition, languages: definition.languages.filter(l => (l.monacoId ?? l.languageId) === language || l.languageId === language) }, options, refresh);
    this.ownedFile(state, resource);
    return { ...plan.context, servers, analysisSelection };
  }
  private async selectEnvironment(state: WindowState, file: string, language: string, selection: AnalysisSelection): Promise<DocumentAnalysis> {
    if (!selection || !['python', 'typescript', 'compilation', 'server', 'python-checking'].includes(selection.kind) || typeof selection.value !== 'string' || selection.value.length > 128) throw Error('Invalid environment selection.');
    this.subscribe(state);
    const context = await this.documentEnvironment(state, file, language, true);
    if (selection.root !== undefined && selection.root !== context.root) throw Error('The analysis project changed. Refresh the environment before applying this choice.');
    if (selection.kind === 'python-checking') {
      if (language !== 'python' || !['automatic', 'off', 'basic', 'standard', 'strict'].includes(selection.value)) throw Error('Invalid Python checking level.');
      await this.updateEnvironment(context.root, language, () => analysisPreferences.set(context.root, 'python-checking', selection.value === 'automatic' ? undefined : selection.value));
    } else if (selection.kind === 'server') {
      if (!['off', 'automatic'].includes(selection.value) && !context.servers.some(s => s.id === selection.value && s.role === 'primary')) throw Error('Unknown analysis provider.');
      await this.updateEnvironment(context.root, language, () => this.registry.selectAnalysis(language, selection.value, context.root));
    } else {
      if (selection.kind !== context.kind) throw Error('This environment does not apply to the document.');
      let selected: string | undefined;
      if (selection.value === 'browse') {
        const result = await pathDialog.showOpenDialog(state.window, { title: context.label, properties: [selection.kind === 'compilation' ? 'openDirectory' : 'openFile'] });
        if (result.canceled || !result.filePaths[0]) return context;
        selected = selection.kind === 'compilation' ? path.join(result.filePaths[0], 'compile_commands.json') : result.filePaths[0];
        if (selection.kind === 'python' ? !await findExecutable(selected) : !(await stat(selected)).isFile()) throw Error('Choose an existing analysis environment.');
        if ((await this.documentEnvironment(state, file, language, true)).root !== context.root) throw Error('The analysis project changed while choosing an environment.');
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
      this.broadcast({ type: 'configuration', servers: language === 'python' ? [...ids, 'notebook-python'] : ids, roots: [root] });
    });
    this.updating = update.catch(() => {}); return update;
  }
  private observation(server: ServerSession): AnalysisObservation | undefined {
    const plan = this.sessions.get(server)?.plan;
    return plan && { context: plan.context, analysis: server.progress?.size ? 'working' : 'waiting', scope: 'open-files', freshness: 'none', progress: [...server.progress?.values() ?? []] };
  }
  /** Sets aside the program of this computer a tool failed in, where Setdown can start the tool
   * from a copy of its own. False when nothing would change: the person named the program, the
   * program is Setdown's, Setdown has no way to prepare the tool or may not download it, or it
   * was set aside before. */
  private async setAside(tool: LanguageServerDefinition, program: string, issue: LanguageIssue, resource: string): Promise<boolean> {
    if (!this.provisioner.setAside || this.registry.isCustom(tool.id) || path.isAbsolute(this.registry.executable(tool.id, this.discovery.environment.peek().env))
      || !this.provisioner.canPrepare(tool) || !this.registry.automaticInstall(tool.id, resource)) return false;
    const detail = issue.kind === 'outdated' || issue.kind === 'startup' ? issue.detail : issue.kind === 'executable' ? 'It is not a language tool that answers.'
      : issue.kind === 'crashed' ? 'It stopped while working, three times in a row.' : undefined;
    const done = await this.provisioner.setAside(program, { ...(detail ? { detail } : {}), lasting: issue.kind === 'outdated' });
    if (done) console.info(`${tool.name}: ${program} does not run${detail ? ` (${detail})` : ''}; Setdown's own copy is started instead.`);
    return done;
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
    await this.projectsValue?.fileOperation(state, operation, phase);
    const owner = this.owners.get(state.webContentsId);
    if (!owner) return;
    for (const server of owner.servers.values()) {
      if (this.sessions.get(server)?.state !== 'ready') continue;
      const versions = [...owner.documents.values()].filter(binding => binding.server === server).map(({ id, generation, version }) => ({ id, generation, version }));
      if (phase === 'did') await this.svelteRenamed(owner, server, operation).catch(error => console.warn('Svelte import updates failed', error));
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
    this.projectsValue?.close(ownerId, id);
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
    const notebooks = Promise.all([this.notebooks.dispose(id), this.projectsValue?.disposeWindow(id)]);
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
