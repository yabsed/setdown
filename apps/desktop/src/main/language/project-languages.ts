import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unwatchFile, watchFile } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ApplyWorkspaceEditResult, Diagnostic, FileOperationRegistrationOptions, ServerCapabilities, TextDocumentContentChangeEvent, WorkspaceEdit } from 'vscode-languageserver-protocol';
import { languageMethods, type LanguageCapabilities, type LanguageCatalogEntry, type LanguageConnection, type LanguageDocument, type LanguageEvent, type LanguageIssue, type LanguageMethod, type LanguageUnavailable } from '../../protocol/language';
import { featureNames, isDocumentMethod, resolveMethods, type LanguageRefresh } from '../../protocol/language-features';
import { languageFailure } from '../../protocol/language-request';
import type { AnalysisObservation } from '../../core/document/analysis-context';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';
import { fileOperationMethod, filteredFileOperation, type LanguageFileOperation } from './file-operations';
import { failureLine, runtimeIssue } from './language-issue';
import { LanguagePackageStore, type ExtensionPackage } from './language-package-store';
import { LanguageServiceSupervisor } from './language-supervisor';
import type { ServerRegistry } from './server-registry';
import { ServerItems } from './server-items';
import { ZedLanguageHost, type HostEvent } from './zed-language-host';
import { plainLanguages, projectEngineTools, projectFolder, setdownChoices, setdownDefaults, zedLanguage, zedNames, type BundledProgram, type ZedNames } from './zed-settings';

/** The tool a channel of the editor asked for, and the server Zed runs for it. */
export type ProjectTarget = { tool: string; toolName: string; server: string; primary: boolean; languageId: string };
type Channel = { id: string; generation: string; version: number; target: ProjectTarget; server?: number; raw: ServerCapabilities;
  capabilities: LanguageCapabilities; state: 'starting' | 'ready' | 'failed'; message?: string; issue?: LanguageIssue;
  /** Zed said it is fetching the tool, which can take many minutes. */
  preparing?: boolean;
  waiting?: { changed(): void; failed(error: Error): void } };
/** One file of one window. Every channel of the editor (the language's own tool and each
 * helper tool) reads the same text, so Zed holds one copy and each change is applied once. */
type OpenFile = { path: string; uri: string; owner: string; root: string; rootReason: string; revision: number; channels: Map<string, Channel>;
  opened: Promise<{ language?: string; servers: string[] }>; saved?: { revision: number; at: number }; resync?: ReturnType<typeof setTimeout> };
type Running = { name: string; items: ServerItems; command?: Channel; progress: Map<string, string> };
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

