import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { unwatchFile, watchFile } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ApplyWorkspaceEditResult, Diagnostic, FileOperationRegistrationOptions, Range, SemanticTokensLegend, ServerCapabilities, TextDocumentContentChangeEvent, WorkspaceEdit } from 'vscode-languageserver-protocol';
import { languageMethods, type LanguageCapabilities, type LanguageCatalogEntry, type LanguageConnection, type LanguageDocument, type LanguageEvent, type LanguageIssue, type LanguageMethod, type LanguageUnavailable } from '../../protocol/language';
import { documentRequest, featureNames, resolveMethods, type LanguageRefresh } from '../../protocol/language-features';
import { languageFailure } from '../../protocol/language-request';
import type { AnalysisObservation } from '../../core/document/analysis-context';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';
import { fileOperationMethod, filteredFileOperation, type LanguageFileOperation } from './file-operations';
import { failureLine, outdatedIssue, runtimeIssue } from './language-issue';
import { answersRequest, autoInsertion, isClangd, isGopls, isJsonServer, isKotlinServer, isSvelteServer, jsonLanguageStatus, schemaLines, setting, svelteScriptChanged, svelteScriptLanguages, toolFamily } from './extension-rules';
import { isOwnAction, isToolCommand, toolMessage } from '../../protocol/language-tools';
import { findGoTool, goEnvironment, installGoTool } from './go-tools';
import { withoutDuplicates } from './go-check';
import { chooseGoVersion, goLintOnSave, goProjectEnvironment, lintAfterChange, goTagsCommand, goTestProgram, goVersionList, goplsStartOptions } from './go-project';
import { forgetKotlinServer, installedKotlinServers, kotlinServerForRun } from './kotlin-download';
import { programOnPath, setAsideNote } from './program-health';
import { kotlinInitializationOptions } from './kotlin-options';
import { schemaContentErrors, schemaDownloadSettings, SchemaContentError, type JsonSchemaContent } from './json-schema-content';
import { withBuiltinJsonSchemas } from './json-builtin-schema-files';
import { customDataAddresses, customDataChanged, htmlCustomDataFile } from './markup-custom-data';
import { htmlSemanticLegend, htmlSemanticLegendRequest, htmlSemanticTokenData, htmlSemanticTokensMethod, htmlSemanticTokensParams, htmlSemanticTokensProvider } from './html-embedded-tokens';
import { yamlDetectionAfterPick, yamlDetectionSetting, yamlFileSchemasMethod, yamlSchemaLine, yamlSchemaRequest, yamlSchemaSelectionSupported, yamlSchemaStoreInitializedMethod, yamlSchemasAfterPick, yamlSchemasSetting } from './yaml-schema-choice';
import { toolRules } from './tool-rules';
import type { ToolSignal } from './tool-signals';
import { LanguagePackageStore, type ExtensionPackage } from './language-package-store';
import { LanguageServiceSupervisor } from './language-supervisor';
import type { ServerRegistry } from './server-registry';
import { ServerItems } from './server-items';
import { ZedLanguageHost, type HostEvent } from './zed-language-host';
import { plainLanguages, projectEngineTools, projectFolder, setdownChoices, setdownDefaults, zedLanguage, zedNames, type BundledProgram, type SetdownRules, type ZedNames } from './zed-settings';

/** The tool a channel of the editor asked for, and the server Zed runs for it. */
export type ProjectTarget = { tool: string; toolName: string; server: string; primary: boolean; languageId: string };
type Channel = { id: string; generation: string; version: number; target: ProjectTarget; server?: number; raw: ServerCapabilities;
  capabilities: LanguageCapabilities; state: 'starting' | 'ready' | 'failed'; message?: string; issue?: LanguageIssue;
  /** Zed said it is fetching the tool, which can take many minutes. */
  preparing?: boolean;
  /** What the tool said about this file once, shown with the project in the document panel. */
  notes?: string[];
  waiting?: { changed(): void; failed(error: Error): void } };
/** One file of one window. Every channel of the editor (the language's own tool and each
 * helper tool) reads the same text, so Zed holds one copy and each change is applied once. */
type OpenFile = { path: string; uri: string; owner: string; root: string; rootReason: string; revision: number; channels: Map<string, Channel>;
  opened: Promise<{ language?: string; servers: string[] }>; saved?: { revision: number; at: number }; resync?: ReturnType<typeof setTimeout>; repairing?: 'once' | 'again';
  /** What gopls last said of the file, and what the lint tool of `go.lintTool` said after a save (`go-project.ts`). */
  reported?: Diagnostic[]; lint?: { diagnostics: Diagnostic[]; revision: number }; linting?: AbortController };
type Running = { name: string; items: ServerItems; command?: Channel; progress: Map<string, string>;
  /** The addresses of the custom data files the tool was last told, as text; the HTML tool is read those files and no other. */
  customData?: string;
  /** The HTML tool's token names for the script inside a page; `null` when it was asked and has none. */
  legend?: SemanticTokensLegend | null;
  /** The YAML tool was asked to say when its schemas are known. */
  schemaEvents?: true;
  /** What the tool said about itself, by a name: a standing line of the document panel. */
  notes: Map<string, string> };
type Edit = { window: Window; finish(result: ApplyWorkspaceEditResult): void };
type Window = { state: WindowState; workspace: string; folders: Set<string>; files: Map<string, OpenFile>; channels: Map<string, OpenFile>;
  requests: Map<string, AbortController>; servers: Map<number, Running>; failed: Set<string>; activity?: ReturnType<typeof setTimeout> };
type Session = { host: ZedLanguageHost; offline: boolean; names: ZedNames; /** The languages Zed has without any extension. */ languages: string[]; extensions: Map<string, string>; loading: Promise<unknown>; stop(): void };
type Catalog = { binding(id: string): { server: string; extension: string } | undefined; package(id: string): ExtensionPackage | undefined };
export type ProjectLanguagesOptions = {
  /** Where Zed keeps the tools and extensions it installs. */
  directory: string; executable: string; home: string;
  registry(): ServerRegistry; catalog(): Catalog; packaged: boolean;
  emit(state: WindowState, event: LanguageEvent): void;
  download?: typeof fetch; environment?: NodeJS.ProcessEnv;
  /** Downloads the schemas the JSON server asks for. Without it the server downloads them itself. */
  schemas?: JsonSchemaContent;
  /** Writes settings of a tool by their VS Code names: for the project in `root`, or without one for every project. */
  writeSettings?(tool: string, resource: string, root: string | undefined, entries: [string, unknown][]): Promise<void>;
  /** The environment tools are looked for in: the person's login shell, where it is known. */
  toolEnvironment?(): NodeJS.ProcessEnv;
  /** The programs of this computer that were found unable to run (`program-health.ts`). */
  programs?: { find(program: string): Promise<{ detail?: string } | undefined>; add(program: string, reason: { detail?: string; lasting: boolean }): Promise<boolean> };
};

/** What the editor is told about a server Zed runs. Zed keeps the server's copy of the text
 * current, so the editor always reports each change with its range, whatever the server
 * asked for, and never asks the server for diagnostics itself: Zed does, and they arrive as events. */
export function channelCapabilities(raw: ServerCapabilities): LanguageCapabilities {
  const { diagnosticProvider: _pulledByZed, ...capabilities } = raw;
  const sync = typeof raw.textDocumentSync === 'object' ? raw.textDocumentSync : undefined;
  return { ...capabilities, textDocumentSync: { openClose: true, change: 2, save: { includeText: false },
    ...(sync?.willSave ? { willSave: true } : {}), ...(sync?.willSaveWaitUntil ? { willSaveWaitUntil: true } : {}) } };
}

/** A server counts the versions of Zed's copy of a document, and an edit it proposes names
 * them. The editor checks an edit against its own versions, so each one is replaced by the
 * version the editor had sent for that document when the server was asked. */
function editorVersions(edit: WorkspaceEdit | null | undefined, revisions: Map<string, number>): void {
  if (!edit || typeof edit !== 'object' || !Array.isArray(edit.documentChanges)) return;
  for (const change of edit.documentChanges) {
    if (!change || !('textDocument' in change) || change.textDocument?.version == null) continue;
    let file: string | undefined;
    try { file = canonicalPath(fileURLToPath(change.textDocument.uri)); } catch { /* Not a file: the editor refuses it. */ }
    const revision = file === undefined ? undefined : revisions.get(file);
    if (revision !== undefined) change.textDocument.version = revision;
  }
}
function proposedEdits(method: LanguageMethod, result: unknown): (WorkspaceEdit | null | undefined)[] {
  if (!result || typeof result !== 'object') return [];
  if (method === 'textDocument/codeAction') return Array.isArray(result) ? result.map(action => (action as { edit?: WorkspaceEdit } | null)?.edit) : [];
  if (method === 'codeAction/resolve') return [(result as { edit?: WorkspaceEdit }).edit];
  return method === 'textDocument/rename' ? [result as WorkspaceEdit] : [];
}

