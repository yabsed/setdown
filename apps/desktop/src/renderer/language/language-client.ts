import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';
import type { DocumentTab } from '../../core/workspace/workspace-state';
import type { LanguageApi, LanguageCapabilities, LanguageConnection, LanguageUnavailable, LanguageMethod } from '../../protocol/language';
import { textSynchronization } from '../../protocol/language';
import { languageSupport } from '../../core/document/language-support';
import { installNavigationFeatures } from './language-navigation-features';
import { installSemanticFeatures } from './language-semantic-features';
import { installEditFeatures } from './language-edit-features';
import { installPullDiagnostics, type DiagnosticCache } from './language-diagnostics';
import { noCancellation, type LanguageFeatureContext } from './language-feature-context';
import type { LanguageRefresh } from '../../protocol/language-features';
import { completionDefaults, completion, fromRange, markdown, marker, toPosition, toRange } from './language-conversion';
import { requestLanguageResult, LanguageRequestError, languageItemHandles } from '../../protocol/language-request';
import { completionContext as toCompletionContext } from '../../protocol/language-completion';
import { ownLanguageDiagnostics, hasBuiltinLanguageService } from './builtin-diagnostics';

type Binding = { capabilities: LanguageCapabilities; diagnosticCache: DiagnosticCache; diagnostics: L.Diagnostic[]; refresh: Map<LanguageRefresh, Set<() => void>>; serverId: string; tab: DocumentTab; model: M.editor.ITextModel; path: string; generation: string; connected: Promise<LanguageConnection | LanguageUnavailable>;
  uri?: string; sync?: ReturnType<typeof textSynchronization>; queue: Promise<unknown>; listener: M.IDisposable; providers: M.IDisposable[]; failed: boolean; state: 'starting' | 'ready' | 'failed' | 'unavailable'; message?: string };