function failureIssue(message: string, offline: boolean): LanguageIssue {
  const runtime = runtimeIssue(message); if (runtime) return runtime;
  if (offline) return { kind: 'downloads-off' };
  const detail = failureLine(message.split('-- stderr --').at(-1) ?? message);
  return /download|fetch|http|network|dns|connect|resolve host|certificate/i.test(message) ? { kind: 'download-failed', ...(detail ? { detail } : {}) }
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
      const defaults = setdownDefaults(session.names, definition, this.bundled());
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
    await this.applySettings(session);
  }
  private async restartHost(reason: string): Promise<void> {
    const session = await this.session?.catch(() => undefined);
    this.session = undefined;
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
      if (!folder.single && !window.folders.has(folder.path)) {
        window.folders.add(folder.path);
        void host.request('project.folder', { workspace, root: folder.path }).catch(() => window.folders.delete(folder.path));
      }
      const created: OpenFile = { path: file, uri: pathToFileURL(file).href, owner, root: folder.path, rootReason: folder.reason, revision: document.version, channels: new Map(),
        // The document's language is Setdown's: the one the person sees and can change, and the
        // one that led to this tool. Zed is told it where it has a name for it.
        opened: host.request('project.open', { workspace, path: file, text: document.text, revision: document.version, language: zedLanguage(target.languageId) }) };
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
      channel.state = 'ready'; channel.capabilities = channelCapabilities(channel.raw);
      this.supervisor.reset(this.recoveryKey(window, channel.target.server));
      this.options.emit(state, { type: 'status', state: 'ready', documents: [{ id: channel.id, generation: channel.generation }] });
      // What Zed already knows about this file reaches a channel that was bound after it was said.
      void host.request('project.diagnostics', { workspace, path: file }).catch(() => {});
      return { messages: [], analysis: this.observation(current, channel, running), name: channel.target.toolName, uri: current.uri, capabilities: channel.capabilities,
        server: channel.target.tool, context: [`Project: ${current.root}`, `Root: ${current.rootReason}`] };
    } catch (error) {
      if (!alive()) throw error;
      const message = String(error instanceof Error ? error.message : error);
      channel.state = 'failed'; channel.message = message; channel.issue = failureIssue(message, session.offline);
      window.failed.add(channel.target.server);
      const repeats = channel.issue.kind === 'runtime' || channel.issue.kind === 'downloads-off';
      const recovering = repeats ? undefined : this.supervisor.schedule(this.recoveryKey(window, channel.target.server), () => this.rebind(window, current, channel.target.tool));
      channel.message = `${message}\n${recovering ? `Reconnecting (${recovering.attempt}/3)…` : repeats ? 'It will not start until its setup changes.' : 'Automatic recovery paused after repeated failures. Restart this service to try again.'}`;
      this.options.emit(state, { type: 'status', state: 'failed', message: channel.message, issue: channel.issue, server: named(),
        recovery: { retrying: !!recovering, attempt: recovering?.attempt }, documents: [{ id: channel.id, generation: channel.generation }] });
      throw Error(channel.message);
    }
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
            if (!running) window.servers.set(found.server, running = { name, items: new ServerItems(), progress: new Map() });
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
        if (file && event.revision === file.revision) for (const channel of file.channels.values()) if (channel.state === 'ready' && channel.server === event.server)
          this.options.emit(window.state, { type: 'diagnostics', server: channel.target.tool, id: channel.id, generation: channel.generation, version: file.revision, diagnostics: event.diagnostics as Diagnostic[] });
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
              context: [`Project: ${file.root}`, `Root: ${file.rootReason}`, ...active?.progress.values() ?? []] }); }
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
      case 'project.diverged': {
        // Zed changed its copy by itself, usually by reading the file again after it changed on
        // disk. The editor normally sends the same text a moment later; if it does not, the
        // document is bound again, which sends the editor's text whole.
        const file = window.files.get(String(event.path));
        if (file && !file.resync) file.resync = setTimeout(() => { file.resync = undefined; this.resync(window, file); }, 1500);
        break;
      }
    }
  }
  private async capabilitiesChanged(host: ZedLanguageHost, window: Window, server: number): Promise<void> {
    for (const file of window.files.values()) {
      const channels = [...file.channels.values()].filter(channel => channel.state === 'ready' && channel.server === server);
      if (!channels.length) continue;
      const { servers } = await host.request<{ servers: { server: number; capabilities: ServerCapabilities }[] }>('project.servers', { workspace: window.workspace, path: file.path }).catch(() => ({ servers: [] }));
      const found = servers.find(candidate => candidate.server === server); if (!found) continue;
      for (const channel of channels) if (file.channels.get(channel.id) === channel && JSON.stringify(channel.raw) !== JSON.stringify(found.capabilities)) {
        channel.raw = found.capabilities; channel.capabilities = channelCapabilities(found.capabilities);
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
    if (changes.some(change => !('range' in change))) { clearTimeout(file.resync); file.resync = undefined; }
    const session = await this.start();
    await session.host.request('project.change', { workspace: window.workspace, path: file.path, revision: version, changes }).catch(error => {
      console.warn('Zed could not apply a document change; sending the document again.', String(error));
      this.resync(window, file);
    });
  }
  async request(windowId: number, id: string, version: number, requestId: string, method: LanguageMethod, params: unknown): Promise<unknown> {
    const { window, file, channel } = this.channel(windowId, id);
    const running = channel.server === undefined ? undefined : window.servers.get(channel.server);
    if (!running || channel.state !== 'ready' || channel.version !== version || !languageMethods.includes(method) || method === 'textDocument/diagnostic'
      || typeof requestId !== 'string' || requestId.length > 128 || window.requests.has(requestId)
      || window.requests.size >= 64 || !params || typeof params !== 'object' || JSON.stringify(params).length > 4 * 1024 * 1024) throw Error('Invalid or stale language request.');
    const origin = { document: id, generation: channel.generation, version };
    const command = method === 'workspace/executeCommand';
    const requestParams = method in resolveMethods || command ? running.items.resolve(method, params, origin)
      : isDocumentMethod(method) ? { ...params, textDocument: { uri: file.uri } } : params;
    if (command && running.command) throw Error('A language command is already running.');
    const controller = new AbortController();
    window.requests.set(requestId, controller);
    if (command) running.command = channel;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const session = await this.start();
      const send = { workspace: window.workspace, server: channel.server, method, params: requestParams };
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