/** Options that say nothing are no options: Zed is not told its settings changed. */
const someOptions = (options: Record<string, unknown>) => Object.keys(options).length ? options : undefined;
export function failureIssue(message: string, offline: boolean): LanguageIssue {
  const runtime = runtimeIssue(message); if (runtime) return runtime;
  // Zed puts what the tool wrote before it ended after this line (lsp_store.rs, "-- stderr --").
  // Those are the tool's words about itself. The program was on this computer and ran, so
  // nothing failed to download, whatever addresses and advice it printed: the Kotlin server
  // ends with "Please download a new build from https://…", and Zed's own sentence for a tool
  // that ended is "language server disconnected".
  const at = message.indexOf('-- stderr --'), reason = at < 0 ? message : message.slice(0, at), written = at < 0 ? '' : message.slice(at + '-- stderr --'.length);
  const outdated = outdatedIssue(written || reason); if (outdated) return outdated;
  if (offline && !written.trim()) return { kind: 'downloads-off' };
  const detail = failureLine(written.trim() ? written : reason);
  return !written.trim() && /\b(?:download\w*|fetch\w*|https?|network|dns|connect(?:ion|ing)?|resolve host|certificate)\b/i.test(reason) ? { kind: 'download-failed', ...(detail ? { detail } : {}) }
    : { kind: 'startup', ...(detail ? { detail } : {}) };
}

/** Ordinary code files served by Zed's project engine (`tooling/language-host`). Setdown says
 * which folder is open and what each open file contains; Zed decides which servers serve the
 * file and with what root, environment and settings, starts them and keeps them informed.
 * Requests of the editor and their answers cross unchanged. Notebooks do not come here. */
export class ProjectLanguages {
  private session?: Promise<Session>;
  private readonly windows = new Map<number, Window>();
  private readonly edits = new Map<string, Edit>();
  /** The newest open of each document. A close, or a second open, ends the ones before it. */
  private readonly opening = new Map<string, symbol>();
  private readonly supervisor = new LanguageServiceSupervisor();
  private readonly packages: LanguagePackageStore;
  private readonly userSettings: string;
  private watching = false;
  /** What was found out for single tools on this computer; part of Setdown's settings layer. */
  private rules: SetdownRules = {};
  private readonly prepared = new Map<string, Promise<void>>();
  private applying: Promise<unknown> = Promise.resolve();
  private disposed = false;
  constructor(private readonly options: ProjectLanguagesOptions) {
    this.packages = new LanguagePackageStore(path.join(options.directory, 'extensions'), options.download);
    const env = options.environment ?? process.env;
    this.userSettings = path.join(process.platform === 'win32' ? path.join(env.APPDATA ?? path.join(options.home, 'AppData', 'Roaming'), 'Zed')
      : path.join(env.FLATPAK_XDG_CONFIG_HOME ?? env.XDG_CONFIG_HOME ?? path.join(options.home, '.config'), 'zed'), 'settings.json');
  }

  private start(): Promise<Session> {
    if (this.disposed) return Promise.reject(Error('Language support has stopped.'));
    return this.session ??= (async () => {
      const offline = !this.options.registry().automaticInstall();
      const host = new ZedLanguageHost(this.options.directory, this.options.executable,
        { ...(this.options.environment ?? process.env), ...(offline ? { SETDOWN_LANGUAGE_HOST_OFFLINE: '1' } : {}) });
      const stop = host.onEvent(event => this.received(host, event));
      try {
        const inventory = await host.request<{ servers: string[]; languages: string[] }>('inventory');
        const names = zedNames(inventory.servers, id => this.options.catalog().binding(id)?.server);
        const session: Session = { host, offline, names, languages: inventory.languages, extensions: new Map(), loading: Promise.resolve(), stop };
        await this.applySettings(session);
        if (!this.watching) {
          this.watching = true;
          watchFile(this.userSettings, { persistent: false, interval: 750 }, this.userSettingsChanged);
        }
        return session;
      } catch (error) { stop(); host.dispose(); this.session = undefined; throw error; }
    })();
  }
  private readonly userSettingsChanged = () => { void this.configure().catch(error => console.warn('Could not apply Zed settings', error)); };
  private bundled(): Record<string, BundledProgram> {
    const registry = this.options.registry(), result: Record<string, BundledProgram> = {};
    for (const definition of registry.definitions()) if (definition.launch.kind === 'bundledNode') try {
      const launch = registry.launch(definition.id, this.options.packaged, {});
      result[definition.id] = { path: launch.executable, arguments: launch.args, env: { ELECTRON_RUN_AS_NODE: '1' } };
    } catch { /* A tool that is not in this build is not offered as bundled. */ }
    return result;
  }
  /** Setdown's part of Zed's settings: what it ships, the person's Zed settings file as
   * written, and what the person chose in Language Support. Project files are Zed's to read. */
  private applySettings(session: Session): Promise<unknown> {
    const apply = this.applying.catch(() => {}).then(async () => {
      const registry = this.options.registry();
      const definition = (id: string) => { try { return registry.definition(id); } catch { return undefined; } };
      const defaults = setdownDefaults(session.names, definition, this.bundled(), { schemaDownloads: !!this.options.schemas, ...this.rules });
      const user = await readFile(this.userSettings, 'utf8').catch(() => '{}');
      const result = await session.host.request<{ user?: string | null }>('project.settings',
        { defaults: JSON.stringify(defaults), user: user.trim() ? user : '{}', choices: JSON.stringify(setdownChoices(registry, session.names, defaults)),
          languages: plainLanguages(session.languages, definition, id => this.options.catalog().binding(id)?.extension) });
      if (result.user) console.warn(`Zed settings at ${this.userSettings} were not applied: ${result.user}`);
    });
    this.applying = apply; return apply;
  }
  /** Language Support or the person's Zed settings changed. Zed restarts what the change affects. */
  async configure(): Promise<void> {
    if (!this.session) return;
    const session = await this.session.catch(() => undefined); if (!session) return;
    if (session.offline === this.options.registry().automaticInstall()) { await this.restartHost('Download settings changed.'); return; }
    // What was found out for a tool is made from its settings too, so it is found out again.
    const again = [...this.prepared.keys()].map(key => key.split('\0')), tools = this.options.registry().definitions();
    this.prepared.clear();
    for (const [id, folder] of again) {
      const tool = tools.find(other => other.id === id);
      if (tool) await this.prepareTool(session, tool, folder, () => {}).catch(error => console.warn(`Could not prepare ${tool.name}`, error));
    }
    await this.applySettings(session);
  }
  private async restartHost(reason: string): Promise<void> {
    const session = await this.session?.catch(() => undefined);
    this.session = undefined; this.prepared.clear();
    if (session) { session.stop(); session.host.dispose(); }
    this.lost(reason, false);
  }

  /** Whether this tool's ordinary files are served by Zed's project engine. */
  eligible(definition: LanguageServerDefinition, file: string, languageId: string): boolean {
    const registry = this.options.registry(), mode = (this.options.environment ?? process.env).SETDOWN_LANGUAGE_ENGINE;
    if (mode === 'legacy' || !(mode === 'zed' || projectEngineTools.has(definition.id)) || registry.isCustom(definition.id)) return false;
    // A dialect Zed has no language for, of a tool whose other languages it has (a Go template
    // with gopls), would open in Zed as a file no server belongs to.
    if (!zedLanguage(languageId) && definition.languages.some(language => zedLanguage(language.languageId))) return false;
    // Choices made for one project folder have no place in Zed's settings layers yet; such a
    // file, and a tool with its own download rule, stays on Setdown's client.
    return !registry.hasProjectChoices(file) && registry.automaticInstall(definition.id, file) === registry.automaticInstall();
  }
  /** Zed's name for the tool's server; none when Zed has no adapter for it. */
  async target(definition: LanguageServerDefinition): Promise<string | undefined> { return (await this.start()).names.server(definition); }
  has(windowId: number, id: string): boolean { return !!this.windows.get(windowId)?.channels.has(id); }
  private channel(windowId: number, id: string): { window: Window; file: OpenFile; channel: Channel } {
    const window = this.windows.get(windowId), file = window?.channels.get(id), channel = file?.channels.get(id);
    if (!window || !file || !channel) throw Error('Language document is closed.');
    return { window, file, channel };
  }
  private documents(file: OpenFile, select: (channel: Channel) => boolean = () => true) {
    return [...file.channels.values()].filter(select).map(({ id, generation }) => ({ id, generation }));
  }
  private observation(file: OpenFile, channel: Channel, running?: Running): AnalysisObservation {
    const progress = [...running?.progress.values() ?? []];
    return { context: { id: channel.target.languageId, root: file.root, rootReason: file.rootReason, environment: 'usable', choices: [], evidence: [], issues: [] },
      analysis: progress.length ? 'working' : 'waiting', scope: 'open-files', freshness: 'none', progress };
  }

