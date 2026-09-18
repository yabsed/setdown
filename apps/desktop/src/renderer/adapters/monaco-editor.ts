import type * as Monaco from 'monaco-editor';
import type { DocumentSnapshot } from '../../core/document/document';
import type { PreviewThemeId } from '../../core/preview/preview-preferences';
import type { BandLine, ViewportAnchor } from '../../core/preview/viewport-anchor';
import type { WorkspaceTab } from '../../core/workspace/workspace-state';
import { readEditorViewport } from '../editor/editor-viewport';
import { monacoThemeName, registerMonacoThemes } from '../theme';

type Options = {
  host: HTMLElement;
  tabs: () => WorkspaceTab[];
  active: () => WorkspaceTab | null;
  theme: () => PreviewThemeId;
  status: (status: 'loading' | 'ready' | 'error') => void;
  changed: (tab: WorkspaceTab, text: string) => void;
  scrolled: () => void;
  escape: () => void;
  insertLink: () => void;
  insertTable: () => void;
};

export class MonacoEditor {
  private apiValue: typeof Monaco | null = null;
  private editorValue: Monaco.editor.IStandaloneCodeEditor | null = null;
  private loading: Promise<void> | null = null;
  private readonly models = new Map<string, Monaco.editor.ITextModel>();
  private readonly views = new Map<string, Monaco.editor.ICodeEditorViewState | null>();

  constructor(private readonly options: Options) {}

  get api() { return this.apiValue; }
  get editor() { return this.editorValue; }
  get model() { return this.editorValue?.getModel() ?? null; }
  get loaded() { return this.editorValue !== null; }

  text(tab: WorkspaceTab): string {
    return this.models.get(tab.id)?.getValue() ?? tab.text;
  }

  lineCount(tab: WorkspaceTab): number {
    return this.models.get(tab.id)?.getLineCount()
      ?? (tab.text.length === 0 ? 1 : tab.text.split(/\r\n|\r|\n/).length);
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
      this.editorValue = api.editor.create(this.options.host, {
        automaticLayout: true,
        language: 'markdown',
        theme: monacoThemeName(this.options.theme()),
        wordWrap: 'on',
        wrappingIndent: 'same',
        lineNumbers: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: 'on',
        fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
        fontSize: 15,
        lineHeight: 24,
        padding: { top: 26, bottom: 60 },
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        stickyScroll: { enabled: false },
      });
      this.installBindings(api, this.editorValue);
      for (const tab of this.options.tabs()) this.ensureModel(tab);
      const active = this.options.active();
      if (active) this.activate(active);
      this.options.status('ready');
    }).catch((error) => {
      this.loading = null;
      this.options.status('error');
      throw error;
    });
    return this.loading;
  }

  activate(tab: WorkspaceTab): void {
    if (!this.editorValue) return;
    this.editorValue.setModel(this.ensureModel(tab));
    const view = this.views.get(tab.id);
    if (view) this.editorValue.restoreViewState(view);
  }

  saveView(tab: WorkspaceTab): void {
    const editor = this.editorValue;
    if (editor && editor.getModel() === this.models.get(tab.id)) {
      this.views.set(tab.id, editor.saveViewState());
    }
    tab.text = this.text(tab);
  }

  exportView(tabId: string): unknown {
    return this.views.get(tabId) ?? null;
  }

  importView(tabId: string, value: unknown): void {
    this.views.set(tabId, value as Monaco.editor.ICodeEditorViewState | null);
  }

  replace(tab: WorkspaceTab, document: DocumentSnapshot): void {
    this.models.get(tab.id)?.dispose();
    this.models.delete(tab.id);
    tab.text = document.text;
    tab.revision = document.revision;
    if (this.editorValue) this.activate(tab);
  }

  dispose(tabId: string): void {
    const model = this.models.get(tabId);
    const editor = this.editorValue;
    if (editor && editor.getModel() === model) editor.setModel(null);
    model?.dispose();
    this.models.delete(tabId);
    this.views.delete(tabId);
  }

  clear(): void {
    this.editorValue?.setModel(null);
  }

  setTheme(theme: PreviewThemeId): void {
    this.apiValue?.editor.setTheme(monacoThemeName(theme));
  }

  layout(): void {
    this.editorValue?.layout();
  }

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
      editor.layout();
      const top = editor.getTopForLineNumber(line) - editor.getLayoutInfo().height * anchor.yRatio;
      editor.setScrollTop(Math.max(0, top));
      editor.focus();
    }, 0);
  }

  private ensureModel(tab: WorkspaceTab): Monaco.editor.ITextModel {
    const existing = this.models.get(tab.id);
    if (existing) return existing;
    if (!this.apiValue) throw new Error('Monaco is not loaded.');
    const uri = this.apiValue.Uri.file(tab.document.path).with({ query: tab.id });
    const model = this.apiValue.editor.createModel(tab.text, 'markdown', uri);
    model.onDidChangeContent(() => {
      if (this.editorValue?.getModel() === model) this.options.changed(tab, model.getValue());
    });
    this.models.set(tab.id, model);
    return model;
  }

  private installBindings(api: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor): void {
    editor.onDidScrollChange((event) => {
      if (event.scrollTopChanged) this.options.scrolled();
    });
    editor.addAction({
      id: 'setdown.insertLink',
      label: '링크 삽입',
      keybindings: [api.KeyMod.CtrlCmd | api.KeyCode.KeyK],
      contextMenuGroupId: '1_modification',
      run: this.options.insertLink,
    });
    editor.addAction({
      id: 'setdown.insertTable',
      label: '표 삽입',
      contextMenuGroupId: '1_modification',
      run: this.options.insertTable,
    });
    editor.addCommand(
      api.KeyCode.Escape,
      this.options.escape,
      '!suggestWidgetVisible && !findInputFocussed && !renameInputVisible && !compositionInProgress',
    );
  }
}
