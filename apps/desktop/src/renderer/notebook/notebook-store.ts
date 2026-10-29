import type { NotebookExecution } from './notebook-execution';
import { NotebookDocument, type NotebookCell } from '../../core/notebook/notebook-document';
import type { DocumentContent as DocumentTab } from '../../core/workspace/document-store';
import type * as Monaco from 'monaco-editor';
import { NotebookController } from './notebook-controller';
import type { NotebookChange } from '../../core/notebook/notebook-document';

export class NotebookEntry {
  readonly document: NotebookDocument;
  readonly models = new Map<string, Monaco.editor.ITextModel>();
  readonly views = new Map<string, Monaco.editor.ICodeEditorViewState | null>();
  readonly controller: NotebookController;
  execution?: NotebookExecution;
  changed?: (event: NotebookChange) => void;
  private release: () => void;
  constructor(readonly id: string, text: string, savedText: string) {
    this.document = new NotebookDocument(text);
    this.controller = new NotebookController(this.document);
    this.document.markSaved(savedText);
    this.release = this.document.subscribe(event => {
      if (event === 'structure') {
        const present = new Set(this.document.cells.map(cell => cell.id));
        for (const [id, model] of this.models) if (!present.has(id)) {
          model.dispose(); this.models.delete(id); this.views.delete(id);
        }
        for (const cell of this.document.cells) {
          const model = this.models.get(cell.id);
          if (model && model.getValue() !== cell.source) {
            model.pushStackElement();
            model.pushEditOperations(null, [{ range: model.getFullModelRange(), text: cell.source }], () => null);
            model.pushStackElement();
          }
        }
        this.controller.reconcile();
      }
      this.changed?.(event);
    });
  }
  model(api: typeof Monaco, cell: NotebookCell): Monaco.editor.ITextModel {
    const language = cell.kind === 'markdown' ? 'markdown' : cell.kind === 'raw' ? 'plaintext' : this.document.language;
    let model = this.models.get(cell.id);
    if (!model) {
      model = api.editor.createModel(cell.source, language, api.Uri.parse(`setdown-cell://${this.id}/${cell.id}`));
      this.models.set(cell.id, model);
      const owned = model;
      const listener = model.onDidChangeContent(() => this.document.setSource(cell.id, owned.getValue()));
      model.onWillDispose(() => listener.dispose());
    } else if (model.getLanguageId() !== language) api.editor.setModelLanguage(model, language);
    return model;
  }
  dispose(): void { this.execution?.dispose(); this.release(); for (const model of this.models.values()) model.dispose(); this.models.clear(); }
}
class NotebookStore {
  private entries = new Map<string, NotebookEntry>();
  get(tab: DocumentTab): NotebookEntry {
    let entry = this.entries.get(tab.id);
    if (!entry) { entry = new NotebookEntry(tab.id, tab.text, tab.document.savedText); this.entries.set(tab.id, entry); }
    return entry;
  }
  dispose(id: string): void { this.entries.get(id)?.dispose(); this.entries.delete(id); }
  disposeAll(): void { for (const id of this.entries.keys()) this.dispose(id); }
}
export const notebooks = new NotebookStore();