  async open(state: WindowState, document: LanguageDocument, file: string, target: ProjectTarget, definition: LanguageServerDefinition): Promise<LanguageConnection | LanguageUnavailable> {
    const key = `${state.webContentsId}:${document.id}`, opening = Symbol(document.id);
    this.opening.set(key, opening);
    let session: Session;
    try {
      session = await this.start();
      const binding = this.options.catalog().binding(target.tool);
      if (binding) await this.loadExtension(session, binding.extension);
      if (this.opening.get(key) !== opening) throw Error('Language document closed during initialization.');
    } finally { if (this.opening.get(key) === opening) this.opening.delete(key); }
    let window = this.windows.get(state.webContentsId);
    if (!window) this.windows.set(state.webContentsId, window = { state, workspace: `window-${state.webContentsId}-${randomUUID()}`, folders: new Set(), files: new Map(), channels: new Map(), requests: new Map(), servers: new Map(), failed: new Set() });
    const host = session.host, workspace = window.workspace;
    // The editor names a helper tool's channel after the document's own.
    const owner = document.server ? document.id.slice(0, -(document.server.length + 1)) : document.id;
    let opened = window.files.get(file);
    if (opened && opened.owner !== owner) throw Error('This provider already owns the document.');
    if (!opened) {
      const folder = projectFolder(file, { ...definition, languages: definition.languages.filter(language => language.languageId === target.languageId) },
        state.projectRoot ? canonicalPath(state.projectRoot) : undefined, this.options.registry().options(target.tool, file).root);
      // Zed starts the tool as soon as it has the file, so what the tool needs first is done first.
      const prepared = this.prepareTool(session, definition, folder.path, this.preparing(state, { id: target.tool, name: target.toolName }, [{ id: document.id, generation: document.generation }]));
      prepared.catch(() => {});
      if (!folder.single && !window.folders.has(folder.path)) {
        window.folders.add(folder.path);
        void host.request('project.folder', { workspace, root: folder.path }).catch(() => window.folders.delete(folder.path));
      }
      const created: OpenFile = { path: file, uri: pathToFileURL(file).href, owner, root: folder.path, rootReason: folder.reason, revision: document.version, channels: new Map(),
        // The document's language is Setdown's: the one the person sees and can change, and the
        // one that led to this tool. Zed is told it where it has a name for it.
        opened: prepared.then(() => host.request('project.open', { workspace, path: file, text: document.text, revision: document.version, language: zedLanguage(target.languageId) })) };
      created.opened.catch(() => {});
      opened = created; window.files.set(file, created);
    } else if (document.version > opened.revision) {
      // This channel was bound later and already holds newer text than the other channels have sent.
      opened.revision = document.version;
      void host.request('project.change', { workspace, path: file, revision: document.version, text: document.text }).catch(() => this.resync(window, opened!));
    }
    const current = opened;
    const channel: Channel = { id: document.id, generation: document.generation, version: document.version, target, raw: {}, capabilities: {}, state: 'starting' };
    current.channels.set(document.id, channel); window.channels.set(document.id, current);
    const alive = () => this.windows.get(state.webContentsId) === window && window.channels.get(document.id) === current && current.channels.get(document.id) === channel;
    const named = () => ({ id: channel.target.tool, name: channel.target.toolName });
    this.options.emit(state, { type: 'status', state: 'starting', server: named(), documents: [{ id: channel.id, generation: channel.generation }] });
    try {
      const { servers } = await current.opened;
      if (!alive()) throw Error('Language document closed during initialization.');
      if (!servers.includes(target.server)) {
        // The project's own Zed settings name other servers for this language, and they decide.
        const registry = this.options.registry();
        const replacement = target.primary ? registry.definitions().find(other => { const name = session.names.server(other); return !!name && servers.includes(name) && registry.role(other.id, file) === 'primary'; }) : undefined;
        if (!replacement) { this.close(state.webContentsId, document.id); return { unavailable: 'missing', server: named() }; }
        channel.target = { ...target, tool: replacement.id, toolName: replacement.name, server: session.names.server(replacement)! };
      }
      const running = await this.attach(session, window, current, channel, alive);
      const registry = this.options.registry(), tool = registry.definitions().find(other => other.id === channel.target.tool) ?? definition;
      await this.extend(session, window, current, channel, running, tool);
      if (!alive()) throw Error('Language document closed during initialization.');
      channel.state = 'ready'; channel.capabilities = channelCapabilities(channel.raw);
      this.supervisor.reset(this.recoveryKey(window, channel.target.server));
      this.options.emit(state, { type: 'status', state: 'ready', documents: [{ id: channel.id, generation: channel.generation }] });
      // What Zed already knows about this file reaches a channel that was bound after it was said.
      void host.request('project.diagnostics', { workspace, path: file }).catch(() => {});
      const autoInsert = autoInsertion(tool, registry.options(tool.id, file).settings ?? tool.settings);
      channel.notes = await this.schemas(session, window, current, channel, tool);
      // A program of this computer that was passed by for Setdown's own copy is named wherever the tool's lines are shown.
      const passedBy = this.notUsed.get(tool.id);
      if (passedBy) channel.notes = [...channel.notes, `Not used: ${passedBy}`];
      if (!alive()) throw Error('Language document closed during initialization.');
      const family = toolFamily(tool);
      return { ...(autoInsert ? { autoInsert } : {}), ...(isClangd(tool) ? { companion: true } : {}), ...(family ? { tool: family } : {}),
        messages: [], analysis: this.observation(current, channel, running), name: channel.target.toolName, uri: current.uri, capabilities: channel.capabilities,
        server: channel.target.tool, context: [`Project: ${current.root}`, `Root: ${current.rootReason}`, ...channel.notes, ...running.notes.values()] };
    } catch (error) {
      if (!alive()) throw error;
      const message = String(error instanceof Error ? error.message : error);
      channel.state = 'failed'; channel.message = message; channel.issue = failureIssue(message, session.offline);
      this.unprepare(channel.target.tool, current.root);
      // The program of this computer said its build no longer runs: it is set aside and the tool
      // is opened again, now from the copy Setdown verified.
      if (channel.issue.kind === 'outdated' && await this.setAside(definition, current.root, channel.issue.detail).catch(() => false)) {
        this.unprepare(channel.target.tool);
        this.supervisor.reset(this.recoveryKey(window, channel.target.server));
        this.options.emit(state, { type: 'status', state: 'starting', server: named(), documents: [{ id: channel.id, generation: channel.generation }] });
        this.rebind(window, current, channel.target.tool);
        throw Error(message);
      }
      window.failed.add(channel.target.server);
      const repeats = channel.issue.kind === 'runtime' || channel.issue.kind === 'downloads-off' || channel.issue.kind === 'outdated';
      const recovering = repeats ? undefined : this.supervisor.schedule(this.recoveryKey(window, channel.target.server), () => this.rebind(window, current, channel.target.tool));
      channel.message = `${message}\n${recovering ? `Reconnecting (${recovering.attempt}/3)…` : repeats ? 'It will not start until its setup changes.' : 'Automatic recovery paused after repeated failures. Restart this service to try again.'}`;
      this.options.emit(state, { type: 'status', state: 'failed', message: channel.message, issue: channel.issue, server: named(),
        recovery: { retrying: !!recovering, attempt: recovering?.attempt }, documents: [{ id: channel.id, generation: channel.generation }] });
      throw Error(channel.message);
    }
  }
  /** What a tool's own editor extension does before it starts the tool, done before Zed starts
   * it. gopls is looked for where `go install` puts it and installed in a cleaned environment
   * (`go-tools.ts`). JetBrains' Kotlin server is downloaded with its checksum verified and is
   * told its build settings (`kotlin-download.ts`, `kotlin-options.ts`). What was found becomes
   * part of Setdown's settings layer, so Zed starts the tool with it. It is found out once for
   * a tool and a folder, and again after a restart, a change of settings or a failure. */
  private prepareTool(session: Session, tool: LanguageServerDefinition, folder: string, report: (message: string) => void): Promise<void> {
    if (!isGopls(tool) && !isKotlinServer(tool)) return Promise.resolve();
    const key = `${tool.id}\0${folder}`;
    let prepared = this.prepared.get(key);
    if (!prepared) {
      const started = prepared = (async () => {
        const kotlin = isKotlinServer(tool) ? await this.kotlin(session, tool, folder, report) : undefined;
        const program = isGopls(tool) ? await this.gopls(session, tool, folder, report) : kotlin?.program;
        // gopls is told the person's `go.*` and `gopls` settings as its extension tells it (`go-gopls-rules.ts`).
        const options = kotlin ? kotlin.options
          : isGopls(tool) ? someOptions(goplsStartOptions(this.options.registry().options(tool.id).settings ?? tool.settings)) : undefined;
        // Read and replaced without a pause between: another tool may have been prepared meanwhile.
        if (JSON.stringify([this.rules.programs?.[tool.id], this.rules.options?.[tool.id]]) === JSON.stringify([program, options])) return;
        const { [tool.id]: _program, ...programs } = this.rules.programs ?? {}, { [tool.id]: _options, ...rest } = this.rules.options ?? {};
        this.rules = { programs: { ...programs, ...(program ? { [tool.id]: program } : {}) }, options: { ...rest, ...(options ? { [tool.id]: options } : {}) } };
        await this.applySettings(session);
      })();
      this.prepared.set(key, started);
      started.catch(() => { if (this.prepared.get(key) === started) this.prepared.delete(key); });
    }
    return prepared;
  }
  /** The next file of this tool finds out again what the tool needs. */
  private unprepare(tool: string, folder?: string): void {
    for (const key of [...this.prepared.keys()]) if (folder === undefined ? key.startsWith(`${tool}\0`) : key === `${tool}\0${folder}`) this.prepared.delete(key);
    const definition = this.options.registry().definitions().find(other => other.id === tool);
    if (definition && isKotlinServer(definition)) forgetKotlinServer(this.kotlinWork(tool));
  }
  private kotlinWork(tool: string) { return path.join(this.options.directory, 'extensions', 'work', this.options.catalog().binding(tool)?.extension ?? 'kotlin'); }
  private preparing(state: WindowState, tool: { id: string; name: string }, documents: { id: string; generation: string }[]) {
    return (message: string) => this.options.emit(state, { type: 'status', state: 'starting', preparing: true, message, server: tool, documents });
  }
  private async gopls(session: Session, tool: LanguageServerDefinition, folder: string, report: (message: string) => void): Promise<NonNullable<SetdownRules['programs']>[string] | undefined> {
    // A program the person named in Language Support is used as it is.
    if (path.isAbsolute(this.options.registry().executable(tool.id))) return undefined;
    // The Go the person chose with "Go: Choose Go Environment" comes first (`go-project.ts`).
    const base = this.goBase(), { env, chosen } = await goProjectEnvironment(this.options.directory, folder, this.options.registry().options(tool.id).settings ?? tool.settings, base);
    const isFile = (file: string) => stat(file).then(found => found.isFile(), () => false);
    const go = await goEnvironment(env, undefined, { toolchain: 'local' });
    const found = await findGoTool('gopls', env, go);
    const own = path.join(this.options.directory, 'go', 'bin'), installed = path.join(own, process.platform === 'win32' ? 'gopls.exe' : 'gopls');
    // Zed finds a gopls on PATH itself, and keeps one it installed earlier in its own folder.
    let program = found && found.source !== 'PATH' ? found.path : undefined;
    if (!found && await isFile(installed)) program = installed;
    else if (!found && go && !session.offline && !(await readdir(path.join(this.options.directory, 'servers', 'gopls')).catch(() => [])).some(name => name.startsWith('gopls_'))) {
      report('Installing gopls…');
      // The Go the project is built with decides the toolchain gopls is built with (`go-tools.ts`).
      const project = await goEnvironment(env, undefined, { cwd: folder });
      program = await installGoTool({ go, env, destination: own, projectGoVersion: project?.GOVERSION, cwd: folder });
    }
    // gopls runs `go` by name. vscode-go puts Go's own folder in front of PATH when `go` was
    // found somewhere else (goInstallTools.ts `updateGoVarsFromConfig`).
    const goFolder = chosen ? path.dirname(chosen) : go && go.source !== 'PATH' ? go.GOROOT ? path.join(go.GOROOT, 'bin') : path.dirname(go.executable) : undefined;
    const added = goFolder ? { env: { PATH: [goFolder, ...(base.PATH ?? base.Path ?? '').split(path.delimiter).filter(entry => entry && entry !== goFolder)].join(path.delimiter) } } : {};
    return program || goFolder ? { ...(program ? { path: program, arguments: ['-mode=stdio'] } : {}), ...added } : undefined;
  }
  private goBase(): NodeJS.ProcessEnv { return this.options.toolEnvironment?.() ?? this.options.environment ?? process.env; }
  /** By tool: the sentence about a program of this computer that was passed by for Setdown's own copy. */
  private readonly notUsed = new Map<string, string>();
  /** Sets aside the program of this computer a tool ended in saying its build no longer runs, where
   * Setdown names another copy to Zed. That is JetBrains' Kotlin server: `kotlin()` names the
   * verified build once the `kotlin-lsp` on PATH is aside. False when nothing would change. */
  private async setAside(tool: LanguageServerDefinition, folder: string, detail?: string): Promise<boolean> {
    if (!this.options.programs || !isKotlinServer(tool) || path.isAbsolute(this.options.registry().executable(tool.id))) return false;
    const local = await programOnPath('kotlin-lsp', this.goBase(), folder);
    return !!local && this.options.programs.add(local, { ...(detail ? { detail } : {}), lasting: true });
  }
  private async kotlin(session: Session, tool: LanguageServerDefinition, folder: string, report: (message: string) => void): Promise<{ program?: NonNullable<SetdownRules['programs']>[string]; options: Record<string, unknown> }> {
    // Zed is told the program, with the argument the Kotlin extension gives it, by the rules of
    // zed-extensions/kotlin 0.3.5 (src/language_servers/kotlin_lsp.rs `language_server_binary_path`,
    // src/kotlin.rs `language_server_command`): a `kotlin-lsp` on PATH before any download. The
    // extension is not left to find it, because it starts that program whatever its state and
    // otherwise downloads a build without reading its checksum, which the host refuses. A
    // program on PATH that was found unable to run is passed by, and the build Setdown verified
    // (`kotlin-download.ts`) is named. A program the person named in Language Support is used as
    // it is. With downloads off the newest server already here is named.
    const named = path.isAbsolute(this.options.registry().executable(tool.id)), work = this.kotlinWork(tool.id);
    const local = named ? undefined : await programOnPath('kotlin-lsp', this.goBase(), folder), aside = local ? await this.options.programs?.find(local) : undefined;
    const managed = named || local && !aside ? undefined : session.offline ? (await installedKotlinServers(work))[0] : await kotlinServerForRun({ work, fetch: this.options.download,
      progress: (received, total) => report(`Downloading ${tool.name}… ${total ? `${Math.floor(received / total * 100)}%` : `${Math.round(received / 1e6)} MB`}`) });
    const found = managed ?? (local ? { program: local } : undefined);
    if (managed && local) this.notUsed.set(tool.id, setAsideNote(tool.name, local, aside?.detail)); else this.notUsed.delete(tool.id);
    const folders = new Set([...this.windows.values()].flatMap(window => [...window.folders])).add(folder);
    const { options, problems } = kotlinInitializationOptions(this.options.registry().options(tool.id).settings ?? tool.settings, [...folders].map(open => pathToFileURL(open).href));
    for (const problem of problems) console.warn(`${tool.name}: ${problem} and was not sent.`);
    return { ...(found ? { program: { path: found.program, arguments: ['--stdio'] } } : {}), options };
  }
  private revisions(window: Window) { return new Map([...window.files].map(([file, opened]) => [file, opened.revision])); }
  private recoveryKey(window: Window, server: string) { return `${window.state.webContentsId}:${server}`; }
  private loadExtension(session: Session, id: string): Promise<unknown> {
    const pkg = this.options.catalog().package(id);
    if (!pkg) throw Error(`The Zed extension ${id} is not in the catalog.`);
    if (session.extensions.get(pkg.id) === pkg.version) return session.loading;
    // The whole list goes each time: Zed unloads an extension that a later list leaves out.
    return session.loading = session.loading.catch(() => {}).then(async () => {
      await this.packages.ensure(pkg);
      const extensions = new Map(session.extensions).set(pkg.id, pkg.version);
      await session.host.request('extensions', { extensions: [...extensions].map(([id, version]) => ({ id, version })) });
      session.extensions.set(pkg.id, pkg.version);
    });
  }
  /** Waits until Zed runs the channel's server for this file. Zed says when something changed. */
  private async attach(session: Session, window: Window, file: OpenFile, channel: Channel, alive: () => boolean): Promise<Running> {
    const name = channel.target.server;
    if (window.failed.delete(name)) await session.host.request('project.restart', { workspace: window.workspace, path: file.path, names: [name] });
    try {
      for (;;) {
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        const changed = new Promise<void>((resolve, reject) => {
          // Zed reports a download and a failure. Silence this long means the server was never started.
          if (!channel.preparing) watchdog = setTimeout(() => reject(Error(`${channel.target.toolName} did not start.`)), 120_000);
          channel.waiting = { changed: resolve, failed: reject };
        });
        changed.catch(() => {});
        try {
          const { servers } = await session.host.request<{ servers: { server: number; name: string; capabilities: ServerCapabilities }[] }>('project.servers', { workspace: window.workspace, path: file.path });
          if (!alive()) throw Error('Language document closed during initialization.');
          const found = servers.find(server => server.name === name);
          if (found) {
            channel.server = found.server; channel.raw = found.capabilities ?? {};
            let running = window.servers.get(found.server);
            if (!running) window.servers.set(found.server, running = { name, items: new ServerItems(), progress: new Map(), notes: new Map() });
            return running;
          }
          await changed;
        } finally { clearTimeout(watchdog); }
      }
    } finally { channel.waiting = undefined; }
  }