export type LanguageOptions = {
  port: LanguageApi;
  route?: typeof languageSupport;
  prepare(path: string): Promise<{ tab: DocumentTab; model: M.editor.ITextModel }>;
  open(path: string, selection: M.IRange | M.IPosition | undefined): Promise<void>;
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
  constructor(private readonly api: typeof M, private readonly options: LanguageOptions) {
    this.disposables.push({ dispose: options.port.onEvent(event => {
      if (event.type === 'refresh') {
        for (const binding of this.bindings.values()) if (event.documents.some(d => d.id === binding.tab.id && d.generation === binding.generation))
          for (const listener of binding.refresh.get(event.feature) ?? []) listener();
        return;
      }
      if (event.type === 'capabilities') {
        const binding = [...this.bindings.values()].find(b => b.tab.id === event.id && b.generation === event.generation);
        if (binding && !binding.failed) this.installProviders(binding, event.capabilities);
        return;
      }
      if (event.type === 'apply-edit') {
        const binding = [...this.bindings.values()].find(b => b.tab.id === event.id && b.generation === event.generation);
        let versions = binding && this.commandEdits.get(binding);
        if (event.versions) {
          versions = new Map();
          for (const document of event.versions) {
            const target = [...this.bindings.values()].find(b => b.tab.id === document.id && b.generation === document.generation);
            if (target) versions.set(target.model, document.version);
          }
        }
        void (async () => {
          try {
            if (!binding || !versions) throw Error('No active editor command accepts edits.');
            if (event.versions?.some(document => ![...this.bindings.values()].some(b => b.tab.id === document.id && b.generation === document.generation))) throw Error('Documents closed during the file operation.');
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
        const affected = [...this.bindings.values()].filter(binding => event.documents.some(document => document.id === binding.tab.id && document.generation === binding.generation));
        if (!affected.length) return;
        for (const binding of affected) { binding.state = event.state; binding.message = event.message; }
        this.publishStatus();
        if (event.state === 'failed') for (const binding of affected) {
          binding.failed = true; binding.diagnostics = []; api.editor.setModelMarkers(binding.model, 'setdown-language', []);
          for (const provider of binding.providers) provider.dispose(); binding.providers = [];
        }
        return;
      }
      if (event.type !== 'diagnostics') return;
      const binding = [...this.bindings.values()].find(binding => binding.tab.id === event.id);
      if (binding && binding.generation === event.generation && !binding.failed && !binding.model.isDisposed() && binding.model.getVersionId() === event.version)
        this.diagnostics(binding, event.diagnostics);
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
    const connected = this.options.port.open({ id: tab.id, generation, path: tab.document.path,
      text: model.getValue(), version: model.getVersionId() });
    const binding: Binding = { capabilities: {}, diagnosticCache: new Map(), diagnostics: [], refresh: new Map(), serverId: (this.options.route ?? languageSupport)(tab.document.path)!.server, tab, model, path: tab.document.path, generation, connected, queue: connected,
      failed: false, state: 'starting', providers: [], listener: { dispose() {} } };
    this.bindings.set(model, binding);
    const fail = (error: unknown) => {
      if (this.bindings.get(model) !== binding) return;
      binding.failed = true; binding.state = 'failed'; binding.message = String(error); this.publishStatus();
    };
    // A failed initialization is a language-service state, not a rejected
    // editor/save queue. Keep ordinary editing usable while restart is offered.
    binding.queue = connected.then(connection => {
      if (this.bindings.get(model) !== binding) return;
      if ('unavailable' in connection) {
        binding.state = 'unavailable'; binding.listener.dispose(); this.publishStatus(); return;
      }
      binding.uri = connection.uri;
      binding.serverId = connection.server ?? binding.serverId;
      binding.sync = textSynchronization(connection.capabilities);
      if (this.bindings.get(model) === binding && !binding.failed) this.installProviders(binding, connection.capabilities);
    }).catch(fail);
    binding.listener = model.onDidChangeContent(event => {
      if (!this.applying) this.cancel(binding);
      binding.diagnostics = [];
      this.api.editor.setModelMarkers(model, 'setdown-language', []);
      const version = model.getVersionId();
      // Monaco reports simultaneous edits against the old model. Descending
      // offsets turn them into LSP's sequential edits, including CRLF and emoji.
      const changes = [...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset)
        .map(change => ({ range: toRange(change.range), text: change.text }));
      // Initialization may still select Full sync; capture this revision, never later text.
      const fullText = !binding.sync || binding.sync.change === 1 || event.isFlush || event.isEolChange ? model.getValue() : undefined;
      binding.queue = binding.queue.then(() => {
        if (this.bindings.get(model) === binding && !binding.failed && binding.state !== 'unavailable')
          return this.options.port.change(tab.id, version, binding.sync?.change === 0 ? []
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
    if (!model.isDisposed()) this.api.editor.setModelMarkers(model, 'setdown-language', []);
    this.options.port.close(binding.tab.id);
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
      if (this.bindings.get(model) === binding && !binding.failed && binding.state !== 'unavailable') this.options.port.saved(binding.tab.id, text);
    });
  }
  private cancel(binding: Binding): void {
    for (const [id, owner] of this.requests) if (owner === binding) this.options.port.cancel(id);
  }
  private async request<T>(model: M.editor.ITextModel, method: LanguageMethod, params: unknown, token: M.CancellationToken): Promise<T | null> {
    const binding = this.bindings.get(model);
    if (!binding || binding.failed || token.isCancellationRequested) return null;
    const version = model.getVersionId();
    const commandVersions = method === 'workspace/executeCommand' ? this.snapshot() : undefined;
    await binding.queue;
    if (this.bindings.get(model) !== binding || model.getVersionId() !== version || binding.failed || token.isCancellationRequested) return null;
    const id = crypto.randomUUID();
    this.requests.set(id, binding);
    const cancel = token.onCancellationRequested(() => this.options.port.cancel(id));
    try {
      if (commandVersions) this.commandEdits.set(binding, commandVersions);
      const result = await requestLanguageResult<T>(method, () => this.options.port.request(binding.tab.id, version, id, method, params),
        () => this.bindings.get(model) === binding && !binding.failed && !model.isDisposed() && model.getVersionId() === version, token);
      return this.bindings.get(model) === binding && !model.isDisposed() && model.getVersionId() === version
        && !token.isCancellationRequested ? result as T : null;
    } catch (error) {
      if (error instanceof LanguageRequestError && [-32800, -32801, -32802].includes(error.code)) return null;
      if (!token.isCancellationRequested && !model.isDisposed() && model.getVersionId() === version && !binding.failed)
        console.warn('Language request failed:', method, error);
      return null;
    } finally { cancel.dispose(); this.requests.delete(id); if (commandVersions) this.commandEdits.delete(binding); }
  }
  invalidate(servers: string[]): void {
    for (const binding of [...this.bindings.values()]) if (servers.includes(binding.serverId)) this.unbind(binding.model);
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
    this.restartDocuments?.clear();
    for (const model of this.bindings.keys()) this.unbind(model);
    for (const disposable of this.disposables) disposable.dispose();
  }
  private publishStatus(): void {
    const bindings = [...this.bindings.values()];
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
  async showNavigation(kind: 'symbols' | 'incoming' | 'outgoing' | 'supertypes' | 'subtypes' | 'problems', editor: M.editor.IStandaloneCodeEditor): Promise<void> {
    const model = editor.getModel(), position = editor.getPosition();
    if (!model || !position) return;
    const binding = this.bindings.get(model);
    if (!binding) return;
    const capability = { symbols: 'workspaceSymbolProvider', incoming: 'callHierarchyProvider', outgoing: 'callHierarchyProvider', supertypes: 'typeHierarchyProvider', subtypes: 'typeHierarchyProvider', problems: undefined }[kind] as keyof L.ServerCapabilities | undefined;
    if (capability && !binding.capabilities[capability]) return;
    const version = model.getVersionId();
    const { showLanguageResults } = await import('./language-results');
    const valid = () => this.bindings.get(model) === binding && !model.isDisposed() && model.getVersionId() === version;
    const location = (label: string, uri: string, range?: L.Range): import('./language-results').LanguageResult => ({ label,
      detail: `${this.api.Uri.parse(uri).fsPath}${range ? `:${range.start.line + 1}` : ''}`,
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
      if (kind === 'problems') return [...this.bindings.values()].flatMap(b => b.diagnostics.map(d => location(
        `${d.severity === 1 ? 'Error' : d.severity === 2 ? 'Warning' : 'Info'} · ${typeof d.message === 'string' ? d.message : d.message.value}`, b.uri!, d.range)));
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
  private snapshot(): Map<M.editor.ITextModel, number> { return new Map([...this.bindings.keys()].map(model => [model, model.getVersionId()])); }
  private diagnostics(binding: Binding, diagnostics: L.Diagnostic[]): void {
    binding.diagnostics = diagnostics;
    this.api.editor.setModelMarkers(binding.model, 'setdown-language', diagnostics.map(d => marker(this.api, d)));
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
    owner.providers = []; owner.capabilities = capabilities;
    const { api } = this;
    const language = { language: owner.model.getLanguageId(), scheme: 'file', pattern: owner.model.uri.fsPath, exclusive: hasBuiltinLanguageService(owner.model.getLanguageId()) };
    owner.providers.push(ownLanguageDiagnostics(api, owner.model));
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
        await this.request(owner.model, 'workspace/executeCommand', command, noCancellation);
      }),
    };
    installNavigationFeatures(context); installSemanticFeatures(context); installEditFeatures(context);
    installPullDiagnostics(context, diagnostics => this.diagnostics(owner, diagnostics), owner.diagnosticCache);
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
          dispose: () => { lease.disposed = true; this.options.port.releaseItems?.(binding.tab.id, [...lease.handles]); } };
      },
      resolveCompletionItem: !capabilities.completionProvider!.resolveProvider ? undefined : async (item, token) => {
        const data = this.completionItems.get(item);
        const valid = () => !!data && !data.lease.disposed && data.binding === owner && this.bindings.get(data.binding.model) === data.binding
          && !data.binding.model.isDisposed() && data.binding.model.getVersionId() === data.version;
        if (!data || !valid()) return { ...item, additionalTextEdits: undefined };
        const resolved = await this.request<L.CompletionItem>(data.binding.model, 'completionItem/resolve', data.item, token);
        const handles = languageItemHandles(resolved);
        if (data.lease.disposed) this.options.port.releaseItems?.(data.binding.tab.id, handles);
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
        return result && { contents: (Array.isArray(result.contents) ? result.contents : [result.contents]).map(markdown),
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
    if (capabilities.renameProvider) owner.providers.push(api.languages.registerRenameProvider(language, scoped({
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
