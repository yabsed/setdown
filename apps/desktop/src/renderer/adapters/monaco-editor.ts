import type * as Monaco from 'monaco-editor';
import type { DocumentSnapshot } from '../../core/document/document';
import { documentLanguage } from '../../core/document/document-profile';
import { hasMarkdownPreview } from '../../core/document/document-capabilities';
import type { PreviewThemeId } from '../../core/preview/preview-preferences';
import type { BandLine, ViewportAnchor } from '../../core/preview/viewport-anchor';
import type { WorkspaceTab } from '../../core/workspace/workspace-state';
import type { ProjectSearchDocument } from '../../protocol/desktop-api';
import type { WorkingTreeEdit } from '../view-state.svelte';
import { readEditorViewport } from '../editor/editor-viewport';
import { installMarkdownEditorActions } from '../editor/markdown-editor-actions';
import { monacoThemeName, registerMonacoThemes } from '../theme';

type Options = {
  host: HTMLElement; tabs: () => WorkspaceTab[]; active: () => WorkspaceTab | null;
  theme: () => PreviewThemeId; status: (status: 'loading' | 'ready' | 'error') => void;
  changed: (tab: WorkspaceTab, text: string) => void;
  scrolled: () => void; escape: () => void; insertLink: () => void; insertTable: () => void;
};
type SearchTarget = { line: number; column: number; ordinal: number };
type ProjectMatch = NonNullable<ProjectSearchDocument['matches']>[number];