  private received(host: ZedLanguageHost, event: HostEvent): void {
    if (event.event === 'exit') {
      void this.session?.then(session => { if (session.host === host && !this.disposed) { this.session = undefined; session.stop(); this.lost(String(event.message ?? 'The language host stopped.'), true); } }, () => {});
      return;
    }
    const window = [...this.windows.values()].find(candidate => candidate.workspace === event.workspace);
    if (!window) return;
    const waiting = (select: (file: OpenFile, channel: Channel) => boolean) =>
      [...window.files.values()].flatMap(file => [...file.channels.values()].filter(channel => channel.waiting && select(file, channel)));
    const bound = (server: unknown) => [...window.files.values()].flatMap(file => [...file.channels.values()].filter(channel => channel.state === 'ready' && (server === null || server === undefined || channel.server === server)).map(channel => ({ file, channel })));
    switch (event.event) {
      case 'project.diagnostics': {
        const file = window.files.get(String(event.path));
        if (file && event.revision === file.revision) for (const channel of file.channels.values()) if (channel.state === 'ready' && channel.server === event.server) {
          const tool = this.options.registry().definitions().find(other => other.id === channel.target.tool);
          if (tool && isGopls(tool)) { file.reported = event.diagnostics as Diagnostic[]; this.reportGo(window, file, channel); }
          else this.options.emit(window.state, { type: 'diagnostics', server: channel.target.tool, id: channel.id, generation: channel.generation, version: file.revision, diagnostics: event.diagnostics as Diagnostic[] });
        }
        break;
      }
      case 'project.registered': for (const channel of waiting(file => file.path === event.path)) channel.waiting!.changed(); break;
      case 'project.server':
        if (event.state === 'added') { for (const channel of waiting(() => true)) channel.waiting!.changed(); break; }
        // Zed stopped the server: its settings changed, it was restarted, or it ended by itself.
        for (const { file, channel } of bound(event.server)) this.rebind(window, file, channel.target.tool);
        this.forget(window, event.server as number);
        break;
      case 'project.status':
        for (const channel of waiting((_file, channel) => channel.target.server === event.name)) {
          if (event.status === 'failed') channel.waiting!.failed(Error(String(event.message ?? `${channel.target.toolName} could not start.`)));
          else {
            channel.preparing = event.status === 'downloading' || event.status === 'checking';
            channel.waiting!.changed();
            if (channel.preparing) this.options.emit(window.state, { type: 'status', state: 'starting', preparing: true,
              message: event.status === 'downloading' ? `Downloading ${channel.target.toolName}…` : `Preparing ${channel.target.toolName}…`,
              server: { id: channel.target.tool, name: channel.target.toolName }, documents: [{ id: channel.id, generation: channel.generation }] });
          }
        }
        break;
      case 'project.capabilities': void this.capabilitiesChanged(host, window, event.server as number); break;
      case 'project.refresh':
        for (const { channel } of bound(event.server)) this.options.emit(window.state, { type: 'refresh', feature: event.feature as LanguageRefresh, documents: [{ id: channel.id, generation: channel.generation }] });
        break;
      case 'project.progress': {
        const running = window.servers.get(event.server as number); if (!running) break;
        const token = String(event.token);
        if (event.phase === 'end') running.progress.delete(token);
        else running.progress.set(token, [event.title ?? running.progress.get(token)?.split(': ')[0], event.message, typeof event.percentage === 'number' ? `${event.percentage}%` : undefined].filter(Boolean).join(': ').slice(0, 240));
        window.activity ??= setTimeout(() => {
          window.activity = undefined;
          this.options.emit(window.state, { type: 'activity' });
          for (const { file, channel } of bound(undefined)) { const active = window.servers.get(channel.server!);
            this.options.emit(window.state, { type: 'context', id: channel.id, generation: channel.generation, messages: [], analysis: this.observation(file, channel, active),
              context: [`Project: ${file.root}`, `Root: ${file.rootReason}`, ...channel.notes ?? [], ...active?.notes.values() ?? [], ...active?.progress.values() ?? []] }); }
        }, 500);
        break;
      }
      case 'project.applyEdit': {
        const command = window.servers.get(event.server as number)?.command;
        const file = command && window.channels.get(command.id);
        editorVersions(event.workspaceEdit as WorkspaceEdit, this.revisions(window));
        void (command && file ? this.proposeEdit(window, file, command, event.workspaceEdit as WorkspaceEdit) : Promise.resolve({ applied: false, failureReason: 'No active user command accepts edits.' }))
          .then(result => host.request('project.applyEditResult', { edit: event.edit, applied: result.applied, failureReason: result.failureReason })).catch(() => {});
        break;
      }
      case 'project.toolNotification': {
        // What a tool tells only its own extension (`tool-signals.ts`).
        const running = window.servers.get(event.server as number); if (!running) break;
        if (event.method === yamlSchemaStoreInitializedMethod) { for (const { file, channel } of bound(event.server)) void this.renote(window, file, channel); break; }
        const tool = this.options.registry().definitions().find(other => bound(event.server).some(({ channel }) => channel.target.tool === other.id));
        const rules = tool && toolRules(tool, { name: tool.name, root: '', settings: tool.settings });
        let signal: ToolSignal | undefined;
        try { signal = rules?.notifications?.[String(event.method)]?.(event.params); } catch { /* A malformed message of a tool shows nothing. */ }
        // This path has no notices of its own: what a notice says stands as a line of the panel.
        for (const [key, notice] of Object.entries(signal?.notices ?? {})) { if (notice?.message.trim()) running.notes.set(key, notice.message.replace(/\s+/g, ' ').trim().slice(0, 1000)); else running.notes.delete(key); }
        if (signal?.notices) for (const { file, channel } of bound(event.server)) this.context(window, file, channel);
        break;
      }
      case 'project.schemaContent':
        if (event.kind === 'html.customData') {
          // The HTML tool reads no custom data file itself. It is read the files it was told of, and no other.
          const told = [...window.servers.values()].flatMap(running => { try { return JSON.parse(running.customData ?? '[]') as string[]; } catch { return []; } });
          const file = told.includes(String(event.uri)) ? htmlCustomDataFile(event.uri) : undefined;
          void (file ? stat(file).then(found => found.size > 16 * 1024 * 1024 ? '' : readFile(file, 'utf8')).catch(() => '') : Promise.resolve(''))
            .then(content => host.request('project.schemaContentResult', { request: event.request, content })).catch(() => {});
          break;
        }
        // The JSON server asked for a schema it does not read itself. The answer, or the
        // refusal with its code, is what VS Code's JSON extension would give.
        void this.schemaContent(String(event.uri)).then(content => ({ content }), error => ({ error: String(error instanceof Error ? error.message : error),
          code: error instanceof SchemaContentError ? error.code : schemaContentErrors.http }))
          .then(answer => host.request('project.schemaContentResult', { request: event.request, ...answer })).catch(() => {});
        break;
      case 'project.diverged': {
        // Zed changed its copy by itself, usually by reading the file again after it changed on
        // disk. The editor normally sends the same text a moment later; if it does not, the
        // document is bound again, which sends the editor's text whole.
        const file = window.files.get(String(event.path));
        if (file && !file.resync) file.resync = setTimeout(() => { file.resync = undefined; this.resync(window, file); }, 1500);
        // After a save of Setdown's own, the file is the editor's text of this revision. Zed is
        // given that text again and the document stays bound: binding it again would close what
        // the person has open on it and show the tool as starting.
        if (file && file.saved?.revision === file.revision) void this.repair(window, file);
        break;
      }
    }
  }
  private async schemaContent(uri: string): Promise<string> {
    const registry = this.options.registry(), tool = registry.definitions().find(isJsonServer);
    if (!this.options.schemas || !tool) throw new SchemaContentError(schemaContentErrors.http, 'This editor downloads no schemas.');
    // An address VS Code has built in for a file name is trusted, as one the person assigned is (jsonClient.ts `isTrusted`).
    return this.options.schemas.content(uri, schemaDownloadSettings(withBuiltinJsonSchemas(registry.options(tool.id).settings ?? tool.settings)));
  }
  /** Which schemas the JSON or the YAML server checks this file against, as lines of the document panel. */
  private async schemas(session: Session, window: Window, file: OpenFile, channel: Channel, tool: LanguageServerDefinition): Promise<string[]> {
    if (channel.server === undefined) return [];
    const send = { workspace: window.workspace, server: channel.server };
    try {
      if (isJsonServer(tool)) return schemaLines(await session.host.request('project.request', { ...send, method: jsonLanguageStatus, params: [file.uri] }));
      // vscode-yaml shows the file's schema in the status bar (`yaml-schema-choice.ts`).
      if (toolFamily(tool) === 'yaml') return [`Schema: ${yamlSchemaLine(await session.host.request('project.request', { ...send, ...yamlSchemaRequest(yamlFileSchemasMethod, file.uri) }))}`];
    } catch { /* A tool that does not answer shows no line. */ }
    return [];
  }
  /** Reads the schema line of a file again, after the tool's schemas or the person's choice changed. */
  private async renote(window: Window, file: OpenFile, channel: Channel): Promise<void> {
    const session = await this.session?.catch(() => undefined), tool = this.options.registry().definitions().find(other => other.id === channel.target.tool);
    if (!session || !tool || channel.state !== 'ready') return;
    const notes = await this.schemas(session, window, file, channel, tool);
    if (file.channels.get(channel.id) !== channel || JSON.stringify(notes) === JSON.stringify(channel.notes)) return;
    channel.notes = notes; this.context(window, file, channel);
  }
  private context(window: Window, file: OpenFile, channel: Channel): void {
    const active = channel.server === undefined ? undefined : window.servers.get(channel.server);
    this.options.emit(window.state, { type: 'context', id: channel.id, generation: channel.generation, messages: [], analysis: this.observation(file, channel, active),
      context: [`Project: ${file.root}`, `Root: ${file.rootReason}`, ...channel.notes ?? [], ...active?.notes.values() ?? [], ...active?.progress.values() ?? []] });
  }
  /** What a tool's own extension does once the tool runs: it names the project's custom data
   * files (`markup-custom-data.ts`), asks the HTML tool for the token names of a page's script
   * (`html-embedded-tokens.ts`), and asks the YAML tool to say when its schemas are known. */
  private async extend(session: Session, window: Window, file: OpenFile, channel: Channel, running: Running, tool: LanguageServerDefinition): Promise<void> {
    const family = toolFamily(tool), send = { workspace: window.workspace, server: channel.server };
    if (family === 'html' || family === 'css') {
      const addresses = customDataAddresses(family, this.options.registry().options(tool.id, file.path).settings ?? tool.settings, file.root), told = JSON.stringify(addresses);
      // Each notification replaces the whole list, so an emptied list is told as well.
      if (running.customData !== told && (addresses.length || running.customData !== undefined)) {
        running.customData = told;
        await session.host.request('project.notify', { ...send, ...customDataChanged(family, addresses) }).catch(() => {});
      }
    }
    if (family === 'html') {
      if (running.legend === undefined) running.legend = htmlSemanticLegend(await session.host.request('project.request', { ...send, ...htmlSemanticLegendRequest }).catch(() => null)) ?? null;
      if (running.legend && !channel.raw.semanticTokensProvider) channel.raw = { ...channel.raw, semanticTokensProvider: htmlSemanticTokensProvider(running.legend) };
    }
    if (family === 'yaml' && !running.schemaEvents) {
      running.schemaEvents = true;
      await session.host.request('project.notify', { ...send, ...yamlSchemaSelectionSupported }).catch(() => {});
    }
  }
  /** vscode-yaml `showSchemaSelection`: the person's choice of schemas for a file is written to
   * `yaml.schemas` (`yaml-schema-choice.ts`). A new entry names the file by its full address, so
   * it is kept with the person's settings for the tool everywhere: a choice kept for one
   * project would move that project's files to Setdown's own client (`eligible`). */
  private async selectSchemas(session: Session, window: Window, file: OpenFile, channel: Channel, tool: LanguageServerDefinition, params: Record<string, unknown>): Promise<boolean> {
    if (!this.options.writeSettings) throw Error('Settings cannot be written here.');
    const selected = Array.isArray(params.selected) ? params.selected.filter((uri): uri is string => typeof uri === 'string' && uri.length <= 2048).slice(0, 32) : [];
    const inUse = await session.host.request<unknown>('project.request', { workspace: window.workspace, server: channel.server, ...yamlSchemaRequest(yamlFileSchemasMethod, file.uri) }).catch(() => []);
    const used = (Array.isArray(inUse) ? inUse : []).flatMap(entry => typeof (entry as { uri?: unknown } | null)?.uri === 'string' ? [(entry as { uri: string }).uri] : []);
    const settings = this.options.registry().chosen(tool.id).settings ?? tool.settings, place = { uri: file.uri, folder: file.root };
    const detection = yamlDetectionAfterPick(setting(settings, yamlDetectionSetting), place, selected);
    await this.options.writeSettings(tool.id, file.path, undefined, [[yamlSchemasSetting, yamlSchemasAfterPick(setting(settings, yamlSchemasSetting), place, selected, used)],
      ...(detection === undefined ? [] : [[yamlDetectionSetting, detection] as [string, unknown]])]);
    // The tool reads the new settings in its own time; the line follows a moment later.
    setTimeout(() => void this.renote(window, file, channel), 1500).unref();
    return true;
  }
  private async capabilitiesChanged(host: ZedLanguageHost, window: Window, server: number): Promise<void> {
    for (const file of window.files.values()) {
      const channels = [...file.channels.values()].filter(channel => channel.state === 'ready' && channel.server === server);
      if (!channels.length) continue;
      const { servers } = await host.request<{ servers: { server: number; capabilities: ServerCapabilities }[] }>('project.servers', { workspace: window.workspace, path: file.path }).catch(() => ({ servers: [] }));
      const found = servers.find(candidate => candidate.server === server); if (!found) continue;
      // The token names of the HTML tool are no capability of its own; they stay what was asked.
      const legend = window.servers.get(server)?.legend;
      const raw = legend && !found.capabilities.semanticTokensProvider ? { ...found.capabilities, semanticTokensProvider: htmlSemanticTokensProvider(legend) } : found.capabilities;
      for (const channel of channels) if (file.channels.get(channel.id) === channel && JSON.stringify(channel.raw) !== JSON.stringify(raw)) {
        channel.raw = raw; channel.capabilities = channelCapabilities(raw);
        this.options.emit(window.state, { type: 'capabilities', id: channel.id, generation: channel.generation, capabilities: channel.capabilities });
      }
    }
  }
  /** Asks the editor to bind these documents again. It closes them here and opens them with its current text. */
  private rebind(window: Window, file: OpenFile, tool?: string): void {
    if (this.windows.get(window.state.webContentsId) !== window || window.files.get(file.path) !== file) return;
    const documents = this.documents(file, channel => !tool || channel.target.tool === tool);
    if (documents.length) this.options.emit(window.state, { type: 'configuration', servers: [...new Set([...file.channels.values()].filter(channel => !tool || channel.target.tool === tool).map(channel => channel.target.tool))], documents });
  }
  private resync(window: Window, file: OpenFile): void { clearTimeout(file.resync); file.resync = undefined; this.rebind(window, file); }
  /** Gives Zed the saved file's text as the document's text, while the file is still the
   * document at its current revision. When that cannot be done the timer of `project.diverged`
   * binds the document again. */
  private async repair(window: Window, file: OpenFile): Promise<void> {
    if (file.repairing) { file.repairing = 'again'; return; }
    try {
      for (;;) {
        file.repairing = 'once';
        const revision = file.revision;
        const current = () => this.windows.get(window.state.webContentsId) === window && window.files.get(file.path) === file
          && file.revision === revision && file.saved?.revision === revision;
        const text = await readFile(file.path, 'utf8');
        const session = await this.session;
        if (!session || !current()) return;
        await session.host.request('project.change', { workspace: window.workspace, path: file.path, revision, text });
        if (!current()) return;
        // Zed read the file once more while this was on its way: the text is given again.
        if (file.repairing === 'once') { clearTimeout(file.resync); file.resync = undefined; return; }
      }
    } catch { /* The timer binds the document again. */ } finally { file.repairing = undefined; }
  }
  private forget(window: Window, server: number): void {
    window.servers.delete(server);
    for (const edit of this.edits.values()) if (edit.window === window) edit.finish({ applied: false, failureReason: 'Language session closed.' });
  }
  /** The host is gone, and with it every copy and server. The editor binds its documents again. */
  private lost(reason: string, crashed: boolean): void {
    for (const window of this.windows.values()) {
      for (const controller of window.requests.values()) controller.abort();
      for (const edit of this.edits.values()) if (edit.window === window) edit.finish({ applied: false, failureReason: 'Language session closed.' });
      const documents = [...window.files.values()].flatMap(file => this.documents(file));
      const tools = [...new Set([...window.files.values()].flatMap(file => [...file.channels.values()].map(channel => channel.target.tool)))];
      for (const file of window.files.values()) { clearTimeout(file.resync); for (const channel of file.channels.values()) channel.waiting?.failed(Error(reason)); }
      clearTimeout(window.activity);
      this.windows.delete(window.state.webContentsId);
      if (!documents.length) continue;
      const recovering = crashed ? this.supervisor.schedule(`host:${window.state.webContentsId}`, () => this.options.emit(window.state, { type: 'configuration', servers: tools, documents })) : undefined;
      if (crashed) this.options.emit(window.state, { type: 'status', state: 'failed', issue: { kind: 'crashed' }, documents, recovery: { retrying: !!recovering, attempt: recovering?.attempt },
        message: `${reason}\n${recovering ? `Reconnecting (${recovering.attempt}/3)…` : 'Automatic recovery paused after repeated failures. Restart this service to try again.'}` });
      else this.options.emit(window.state, { type: 'configuration', servers: tools, documents });
    }
  }

