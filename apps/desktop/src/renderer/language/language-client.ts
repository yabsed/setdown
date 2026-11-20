import type { AnalysisObservation } from '../../core/document/analysis-context';
import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';
import type { DocumentContent as DocumentTab } from '../../core/workspace/document-store';
import type { LanguageApi, LanguageAutoInsert, LanguageCapabilities, LanguageConnection, LanguageUnavailable, LanguageMethod } from '../../protocol/language';
import { textSynchronization } from '../../protocol/language';
import { languageSupport } from '../../core/document/language-support';
import { installNavigationFeatures } from './language-navigation-features';
import { installSemanticFeatures } from './language-semantic-features';
import { codeActionRunner, installEditFeatures } from './language-edit-features';
import { installAutoInsertion } from './language-auto-insert';
import { installPullDiagnostics, type DiagnosticCache } from './language-diagnostics';
import { noCancellation, type LanguageFeatureContext } from './language-feature-context';
import type { LanguageRefresh } from '../../protocol/language-features';
import { completionDefaults, completion, fromRange, markdown, marker, toPosition, toRange } from './language-conversion';
import { requestLanguageResult, LanguageRequestError, languageItemHandles } from '../../protocol/language-request';
import { completionContext as toCompletionContext } from '../../protocol/language-completion';
import { ownLanguageDiagnostics } from './builtin-diagnostics';
import { diagnosticsFor, type DiagnosticStore } from './diagnostic-store';
import { documentSupport, type ProviderSupport, type ToolAction, type ToolEnvironment } from './document-support';
import { environmentAction, problemsEmpty } from './document-presentation';
import { featureNames } from '../../protocol/language-features';
import { isUnresolvedSymptom, mayEdit, unresolvedSymptoms, type ToolFamily } from '../../protocol/language-tools';
import { clientCommandHandlers, commandLine, goChoice, goEnvironment, plainSnippet, toolCommands, toolEnvironmentRows, yamlEnvironment, type ToolCommandContext } from './tool-commands';
import { toolCommandList } from './tool-command-list';
import { hereProbes } from './language-here';
import type { HereItem } from './here-menu';

type Binding = { /** How many of the tool's diagnostics say that something the file brings in was not found. Kept
   * from one report of the tool to its next, so the status does not blink while a person types. */
  unresolved?: number; runCodeAction?: ReturnType<typeof codeActionRunner>; autoInsert?: LanguageAutoInsert; companion?: boolean; tool?: ToolFamily; issue?: import('../../protocol/language').LanguageIssue; preparing?: boolean; recovery?: import('../../protocol/language').LanguageRecovery; messages?: import('../../protocol/language').LanguageServerMessage[]; analysis?: AnalysisObservation; serverName?: string; hasDiagnostics?: boolean; id: string; context?: string[]; unavailable?: 'missing'; lease: ReturnType<DiagnosticStore['lease']>; diagnosticChannels: Map<string, L.Diagnostic[]>; capabilities: LanguageCapabilities; diagnosticCache: DiagnosticCache; diagnostics: L.Diagnostic[]; refresh: Map<LanguageRefresh, Set<() => void>>; serverId: string; tab: DocumentTab; model: M.editor.ITextModel; path: string; generation: string; connected: Promise<LanguageConnection | LanguageUnavailable>;
  uri?: string; sync?: ReturnType<typeof textSynchronization>; queue: Promise<unknown>; listener: M.IDisposable; providers: M.IDisposable[]; failed: boolean; state: 'starting' | 'ready' | 'failed' | 'unavailable'; message?: string };
export type LanguageOptions = {
  port: LanguageApi;
  provider?: string;
  languageId?(model: M.editor.ITextModel): string | undefined;
  filterCapabilities?(model: M.editor.ITextModel, server: string, capabilities: LanguageCapabilities): LanguageCapabilities;
  documentStatus?(model: M.editor.ITextModel, status?: ProviderSupport): void;
  route?: typeof languageSupport;
  prepare(path: string): Promise<{ tab: DocumentTab; model: M.editor.ITextModel }>;
  open(path: string, selection: M.IRange | M.IPosition | undefined): Promise<void>;
  /** Starts a command line in a new terminal of the window. Absent where the window has none. */
  runProgram?(commandLine: string, cwd?: string): Promise<void>;
  /** Opens a page a tool points to (documentation). */
  openLink?(href: string): Promise<void>;
  /** Opens a document that a tool's answer was kept as, beside the code. */
  openAnswer?(file: string): Promise<void>;
  /** Opens the panel behind the language name, on the page where a choice is made. */
  inspect?(model: M.editor.ITextModel, page: 'environment' | 'tool-environment', item?: string): void;
  status(state: string, message?: string): void;
};

