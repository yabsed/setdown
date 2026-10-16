import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';
import type { LanguageApi, LanguageConnection, LanguageMethod } from '../../protocol/language';
import { textSynchronization } from '../../protocol/language';
import { NotebookProjection } from '../../core/notebook/notebook-projection';
import type { NotebookEntry } from './notebook-store';
import { completion, completionDefaults, fromRange, markdown, marker, toPosition } from '../editor/language-conversion';

/** One Python document per notebook. Providers expose only operations whose
 * ranges can be mapped without editing a separator, another cell, or a file. */
export class NotebookLanguage {
  private connection?: LanguageConnection;
  private projection: NotebookProjection;
  private cellOrder = '';
  private version = 1;
  private sent = 0;
  private generation = crypto.randomUUID();
  private readonly id = crypto.randomUUID();
  private disposed = false;
  private connecting = false;
  private queue = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private disposables: { dispose(): void }[] = [];
  private requests = new Set<string>();
  private diagnostics: L.Diagnostic[] = [];
  constructor(private api: typeof M, private port: LanguageApi, private entry: NotebookEntry, private path: string,
    private status: (state: string) => void, openFile: (uri: string, selection?: M.IRange | M.IPosition) => Promise<void>, reveal: (id: string, selection: M.IRange) => Promise<void>) {
    this.projection = new NotebookProjection(entry.document.cells);
    this.cellOrder = entry.document.cells.filter(c => c.kind === 'code').map(c => c.id).join();
    const unsubscribe = entry.document.subscribe(() => {
      const projection = new NotebookProjection(entry.document.cells);
      if (projection.text === this.projection.text && entry.document.cells.filter(c => c.kind === 'code').map(c => c.id).join() === this.cellOrder) return;
      this.cellOrder = entry.document.cells.filter(c => c.kind === 'code').map(c => c.id).join();
      this.projection = projection; this.version++;
      this.diagnostics = []; this.updateMarkers();
      clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush(); }, 150);
    });
    const events = port.onEvent(event => {
      if (event.type === 'discovery') { if (!this.connection && !this.connecting) void this.reconnect(); return; }
      if (event.type === 'configuration') {
        if (!this.connection?.server || !event.servers || event.servers.includes(this.connection.server)) void this.reconnect();
        return;
      }
      if (event.type === 'diagnostics' && event.id === this.id && event.generation === this.generation && event.version === this.version) {
        this.diagnostics = event.diagnostics; this.updateMarkers();
      }
      if (event.type === 'status' && event.documents.some(doc => doc.id === this.id && doc.generation === this.generation)) status(event.state);
    });
    this.disposables.push({ dispose: unsubscribe }, { dispose: events });
    const selector = { language: 'python', scheme: 'setdown-cell' };
    this.disposables.push(api.languages.registerCompletionItemProvider(selector, {
      triggerCharacters: ['.'], provideCompletionItems: async (model, position, context, token) => {
        if (!this.connection?.capabilities.completionProvider) return;
        const cell = this.cell(model), point = cell && this.projection.position(cell, toPosition(position)); if (!cell || !point) return;
        const result = await this.request<L.CompletionList | L.CompletionItem[]>('textDocument/completion', { position: point,
          context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter } }, token);
        if (!result) return;
        const word = model.getWordUntilPosition(position), fallback = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
          startColumn: word.startColumn, endColumn: word.endColumn };
        const items = Array.isArray(result) ? result : result.items.map(item => completionDefaults(item, result.itemDefaults));
        const suggestions: M.languages.CompletionItem[] = [];
        for (const item of items) {
          if (item.command) continue; // No untracked cross-cell command side effects.
          const mapped = this.mapCompletion(cell, item);
          if (mapped) suggestions.push(completion(api, mapped, fallback));
        }
        return { suggestions, incomplete: !Array.isArray(result) && result.isIncomplete };
      },
    }), api.languages.registerHoverProvider(selector, { provideHover: async (model, position, token) => {
      if (!this.connection?.capabilities.hoverProvider) return;
      const cell = this.cell(model), point = cell && this.projection.position(cell, toPosition(position)); if (!cell || !point) return;
      const result = await this.request<L.Hover>('textDocument/hover', { position: point }, token); if (!result) return;
      const range = result.range && this.projection.range(result.range);
      return { contents: (Array.isArray(result.contents) ? result.contents : [result.contents]).map(markdown),
        range: range?.id === cell ? fromRange(range.range) : undefined };
    } }), api.languages.registerSignatureHelpProvider(selector, {
      signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [',', ')'],
      provideSignatureHelp: async (model, position, token) => {
        if (!this.connection?.capabilities.signatureHelpProvider) return;
        const cell = this.cell(model), point = cell && this.projection.position(cell, toPosition(position)); if (!point) return;
        const result = await this.request<L.SignatureHelp>('textDocument/signatureHelp', { position: point }, token); if (!result) return;
        return { value: { signatures: result.signatures.map(signature => ({ label: signature.label,
          documentation: signature.documentation ? markdown(signature.documentation) : undefined,
          parameters: (signature.parameters ?? []).map(parameter => ({ label: parameter.label,
            documentation: parameter.documentation ? markdown(parameter.documentation) : undefined })) })),
        activeSignature: result.activeSignature ?? 0, activeParameter: result.activeParameter ?? 0 }, dispose() {} };
      },
    }), api.languages.registerDefinitionProvider(selector, { provideDefinition: async (model, position, token) => {
      if (!this.connection?.capabilities.definitionProvider) return;
      const cell = this.cell(model), point = cell && this.projection.position(cell, toPosition(position)); if (!point) return;
      const result = await this.request<L.Location | L.Location[] | L.LocationLink[]>('textDocument/definition', { position: point }, token);
      return (result ? Array.isArray(result) ? result : [result] : []).flatMap(location => {
        const uri = 'uri' in location ? location.uri : location.targetUri;
        const range = 'range' in location ? location.range : location.targetSelectionRange;
        if (uri !== this.connection?.uri) return uri.startsWith('file:') ? [{ uri: api.Uri.parse(uri), range: fromRange(range) }] : [];
        const mapped = this.projection.range(range); if (!mapped) return [];
        const cell = entry.document.cells.find(cell => cell.id === mapped.id); if (!cell) return [];
        const target = entry.model(api, cell);
        return [{ uri: target.uri, range: fromRange(mapped.range) }];
      });
    } }), api.editor.registerEditorOpener({ openCodeEditor: async (source, uri, selection) => {
      const origin = source.getModel();
      if (uri.scheme === 'file' && origin && this.cell(origin)) { await openFile(uri.toString(), selection); return true; }
      const cell = [...entry.models].find(([, model]) => model.uri.toString() === uri.toString())?.[0];
      if (!cell) return false;
      const range = selection && 'startLineNumber' in selection ? selection : { startLineNumber: selection?.lineNumber ?? 1,
        endLineNumber: selection?.lineNumber ?? 1, startColumn: selection?.column ?? 1, endColumn: selection?.column ?? 1 };
      await reveal(cell, range); return true;
    } }));
    void this.reconnect();
  }
  updateMarkers(): void {
    const mapped = this.diagnostics.map(diagnostic => ({ diagnostic, target: this.projection.range(diagnostic.range) }));
    for (const [id, model] of this.entry.models) if (!model.isDisposed()) this.api.editor.setModelMarkers(model, 'notebook-language',
      mapped.filter(item => item.target?.id === id).map(item => marker(this.api, { ...item.diagnostic,
        range: item.target!.range, relatedInformation: undefined })));
  }
  private cell(model: M.editor.ITextModel): string | undefined {
    return this.entry.document.cells.find(cell => this.entry.models.get(cell.id) === model)?.id;
  }
  private mapCompletion(id: string, item: L.CompletionItem): L.CompletionItem | null {
    const local = (range: L.Range) => { const mapped = this.projection.range(range); return mapped?.id === id ? mapped.range : undefined; };
    const result = { ...item };
    if (item.textEdit) {
      if ('range' in item.textEdit) { const range = local(item.textEdit.range); if (!range) return null; result.textEdit = { ...item.textEdit, range }; }
      else { const insert = local(item.textEdit.insert), replace = local(item.textEdit.replace); if (!insert || !replace) return null;
        result.textEdit = { ...item.textEdit, insert, replace }; }
    }
    const edits: L.TextEdit[] = [];
    for (const edit of item.additionalTextEdits ?? []) { const range = local(edit.range); if (!range) return null; edits.push({ ...edit, range }); }
    result.additionalTextEdits = edits; return result;
  }
  private async reconnect(): Promise<void> {
    if (this.disposed) return;
    this.port.close(this.id); this.connection = undefined; this.sent = 0;
    const generation = this.generation = crypto.randomUUID(), version = this.version;
    this.connecting = true; this.status('starting');
    try {
      const connection = await this.port.open({ id: this.id, generation, path: this.path, notebook: 'python', text: this.projection.text, version });
      if (this.disposed || generation !== this.generation) return;
      if ('unavailable' in connection) { this.status(connection.unavailable); return; }
      this.connection = connection; this.sent = version; this.status('ready'); await this.flush();
    } catch (error) { if (!this.disposed && generation === this.generation) { this.status('failed'); console.warn('Notebook language support:', error); } }
    finally { if (generation === this.generation) this.connecting = false; }
  }
  private flush(): Promise<void> {
    clearTimeout(this.timer);
    this.queue = this.queue.then(async () => {
      if (this.disposed || !this.connection || this.sent === this.version) return;
      const version = this.version, generation = this.generation;
      if (textSynchronization(this.connection.capabilities).change === 0) return;
      await this.port.change(this.id, version, [{ text: this.projection.text }]);
      if (generation === this.generation) this.sent = version;
    }).catch(error => { if (!this.disposed) console.warn('Notebook synchronization:', error); });
    return this.queue;
  }
  private async request<T>(method: LanguageMethod, params: object, token: M.CancellationToken): Promise<T | null> {
    const version = this.version, generation = this.generation;
    await this.flush(); if (this.disposed || !this.connection || this.sent !== version || token.isCancellationRequested) return null;
    const id = crypto.randomUUID(); this.requests.add(id);
    const cancel = token.onCancellationRequested(() => this.port.cancel(id));
    try { const result = await this.port.request(this.id, version, id, method, params);
      return !this.disposed && version === this.version && generation === this.generation && !token.isCancellationRequested ? result as T : null;
    } catch { return null; } finally { cancel.dispose(); this.requests.delete(id); }
  }
  dispose(): void {
    this.disposed = true; clearTimeout(this.timer); for (const id of this.requests) this.port.cancel(id);
    this.port.close(this.id); for (const disposable of this.disposables) disposable.dispose();
  }
}