export class MonacoEditor {
  private apiValue: typeof Monaco | null = null;
  private editorValue: Monaco.editor.IStandaloneCodeEditor | null = null;
  private loading: Promise<void> | null = null;
  private projectDecorations: Monaco.editor.IEditorDecorationsCollection | null = null;
  private readonly models = new Map<string, Monaco.editor.ITextModel>();
  private readonly modelPaths = new Map<string, string>();
  private readonly views = new Map<string, Monaco.editor.ICodeEditorViewState | null>();
  constructor(private readonly options: Options) {}
  get api() { return this.apiValue; }
  get editor() { return this.editorValue; }
  get model() { return this.editorValue?.getModel() ?? null; }
  get loaded() { return this.editorValue !== null; }
  text(tab: WorkspaceTab): string { return this.models.get(tab.id)?.getValue() ?? tab.text; }
  lineCount(tab: WorkspaceTab): number {
    return this.models.get(tab.id)?.getLineCount() ?? (tab.text.length === 0 ? 1 : tab.text.split(/\r\n|\r|\n/).length);
  }
  async load(): Promise<void> {
    if (this.editorValue) return;
    if (this.loading) return this.loading;
    this.options.status('loading');
    this.loading = Promise.all([
      import('monaco-editor/editor/editor.main'),
      import('monaco-editor/editor/editor.worker?worker'),
    ]).then(([api, workerModule]) => {
      this.apiValue = api;
      window.MonacoEnvironment = { getWorker: () => new workerModule.default() };
      registerMonacoThemes(api);
      // Keep Markdown's complete editor configuration unchanged. Syntax selection
      // lives on each model; introducing text tabs cannot leak different wrapping.
      this.editorValue = api.editor.create(this.options.host, {
        automaticLayout: true, language: 'markdown', theme: monacoThemeName(this.options.theme()),
        wordWrap: 'on', wrappingIndent: 'same', lineNumbers: 'on', minimap: { enabled: false },
        scrollBeyondLastLine: false, smoothScrolling: true, cursorSmoothCaretAnimation: 'on',
        fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
        fontSize: 15, lineHeight: 24, padding: { top: 26, bottom: 60 },
        renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, stickyScroll: { enabled: false },
      });
      this.projectDecorations = this.editorValue.createDecorationsCollection();
      this.installBindings(api, this.editorValue);
      for (const tab of this.options.tabs()) this.ensureModel(tab);
      const active = this.options.active();
      if (active) this.activate(active);
      this.options.status('ready');
    }).catch((error) => { this.loading = null; this.options.status('error'); throw error; });
    return this.loading;
  }
  activate(tab: WorkspaceTab): void {
    if (!this.editorValue) return;
    this.editorValue.setModel(this.ensureModel(tab));
    const view = this.views.get(tab.id);
    if (view) this.editorValue.restoreViewState(view);
  }
  /** Retarget highlighting without replacing content, undo history or view state. */
  retarget(tab: WorkspaceTab): void {
    const model = this.models.get(tab.id);
    if (!this.apiValue || !model || this.modelPaths.get(tab.id) === tab.document.path) return;
    const language = documentLanguage(tab.document.path, this.apiValue.languages.getLanguages(), model.getLineContent(1));
    if (model.getLanguageId() !== language) this.apiValue.editor.setModelLanguage(model, language);
    this.modelPaths.set(tab.id, tab.document.path);
  }
  saveView(tab: WorkspaceTab): void {
    const editor = this.editorValue;
    if (editor && editor.getModel() === this.models.get(tab.id)) this.views.set(tab.id, editor.saveViewState());
    tab.text = this.text(tab);
  }
  exportView(tabId: string): unknown { return this.views.get(tabId) ?? null; }
  importView(tabId: string, value: unknown): void { this.views.set(tabId, value as Monaco.editor.ICodeEditorViewState | null); }
  replace(tab: WorkspaceTab, document: DocumentSnapshot): void {
    const previous = this.models.get(tab.id);
    const active = this.editorValue?.getModel() === previous;
    previous?.dispose();
    this.models.delete(tab.id);
    this.modelPaths.delete(tab.id);
    tab.text = document.text;
    tab.revision = document.revision;
    if (active) this.activate(tab);
  }
  /** Updates an existing document buffer without changing its saved baseline. */
  setText(tab: WorkspaceTab, text: string, edits?: WorkingTreeEdit[]): boolean {
    const model = this.models.get(tab.id);
    if (!model) { tab.text = text; return false; }
    const active = this.editorValue?.getModel() === model;
    if (edits) {
      if (edits.length) model.applyEdits(edits.map((edit) => ({ range: edit.range, text: edit.text })));
      return active;
    }
    if (model.getValue() === text) return active;
    model.setValue(text);
    return active;
  }
  dispose(tabId: string): void {
    const model = this.models.get(tabId);
    const editor = this.editorValue;
    if (editor && editor.getModel() === model) editor.setModel(null);
    model?.dispose();
    this.models.delete(tabId); this.modelPaths.delete(tabId); this.views.delete(tabId);
  }
  clear(): void { this.editorValue?.setModel(null); }
  setTheme(theme: PreviewThemeId): void { this.apiValue?.editor.setTheme(monacoThemeName(theme)); }
  layout(): void { this.editorValue?.layout(); }
  find(): void { void this.editorValue?.getAction('actions.find')?.run(); }
  viewport(fallback: ViewportAnchor): { anchor: ViewportAnchor; band: BandLine[] } {
    return readEditorViewport(this.editorValue, this.apiValue, this.model, fallback);
  }
  reveal(anchor: ViewportAnchor): void {
    const editor = this.editorValue;
    const model = this.model;
    if (!editor || !model) return;
    const line = anchor.sourceLine;
    const column = Math.min(anchor.sourceColumn ?? 1, model.getLineMaxColumn(line));
    editor.setPosition({ lineNumber: line, column });
    window.setTimeout(() => {
      if (this.editorValue !== editor || editor.getModel() !== model) return;
      editor.layout();
      const top = editor.getTopForLineNumber(line) - editor.getLayoutInfo().height * anchor.yRatio;
      editor.setScrollTop(Math.max(0, top));
      editor.focus();
    }, 0);
  }
  projectSearch(query: string, target?: SearchTarget): void {
    const editor = this.editorValue;
    const model = editor?.getModel();
    if (!editor || !model || !this.projectDecorations) return;
    if (!query) { this.projectDecorations.clear(); return; }
    const matches = model.findMatches(query, false, false, false, null, false, 10_000);
    let active = -1;
    if (target) {
      active = matches.findIndex(({ range }) => range.startLineNumber === target.line && range.startColumn === target.column);
      if (active < 0 && matches.length) active = Math.min(Math.max(0, target.ordinal), matches.length - 1);
    }
    this.projectDecorations.set(matches.map(({ range }, index) => ({ range, options: {
      inlineClassName: index === active ? 'editor-project-search-active' : 'editor-project-search-match',
    } })));
    if (active >= 0) {
      editor.setSelection(matches[active].range);
      editor.revealRangeInCenterIfOutsideViewport(matches[active].range);
      editor.focus();
    }
  }
  projectMatches(tab: WorkspaceTab, query: string, limit = 300): ProjectMatch[] {
    const model = this.models.get(tab.id);
    if (!model || !query) return [];
    const perLine = new Map<number, number>();
    return model.findMatches(query, false, false, false, null, false, limit).map(({ range }, ordinal) => {
      const line = range.startLineNumber;
      const column = range.startColumn;
      const content = model.getLineContent(line);
      const start = Math.max(0, column - 1 - 60);
      const end = Math.min(content.length, range.endColumn - 1 + 120);
      const match: ProjectMatch = { line, column, lineOccurrence: perLine.get(line) ?? 0, ordinal,
        preview: `${start ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}` };
      perLine.set(line, match.lineOccurrence + 1);
      return match;
    });
  }
  private ensureModel(tab: WorkspaceTab): Monaco.editor.ITextModel {
    const existing = this.models.get(tab.id);
    if (existing) { this.retarget(tab); return existing; }
    if (!this.apiValue) throw new Error('Monaco is not loaded.');
    const uri = this.apiValue.Uri.file(tab.document.path).with({ query: tab.id });
    const language = documentLanguage(tab.document.path, this.apiValue.languages.getLanguages(), tab.text.split(/[\r\n]/, 1)[0]);
    const model = this.apiValue.editor.createModel(tab.text, language, uri);
    if (tab.document.eol) model.setEOL(tab.document.eol === 'crlf'
      ? this.apiValue.editor.EndOfLineSequence.CRLF : this.apiValue.editor.EndOfLineSequence.LF);
    model.onDidChangeContent(() => {
      if (this.editorValue?.getModel() === model) this.options.changed(tab, model.getValue());
    });
    this.models.set(tab.id, model);
    this.modelPaths.set(tab.id, tab.document.path);
    return model;
  }
  private installBindings(api: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor): void {
    editor.onDidScrollChange((event) => {
      if (event.scrollTopChanged && hasMarkdownPreview(this.options.active()?.document)) this.options.scrolled();
    });
    installMarkdownEditorActions(api, editor, this.options, () => hasMarkdownPreview(this.options.active()?.document));
    editor.addCommand(api.KeyCode.Escape, this.options.escape,
      'setdownMarkdownDocument && !suggestWidgetVisible && !findInputFocussed && !renameInputVisible && !compositionInProgress');
  }
}