/** Scoped standalone providers. No replacement models or second document store. */
export class LanguageClient {
  private readonly bindings = new Map<M.editor.ITextModel, Binding>();
  private readonly disposables: M.IDisposable[] = [];
  private readonly completionItems = new WeakMap<M.languages.CompletionItem, { binding: Binding; version: number; item: L.CompletionItem; lease: { handles: Set<string>; disposed: boolean } }>();
  private readonly requests = new Map<string, Binding>();
  private restarting: Promise<void> | undefined;
  private restartDocuments: Map<M.editor.ITextModel, DocumentTab> | undefined;
  private disposed = false;
  private applying = false;
  private resultsView?: M.IDisposable;
  private readonly commandEdits = new Map<Binding, Map<M.editor.ITextModel, number>>();
  private messageTurn = 0;
  constructor(private readonly api: typeof M, private readonly options: LanguageOptions) {
    this.disposables.push({ dispose: options.port.onEvent(event => {
      if (event.type === 'context') {
        const binding = [...this.bindings.values()].find(b => b.id === event.id && b.generation === event.generation);
        if (binding) { binding.context = event.context; binding.messages = event.messages; if (event.analysis) binding.analysis = { ...event.analysis, analysis: event.analysis.progress.length ? 'working' : binding.analysis?.analysis === 'observed' ? 'observed' : 'waiting', freshness: binding.analysis?.freshness ?? 'none' }; this.publishStatus(); }
        return;
      }
      if (event.type === 'refresh') {
        for (const binding of this.bindings.values()) if (event.documents.some(d => d.id === binding.id && d.generation === binding.generation))
          for (const listener of binding.refresh.get(event.feature) ?? []) listener();
        return;
      }
      if (event.type === 'capabilities') {
        const binding = [...this.bindings.values()].find(b => b.id === event.id && b.generation === event.generation);
        if (binding && !binding.failed) this.installProviders(binding, event.capabilities);
        return;
      }
      if (event.type === 'apply-edit') {
        const binding = [...this.bindings.values()].find(b => b.id === event.id && b.generation === event.generation);
        let versions = binding && this.commandEdits.get(binding);
        if (event.versions) {
          versions = new Map();
          for (const document of event.versions) {
            const target = [...this.bindings.values()].find(b => b.id === document.id && b.generation === document.generation);
            if (target) versions.set(target.model, document.version);
          }
        }
        void (async () => {
          try {
            if (!binding || !versions) throw Error('No active editor command accepts edits.');
            if (event.versions?.some(document => ![...this.bindings.values()].some(b => b.id === document.id && b.generation === document.generation))) throw Error('Documents closed during the file operation.');
            const edit = await this.workspaceEdit(event.edit, versions, noCancellation, true);
            if (this.bindings.get(binding.model) !== binding) throw Error('Language session closed.');
            this.applyEdit(edit);
            // A command may send several sequential applyEdit requests.
            for (const model of versions.keys()) versions.set(model, model.getVersionId());
            await Promise.all([...this.bindings.values()].map(b => b.queue));
            this.options.port.editApplied(event.requestId, true);
          } catch (error) { this.options.port.editApplied(event.requestId, false, String(error)); }
        })();
        return;
      }
      if (event.type === 'status') {
        const affected = [...this.bindings.values()].filter(binding => event.documents.some(document => document.id === binding.id && document.generation === binding.generation));
        if (!affected.length) return;
        for (const binding of affected) {
          binding.state = event.state; binding.message = event.message; binding.recovery = event.recovery; binding.issue = event.issue; binding.preparing = event.preparing;
          if (event.server) { this.setServer(binding, event.server.id); binding.serverName = event.server.name; }
        }
        this.publishStatus();
        if (event.state === 'failed') for (const binding of affected) {
          binding.failed = true; binding.diagnostics = []; binding.unresolved = undefined; binding.diagnosticChannels.clear(); binding.lease.clear();
          for (const provider of binding.providers) provider.dispose(); binding.providers = [];
        }
        this.publishStatus(); return;
      }
      if (event.type !== 'diagnostics') return;
      const binding = [...this.bindings.values()].find(binding => binding.id === event.id);
      if (binding && binding.generation === event.generation && !binding.failed && !binding.model.isDisposed() && binding.model.getVersionId() === event.version) {
        if (event.server) this.setServer(binding, event.server);
        this.diagnostics(binding, event.diagnostics, 'push', event.unversioned ? undefined : event.version);
      }
    }) });
    this.disposables.push(api.editor.registerEditorOpener({ openCodeEditor: async (_source, uri, selection) => {
      if (uri.scheme !== 'file') return false;
      const binding = [...this.bindings.values()].find(binding => binding.model.uri.toString() === uri.toString());
      await options.open(binding?.path ?? uri.fsPath, selection);
      return true;
    } }));
  }
  bind(tab: DocumentTab, model: M.editor.ITextModel): void {
    if (this.disposed || model.isDisposed()) return;
    if (this.restarting) { this.restartDocuments?.set(model, tab); return; }
    const old = this.bindings.get(model);
    if (old?.path === tab.document.path && !tab.document.isUntitled && (this.options.route ?? languageSupport)(tab.document.path)) return;
    this.unbind(model);
    if (tab.document.isUntitled || model.isDisposed() || !(this.options.route ?? languageSupport)(tab.document.path)) return;
    const generation = crypto.randomUUID();
    diagnosticsFor(this.api).setResource(model, tab.document.path);
    const id = this.options.provider ? `${tab.id}:${this.options.provider}` : tab.id;
    const connected = this.options.port.open({ id, generation, path: tab.document.path, server: this.options.provider, languageId: this.options.languageId?.(model),
      text: model.getValue(), version: model.getVersionId() });
    const binding: Binding = { id, lease: diagnosticsFor(this.api).lease(model, (this.options.route ?? languageSupport)(tab.document.path)!.server, generation), diagnosticChannels: new Map(), capabilities: {}, diagnosticCache: new Map(), diagnostics: [], refresh: new Map(), serverId: (this.options.route ?? languageSupport)(tab.document.path)!.server, tab, model, path: tab.document.path, generation, connected, queue: connected,
      failed: false, state: 'starting', providers: [], listener: { dispose() {} } };
    this.bindings.set(model, binding);
    const fail = (error: unknown) => {
      if (this.bindings.get(model) !== binding) return;
      binding.failed = true; binding.state = 'failed'; binding.preparing = false; binding.message = String(error); binding.lease.clear();
      for (const provider of binding.providers) provider.dispose(); binding.providers = []; this.publishStatus();
    };
    // A failed initialization is a language-service state, not a rejected
    // editor/save queue. Keep ordinary editing usable while restart is offered.
    binding.queue = connected.then(connection => {
      if (this.bindings.get(model) !== binding) return;
      if ('unavailable' in connection) {
        binding.state = 'unavailable'; binding.unavailable = connection.unavailable; binding.message = connection.message; binding.issue = connection.issue; binding.preparing = false;
        if (connection.server) { this.setServer(binding, connection.server.id); binding.serverName = connection.server.name; }
        binding.listener.dispose(); this.publishStatus(); return;
      }
      binding.uri = connection.uri; binding.state = 'ready'; binding.issue = undefined; binding.preparing = false; binding.context = connection.context; binding.analysis = connection.analysis; binding.messages = connection.messages; binding.serverName = connection.name;
      binding.autoInsert = connection.autoInsert; binding.companion = connection.companion; binding.tool = connection.tool;
      this.setServer(binding, connection.server ?? binding.serverId);
      binding.sync = textSynchronization(connection.capabilities);
      if (this.bindings.get(model) === binding && !binding.failed) this.installProviders(binding, connection.capabilities);
    }).catch(fail);
    binding.listener = model.onDidChangeContent(event => {
      if (!this.applying) this.cancel(binding);
      binding.diagnostics = []; binding.diagnosticChannels.clear(); binding.lease.clear();
      if (binding.analysis && binding.analysis.freshness !== 'stale') { binding.analysis = { ...binding.analysis, analysis: 'working', freshness: 'stale' }; this.publishStatus(); }
      const version = model.getVersionId();
      // Monaco reports simultaneous edits against the old model. Descending
      // offsets turn them into LSP's sequential edits, including CRLF and emoji.
      const changes = [...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset)
        .map(change => ({ range: toRange(change.range), text: change.text }));
      // Initialization may still select Full sync; capture this revision, never later text.
      const fullText = !binding.sync || binding.sync.change === 1 || event.isFlush || event.isEolChange ? model.getValue() : undefined;
      binding.queue = binding.queue.then(() => {
        if (this.bindings.get(model) === binding && !binding.failed && binding.state !== 'unavailable')
          return this.options.port.change(binding.id, version, binding.sync?.change === 0 ? []
            : binding.sync?.change === 1 || event.isFlush || event.isEolChange ? [{ text: fullText! }] : changes);
      }).catch(fail);
      for (const other of this.bindings.values()) if (other !== binding && other.capabilities.diagnosticProvider?.interFileDependencies)
        for (const listener of other.refresh.get('diagnostic') ?? []) listener();
    });
  }
  unbind(model: M.editor.ITextModel, restarting = false): void {
    if (!restarting) this.restartDocuments?.delete(model);
    const binding = this.bindings.get(model);
    if (!binding) return;
    this.bindings.delete(model); binding.listener.dispose(); this.cancel(binding);
    for (const provider of binding.providers) provider.dispose();
    this.publishStatus();
    binding.lease.dispose(); this.options.documentStatus?.(model, undefined);
    this.options.port.close(binding.id);
  }
  async beforeSave(model: M.editor.ITextModel, reason: 1 | 2 = 1): Promise<void> {
    const binding = this.bindings.get(model);
    // Saving must never wait for a server/toolchain that is still initializing.
    if (!binding || !binding.sync || binding.failed || binding.state === 'unavailable') return;
    const versions = this.snapshot();
    const edits = await this.request<L.TextEdit[]>(model, 'textDocument/willSaveWaitUntil', { reason }, noCancellation);
    if (!edits?.length || !binding.uri) return;
    try { this.applyEdit(await this.workspaceEdit({ changes: { [binding.uri]: edits } }, versions, noCancellation)); }
    catch (error) { console.warn('Language save edits ignored:', error); }
  }
  saved(model: M.editor.ITextModel, text = model.getValue()): void {
    const binding = this.bindings.get(model);
    if (binding) void binding.queue.then(() => {
      if (this.bindings.get(model) === binding && !binding.failed && binding.state !== 'unavailable') this.options.port.saved(binding.id, text);
    });
  }
  private cancel(binding: Binding): void {
    for (const [id, owner] of this.requests) if (owner === binding) this.options.port.cancel(id);
  }
  /** `strict`: a refusal of the tool is thrown with its own words instead of being logged. */
  private async request<T>(model: M.editor.ITextModel, method: LanguageMethod, params: unknown, token: M.CancellationToken, strict = false): Promise<T | null> {
    const binding = this.bindings.get(model);
    if (!binding || binding.failed || token.isCancellationRequested) return null;
    const version = model.getVersionId();
    const commandVersions = method === 'workspace/executeCommand' || mayEdit(method) ? this.snapshot() : undefined;
    await binding.queue;
    if (this.bindings.get(model) !== binding || model.getVersionId() !== version || binding.failed || token.isCancellationRequested) return null;
    const id = crypto.randomUUID();
    this.requests.set(id, binding);
    const cancel = token.onCancellationRequested(() => this.options.port.cancel(id));
    try {
      if (commandVersions) this.commandEdits.set(binding, commandVersions);
      const result = await requestLanguageResult<T>(method, () => this.options.port.request(binding.id, version, id, method, params),
        () => this.bindings.get(model) === binding && !binding.failed && !model.isDisposed() && model.getVersionId() === version, token);
      return this.bindings.get(model) === binding && !model.isDisposed() && model.getVersionId() === version
        && !token.isCancellationRequested ? result as T : null;
    } catch (error) {
      if (error instanceof LanguageRequestError && [-32800, -32801, -32802].includes(error.code)) return null;
      if (strict && error instanceof LanguageRequestError) throw error;
      if (!token.isCancellationRequested && !model.isDisposed() && model.getVersionId() === version && !binding.failed)
        console.warn('Language request failed:', method, error);
      return null;
    } finally { cancel.dispose(); this.requests.delete(id); if (commandVersions) this.commandEdits.delete(binding); }
  }
  invalidate(servers: string[], documents?: Array<{ id: string; generation: string }>, roots?: string[], retainedDocuments?: Array<{ id: string; generation: string }>): void {
    const inside = (file: string, root: string) => { file = file.replaceAll('\\', '/'); root = root.replaceAll('\\', '/').replace(/\/$/, ''); return file === root || file.startsWith(root + '/'); };
    for (const binding of [...this.bindings.values()]) if (!retainedDocuments?.some(document => document.id === binding.id && document.generation === binding.generation) && (!roots || roots.some(root => inside(binding.path, root))) && servers.includes(binding.serverId) && (!documents || documents.some(document => document.id === binding.id && document.generation === binding.generation))) this.unbind(binding.model);
  }
  retryUnavailable(): void {
    for (const binding of [...this.bindings.values()]) if (binding.state === 'unavailable' || binding.state === 'failed') {
      this.unbind(binding.model);
      if (!binding.model.isDisposed()) this.bind(binding.tab, binding.model);
    }
  }
  async restart(): Promise<void> {
    if (this.restarting) return this.restarting;
    const documents = [...this.bindings.values()];
    this.restartDocuments = new Map(documents.map(binding => [binding.model, binding.tab]));
    for (const binding of documents) this.unbind(binding.model, true);
    this.restarting = this.options.port.restart().finally(() => { this.restarting = undefined; });
    try { await this.restarting; }
    catch (error) { this.options.status('failed', String(error)); return; }
    const wanted = this.restartDocuments;
    this.restartDocuments = undefined;
    if (!this.disposed) for (const [model, tab] of wanted ?? []) if (!model.isDisposed()) this.bind(tab, model);
  }
  dispose(): void {
    this.disposed = true;
    this.restartDocuments?.clear(); this.resultsView?.dispose();
    for (const model of this.bindings.keys()) this.unbind(model);
    for (const disposable of this.disposables) disposable.dispose();
  }
  private publishStatus(): void {
    const bindings = [...this.bindings.values()];
    for (const binding of bindings) this.options.documentStatus?.(binding.model, {
      id: binding.serverId, name: binding.serverName ?? binding.serverId, kind: 'server', state: binding.state === 'unavailable' ? binding.unavailable ?? 'missing' : binding.state,
      features: binding.failed ? [] : featureNames(binding.capabilities), checks: !binding.failed && binding.state === 'ready' && (binding.capabilities.diagnosticProvider || binding.hasDiagnostics) ? 'Server diagnostics' : 'none',
      recovery: binding.recovery, issue: binding.issue, preparing: binding.preparing, message: binding.message, context: binding.context, analysis: binding.analysis, messages: binding.messages, diagnosticCount: binding.diagnostics.length,
      tool: !binding.failed && binding.state === 'ready' ? binding.tool : undefined,
      unresolved: !binding.failed && binding.state === 'ready' && binding.tool && binding.unresolved ? { count: binding.unresolved, noun: unresolvedSymptoms[binding.tool]!.noun } : undefined,
    });
    const current = bindings.find(binding => binding.state === 'failed') ?? bindings.find(binding => binding.state === 'starting');
    this.options.status(current?.state ?? (bindings.some(b => b.state === 'ready') ? 'ready' : 'unavailable'), current?.message);
  }
  private uri(value: string): M.Uri {
    const target = this.api.Uri.parse(value);
    if (target.scheme !== 'file' || target.query || target.fragment) throw new Error('Unsupported language target.');
    return [...this.bindings.values()].find(binding => binding.path === target.fsPath)?.model.uri ?? target;
  }
  capabilitiesFor(model: M.editor.ITextModel | null): L.ServerCapabilities {
    const binding = model && this.bindings.get(model); return binding && !binding.failed ? binding.capabilities : {};
  }
  /** The document's tool can name the file that belongs with it: a header's source, a source's header. */
  hasCompanion(model: M.editor.ITextModel | null): boolean {
    const binding = model && this.bindings.get(model); return !!binding && !binding.failed && binding.state === 'ready' && !!binding.companion;
  }
  /** Opens that file. `vendor/vscode-clangd/src/switch-source-header.ts`: the tool answers
   * with an address, or with nothing when it found none. */
  async openCompanion(model: M.editor.ITextModel): Promise<boolean> {
    if (!this.hasCompanion(model)) return false;
    const found = await this.request<string>(model, 'textDocument/switchSourceHeader', {}, noCancellation);
    if (!found || typeof found !== 'string') return false;
    await this.options.open(this.uri(found).fsPath, undefined);
    return true;
  }
  /** The extension whose commands the document's tool is offered with, once it is ready. */
  toolFor(model: M.editor.ITextModel | null): ToolFamily | undefined {
    const binding = model && this.bindings.get(model); return binding && !binding.failed && binding.state === 'ready' ? binding.tool : undefined;
  }
  /** Runs one command of `tool-command-list.ts` for the document in this editor. False when the document's tool is not the command's. */
  async runToolCommand(id: string, editor: M.editor.IStandaloneCodeEditor): Promise<boolean> {
    const model = editor.getModel(), binding = model && this.bindings.get(model), run = toolCommands[id];
    if (!binding || !run || this.toolFor(model) !== toolCommandList.find(command => command.id === id)?.tool) return false;
    const context = this.commandContext(binding, editor);
    try { await run(context); } catch (error) { context.message(String(error instanceof Error ? error.message : error)); }
    return true;
  }
  /** A command a tool named in a code lens, a completion or a code action. The ones the tool
   * hands back to its editor run here (`tool-commands.ts`); the editor's own two that tools
   * name by their VS Code ids run in the editor; every other one is the tool's to run. */
  private async execute(binding: Binding, command: L.Command): Promise<void> {
    const editor = this.api.editor.getEditors().find(editor => editor.getModel() === binding.model && editor.hasTextFocus())
      ?? this.api.editor.getEditors().find(editor => editor.getModel() === binding.model);
    const own = binding.tool && clientCommandHandlers[binding.tool]?.[command.command];
    if (own && editor) { const context = this.commandContext(binding, editor as M.editor.IStandaloneCodeEditor);
      try { await own(context, Array.isArray(command.arguments) ? command.arguments : []); } catch (error) { context.message(String(error instanceof Error ? error.message : error)); }
      return; }
    if (['editor.action.triggerSuggest', 'editor.action.triggerParameterHints'].includes(command.command)) { editor?.trigger('setdown.language', command.command, {}); return; }
    await this.request(binding.model, 'workspace/executeCommand', command, noCancellation);
  }
  private commandContext(binding: Binding, editor: M.editor.IStandaloneCodeEditor): ToolCommandContext {
    const { api } = this, model = binding.model;
    const host = editor.getDomNode()?.parentElement ?? undefined;
    const restore = () => { if (!model.isDisposed() && editor.getModel() === model) editor.focus(); };
    const selections = (editor.getSelections() ?? []).map(selection => toRange(selection));
    const position = toPosition(editor.getPosition() ?? { lineNumber: 1, column: 1 });
    // A sentence at the cursor that leaves by itself: nothing a tool says stays over the text.
    const message = (text: string) => {
      const at = editor.getPosition(), controller = editor.getContribution('editor.contrib.messageController') as unknown as { showMessage?(message: string, position: M.IPosition): void; closeMessage?(): void } | null;
      if (!at || !controller?.showMessage) return;
      controller.showMessage(text.slice(0, 500), at);
      const turn = ++this.messageTurn;
      setTimeout(() => { if (turn === this.messageTurn) controller.closeMessage?.(); }, 6000);
    };
    const open = async (uri: string, range?: L.Range) => { await this.options.open(this.uri(uri).fsPath, range && fromRange(range)); };
    const show = async (view: Promise<M.IDisposable>) => { this.resultsView?.dispose(); this.resultsView = await view; if (this.bindings.get(model) !== binding) this.resultsView.dispose(); else binding.providers.push(this.resultsView); };
    return {
      position, selections, selection: selections[0] ?? { start: position, end: position }, uri: binding.uri ?? '',
      formatting: { tabSize: model.getOptions().tabSize, insertSpaces: model.getOptions().insertSpaces },
      line: model.getLineContent(Math.min(position.line + 1, model.getLineCount())),
      request: (method, params, strict) => this.request(model, method, params, noCancellation, strict),
      // The answer becomes a file of the app, which opens beside the code like any document.
      showText: async source => {
        const { port, openAnswer } = this.options;
        if (!port.answer || !openAnswer) throw Error('This window cannot open the answer as a document.');
        await openAnswer(await port.answer(binding.path, source));
      },
      showLocations: async (title, found, empty) => {
        const places = found.flatMap(place => { const uri = 'targetUri' in place ? place.targetUri : place.uri, range = 'targetUri' in place ? place.targetSelectionRange : place.range;
          try { return [{ uri, range, path: this.uri(uri).fsPath }]; } catch { return []; } });
        if (!places.length) { message(empty); return; }
        if (places.length === 1) { await this.options.open(places[0].path, fromRange(places[0].range)); return; }
        if (host) await show(import('./language-results').then(({ showLanguageResults }) => showLanguageResults(host, { title, searchable: false,
          load: async () => places.map(place => ({ label: `${place.path.split(/[\\/]/).at(-1)}:${place.range.start.line + 1}`, detail: place.path,
            location: { path: place.path, line: place.range.start.line + 1, column: place.range.start.character + 1, endLine: place.range.end.line + 1, endColumn: place.range.end.character + 1 },
            open: () => this.options.open(place.path, fromRange(place.range)) })) }, restore)));
      },
      open,
      ask: async source => host ? (await import('./language-text')).askLanguageInput(host, source, restore) : undefined,
      pick: async (title, items) => {
        if (!host) return undefined;
        const { showLanguageResults } = await import('./language-results');
        return new Promise(resolve => {
          let chosen: typeof items[number]['value'] | undefined;
          // A long list is narrowed by typing, as a quick pick is.
          const rows = items.map(item => ({ label: item.label, detail: item.detail, open: async () => { chosen = item.value; } }));
          const narrowed = (query: string) => { const words = query.toLowerCase().split(/\s+/).filter(Boolean); return words.length ? rows.filter(row => words.every(word => row.label.toLowerCase().includes(word) || row.detail.toLowerCase().includes(word))) : rows; };
          void show(showLanguageResults(host, { title, searchable: items.length > 8, placeholder: items.length > 8 ? 'Type to narrow the list' : 'Choose with the arrow keys and Enter', load: async query => narrowed(query) },
            () => { restore(); resolve(chosen); }));
        });
      },
      edit: (edits, snippet = false) => {
        if (editor.getModel() !== model) return;
        // The tool's offsets are in the text before the edits; the cursor mark of a snippet moves with the edits before it.
        const items = edits.map(edit => ({ range: fromRange(edit.range), ...(snippet ? plainSnippet(edit.newText) : { text: edit.newText, cursor: undefined }) }))
          .map(item => ({ ...item, start: model.getOffsetAt({ lineNumber: item.range.startLineNumber, column: item.range.startColumn }), end: model.getOffsetAt({ lineNumber: item.range.endLineNumber, column: item.range.endColumn }) }))
          .sort((a, b) => a.start - b.start);
        const marked = items.find(item => item.cursor !== undefined);
        const cursor = marked && marked.start + marked.cursor! + items.filter(item => item.start < marked.start).reduce((moved, item) => moved + item.text.length - (item.end - item.start), 0);
        editor.pushUndoStop();
        editor.executeEdits('setdown.language', items.map(item => ({ range: api.Range.lift(item.range), text: item.text, forceMoveMarkers: true })));
        if (cursor !== undefined) { const at = model.getPositionAt(cursor); editor.setPosition(at); editor.revealPositionInCenterIfOutsideViewport(at); }
        editor.pushUndoStop();
      },
      workspaceEdit: async edit => { this.applyEdit(await this.workspaceEdit(edit, this.snapshot(), noCancellation, true)); },
      select: ranges => {
        if (editor.getModel() !== model || !ranges.length) return;
        editor.setSelections(ranges.map(range => new api.Selection(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1)));
        editor.revealRangeInCenterIfOutsideViewport(fromRange(ranges[0]));
      },
      run: async program => { if (!this.options.runProgram) return false; await this.options.runProgram(commandLine(program, /Win/i.test(navigator.platform)), program.cwd); return true; },
      copy: async text => { await navigator.clipboard.writeText(text); },
      link: async href => { await this.options.openLink?.(href); },
      message,
      inspect: (page, item) => { this.options.inspect?.(model, page, item); },
      editorAction: async id => { editor.focus(); const action = editor.getAction(id); if (action) await action.run(); else editor.trigger('setdown.language', id, {}); },
      type: text => { editor.trigger('keyboard', 'type', { text }); },
    };
  }
  /** The commands of the tool's own extension that act on the project or on the tool. */
  toolActions(model: M.editor.ITextModel | null): ToolAction[] {
    const binding = model && this.bindings.get(model), tool = this.toolFor(model);
    return !binding || !tool ? [] : toolCommandList.flatMap(command => command.tool === tool && (command.place === 'project' || command.place === 'settings')
      ? [{ id: command.id, server: binding.serverId, title: command.short ?? command.title, place: command.place }] : []);
  }
  /** The row of a choice the document's tool keeps itself, known without asking it. */
  toolEnvironmentRow(model: M.editor.ITextModel | null): { id: string; label: string } | undefined {
    const tool = this.toolFor(model); return tool && toolEnvironmentRows[tool];
  }
  /** Asks the tool for that choice. A refusal of the tool is the row's own sentence. */
  async toolEnvironment(model: M.editor.ITextModel, id: string): Promise<ToolEnvironment | undefined> {
    const row = this.toolEnvironmentRow(model);
    if (row?.id !== id) return undefined;
    try {
      return id === 'go' ? goEnvironment(await this.request(model, 'setdown/go.versions', {}, noCancellation, true))
        : yamlEnvironment(await this.request(model, 'yaml/get/all/jsonSchemas', {}, noCancellation, true));
    } catch (error) { return { ...row, value: '', choices: [], refusal: String(error instanceof Error ? error.message : error).slice(0, 500) }; }
  }
  /** Makes the choice. The answer is what to tell the person, or `false` when the row is not this tool's. */
  async chooseToolEnvironment(model: M.editor.ITextModel, id: string, choice: string): Promise<string | undefined | false> {
    if (this.toolEnvironmentRow(model)?.id !== id) return false;
    if (id === 'go') {
      const picked = goChoice(choice);
      if (!picked) throw Error('This Go is no longer in the list.');
      return await this.request(model, 'setdown/go.chooseVersion', picked, noCancellation, true) ? ('clear' in picked ? 'Using the Go of the environment again.' : 'Go changed; gopls is starting again.') : undefined;
    }
    await this.request(model, 'setdown/yaml.selectSchemas', { selected: choice ? [choice] : [] }, noCancellation, true);
    return undefined;
  }
  /** What can be done with the thing under the cursor: the questions are sent now, and each
   * resolves with the entries its answer makes (`language-here.ts`). */
  hereProbes(editor: M.editor.IStandaloneCodeEditor): Promise<HereItem[]>[] {
    const model = editor.getModel(), binding = model && this.bindings.get(model);
    if (!model || !binding || binding.failed || binding.state !== 'ready') return [];
    const command = this.commandContext(binding, editor), version = model.getVersionId(), versions = this.snapshot();
    const report = (error: unknown) => command.message(String(error instanceof Error ? error.message : error));
    return hereProbes({ capabilities: binding.capabilities, tool: binding.tool, position: command.position, selection: command.selection, uri: binding.uri ?? '',
      readOnly: editor.getOption(this.api.editor.EditorOption.readOnly), diagnostics: binding.diagnostics, environment: binding.analysis?.context.kind,
      // A tool that refuses a question at this position has simply answered no.
      request: <T>(method: LanguageMethod, params: object) => this.request<T>(model, method, params, noCancellation, true).catch(() => null),
      runs: name => !!binding.tool && !!clientCommandHandlers[binding.tool]?.[name] && !/\.(?:showReferences|gotoLocation|triggerParameterHints|rename)$/.test(name)
        || !!binding.capabilities.executeCommandProvider?.commands?.includes(name),
      editorAction: id => { void command.editorAction(id).catch(report); },
      hierarchy: kind => { void this.showNavigation(kind, editor); },
      codeAction: async action => { try { await binding.runCodeAction?.(action, version, versions); } catch (error) { report(error); } },
      execute: async lens => { try { await this.execute(binding, lens); } catch (error) { report(error); } },
      toolCommand: async id => { await this.runToolCommand(id, editor); },
      showText: source => command.showText(source).catch(report), showLocations: command.showLocations, link: command.link, edit: command.edit,
      inspectEnvironment: () => { this.options.inspect?.(model, 'environment'); },
    });
  }
  async documentSymbols(model: M.editor.ITextModel): Promise<Array<{ name: string; line: number; column: number; kind: number }>> {
    if (!this.capabilitiesFor(model).documentSymbolProvider) return [];
    const symbols = await this.request<Array<L.DocumentSymbol | L.SymbolInformation>>(model, 'textDocument/documentSymbol', {}, noCancellation);
    const flatten = (items: Array<L.DocumentSymbol | L.SymbolInformation>): Array<{ name: string; line: number; column: number; kind: number }> => items.flatMap(item => {
      const range = 'selectionRange' in item ? item.selectionRange : item.location.range;
      return [{ name: item.name, line: range.start.line + 1, column: range.start.character + 1, kind: item.kind }, ...('children' in item ? flatten(item.children ?? []) : [])];
    });
    return flatten(symbols ?? []);
  }
  async showNavigation(kind: 'symbols' | 'incoming' | 'outgoing' | 'supertypes' | 'subtypes' | 'problems', editor: M.editor.IStandaloneCodeEditor): Promise<void> {
    const model = editor.getModel(), position = editor.getPosition();
    if (!model || !position) return;
    if (kind === 'problems') { await this.showProblems(editor); return; }
    const binding = this.bindings.get(model);
    if (!binding) return;
    const capability = { symbols: 'workspaceSymbolProvider', incoming: 'callHierarchyProvider', outgoing: 'callHierarchyProvider', supertypes: 'typeHierarchyProvider', subtypes: 'typeHierarchyProvider', problems: undefined }[kind] as keyof L.ServerCapabilities | undefined;
    if (capability && !binding.capabilities[capability]) return;
    const version = model.getVersionId();
    const { showLanguageResults } = await import('./language-results');
    const valid = () => this.bindings.get(model) === binding && !model.isDisposed() && model.getVersionId() === version;
    const location = (label: string, uri: string, range?: L.Range): import('./language-results').LanguageResult => ({ label,
      detail: `${this.api.Uri.parse(uri).fsPath}${range ? `:${range.start.line + 1}` : ''}`,
      location: { path: this.uri(uri).fsPath, line: (range?.start.line ?? 0) + 1, column: (range?.start.character ?? 0) + 1,
        endLine: range ? range.end.line + 1 : undefined, endColumn: range ? range.end.character + 1 : undefined },
      open: async () => { await this.options.open(this.uri(uri).fsPath, range && fromRange(range)); },
    });
    const hierarchy = (item: L.CallHierarchyItem | L.TypeHierarchyItem): import('./language-results').LanguageResult => ({
      ...location(item.name, item.uri, item.selectionRange),
      children: async () => {
        if (!valid()) throw Error('Document changed. Reopen the hierarchy.');
        if (kind === 'incoming' || kind === 'outgoing') {
          const result = await this.request<(L.CallHierarchyIncomingCall | L.CallHierarchyOutgoingCall)[]>(model,
            kind === 'incoming' ? 'callHierarchy/incomingCalls' : 'callHierarchy/outgoingCalls', { item }, noCancellation);
          return (result ?? []).map(call => hierarchy('from' in call ? call.from : call.to));
        }
        const result = await this.request<L.TypeHierarchyItem[]>(model, kind === 'supertypes' ? 'typeHierarchy/supertypes' : 'typeHierarchy/subtypes', { item }, noCancellation);
        return (result ?? []).map(hierarchy);
      },
    });
    const titles = { symbols: 'Workspace Symbols', incoming: 'Incoming Calls', outgoing: 'Outgoing Calls', supertypes: 'Supertypes', subtypes: 'Subtypes', problems: 'Problems · Open Files' };
    const host = editor.getDomNode()?.parentElement;
    if (!host) return;
    this.resultsView?.dispose();
    const view = await showLanguageResults(host, { title: titles[kind], searchable: kind === 'symbols', load: async (query, token) => {
      if (!valid()) throw Error('Document changed. Reopen language results.');
      if (kind === 'symbols') {
        const result = await this.request<(L.SymbolInformation | L.WorkspaceSymbol)[]>(model, 'workspace/symbol', { query }, token);
        return (result ?? []).filter(symbol => symbol.location.uri.startsWith('file:')).map(symbol => {
          const range = 'range' in symbol.location ? symbol.location.range : undefined;
          const row = location(symbol.name, symbol.location.uri, range);
          if (!range) row.open = async () => {
            const resolved = await this.request<L.WorkspaceSymbol>(model, 'workspaceSymbol/resolve', symbol, noCancellation);
            if (resolved && 'range' in resolved.location) await this.options.open(this.uri(resolved.location.uri).fsPath, fromRange(resolved.location.range));
          };
          return row;
        });
      }
      const items = await this.request<(L.CallHierarchyItem | L.TypeHierarchyItem)[]>(model,
        kind === 'incoming' || kind === 'outgoing' ? 'textDocument/prepareCallHierarchy' : 'textDocument/prepareTypeHierarchy', { position: toPosition(position) }, token);
      return (items ?? []).map(hierarchy);
    } }, () => { if (!model.isDisposed() && editor.getModel() === model) editor.focus(); });
    this.resultsView = view;
    if (!valid()) { view.dispose(); return; }
    binding.providers.push(view);
  }
  async showProblems(editor: M.editor.IStandaloneCodeEditor): Promise<void> {
    const host = editor.getDomNode()?.parentElement;
    if (!host) return;
    const { showLanguageResults } = await import('./language-results');
    this.resultsView?.dispose();
    this.resultsView = await showLanguageResults(host, { title: 'Problems · Open Files', searchable: false, empty: () => problemsEmpty(documentSupport.all().flatMap(item => item.providers)),
      subscribe: listener => { const diagnostics = diagnosticsFor(this.api).subscribe(listener), support = documentSupport.subscribe(listener); return () => { diagnostics(); support(); }; },
      load: async () => diagnosticsFor(this.api).results((path, range) => this.options.open(path, range)),
    }, () => { if (editor.getDomNode()?.checkVisibility()) editor.focus(); });
  }
  private snapshot(): Map<M.editor.ITextModel, number> { return new Map([...this.bindings.keys()].map(model => [model, model.getVersionId()])); }
  private setServer(binding: Binding, server: string): void {
    if (binding.serverId === server) return;
    binding.lease.dispose(); binding.serverId = server;
    binding.lease = diagnosticsFor(this.api).lease(binding.model, server, binding.generation);
    for (const [channel, items] of binding.diagnosticChannels) binding.lease.publish(channel, items.map(d => marker(this.api, d)));
  }
  private diagnostics(binding: Binding, diagnostics: L.Diagnostic[], channel = 'push', version?: number): void {
    if (!binding.hasDiagnostics) { binding.hasDiagnostics = true; binding.providers.push(ownLanguageDiagnostics(this.api, binding.model, binding.serverId)); this.publishStatus(); }
    binding.diagnosticChannels.set(channel, diagnostics);
    binding.diagnostics = [...binding.diagnosticChannels.values()].flat();
    binding.unresolved = binding.tool && unresolvedSymptoms[binding.tool] ? binding.diagnostics.filter(diagnostic => isUnresolvedSymptom(binding.tool, diagnostic.code)).length : undefined;
    binding.lease.publish(channel, diagnostics.map(d => marker(this.api, d)), version, { diagnostics, context: binding.analysis?.context });
    if (binding.analysis) binding.analysis = { ...binding.analysis, analysis: 'observed', freshness: version === undefined ? 'best-effort' : 'current' };
    this.publishStatus();
  }
  private applyEdit(edit: M.languages.WorkspaceEdit): void {
    const grouped = new Map<M.editor.ITextModel, M.editor.IIdentifiedSingleEditOperation[]>();
    for (const entry of edit.edits) {
      if (!('textEdit' in entry)) throw Error('Unsupported workspace file operation.');
      const model = this.api.editor.getModel(entry.resource);
      if (!model || model.isDisposed() || model.getVersionId() !== entry.versionId) throw Error('Workspace edit target changed.');
      const edits = grouped.get(model) ?? [];
      edits.push({ range: this.api.Range.lift(entry.textEdit.range), text: entry.textEdit.text, forceMoveMarkers: true });
      grouped.set(model, edits);
    }
    // Validate every target before any mutation. Ordinary model events own dirty state and persistence.
    this.applying = true;
    try { for (const [model, edits] of grouped) { model.pushStackElement(); model.pushEditOperations([], edits, () => null); model.pushStackElement(); } }
    finally { this.applying = false; }
  }
  private installProviders(owner: Binding, capabilities: LanguageCapabilities): void {
    for (const provider of owner.providers) provider.dispose();
    owner.providers = []; capabilities = this.options.filterCapabilities?.(owner.model, owner.serverId, capabilities) ?? capabilities; owner.capabilities = capabilities;
    const { api } = this;
    const language = { language: owner.model.getLanguageId(), scheme: 'file', pattern: owner.model.uri.fsPath, exclusive: false };
    if (capabilities.diagnosticProvider || owner.hasDiagnostics) owner.providers.push(ownLanguageDiagnostics(api, owner.model, owner.serverId));
    // Each provider belongs to one live model and its negotiated capabilities.
    // Different roots/servers may advertise different triggers or resolve support.
    const scoped = <T extends object>(provider: T): T => Object.fromEntries(Object.entries(provider).map(([key, value]) =>
      [key, typeof value === 'function' && (key.startsWith('provide') || key === 'resolveRenameLocation')
        ? (model: M.editor.ITextModel, ...args: unknown[]) => model === owner.model && this.bindings.get(model) === owner
          ? value(model, ...args) : null : value])) as T;
    const callbacks = new Map<string, { version: number; run: () => Promise<void> }>();
    owner.providers.push(owner.model.onDidChangeContent(() => {
      for (const [id, callback] of callbacks) if (callback.version < owner.model.getVersionId() - 1) callbacks.delete(id);
    }), { dispose: () => callbacks.clear() });
    const commandId = `setdown.language.${crypto.randomUUID()}`;
    const hoverCallbacks: string[] = [];
    const action = (title: string, run: () => Promise<void>): M.languages.Command => {
      const id = crypto.randomUUID(); callbacks.set(id, { version: owner.model.getVersionId(), run });
      return { id: commandId, title, arguments: [id] };
    };
    // Registered only for this live binding. Server command names never become editor commands.
    if (api.editor.registerCommand) owner.providers.push(api.editor.registerCommand(commandId, async (_accessor, id: string) => {
      const callback = callbacks.get(id); callbacks.delete(id);
      if (callback && this.bindings.get(owner.model) === owner && !owner.failed) await callback.run();
    }));
    const context: LanguageFeatureContext = {
      api, model: owner.model, selector: language, capabilities, scoped,
      add: (...items) => owner.providers.push(...items), request: (method, params, token) => this.request(owner.model, method, params, token),
      uri: value => this.uri(value), alive: version => this.bindings.get(owner.model) === owner && !owner.failed && !owner.model.isDisposed() && owner.model.getVersionId() === version,
      onRefresh: (feature, listener) => { const listeners = owner.refresh.get(feature) ?? new Set(); listeners.add(listener); owner.refresh.set(feature, listeners); return { dispose: () => { listeners.delete(listener); } }; },
      diagnostics: () => owner.diagnostics, snapshot: () => this.snapshot(),
      edit: (edit, versions, token) => this.workspaceEdit(edit, versions, token, true), apply: edit => this.applyEdit(edit), action,
      command: (command, version, afterCompletion = false) => action(command.title, async () => {
        if (!context.alive(version) && !(afterCompletion && context.alive(version + 1))) throw Error('Document changed. Request the command again.');
        await this.execute(owner, command);
      }),
      execute: command => this.execute(owner, command),
    };
    installNavigationFeatures(context); installSemanticFeatures(context); installEditFeatures(context);
    owner.runCodeAction = codeActionRunner(context);
    // The repair sits where it hurts: on the line the tool marked as bringing in something it did
    // not find, the choice of what the analysis is based on is offered as a fix.
    if (owner.tool && unresolvedSymptoms[owner.tool] && this.options.inspect && api.editor.registerCommand) {
      const chooseId = `setdown.language.environment.${crypto.randomUUID()}`;
      owner.providers.push(api.editor.registerCommand(chooseId, () => { if (this.bindings.get(owner.model) === owner) this.options.inspect!(owner.model, 'environment'); }),
        api.languages.registerCodeActionProvider(language, scoped({
          provideCodeActions: (_model: M.editor.ITextModel, _range: M.Range, found: M.languages.CodeActionContext) => {
            const kind = owner.analysis?.context.kind, hit = kind && found.markers.find(marker => isUnresolvedSymptom(owner.tool, marker.code));
            if (!kind || !hit || found.only && !found.only.startsWith('quickfix')) return { actions: [], dispose() {} };
            const title = environmentAction(kind).label;
            return { actions: [{ title, kind: 'quickfix', diagnostics: [hit], command: { id: chooseId, title } }], dispose() {} };
          },
        }), { providedCodeActionKinds: ['quickfix'] }));
    }
    if (owner.autoInsert) installAutoInsertion(context, owner.autoInsert);
    installPullDiagnostics(context, diagnostics => this.diagnostics(owner, diagnostics, 'pull', owner.model.getVersionId()), owner.diagnosticCache);
    this.publishStatus();
    if (capabilities.completionProvider) owner.providers.push(api.languages.registerCompletionItemProvider(language, scoped({
      triggerCharacters: capabilities.completionProvider!.triggerCharacters,
      provideCompletionItems: async (model, position, completionContext, token) => {
        const response = await this.request<L.CompletionItem[] | L.CompletionList>(model, 'textDocument/completion',
          { position: toPosition(position), context: toCompletionContext(completionContext) }, token);
        if (!response) return null;
        const word = model.getWordUntilPosition(position);
        const fallback = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const binding = this.bindings.get(model)!;
        const lease = { handles: new Set(languageItemHandles(response)), disposed: false };
        const suggestions = (Array.isArray(response) ? response : response.items).map(original => {
          const item = completionDefaults(original, Array.isArray(response) ? undefined : response.itemDefaults);
          const converted = completion(api, item, fallback);
          if (item.command) converted.command = context.command(item.command, model.getVersionId(), true);
          this.completionItems.set(converted, { binding, version: model.getVersionId(), item, lease });
          return converted;
        });
        return { suggestions, incomplete: !Array.isArray(response) && response.isIncomplete,
          dispose: () => { lease.disposed = true; this.options.port.releaseItems?.(binding.id, [...lease.handles]); } };
      },
      resolveCompletionItem: !capabilities.completionProvider!.resolveProvider ? undefined : async (item, token) => {
        const data = this.completionItems.get(item);
        const valid = () => !!data && !data.lease.disposed && data.binding === owner && this.bindings.get(data.binding.model) === data.binding
          && !data.binding.model.isDisposed() && data.binding.model.getVersionId() === data.version;
        if (!data || !valid()) return { ...item, additionalTextEdits: undefined };
        const resolved = await this.request<L.CompletionItem>(data.binding.model, 'completionItem/resolve', data.item, token);
        const handles = languageItemHandles(resolved);
        if (data.lease.disposed) this.options.port.releaseItems?.(data.binding.id, handles);
        else for (const handle of handles) data.lease.handles.add(handle);
        if (!valid()) return { ...item, additionalTextEdits: undefined };
        if (!resolved) return item;
        const fallback = 'insert' in item.range ? item.range.insert : item.range;
        return { ...item, ...completion(api, resolved, fallback), command: resolved.command && context.command(resolved.command, data.version, true) };
      },
    })));
    if (capabilities.hoverProvider) owner.providers.push(api.languages.registerHoverProvider(language, scoped({
      provideHover: async (model, position, token) => {
        const result = await this.request<L.Hover>(model, 'textDocument/hover', { position: toPosition(position) }, token);
        if (!result) return result;
        // rust-analyzer adds what can be done with the item under the cursor (`lsp_ext.ts` `hover`,
        // `CommandLinkGroup`): go to its implementations, show its references, run it. Each is a
        // link below the hover that runs the command, as in `client.ts` `renderHoverActions`. The
        // links of the hover before this one stop working.
        for (const id of hoverCallbacks.splice(0)) callbacks.delete(id);
        const groups = owner.tool && clientCommandHandlers[owner.tool] ? ((result as { actions?: unknown }).actions as { title?: unknown; commands?: unknown }[] | undefined) : undefined;
        const lines = (Array.isArray(groups) ? groups : []).slice(0, 8).flatMap(group => {
          const links = (Array.isArray(group?.commands) ? group.commands as L.Command[] : []).filter(item => typeof item?.title === 'string' && typeof item.command === 'string').slice(0, 8).map(item => {
            const link = context.command(item, model.getVersionId());
            hoverCallbacks.push(link.arguments![0] as string);
            return `[${item.title.replace(/[\\\[\]`*_<>]/g, '\\$&')}](command:${link.id}?${encodeURIComponent(JSON.stringify(link.arguments))})`;
          });
          return links.length ? [`${typeof group.title === 'string' && group.title ? `${group.title.replace(/[\\\[\]`*_<>]/g, '\\$&')} ` : ''}${links.join(' | ')}`] : [];
        });
        return { contents: [...(Array.isArray(result.contents) ? result.contents : [result.contents]).map(markdown),
          ...(lines.length ? [{ value: lines.join('\n\n'), isTrusted: { enabledCommands: [commandId] }, supportHtml: false }] : [])],
          range: result.range ? fromRange(result.range) : undefined };
      },
    })));
    if (capabilities.signatureHelpProvider) owner.providers.push(api.languages.registerSignatureHelpProvider(language, scoped({
      signatureHelpTriggerCharacters: capabilities.signatureHelpProvider!.triggerCharacters ?? [],
      signatureHelpRetriggerCharacters: capabilities.signatureHelpProvider!.retriggerCharacters ?? [],
      provideSignatureHelp: async (model, position, token, context) => {
        const result = await this.request<L.SignatureHelp>(model, 'textDocument/signatureHelp', { position: toPosition(position), context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter, isRetrigger: context.isRetrigger } }, token);
        return result && { value: { activeSignature: result.activeSignature ?? 0, activeParameter: result.activeParameter ?? 0,
          signatures: result.signatures.map(s => ({ label: s.label, activeParameter: s.activeParameter ?? undefined, documentation: s.documentation ? markdown(s.documentation) : undefined,
            parameters: (s.parameters ?? []).map(p => ({ label: p.label, documentation: p.documentation ? markdown(p.documentation) : undefined })) })) }, dispose() {} };
      },
    })));
    if (capabilities.definitionProvider) owner.providers.push(api.languages.registerDefinitionProvider(language, scoped({
      provideDefinition: async (model, position, token) => {
        const result = await this.request<L.Location | L.Location[] | L.LocationLink[]>(model, 'textDocument/definition', { position: toPosition(position) }, token);
        if (!result) return null;
        return (Array.isArray(result) ? result : [result]).filter(item => (('targetUri' in item ? item.targetUri : item.uri).startsWith('file:'))).map(item => 'targetUri' in item
          ? { uri: this.uri(item.targetUri), range: fromRange(item.targetRange), targetSelectionRange: fromRange(item.targetSelectionRange),
            originSelectionRange: item.originSelectionRange ? fromRange(item.originSelectionRange) : undefined }
          : { uri: this.uri(item.uri), range: fromRange(item.range) });
      },
    })));
    if (capabilities.referencesProvider) owner.providers.push(api.languages.registerReferenceProvider(language, scoped({
      provideReferences: async (model, position, context, token) => {
        const result = await this.request<L.Location[]>(model, 'textDocument/references', { position: toPosition(position), context }, token);
        return result?.filter(item => item.uri.startsWith('file:')).map(item => ({ uri: this.uri(item.uri), range: fromRange(item.range) }));
      },
    })));
    if (capabilities.documentSymbolProvider) owner.providers.push(api.languages.registerDocumentSymbolProvider(language, scoped({
      provideDocumentSymbols: async (model, token) => {
        const result = await this.request<(L.DocumentSymbol | L.SymbolInformation)[]>(model, 'textDocument/documentSymbol', {}, token);
        const convert = (symbol: L.DocumentSymbol): M.languages.DocumentSymbol => ({ name: symbol.name, detail: symbol.detail ?? '',
          kind: symbol.kind - 1, tags: symbol.tags?.includes(1) ? [api.languages.SymbolTag.Deprecated] : [],
          range: fromRange(symbol.range), selectionRange: fromRange(symbol.selectionRange), children: symbol.children?.map(convert) });
        return result?.flatMap(symbol => 'location' in symbol
          ? symbol.location.uri === owner.uri
            ? [{ name: symbol.name, detail: symbol.containerName ?? '', kind: symbol.kind - 1, tags: [],
                range: fromRange(symbol.location.range), selectionRange: fromRange(symbol.location.range) }] : []
          : [convert(symbol)]);
      },
    })));
    if (capabilities.renameProvider) owner.providers.push(api.languages.registerRenameProvider({ ...language, exclusive: true }, scoped({
      resolveRenameLocation: typeof capabilities.renameProvider !== 'object' || !capabilities.renameProvider.prepareProvider ? undefined : async (model, position, token) => {
        const result = await this.request<L.Range | { range: L.Range; placeholder: string } | { defaultBehavior: boolean }>(model, 'textDocument/prepareRename', { position: toPosition(position) }, token);
        if (!result) return { range: new api.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: '', rejectReason: 'This symbol cannot be renamed.' };
        if ('defaultBehavior' in result) { const word = model.getWordAtPosition(position); return word ? { range: new api.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn), text: word.word } : { range: new api.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: '', rejectReason: 'No symbol at this position.' }; }
        const range = fromRange('range' in result ? result.range : result);
        return { range, text: 'placeholder' in result ? result.placeholder : model.getValueInRange(range) };
      },
      provideRenameEdits: async (model, position, newName, token) => {
        // Capture every open document before asking. A rename cannot silently
        // overwrite typing that happened while the server was computing edits.
        const versions = new Map([...this.bindings].map(([m]) => [m, m.getVersionId()]));
        try {
          for (let attempt = 0; attempt < 4; attempt++) {
            await Promise.all([...this.bindings.values()].map(binding => binding.queue));
            if ([...versions].some(([m, version]) => m.isDisposed() || m.getVersionId() !== version))
              throw new Error('Documents changed during rename. Try again.');
            const result = await this.request<L.WorkspaceEdit>(model, 'textDocument/rename', { position: toPosition(position), newName }, token);
            if (!result) throw new Error('Rename was cancelled or the document changed.');
            let opened = false;
            for (const change of this.textChanges(result)) {
              const target = await this.options.prepare(this.uri(change.uri).fsPath);
              if (!versions.has(target.model)) {
                if ((this.options.route ?? languageSupport)(target.tab.document.path)?.server !== (this.options.route ?? languageSupport)(owner.path)?.server)
                  throw new Error('Rename targets must belong to the same language server.');
                versions.set(target.model, target.model.getVersionId()); opened = true;
              }
            }
            // Newly opened targets may differ from what the server read from
            // disk. Recompute against their authoritative live buffers first.
            if (!opened) return await this.workspaceEdit(result, versions, token);
          }
          throw new Error('Rename targets are still changing. Try again.');
        }
        catch (error) { return { edits: [], rejectReason: String(error) }; }
      },
    })));
  }
  private textChanges(edit: L.WorkspaceEdit) {
    const changes: { uri: string; version?: number | null; edits: L.TextEdit[] }[] = [];
    if (edit.documentChanges) for (const change of edit.documentChanges) {
      if (!('textDocument' in change)) throw new Error('File creation, deletion and renaming are not supported.');
      const edits: L.TextEdit[] = [];
      for (const item of change.edits) {
        if ('annotationId' in item || !('newText' in item)) throw new Error('Annotated or snippet workspace edits are not supported.');
        edits.push(item);
      }
      changes.push({ uri: change.textDocument.uri, version: change.textDocument.version, edits });
    }
    else for (const [uri, edits] of Object.entries(edit.changes ?? {})) changes.push({ uri, edits });
    if (changes.length > 200) throw new Error('Workspace edit affects more than 200 documents.');
    return changes;
  }
  private async workspaceEdit(edit: L.WorkspaceEdit, versions: Map<M.editor.ITextModel, number>, token: M.CancellationToken, allowNew = false): Promise<M.languages.WorkspaceEdit> {
    const changes = this.textChanges(edit);
    const edits: M.languages.IWorkspaceTextEdit[] = [];
    const ranges = new Map<M.editor.ITextModel, { start: number; end: number }[]>();
    for (const change of changes) {
      const uri = this.uri(change.uri);
      const target = await this.options.prepare(uri.fsPath);
      const model = target.model;
      if (!versions.has(model) && allowNew && model.getValue() === target.tab.document.savedText) versions.set(model, model.getVersionId());
      const expected = versions.get(model);
      if (expected === undefined) throw new Error('A rename target was not synchronized. Try again.');
      if (change.version != null && change.version !== expected) throw new Error('A rename target has changed. Try again.');
      versions.set(model, expected);
      for (const item of change.edits) {
        const range = fromRange(item.range);
        if (!this.api.Range.equalsRange(model.validateRange(range), range)) throw new Error('Invalid workspace edit range.');
        const interval = { start: model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn }),
          end: model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn }) };
        const previous = ranges.get(model) ?? [];
        if (previous.some(other => interval.start < other.end && other.start < interval.end)) throw new Error('Overlapping workspace edits.');
        previous.push(interval); ranges.set(model, previous);
        edits.push({ resource: model.uri, versionId: expected, textEdit: { range, text: item.newText } });
      }
    }
    if (token.isCancellationRequested || [...versions].some(([model, version]) => model.isDisposed() || model.getVersionId() !== version))
      throw new Error('Documents changed during rename. Try again.');
    return { edits };
  }
}
