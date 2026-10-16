import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';
import type { LanguageApi, LanguageConnection, LanguageMethod } from '../../protocol/language';
import type { NotebookEntry } from './notebook-store';
import { completion, completionDefaults, fromRange, markdown, marker, toPosition } from '../editor/language-conversion';

/** Cell documents retain their IPython semantics and local coordinates.
 * Providers still reject edits/commands that cannot be applied transactionally. */
export class NotebookLanguage {
  private connection?: LanguageConnection;
  private sourceKey = "";
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
  private diagnostics = new Map<string, L.Diagnostic[]>();
  constructor(private api: typeof M, private port: LanguageApi, private entry: NotebookEntry, private path: string,
    private status: (state: string) => void, openFile: (uri: string, selection?: M.IRange | M.IPosition) => Promise<void>, reveal: (id: string, selection: M.IRange) => Promise<void>, private python?: string) {
    this.sourceKey = JSON.stringify(this.cells());
    const unsubscribe = entry.document.subscribe(event => {
      if (event === 'output') return;
      const key = JSON.stringify(this.cells()); if (key === this.sourceKey) return;
      this.sourceKey = key; this.version++;
      this.diagnostics.clear(); this.updateMarkers();
      clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush(); }, 150);
    });
    const events = port.onEvent(event => {
      if (event.type === 'discovery') { if (!this.connection && !this.connecting) void this.reconnect(); return; }
      if (event.type === 'configuration') {
        if (!this.connection?.server || !event.servers || event.servers.includes(this.connection.server)) void this.reconnect();
        return;
      }
      if (event.type === 'diagnostics' && event.id === this.id && event.generation === this.generation && event.version === this.version) {
        const cell = this.entry.document.cells.find(cell => cell.id === event.cell);
        if (cell && cell.version === event.cellVersion) { this.diagnostics.set(cell.id, event.diagnostics); this.updateMarkers(); }
      }
      if (event.type === 'status' && event.documents.some(doc => doc.id === this.id && doc.generation === this.generation)) { if (event.state === 'failed') { this.diagnostics.clear(); this.updateMarkers(); } status(event.state); }
    });
    this.disposables.push({ dispose: unsubscribe }, { dispose: events });
    const selector = { language: 'python', scheme: 'setdown-cell' };
    this.disposables.push(api.languages.registerCompletionItemProvider(selector, {
      triggerCharacters: ['.'], provideCompletionItems: async (model, position, context, token) => {
        if (!this.connection?.capabilities.completionProvider) return;
        const cell = this.cell(model), point = cell && toPosition(position); if (!cell || !point) return;
        const result = await this.request<L.CompletionList | L.CompletionItem[]>(cell, 'textDocument/completion', { position: point,
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
      const cell = this.cell(model), point = cell && toPosition(position); if (!cell || !point) return;
      const result = await this.request<L.Hover>(cell, 'textDocument/hover', { position: point }, token); if (!result) return;
      const range = result.range && this.range(cell, result.range);
      return { contents: (Array.isArray(result.contents) ? result.contents : [result.contents]).map(markdown),
        range: range?.id === cell ? fromRange(range.range) : undefined };
    } }), api.languages.registerSignatureHelpProvider(selector, {
      signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [',', ')'],
      provideSignatureHelp: async (model, position, token) => {
        if (!this.connection?.capabilities.signatureHelpProvider) return;
        const cell = this.cell(model), point = cell && toPosition(position); if (!cell || !point) return;
        const result = await this.request<L.SignatureHelp>(cell, 'textDocument/signatureHelp', { position: point }, token); if (!result) return;
        return { value: { signatures: result.signatures.map(signature => ({ label: signature.label,
          documentation: signature.documentation ? markdown(signature.documentation) : undefined,
          parameters: (signature.parameters ?? []).map(parameter => ({ label: parameter.label,
            documentation: parameter.documentation ? markdown(parameter.documentation) : undefined })) })),
        activeSignature: result.activeSignature ?? 0, activeParameter: result.activeParameter ?? 0 }, dispose() {} };
      },
    }), api.languages.registerDefinitionProvider(selector, { provideDefinition: async (model, position, token) => {
      if (!this.connection?.capabilities.definitionProvider) return;
      const cell = this.cell(model), point = cell && toPosition(position); if (!cell || !point) return;
      const result = await this.request<L.Location | L.Location[] | L.LocationLink[]>(cell, 'textDocument/definition', { position: point }, token);
      return (result ? Array.isArray(result) ? result : [result] : []).flatMap(location => {
        const uri = 'uri' in location ? location.uri : location.targetUri;
        const range = 'range' in location ? location.range : location.targetSelectionRange;
        const targetId = Object.entries(this.connection?.cells ?? {}).find(([, value]) => value === uri)?.[0];
        if (!targetId) return uri.startsWith('file:') ? [{ uri: api.Uri.parse(uri), range: fromRange(range) }] : [];
        const mapped = this.range(targetId, range); if (!mapped) return [];
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
  private readonly commandToken: M.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  private position(id: string, offset: number): L.Position {
    const cell = this.entry.document.cells.find(cell => cell.id === id); if (!cell) throw Error('Select a code cell first.');
    const lines = cell.source.slice(0, offset).split(/\r\n|\r|\n/); return { line: lines.length - 1, character: lines.at(-1)!.length };
  }
  private transaction(edit: L.WorkspaceEdit): () => void {
    if (edit.changeAnnotations && Object.values(edit.changeAnnotations).some(item => item.needsConfirmation)) throw Error('This action requires changes outside the notebook.');
    const version = this.version, groups = new Map<string, L.TextEdit[]>();
    const add = (uri: string, edits: L.TextEdit[]) => {
      const id = Object.entries(this.connection?.cells ?? {}).find(([, value]) => value === uri)?.[0];
      if (!id) throw Error('This action also edits another file. Open the notebook in JupyterLab to apply it there.');
      groups.set(id, [...groups.get(id) ?? [], ...edits]);
    };
    if (edit.changes && edit.documentChanges) throw Error('Ambiguous workspace edit.');
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits);
    for (const change of edit.documentChanges ?? []) {
      if (!('textDocument' in change)) throw Error('File operations cannot be applied as a notebook cell edit.');
      const id = Object.entries(this.connection?.cells ?? {}).find(([, value]) => value === change.textDocument.uri)?.[0];
      const cell = this.entry.document.cells.find(cell => cell.id === id);
      if (change.textDocument.version != null && change.textDocument.version !== cell?.version) throw Error('A cell changed. Request this action again.');
      if (change.edits.some(edit => !('newText' in edit))) throw Error('Unsupported snippet edit.');
      add(change.textDocument.uri, change.edits as L.TextEdit[]);
    }
    const edits = [...groups].map(([id, changes]) => {
      const cell = this.entry.document.cells.find(cell => cell.id === id)!;
      const offset = (p: L.Position) => { const lines = cell.source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []; return lines.slice(0, p.line).reduce((total, line) => total + line.length, 0) + p.character; };
      const mapped = changes.map(edit => { if (!this.range(id, edit.range)) throw Error('Invalid cell edit range.'); return { start: offset(edit.range.start), end: offset(edit.range.end), text: edit.newText }; }).sort((a, b) => b.start - a.start);
      let source = cell.source, boundary = source.length + 1;
      for (const change of mapped) { if (change.start > change.end || change.end >= boundary) throw Error('Overlapping cell edits.'); source = source.slice(0, change.start) + change.text + source.slice(change.end); boundary = change.start + 1; }
      return { id, version: cell.version, source };
    });
    return () => { if (this.disposed || version !== this.version) throw Error('The notebook changed. Request this action again.'); this.entry.document.editSources(edits); };
  }
  async rename(id: string | undefined, offset: number, newName: string): Promise<void> {
    if (!id || !this.connection?.capabilities.renameProvider) throw Error('Rename is not available in this notebook.');
    if (!/^[\p{ID_Start}_][\p{ID_Continue}]*$/u.test(newName)) throw Error('Enter a valid Python identifier.');
    const edit = await this.request<L.WorkspaceEdit>(id, 'textDocument/rename', { position: this.position(id, offset), newName }, this.commandToken);
    if (!edit) throw Error('No rename edits were returned, or the notebook changed.'); this.transaction(edit)();
  }
  async actions(id: string | undefined, offset: number): Promise<{ title: string; apply(): void }[]> {
    if (!id || !this.connection?.capabilities.codeActionProvider) return [];
    const position = this.position(id, offset);
    const actions = await this.request<(L.CodeAction | L.Command)[]>(id, 'textDocument/codeAction', { range: { start: position, end: position }, context: { diagnostics: this.diagnostics.get(id) ?? [] } }, this.commandToken);
    return (actions ?? []).flatMap(action => {
      if (!('edit' in action) || !action.edit || action.command || action.disabled) return [];
      try { return [{ title: action.title, apply: this.transaction(action.edit) }]; } catch { return []; }
    });
  }
  private cells() { return this.entry.document.cells.filter(cell => cell.kind === 'code').map(cell => ({ id: cell.id, version: cell.version, text: cell.source })); }
  private range(id: string, range: L.Range): { id: string; range: L.Range } | null {
    const cell = this.entry.document.cells.find(cell => cell.id === id && cell.kind === 'code'); if (!cell) return null;
    const lines = cell.source.split(/\r\n|\r|\n/);
    const valid = (p: L.Position) => Number.isInteger(p.line) && Number.isInteger(p.character) && p.line >= 0 && p.line < lines.length && p.character >= 0 && p.character <= lines[p.line].length;
    return valid(range.start) && valid(range.end) ? { id, range } : null;
  }
  updateMarkers(): void {
    for (const [id, model] of this.entry.models) if (!model.isDisposed()) this.api.editor.setModelMarkers(model, 'notebook-language',
      (this.diagnostics.get(id) ?? []).filter(diagnostic => this.range(id, diagnostic.range))
        .map(diagnostic => marker(this.api, { ...diagnostic, relatedInformation: undefined })));
  }
  private cell(model: M.editor.ITextModel): string | undefined {
    return this.entry.document.cells.find(cell => this.entry.models.get(cell.id) === model)?.id;
  }
  private mapCompletion(id: string, item: L.CompletionItem): L.CompletionItem | null {
    const local = (range: L.Range) => { const mapped = this.range(id, range); return mapped?.id === id ? mapped.range : undefined; };
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
    this.port.close(this.id); this.connection = undefined; this.sent = 0; this.diagnostics.clear(); this.updateMarkers();
    const generation = this.generation = crypto.randomUUID(), version = this.version;
    this.connecting = true; this.status('starting');
    try {
      const connection = await this.port.open({ id: this.id, generation, path: this.path, notebook: 'python', cells: this.cells(), python: this.python, text: '', version });
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
      const cells = await this.port.changeNotebook(this.id, version, this.cells());
      if (generation === this.generation && this.connection) this.connection.cells = cells;
      if (generation === this.generation) this.sent = version;
    }).catch(error => { if (!this.disposed) console.warn('Notebook synchronization:', error); });
    return this.queue;
  }
  private async request<T>(cell: string, method: LanguageMethod, params: object, token: M.CancellationToken): Promise<T | null> {
    const version = this.version, generation = this.generation;
    await this.flush(); if (this.disposed || !this.connection || this.sent !== version || token.isCancellationRequested) return null;
    const id = crypto.randomUUID(); this.requests.add(id);
    const cancel = token.onCancellationRequested(() => this.port.cancel(id));
    try { const result = await this.port.request(this.id, version, id, method, { ...params, cell });
      return !this.disposed && version === this.version && generation === this.generation && !token.isCancellationRequested ? result as T : null;
    } catch { return null; } finally { cancel.dispose(); this.requests.delete(id); }
  }
  dispose(): void {
    this.disposed = true; clearTimeout(this.timer); for (const id of this.requests) this.port.cancel(id);
    this.diagnostics.clear(); this.updateMarkers(); this.port.close(this.id); for (const disposable of this.disposables) disposable.dispose();
  }
}
