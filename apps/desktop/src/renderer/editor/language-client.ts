import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';
import type { DocumentTab } from '../../core/workspace/workspace-state';
import type { LanguageApi, LanguageConnection, LanguageMethod } from '../../protocol/language';
import { languageSupport } from '../../core/document/language-support';
import { completion, fromRange, markdown, marker, toPosition, toRange } from './language-conversion';

type Binding = { tab: DocumentTab; model: M.editor.ITextModel; path: string; generation: string; connected: Promise<LanguageConnection>;
  queue: Promise<unknown>; listener: M.IDisposable; providers: M.IDisposable[]; failed: boolean; state: 'starting' | 'ready' | 'failed'; message?: string };
export type LanguageOptions = {
  port: LanguageApi;
  prepare(path: string): Promise<{ tab: DocumentTab; model: M.editor.ITextModel }>;
  open(path: string, selection: M.IRange | M.IPosition | undefined): Promise<void>;
  status(state: string, message?: string): void;
};

/** Scoped standalone providers. No replacement models or second document store. */
export class LanguageClient {
  private readonly bindings = new Map<M.editor.ITextModel, Binding>();
  private readonly disposables: M.IDisposable[] = [];
  private readonly completionItems = new WeakMap<M.languages.CompletionItem, { binding: Binding; version: number; item: L.CompletionItem }>();
  private readonly requests = new Map<string, Binding>();
  private restarting: Promise<void> | undefined;
  private restartDocuments: Map<M.editor.ITextModel, DocumentTab> | undefined;
  private disposed = false;
  constructor(private readonly api: typeof M, private readonly options: LanguageOptions) {
    this.disposables.push({ dispose: options.port.onEvent(event => {
      if (event.type === 'status') {
        const affected = [...this.bindings.values()].filter(binding => event.documents.some(document => document.id === binding.tab.id && document.generation === binding.generation));
        if (!affected.length) return;
        for (const binding of affected) { binding.state = event.state; binding.message = event.message; }
        this.publishStatus();
        if (event.state === 'failed') for (const binding of affected) {
          binding.failed = true; api.editor.setModelMarkers(binding.model, 'setdown-language', []);
        }
        return;
      }
      const binding = [...this.bindings.values()].find(binding => binding.tab.id === event.id);
      if (binding && binding.generation === event.generation && !binding.failed && !binding.model.isDisposed() && binding.model.getVersionId() === event.version)
        api.editor.setModelMarkers(binding.model, 'setdown-language', event.diagnostics.map(d => marker(api, d)));
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
    if (old?.path === tab.document.path && !tab.document.isUntitled && languageSupport(tab.document.path)) return;
    this.unbind(model);
    if (tab.document.isUntitled || model.isDisposed() || !languageSupport(tab.document.path)) return;
    const generation = crypto.randomUUID();
    const connected = this.options.port.open({ id: tab.id, generation, path: tab.document.path,
      text: model.getValue(), version: model.getVersionId() });
    const binding: Binding = { tab, model, path: tab.document.path, generation, connected, queue: connected,
      failed: false, state: 'starting', providers: [], listener: { dispose() {} } };
    this.bindings.set(model, binding);
    const fail = (error: unknown) => {
      if (this.bindings.get(model) !== binding) return;
      binding.failed = true; binding.state = 'failed'; binding.message = String(error); this.publishStatus();
    };
    // A failed initialization is a language-service state, not a rejected
    // editor/save queue. Keep ordinary editing usable while restart is offered.
    binding.queue = connected.then(connection => {
      if (this.bindings.get(model) === binding && !binding.failed) this.installProviders(binding, connection.capabilities);
    }).catch(fail);
    binding.listener = model.onDidChangeContent(event => {
      this.cancel(binding);
      this.api.editor.setModelMarkers(model, 'setdown-language', []);
      const version = model.getVersionId();
      // Monaco reports simultaneous edits against the old model. Descending
      // offsets turn them into LSP's sequential edits, including CRLF and emoji.
      const changes = [...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset)
        .map(change => ({ range: toRange(change.range), text: change.text }));
      const contentChanges = event.isFlush || event.isEolChange ? [{ text: model.getValue() }] : changes;
      binding.queue = binding.queue.then(() => {
        if (this.bindings.get(model) === binding && !binding.failed)
          return this.options.port.change(tab.id, version, contentChanges);
      }).catch(fail);
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
  saved(model: M.editor.ITextModel): void {
    const binding = this.bindings.get(model);
    if (binding) void binding.queue.then(() => {
      if (this.bindings.get(model) === binding && !binding.failed) this.options.port.saved(binding.tab.id);
    });
  }
  private cancel(binding: Binding): void {
    for (const [id, owner] of this.requests) if (owner === binding) this.options.port.cancel(id);
  }
  private async request<T>(model: M.editor.ITextModel, method: LanguageMethod, params: unknown, token: M.CancellationToken): Promise<T | null> {
    const binding = this.bindings.get(model);
    if (!binding || binding.failed || token.isCancellationRequested) return null;
    const version = model.getVersionId();
    await binding.queue;
    if (this.bindings.get(model) !== binding || model.getVersionId() !== version || binding.failed || token.isCancellationRequested) return null;
    const id = crypto.randomUUID();
    this.requests.set(id, binding);
    const cancel = token.onCancellationRequested(() => this.options.port.cancel(id));
    try {
      const result = await this.options.port.request(binding.tab.id, version, id, method, params);
      return this.bindings.get(model) === binding && !model.isDisposed() && model.getVersionId() === version
        && !token.isCancellationRequested ? result as T : null;
    } catch (error) {
      if (!token.isCancellationRequested && !model.isDisposed() && model.getVersionId() === version && !binding.failed)
        console.warn('Language request failed:', method, error);
      return null;
    } finally { cancel.dispose(); this.requests.delete(id); }
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
    this.options.status(current?.state ?? 'ready', current?.message);
  }
  private uri(value: string): M.Uri {
    const target = this.api.Uri.parse(value);
    if (target.scheme !== 'file' || target.query || target.fragment) throw new Error('Unsupported language target.');
    return [...this.bindings.values()].find(binding => binding.path === target.fsPath)?.model.uri ?? target;
  }
  private installProviders(owner: Binding, capabilities: L.ServerCapabilities): void {
    const { api } = this;
    const language = { language: owner.model.getLanguageId(), scheme: 'file', pattern: owner.model.uri.fsPath };
    // Each provider belongs to one live model and its negotiated capabilities.
    // Different roots/servers may advertise different triggers or resolve support.
    const scoped = <T extends object>(provider: T): T => Object.fromEntries(Object.entries(provider).map(([key, value]) =>
      [key, typeof value === 'function' && (key.startsWith('provide') || key === 'resolveRenameLocation')
        ? (model: M.editor.ITextModel, ...args: unknown[]) => model === owner.model && this.bindings.get(model) === owner
          ? value(model, ...args) : null : value])) as T;
    if (capabilities.completionProvider) owner.providers.push(api.languages.registerCompletionItemProvider(language, scoped({
      triggerCharacters: capabilities.completionProvider!.triggerCharacters,
      provideCompletionItems: async (model, position, context, token) => {
        const response = await this.request<L.CompletionItem[] | L.CompletionList>(model, 'textDocument/completion',
          { position: toPosition(position), context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter } }, token);
        if (!response) return null;
        const word = model.getWordUntilPosition(position);
        const fallback = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const binding = this.bindings.get(model)!;
        const suggestions = (Array.isArray(response) ? response : response.items).map(item => {
          const converted = completion(api, item, fallback);
          this.completionItems.set(converted, { binding, version: model.getVersionId(), item });
          return converted;
        });
        return { suggestions, incomplete: !Array.isArray(response) && response.isIncomplete };
      },
      resolveCompletionItem: !capabilities.completionProvider!.resolveProvider ? undefined : async (item, token) => {
        const data = this.completionItems.get(item);
        const valid = () => !!data && data.binding === owner && this.bindings.get(data.binding.model) === data.binding
          && !data.binding.model.isDisposed() && data.binding.model.getVersionId() === data.version;
        if (!data || !valid()) return { ...item, additionalTextEdits: undefined };
        const resolved = await this.request<L.CompletionItem>(data.binding.model, 'completionItem/resolve', data.item, token);
        if (!valid()) return { ...item, additionalTextEdits: undefined };
        if (!resolved) return item;
        const fallback = 'insert' in item.range ? item.range.insert : item.range;
        return { ...item, ...completion(api, resolved, fallback) };
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
      provideSignatureHelp: async (model, position, token) => {
        const result = await this.request<L.SignatureHelp>(model, 'textDocument/signatureHelp', { position: toPosition(position) }, token);
        return result && { value: { activeSignature: result.activeSignature ?? 0, activeParameter: result.activeParameter ?? 0,
          signatures: result.signatures.map(s => ({ label: s.label, documentation: s.documentation ? markdown(s.documentation) : undefined,
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
        const result = await this.request<L.DocumentSymbol[]>(model, 'textDocument/documentSymbol', {}, token);
        const convert = (symbol: L.DocumentSymbol): M.languages.DocumentSymbol => ({ name: symbol.name, detail: symbol.detail ?? '',
          kind: symbol.kind - 1, tags: symbol.tags?.includes(1) ? [api.languages.SymbolTag.Deprecated] : [],
          range: fromRange(symbol.range), selectionRange: fromRange(symbol.selectionRange), children: symbol.children?.map(convert) });
        return result?.map(convert);
      },
    })));
    if (capabilities.renameProvider) owner.providers.push(api.languages.registerRenameProvider(language, scoped({
      resolveRenameLocation: typeof capabilities.renameProvider !== 'object' || !capabilities.renameProvider.prepareProvider ? undefined : async (model, position, token) => {
        const result = await this.request<L.Range | { range: L.Range; placeholder: string }>(model, 'textDocument/prepareRename', { position: toPosition(position) }, token);
        if (!result) return { range: new api.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: '', rejectReason: 'This symbol cannot be renamed.' };
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
                if (languageSupport(target.tab.document.path)?.server !== languageSupport(owner.path)?.server)
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
    if (changes.length > 200) throw new Error('Rename affects more than 200 documents.');
    return changes;
  }
  private async workspaceEdit(edit: L.WorkspaceEdit, versions: Map<M.editor.ITextModel, number>, token: M.CancellationToken): Promise<M.languages.WorkspaceEdit> {
    const changes = this.textChanges(edit);
    const edits: M.languages.IWorkspaceTextEdit[] = [];
    const ranges = new Map<M.editor.ITextModel, { start: number; end: number }[]>();
    for (const change of changes) {
      const uri = this.uri(change.uri);
      const target = await this.options.prepare(uri.fsPath);
      const model = target.model;
      const expected = versions.get(model);
      if (expected === undefined) throw new Error('A rename target was not synchronized. Try again.');
      if (change.version != null && change.version !== expected) throw new Error('A rename target has changed. Try again.');
      versions.set(model, expected);
      for (const item of change.edits) {
        const range = fromRange(item.range);
        if (!this.api.Range.equalsRange(model.validateRange(range), range)) throw new Error('Invalid rename range.');
        const interval = { start: model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn }),
          end: model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn }) };
        const previous = ranges.get(model) ?? [];
        if (previous.some(other => interval.start < other.end && other.start < interval.end)) throw new Error('Overlapping rename edits.');
        previous.push(interval); ranges.set(model, previous);
        edits.push({ resource: model.uri, versionId: expected, textEdit: { range, text: item.newText } });
      }
    }
    if (token.isCancellationRequested || [...versions].some(([model, version]) => model.isDisposed() || model.getVersionId() !== version))
      throw new Error('Documents changed during rename. Try again.');
    return { edits };
  }
}