  async change(windowId: number, id: string, version: number, changes: TextDocumentContentChangeEvent[]): Promise<void> {
    const { window, file, channel } = this.channel(windowId, id);
    if (!Number.isSafeInteger(version) || version <= channel.version || !Array.isArray(changes)
      || changes.length > 10000 || JSON.stringify(changes).length > 32 * 1024 * 1024) throw Error('Invalid language change.');
    channel.version = version;
    if (channel.server !== undefined) window.servers.get(channel.server)?.items.forget(id, false);
    // Every channel reports the same change of the same text. The first report is applied.
    if (version <= file.revision) return;
    file.revision = version;
    // What the lint tool said after the last save stays where the text it is about now is.
    if (file.lint) file.lint = { diagnostics: lintAfterChange(file.lint.diagnostics, changes), revision: version };
    if (changes.some(change => !('range' in change))) { clearTimeout(file.resync); file.resync = undefined; }
    const session = await this.start();
    await session.host.request('project.change', { workspace: window.workspace, path: file.path, revision: version, changes }).catch(error => {
      console.warn('Zed could not apply a document change; sending the document again.', String(error));
      this.resync(window, file);
    });
    // The Svelte tool is told each unsaved change of a TypeScript or JavaScript file, as its
    // extension tells it: Zed informs a server only of the files of its own languages.
    if (!svelteScriptLanguages.includes(channel.target.languageId)) return;
    const tools = this.options.registry().definitions();
    const servers = new Set([...window.files.values()].flatMap(other => [...other.channels.values()]).filter(other => other.state === 'ready' && other.server !== undefined
      && other.server !== channel.server && tools.some(tool => tool.id === other.target.tool && isSvelteServer(tool))).map(other => other.server!));
    for (const server of servers) void session.host.request('project.notify', { workspace: window.workspace, server, method: svelteScriptChanged, params: { uri: file.uri, changes } }).catch(() => {});
  }
  async request(windowId: number, id: string, version: number, requestId: string, method: LanguageMethod, params: unknown): Promise<unknown> {
    const { window, file, channel } = this.channel(windowId, id);
    const running = channel.server === undefined ? undefined : window.servers.get(channel.server);
    if (!running || channel.state !== 'ready' || channel.version !== version || !languageMethods.includes(method) || method === 'textDocument/diagnostic'
      || typeof requestId !== 'string' || requestId.length > 128 || window.requests.has(requestId)
      || window.requests.size >= 64 || !params || typeof params !== 'object' || JSON.stringify(params).length > 4 * 1024 * 1024) throw Error('Invalid or stale language request.');
    if (!answersRequest(this.options.registry().definitions().find(tool => tool.id === channel.target.tool), method)) throw Error('This tool does not answer that request.');
    const origin = { document: id, generation: channel.generation, version };
    const tool = this.options.registry().definitions().find(other => other.id === channel.target.tool);
    let made: ReturnType<typeof toolMessage>;
    if (isOwnAction(method)) {
      if (method === 'setdown/yaml.selectSchemas' && tool) return this.start().then(session => this.selectSchemas(session, window, file, channel, tool, params as Record<string, unknown>)).catch(languageFailure);
      if (!tool || !isGopls(tool)) throw Error('This tool has no such command.');
      if (method !== 'setdown/go.modifyTags') return this.goAction(window, file, channel, tool, method, params as Record<string, unknown>).catch(languageFailure);
      // Sent as a command of gopls, which then changes the struct itself.
      const tags = goTagsCommand(file.uri, params as Record<string, unknown>, this.options.registry().options(tool.id).settings ?? tool.settings);
      if (!tags) throw Error('Select the fields of a struct in a Go file.');
      if ('ask' in tags) return tags;
      made = { method: 'workspace/executeCommand', params: tags, notification: false };
    }
    // The script inside a page is coloured by the HTML tool's own request (`html-embedded-tokens.ts`).
    if (running.legend && (method === 'textDocument/semanticTokens/full' || method === 'textDocument/semanticTokens/range')) {
      const range = method.endsWith('/range') ? (params as { range?: Range }).range : undefined;
      try {
        const session = await this.start();
        const answer = await session.host.request('project.request', { workspace: window.workspace, server: channel.server, method: htmlSemanticTokensMethod, params: htmlSemanticTokensParams(file.uri, range) });
        return file.channels.get(id) === channel && channel.version === version ? { data: htmlSemanticTokenData(answer) ?? [] } : null;
      } catch (error) { return languageFailure(error); }
    }
    // A tool's own request (`language-tools.ts`): its name and parameter are made here. A bare
    // address is sent the way a language client sends one: as the only positional parameter.
    const own = made ?? toolMessage(method, params as Record<string, unknown>, file.uri);
    const command = method === 'workspace/executeCommand' || isToolCommand(method) || !!made;
    const requestParams = method in resolveMethods || method === 'workspace/executeCommand' ? running.items.resolve(method, params, origin)
      : own ? (typeof own.params === 'string' ? [own.params] : own.params) : documentRequest(method, params, file.uri);
    if (command && running.command) throw Error('A language command is already running.');
    const controller = new AbortController();
    window.requests.set(requestId, controller);
    if (command) running.command = channel;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const session = await this.start();
      const send = { workspace: window.workspace, server: channel.server, method: own?.method ?? method, params: requestParams };
      if (own?.notification) { await session.host.request('project.notify', send); return null; }
      if (method === 'textDocument/willSaveWaitUntil') {
        const sync = channel.raw.textDocumentSync;
        if (typeof sync !== 'object' || ![1, 2, 3].includes((params as { reason: number }).reason)) return [];
        if (sync.willSave) await session.host.request('project.notify', { ...send, method: 'textDocument/willSave' });
        if (!sync.willSaveWaitUntil) return [];
        // A save never waits long for a tool: its edits are left out when it is slow.
        timer = setTimeout(() => controller.abort(), 1500);
      }
      const revisions = this.revisions(window);
      const result = await session.host.request('project.request', send, undefined, controller.signal);
      for (const edit of proposedEdits(method, result)) editorVersions(edit, revisions);
      return file.channels.get(id) === channel && channel.version === version ? running.items.remember(method, result, origin) : null;
    } catch (error) {
      if (controller.signal.aborted) return method === 'textDocument/willSaveWaitUntil' ? [] : null;
      return languageFailure(error);
    } finally {
      clearTimeout(timer); window.requests.delete(requestId);
      if (command && running.command === channel) running.command = undefined;
    }
  }
  cancel(windowId: number, requestId: string): void { this.windows.get(windowId)?.requests.get(requestId)?.abort(); }
  releaseItems(windowId: number, id: string, handles: string[]): void {
    const window = this.windows.get(windowId), channel = window?.channels.get(id)?.channels.get(id);
    if (window && channel?.server !== undefined) window.servers.get(channel.server)?.items.release(handles, { document: id, generation: channel.generation });
  }
  /** The editor wrote the file. Zed then tells every server of the file that it was saved. */
  saved(windowId: number, id: string): void {
    const window = this.windows.get(windowId), file = window?.channels.get(id), channel = file?.channels.get(id);
    if (!window || !file || !channel || channel.version !== file.revision) return;
    // Each channel reports the same save.
    if (file.saved?.revision === file.revision && Date.now() - file.saved.at < 1000) return;
    file.saved = { revision: file.revision, at: Date.now() };
    void this.session?.then(session => session.host.request('project.saved', { workspace: window.workspace, path: file.path, revision: file.revision })).catch(() => {});
    const tool = this.options.registry().definitions().find(other => other.id === channel.target.tool);
    if (tool && isGopls(tool) && channel.state === 'ready') void this.lintGo(window, file, channel, tool);
  }
  /** vscode-go runs the lint tool of `go.lintTool` after a save (`go-check.ts`). What it finds
   * stands beside what gopls reports, until the file changes and is saved again. */
  private async lintGo(window: Window, file: OpenFile, channel: Channel, tool: LanguageServerDefinition): Promise<void> {
    file.linting?.abort();
    const controller = file.linting = new AbortController(), revision = file.revision;
    const registry = this.options.registry(), settings = registry.options(tool.id).settings ?? tool.settings;
    const note = (text?: string) => this.goNote(window, file, channel, 'go.lint', text);
    try {
      const { env } = await goProjectEnvironment(this.options.directory, file.root, settings, this.goBase());
      const session = await this.session?.catch(() => undefined);
      const run = await goLintOnSave({ file: file.path, project: file.root, settings, env, directory: this.options.directory, signal: controller.signal,
        mayInstall: !session?.offline && registry.automaticInstall(tool.id, file.path), report: note });
      if (controller.signal.aborted || file.linting !== controller || window.files.get(file.path) !== file) return;
      file.linting = undefined;
      if (!run) { if (file.lint) { file.lint = undefined; this.reportGo(window, file, channel); } note(); return; }
      for (const line of run.log.slice(0, 20)) console.warn(`${tool.name} lint: ${line.slice(0, 2000)}`);
      // The lint tool names every file of the package; each open one shows its own.
      for (const [name, diagnostics] of run.diagnostics) {
        const other = window.files.get(canonicalPath(name)); if (!other || other === file) continue;
        other.lint = { diagnostics: diagnostics.slice(0, 2000), revision: other.revision };
        for (const bound of other.channels.values()) if (bound.target.tool === tool.id && bound.state === 'ready') this.reportGo(window, other, bound);
      }
      file.lint = { diagnostics: (run.diagnostics.get(file.path) ?? [...run.diagnostics].find(([name]) => canonicalPath(name) === file.path)?.[1] ?? []).slice(0, 2000), revision };
      this.reportGo(window, file, channel);
      // A lint tool that is not on this computer is named in the document panel, with how to install it.
      note(run.notes[0]);
    } catch (error) { if (!controller.signal.aborted) console.warn(`Could not run the Go lint tool for ${file.path}`, error); }
  }
  /** A standing line of the document panel about Go, or its removal. */
  private goNote(window: Window, file: OpenFile, channel: Channel, key: string, text?: string): void {
    const running = channel.server === undefined ? undefined : window.servers.get(channel.server);
    if (!running || (text ? running.notes.get(key) === text : !running.notes.has(key))) return;
    if (text) running.notes.set(key, text.replace(/\s+/g, ' ').trim().slice(0, 1000)); else running.notes.delete(key);
    if (file.channels.get(channel.id) === channel) this.context(window, file, channel);
  }
  /** gopls' own diagnostics with the lint tool's after them, without the ones gopls reports too (goCheck.ts). */
  private reportGo(window: Window, file: OpenFile, channel: Channel): void {
    const own = file.reported ?? [], lint = file.lint?.revision === file.revision ? withoutDuplicates(file.lint.diagnostics, own) : [];
    this.options.emit(window.state, { type: 'diagnostics', server: channel.target.tool, id: channel.id, generation: channel.generation, version: file.revision, diagnostics: [...own, ...lint] });
  }
  /** "Go: Choose Go Environment" and the `go test` of a lens (`go-project.ts`). */
  private async goAction(window: Window, file: OpenFile, channel: Channel, tool: LanguageServerDefinition, method: string, params: Record<string, unknown>): Promise<unknown> {
    const settings = this.options.registry().options(tool.id).settings ?? tool.settings, base = this.goBase();
    if (method === 'setdown/go.testCommand') {
      const { env } = await goProjectEnvironment(this.options.directory, file.root, settings, base);
      const test = goTestProgram(params.arguments, settings, file.root, env);
      // The chosen Go is not on the terminal's PATH, so the terminal is told it.
      return test ? { ...test, env: { ...test.env, ...(env.PATH !== base.PATH && env.PATH ? { PATH: env.PATH } : {}) } } : null;
    }
    if (method === 'setdown/go.versions') return goVersionList(this.options.directory, file.root, settings, base, this.options.download);
    if (method === 'setdown/go.chooseVersion') {
      const session = await this.session?.catch(() => undefined);
      if (session?.offline && typeof params.version === 'string') throw Error('Downloads are turned off, so a Go release cannot be downloaded.');
      const changed = await chooseGoVersion(this.options.directory, file.root, settings, base, params, message => this.goNote(window, file, channel, 'go.version', message), this.options.download)
        .finally(() => this.goNote(window, file, channel, 'go.version'));
      // gopls is started again with the other Go, as the extension restarts it.
      if (changed) await this.restart(window.state.webContentsId, file.path, tool.id);
      return changed;
    }
    throw Error('This tool has no such command.');
  }
  close(windowId: number, id: string): void {
    this.opening.delete(`${windowId}:${id}`);
    const window = this.windows.get(windowId), file = window?.channels.get(id), channel = file?.channels.get(id);
    if (!window || !file || !channel) return;
    file.channels.delete(id); window.channels.delete(id);
    channel.waiting?.failed(Error('Language document closed during initialization.'));
    const running = channel.server === undefined ? undefined : window.servers.get(channel.server);
    running?.items.forget(id);
    if (running?.command === channel) running.command = undefined;
    if (file.channels.size) return;
    clearTimeout(file.resync); window.files.delete(file.path);
    // After the open has been answered, so that Zed closes the copy it made for it.
    void file.opened.catch(() => {}).then(() => this.session).then(session => session?.host.request('project.close', { workspace: window.workspace, path: file.path })).catch(() => {});
  }
  editApplied(state: WindowState, requestId: string, applied: boolean, failureReason?: string): boolean {
    const edit = this.edits.get(requestId);
    if (!edit) return false;
    if (edit.window.state === state) edit.finish({ applied, failureReason: typeof failureReason === 'string' ? failureReason.slice(0, 1000) : undefined });
    return true;
  }
  /** A server may change documents only while a command the person started on it runs, and only
   * text inside its project. The editor applies the edit to its own documents and answers. */
  private proposeEdit(window: Window, file: OpenFile, channel: Channel, edit: WorkspaceEdit, versions?: { id: string; generation: string; version: number }[]): Promise<ApplyWorkspaceEditResult> {
    if (file.channels.get(channel.id) !== channel) return Promise.resolve({ applied: false, failureReason: 'No active user command accepts edits.' });
    try {
      if (JSON.stringify(edit).length > 8 * 1024 * 1024) throw Error('Workspace edit is too large.');
      const uris = edit.documentChanges ? edit.documentChanges.map(change => {
        if (!('textDocument' in change)) throw Error('File operations are not supported by this edit transaction.');
        return change.textDocument.uri;
      }) : Object.keys(edit.changes ?? {});
      if (uris.length > 200) throw Error('Invalid workspace edit.');
      for (const uri of uris) {
        const parsed = new URL(uri);
        if (parsed.protocol !== 'file:' || parsed.search || parsed.hash || !isInside(file.root, canonicalPath(fileURLToPath(uri))))
          throw Error('Workspace edits must remain inside the language workspace.');
      }
    } catch (error) { return Promise.resolve({ applied: false, failureReason: String(error) }); }
    return new Promise(resolve => {
      const requestId = randomUUID();
      const timer = setTimeout(() => finish({ applied: false, failureReason: 'Editor did not accept the edit in time.' }), 10_000);
      const finish = (result: ApplyWorkspaceEditResult) => { clearTimeout(timer); this.edits.delete(requestId); resolve(result); };
      this.edits.set(requestId, { window, finish });
      this.options.emit(window.state, { type: 'apply-edit', id: channel.id, generation: channel.generation, requestId, versions, edit });
    });
  }
  /** Files the person created, renamed or deleted in Setdown. Zed announces only its own file operations. */
  async fileOperation(state: WindowState, operation: LanguageFileOperation, phase: 'will' | 'did'): Promise<void> {
    const window = this.windows.get(state.webContentsId), session = await this.session?.catch(() => undefined);
    if (!window || !session) return;
    const method = fileOperationMethod(operation, phase);
    const key = method.slice('workspace/'.length).replace(/Files$/, '') as keyof NonNullable<NonNullable<ServerCapabilities['workspace']>['fileOperations']>;
    for (const [server] of window.servers) {
      const bound = [...window.files.values()].flatMap(file => [...file.channels.values()].filter(channel => channel.state === 'ready' && channel.server === server).map(channel => ({ file, channel })));
      const registered = bound[0]?.channel.raw.workspace?.fileOperations?.[key] as FileOperationRegistrationOptions | undefined;
      if (!registered || !Array.isArray(registered.filters)) continue;
      const params = filteredFileOperation(operation, [registered]);
      if (!params.files.length) continue;
      const send = { workspace: window.workspace, server, method, params };
      if (phase === 'did') { await session.host.request('project.notify', send).catch(() => {}); continue; }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2000);
      const revisions = this.revisions(window);
      const edit = await session.host.request<WorkspaceEdit | null>('project.request', send, undefined, controller.signal).finally(() => clearTimeout(timer));
      if (!edit) continue;
      editorVersions(edit, revisions);
      const versions = bound.map(({ channel }) => ({ id: channel.id, generation: channel.generation, version: channel.version }));
      const result = await this.proposeEdit(window, bound[0].file, bound[0].channel, edit, versions);
      if (!result.applied) throw Error(result.failureReason ?? 'Could not apply language file-operation edits.');
    }
  }
  /** Restarts the servers of one file; the editor then binds the file again. */
  async restart(windowId: number, file: string, tool?: string): Promise<void> {
    const window = this.windows.get(windowId), opened = window?.files.get(file), session = await this.session?.catch(() => undefined);
    if (!window || !opened || !session) return;
    const channels = [...opened.channels.values()].filter(channel => !tool || channel.target.tool === tool);
    for (const channel of channels) this.supervisor.reset(this.recoveryKey(window, channel.target.server));
    const names = [...new Set(channels.map(channel => channel.target.server))];
    for (const name of names) window.failed.delete(name);
    const waiting = channels.filter(channel => channel.state !== 'ready');
    // A restart is how a person says that something outside changed: a Go or a gopls was installed.
    for (const id of new Set(channels.map(channel => channel.target.tool))) {
      const definition = this.options.registry().definitions().find(other => other.id === id);
      if (!definition) continue;
      this.unprepare(id);
      await this.prepareTool(session, definition, opened.root, this.preparing(window.state, { id, name: definition.name }, this.documents(opened, channel => channel.target.tool === id)))
        .catch(error => console.warn(`Could not prepare ${definition.name}`, error));
    }
    if (names.length) await session.host.request('project.restart', { workspace: window.workspace, path: file, names });
    // A running server announces its own end, which binds its documents again.
    if (waiting.length) this.rebind(window, opened, tool);
  }
  sessions(windowId: number, tool: string): LanguageCatalogEntry['sessions'] {
    const window = this.windows.get(windowId), seen = new Set<string>(), result: LanguageCatalogEntry['sessions'] = [];
    for (const file of window?.files.values() ?? []) for (const channel of file.channels.values()) {
      const key = `${channel.server ?? channel.target.server}:${file.root}`;
      if (channel.target.tool !== tool || seen.has(key)) continue;
      seen.add(key);
      result.push({ root: file.root, rootReason: file.rootReason, state: channel.state, message: channel.message, issue: channel.issue, features: featureNames(channel.capabilities),
        context: [], logs: [], progress: [...(channel.server === undefined ? undefined : window!.servers.get(channel.server))?.progress.values() ?? []] });
    }
    return result;
  }
  async disposeWindow(windowId: number): Promise<void> {
    const window = this.windows.get(windowId); if (!window) return;
    this.windows.delete(windowId);
    for (const controller of window.requests.values()) controller.abort();
    for (const edit of this.edits.values()) if (edit.window === window) edit.finish({ applied: false, failureReason: 'Language session closed.' });
    for (const file of window.files.values()) { clearTimeout(file.resync); for (const channel of file.channels.values()) channel.waiting?.failed(Error('Language session closed.')); }
    clearTimeout(window.activity);
    const session = await this.session?.catch(() => undefined);
    // Answered once the window's servers have shut down, or after the host's own limit.
    await session?.host.request('project.dispose', { workspace: window.workspace }).catch(() => {});
  }
  get running(): boolean { return this.windows.size > 0; }
  async dispose(): Promise<void> {
    await Promise.all([...this.windows.keys()].map(id => this.disposeWindow(id)));
    this.disposed = true; this.supervisor.dispose();
    if (this.watching) unwatchFile(this.userSettings, this.userSettingsChanged);
    const session = await this.session?.catch(() => undefined);
    if (session) { session.stop(); session.host.dispose(); }
  }
}
