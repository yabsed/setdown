import { documentIdentity, type DocumentContent } from '../../core/workspace/document-store';
import { isNotebookDocument } from '../../core/document/document-profile';
import { onTextZoom, textZoomOptions } from '../editor/text-zoom';
import { APP_FONT_FAMILY } from '../../core/theme/typography';
import type * as Monaco from 'monaco-editor';
import type { DocumentSnapshot } from '../../core/document/document';
import { documentLanguage } from '../../core/document/document-profile';
import { hasMarkdownPreview } from '../../core/document/document-capabilities';
import type { PreviewThemeId } from '../../core/preview/preview-preferences';
import type { BandLine, ViewportAnchor } from '../../core/preview/viewport-anchor';
import type { DocumentTab as WorkspaceTab } from '../../core/workspace/workspace-state';
import type { ProjectSearchDocument } from '../../protocol/desktop-api';
import type { WorkingTreeEdit } from '../../core/document/text-edit';
import { readEditorViewport } from '../editor/editor-viewport';
import { DocumentModelOwner, liveDocumentModels } from '../editor/live-document-model';
import { installMarkdownEditorActions } from '../editor/markdown-editor-actions';
import { monacoThemeName, registerMonacoThemes } from '../theme';
import { languageSupport, type LanguageRoute } from '../../core/document/language-support';
import type { LanguageOptions } from '../language/language-client';
import type { LanguageServices } from '../language/language-services';
import { documentSupport, builtinSupport, onBuiltinSupport, retargetBuiltin } from '../language/language-runtime';
import { recognizedLanguage } from '../../core/document/language-policy';
import { loadMonaco } from '../editor/monaco-runtime';
import { displayOptions, releaseDisplayOptions } from '../editor/tools/view-display';

type Options = {
  releaseDocuments?(): void;
  contents?(): DocumentContent[];
  viewIds?(content: DocumentContent): string[];
  content?(tab: DocumentContent): DocumentContent;
  pythonCells?(path: string, source: string): Promise<void>;
  language?: Omit<LanguageOptions, 'status'>;
  host: HTMLElement; tabs: () => WorkspaceTab[]; active: () => WorkspaceTab | null;
  theme: () => PreviewThemeId; status: (status: 'loading' | 'ready' | 'error') => void;
  changed: (tab: DocumentContent, text: string) => void;
  viewChanged?: () => void;
  focusTab?: (id: string) => void;
  scrolled: () => void; escape: () => void; insertLink: () => void; insertTable: () => void;
};
type SearchTarget = { line: number; column: number; ordinal: number };
type ProjectMatch = NonNullable<ProjectSearchDocument['matches']>[number];

export class MonacoEditor {
  private languageRoutes: LanguageRoute[] | undefined;
  private languageConfiguration: Promise<LanguageRoute[]> | undefined;
  private languageEpoch = 0;
  private unregisterLanguage?: () => void;
  private readonly languageContexts = new Map<Monaco.editor.IStandaloneCodeEditor, () => void>();
  private languageClient: LanguageServices | undefined;
  private readonly languageOverrides = new Map<string, string>();
  private readonly offBuiltin = onBuiltinSupport(model => {
    const tab = this.options.tabs().find(tab => this.models.get(documentIdentity(tab)) === model);
    if (tab) this.publishLanguageSupport(tab, model);
  });
  private languageLoading: Promise<void> | undefined;
  private disposed = false;
  private languageRoot: string | null = null;
  private apiValue: typeof Monaco | null = null;
  private editorValue: Monaco.editor.IStandaloneCodeEditor | null = null;
  private groupId = 'group-0';
  private readonly groupEditors = new Map<string, { host: HTMLDivElement; tabId: string | null; editor: Monaco.editor.IStandaloneCodeEditor }>();
  private loading: Promise<void> | null = null;
  private projectDecorations: Monaco.editor.IEditorDecorationsCollection | null = null;
  private readonly models = new Map<string, Monaco.editor.ITextModel>();
  private readonly modelPaths = new Map<string, string>();
  private readonly views = new Map<string, Monaco.editor.ICodeEditorViewState | null>();
  private readonly owners = new Map<string, DocumentModelOwner<Monaco.editor.ITextModel>>();
  private readonly replacing = new Set<string>();
  private readonly unregisterZoom = onTextZoom(id => {
    for (const entry of this.groupEditors.values()) {
      const tab = this.options.tabs().find(tab => tab.id === entry.tabId);
      if (tab && (!id || tab.id === id)) entry.editor.updateOptions(textZoomOptions(tab.id));
    }
  });
  private readonly unregisterModels: () => void;
  constructor(private readonly options: Options) {
    const restart = () => { void this.languageClient?.restart(); };
    if (options.language) window.addEventListener('setdown:restart-language', restart);
    const unsubscribe = options.language?.port.onEvent(event => {
      if (event.type === 'discovery') { this.languageClient?.retryUnavailable(); return; }
      if (event.type !== 'configuration') return;
      this.languageEpoch++;
      if (event.servers) this.languageClient?.invalidate(event.servers, event.documents, event.roots);
      else { this.languageClient?.dispose(); this.languageClient = undefined; }
      this.languageLoading = undefined; this.languageRoutes = undefined; this.languageConfiguration = undefined;
      if (!event.servers) {
        delete options.host.dataset.languageServer;
      }
      if (this.apiValue) for (const tab of options.contents?.() ?? options.tabs()) {
        const model = this.models.get(documentIdentity(tab));
        if (model) this.connectLanguage(tab, model, this.apiValue);
      }
    });
    this.unregisterLanguage = () => { unsubscribe?.(); if (options.language) window.removeEventListener('setdown:restart-language', restart); };
    this.unregisterModels = liveDocumentModels.register((path, api) => {
      const tab = (options.contents?.() ?? options.tabs()).find((candidate) => candidate.document.path === path);
      if (!tab || tab.document.kind !== undefined || isNotebookDocument(tab.document.path)) return null;
      // A diff can be the first source surface opened from an ordinary Viewer.
      // Use its already-loaded Monaco module without creating an ordinary editor.
      this.ensureModel(tab, api);
      return this.owners.get(documentIdentity(tab))!.borrow();
    });
  }
  disposeWorkspace(): void {
    this.disposed = true;
    this.unregisterLanguage?.(); this.offBuiltin();
    this.languageClient?.dispose();
    this.unregisterModels();
    this.unregisterZoom();
    for (const id of [...this.models.keys()]) this.disposeDocument(id);
    this.options.releaseDocuments?.();
    for (const entry of this.groupEditors.values()) { entry.editor.dispose(); entry.host.remove(); }
    this.groupEditors.clear();
    this.editorValue = null;
  }
  get api() { return this.apiValue; }
  get editor() { return this.editorValue; }
  get model() { return this.editorValue?.getModel() ?? null; }
  get loaded() { return this.editorValue !== null; }
  /** A mounted group already owns this tab's current caret and viewport. */
  hasLiveView(tab: WorkspaceTab): boolean {
    const model = this.models.get(documentIdentity(tab));
    return !!model && [...this.groupEditors.values()].some(entry => entry.tabId === tab.id && entry.editor.getModel() === model);
  }
  text(tab: DocumentContent): string { return this.models.get(documentIdentity(tab))?.getValue() ?? tab.text; }
  modelFor(tab: DocumentContent): Monaco.editor.ITextModel { return this.ensureModel(tab); }
  documentSymbols(model: Monaco.editor.ITextModel) { return this.languageClient?.documentSymbols(model) ?? Promise.resolve([]); }
  async beforeSave(tab: DocumentContent, reason: 1 | 2 = 1): Promise<void> {
    const model = this.models.get(documentIdentity(tab));
    if (model) await this.languageClient?.beforeSave(model, reason);
  }
  saved(tab: DocumentContent): void {
    const model = this.models.get(documentIdentity(tab));
    if (model) this.languageClient?.saved(model, tab.document.savedText);
  }
  setLanguageRoot(root: string | null): void {
    if (this.languageRoot === root) return;
    this.languageRoot = root;
    void this.languageClient?.restart();
  }
  lineCount(tab: WorkspaceTab): number {
    return this.models.get(documentIdentity(tab))?.getLineCount() ?? (tab.text.length === 0 ? 1 : tab.text.split(/\r\n|\r|\n/).length);
  }
  async load(): Promise<void> {
    if (this.editorValue) return;
    if (this.loading) return this.loading;
    this.options.status('loading');
    this.loading = loadMonaco().then(api => {
      this.apiValue = api;
      registerMonacoThemes(api);
      // Keep Markdown's complete editor configuration unchanged. Syntax selection
      // lives on each model; introducing text tabs cannot leak different wrapping.
      this.selectGroup(this.groupId);
      for (const tab of this.options.tabs()) if (tab.document.kind === undefined && !isNotebookDocument(tab.document.path)) this.ensureModel(tab);
      const active = this.options.active();
      if (active) this.activate(active);
      this.options.status('ready');
    }).catch((error) => { this.loading = null; this.options.status('error'); throw error; });
    return this.loading;
  }
  selectGroup(id: string): void {
    this.groupId = id;
    const api = this.apiValue;
    if (!api || (!this.loading && !this.editorValue)) return;
    let entry = this.groupEditors.get(id);
    if (!entry) {
      const host = document.createElement('div');
      host.className = 'group-monaco-instance';
      this.options.host.append(host);
      const editor = api.editor.create(host, {
        // Group/surface containers clip their contents. Fixed widgets keep LSP
        // hovers and suggestions visible when Monaco places them beyond a pane.
        fixedOverflowWidgets: true,
        automaticLayout: true, 'semanticHighlighting.enabled': true, codeLens: false, inlayHints: { enabled: 'offUnlessPressed' }, linkedEditing: true, language: 'markdown', theme: monacoThemeName(this.options.theme()),
        wordWrap: 'on', wrappingIndent: 'same', lineNumbers: 'on', minimap: { enabled: false },
        scrollBeyondLastLine: false, smoothScrolling: true, cursorSmoothCaretAnimation: 'on',
        fontFamily: APP_FONT_FAMILY,
        ...textZoomOptions(), padding: { top: 26, bottom: 60 },
        renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, stickyScroll: { enabled: false },
      });

      // A find button's default mouse focus activates a background group and
      // reparents its editor before click can reach the button. Let the action
      // run first (Close then focuses the editor itself). Keyboard focus and
      // activation still use Monaco's normal tabindex/keydown handling.
      const keepFindActionTarget = (event: MouseEvent) => {
        if (event.button === 0 && event.target instanceof Element
          && event.target.closest('.find-widget [role="button"]')) event.preventDefault();
      };
      host.addEventListener('mousedown', keepFindActionTarget, true);
      editor.onDidDispose(() => host.removeEventListener('mousedown', keepFindActionTarget, true));

      this.installBindings(api, editor);
      editor.onDidFocusEditorText(() => {
        const tab = this.options.tabs().find(t => t.id === this.groupEditors.get(id)?.tabId);
        if (tab && tab.id !== this.options.active()?.id) this.options.focusTab?.(tab.id);
      });
      entry = { host, editor, tabId: null };
      this.groupEditors.set(id, entry);
    }
    if (this.editorValue !== entry.editor) {
      this.projectDecorations?.clear();
      this.editorValue = entry.editor;
      this.projectDecorations = entry.editor.createDecorationsCollection();
    }
    if (entry.host.parentElement !== this.options.host) {
      const focused = entry.editor.hasTextFocus();
      this.moveHost(entry.host, this.options.host);
      if (focused && !entry.editor.hasTextFocus()) entry.editor.focus();
    }
  }
  private moveHost(host: HTMLElement, parent: HTMLElement): void {
    // Removing/reinserting a focused editor can detach Chromium's EditContext
    // during its focus event. An atomic DOM move retains focus, caret and IME.
    const target = parent as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
    if (host.isConnected && parent.isConnected && target.moveBefore) target.moveBefore(host, null);
    else parent.append(host);
  }
  syncGroups(groups: readonly { id: string; activeId: string | null }[], focusedId: string): void {
    if (!this.editorValue) return;
    for (const [id, entry] of this.groupEditors) {
      if (!groups.some(group => group.id === id)) {
        entry.editor.dispose(); entry.host.remove(); this.groupEditors.delete(id); continue;
      }
      const tab = this.options.tabs().find(tab => tab.id === groups.find(g => g.id === id)?.activeId);
      if (id === focusedId) continue;
      if (entry.tabId && entry.tabId !== tab?.id) this.views.set(entry.tabId, entry.editor.saveViewState());
      entry.tabId = tab?.id ?? null;
      const host = document.querySelector<HTMLElement>(`.group-editor-host[data-group-id="${id}"]`);
      if (host && entry.host.parentElement !== host) this.moveHost(entry.host, host);
      entry.host.style.visibility = tab?.surface === 'editor' ? 'visible' : 'hidden';
      const model = tab?.surface === 'editor' ? this.ensureModel(tab) : null;
      if (entry.editor.getModel() !== model) {
        entry.editor.setModel(model);
        if (tab) entry.editor.updateOptions({ ...displayOptions(tab.id), ...textZoomOptions(tab.id) });
        const state = tab ? this.views.get(tab.id) : null;
        if (state) entry.editor.restoreViewState(state);
      }
      entry.editor.layout();
    }
    this.selectGroup(focusedId);
    const entry = this.groupEditors.get(focusedId);
    if (entry) { entry.host.style.visibility = ''; entry.editor.layout(); }
  }
  activate(tab: WorkspaceTab): void {
    if (!this.editorValue) return;
    if (tab.document.kind !== undefined || isNotebookDocument(tab.document.path)) { this.editorValue.setModel(null); return; }
    const model = this.ensureModel(tab);
    const entry = this.groupEditors.get(this.groupId)!;
    const sameView = entry.tabId === tab.id;
    if (entry.tabId && !sameView) this.views.set(entry.tabId, this.editorValue.saveViewState());
    entry.tabId = tab.id;
    const sameModel = this.editorValue.getModel() === model;
    this.editorValue.updateOptions({ ...displayOptions(tab.id), ...textZoomOptions(tab.id) });
    if (!sameModel) this.editorValue.setModel(model);
    this.owners.get(documentIdentity(tab))?.beginEditing(`document:${tab.id}`);
    this.publishLanguageSupport(tab, model);
    if (sameModel && sameView) return; // Keep the caret placed by the click that focused this group.
    const view = this.views.get(tab.id);
    if (view) this.editorValue.restoreViewState(view);
  }
  /** Retarget highlighting without replacing content, undo history or view state. */
  retarget(tab: DocumentContent, api = this.apiValue): void {
    if (isNotebookDocument(tab.document.path)) {
      if (this.models.has(documentIdentity(tab))) this.dispose(tab.id);
      return;
    }
    const model = this.models.get(documentIdentity(tab));
    const previousPath = this.modelPaths.get(documentIdentity(tab));
    if (!api || !model || previousPath === tab.document.path) return;
    const language = documentLanguage(tab.document.path, api.languages.getLanguages(), model.getLineContent(1));
    if (model.getLanguageId() !== language) api.editor.setModelLanguage(model, language);
    this.modelPaths.set(documentIdentity(tab), tab.document.path);
    retargetBuiltin(api, model, tab.document.path);
    this.connectLanguage(tab, model, api);
    if (previousPath) liveDocumentModels.publish({ type: 'retargeted', path: previousPath, nextPath: tab.document.path });
  }
  saveView(tab: WorkspaceTab): void {
    const editor = [...this.groupEditors.values()].find(entry => entry.tabId === tab.id)?.editor;
    if (editor && editor.getModel() === this.models.get(documentIdentity(tab))) this.views.set(tab.id, editor.saveViewState());
    tab.text = this.text(tab);
  }
  exportView(tabId: string): unknown { return this.views.get(tabId) ?? null; }
  importView(tabId: string, value: unknown): void {
    this.views.set(tabId, value as Monaco.editor.ICodeEditorViewState | null);
    const entry = [...this.groupEditors.values()].find(entry => entry.tabId === tabId);
    if (entry && value) entry.editor.restoreViewState(value as Monaco.editor.ICodeEditorViewState);
  }
  replace(tab: DocumentContent, document: DocumentSnapshot): void {
    const model = this.models.get(documentIdentity(tab));
    // Reload/asset rewriting is one explicit, undoable document edit, not a new
    // model. A mounted Working Tree must never retain a disposed live model.
    this.replacing.add(documentIdentity(tab));
    try {
      if (model && (model.getValue() !== document.text
        || (document.eol && model.getEOL() !== (document.eol === 'crlf' ? '\r\n' : '\n')))) {
        model.pushStackElement();
        if (document.eol && this.apiValue) model.pushEOL(document.eol === 'crlf'
          ? this.apiValue.editor.EndOfLineSequence.CRLF : this.apiValue.editor.EndOfLineSequence.LF);
        model.pushEditOperations(null, [{ range: model.getFullModelRange(), text: document.text }], () => null);
        model.pushStackElement();
      }
      tab.text = model?.getValue() ?? document.text;
      tab.revision = document.revision;
    } finally { this.replacing.delete(documentIdentity(tab)); }
    this.retarget(tab);
    liveDocumentModels.publish({ type: 'changed', path: document.path, text: tab.text });
  }
  /** Explicit external edit. Normal Working Tree typing already uses our model. */
  setText(tab: DocumentContent, text: string, edits?: WorkingTreeEdit[]): boolean {
    if (isNotebookDocument(tab.document.path)) throw Error("Edit notebook cells in the notebook tab.");
    const model = this.models.get(documentIdentity(tab));
    if (!model) { tab.text = text; return false; }
    if (model.getValue() === text) return true;
    const operations = edits?.length ? edits.map((edit) => ({ range: edit.range, text: edit.text }))
      : [{ range: model.getFullModelRange(), text }];
    model.pushStackElement();
    model.pushEditOperations(null, operations, () => null);
    model.pushStackElement();
    return true; // The document-owned listener runs even when its editor is hidden.
  }
  dispose(tabId: string): void {
    releaseDisplayOptions(tabId);
    this.views.delete(tabId);
    documentSupport.remove(tabId);
    for (const entry of this.groupEditors.values()) if (entry.tabId === tabId) { entry.tabId = null; entry.editor.setModel(null); }
    // Nonshared documents retain their previous direct ownership.
    if (this.models.has(tabId)) this.disposeDocument(tabId);
  }
  disposeDocument(id: string): void {
    const model = this.models.get(id), owner = this.owners.get(id), path = this.modelPaths.get(id);
    if (model) this.languageClient?.unbind(model);
    for (const entry of this.groupEditors.values()) if (model && entry.editor.getModel() === model) entry.editor.setModel(null);
    this.models.delete(id); this.owners.delete(id); this.modelPaths.delete(id); this.languageOverrides.delete(id);
    owner?.releaseOwner();
    if (path) liveDocumentModels.publish({ type: 'closed', path });
  }
  clear(): void { this.editorValue?.setModel(null); }
  setTheme(theme: PreviewThemeId): void { window.dispatchEvent(new CustomEvent('setdown:notebook-theme', { detail: theme })); this.apiValue?.editor.setTheme(monacoThemeName(theme)); }
  layout(): void { this.editorValue?.layout(); }
  restoreView(tab: WorkspaceTab): void {
    const editor = this.editorValue;
    if (!editor || editor.getModel() !== this.models.get(documentIdentity(tab))) return;
    editor.layout();
    const view = this.views.get(tab.id);
    if (view) editor.restoreViewState(view);
  }
  find(): void { void this.editorValue?.getAction('actions.find')?.run(); }
  finishScroll(): void {
    const editor = this.editorValue;
    if (!editor?.hasPendingScrollAnimation()) return;
    // Monaco's saved view state uses the animation's destination. Restoring it
    // completes that scroll immediately without guessing from the cursor (which
    // may be offscreen after a wheel scroll) or waiting in the Esc input path.
    const state = editor.saveViewState();
    if (state) editor.restoreViewState(state);
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
  projectMatches(tab: DocumentContent, query: string, limit = 300): ProjectMatch[] {
    const model = this.models.get(documentIdentity(tab));
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
  private ensureModel(tab: DocumentContent, api = this.apiValue): Monaco.editor.ITextModel {
    tab = this.options.content?.(tab) ?? tab;
    const existing = this.models.get(documentIdentity(tab));
    if (existing) { this.retarget(tab, api); return existing; }
    if (!api) throw new Error('Monaco is not loaded.');
    this.apiValue ??= api;
    const uri = api.Uri.file(tab.document.path).with({ query: documentIdentity(tab) });
    const language = documentLanguage(tab.document.path, api.languages.getLanguages(), tab.text.split(/[\r\n]/, 1)[0]);
    const model = api.editor.createModel(tab.text, language, uri);
    if (tab.document.eol) model.setEOL(tab.document.eol === 'crlf'
      ? api.editor.EndOfLineSequence.CRLF : api.editor.EndOfLineSequence.LF);
    const listener = model.onDidChangeContent(() => {
      if (this.replacing.has(documentIdentity(tab)) || this.models.get(documentIdentity(tab)) !== model) return;
      const text = model.getValue();
      // Single authoritative notification regardless of which editor produced
      // the edit, Undo, Redo, IME update, or diff revert operation.
      this.options.changed(tab, text);
      liveDocumentModels.publish({ type: 'changed', path: tab.document.path, text });
    });
    this.models.set(documentIdentity(tab), model);
    this.owners.set(documentIdentity(tab), new DocumentModelOwner(model, () => listener.dispose()));
    this.modelPaths.set(documentIdentity(tab), tab.document.path);
    retargetBuiltin(api, model, tab.document.path);
    this.connectLanguage(tab, model, api);
    return model;
  }
  private connectLanguage(tab: DocumentContent, model: Monaco.editor.ITextModel, api: typeof Monaco): void {
    const options = this.options.language;
    if (!options || this.disposed || model.isDisposed()) return;
    const epoch = this.languageEpoch;
    // Fetch lightweight associations once. The LSP client and catalog stay off the preview path.
    if (!this.languageRoutes) {
      this.languageConfiguration ??= options.port.configuration();
      void this.languageConfiguration.then(routes => {
        if (this.disposed || epoch !== this.languageEpoch || model.isDisposed()) return;
        this.languageRoutes = routes;
        this.connectLanguage(tab, model, api);
      }).catch(error => console.error('Could not read language configuration', error));
      return;
    }
    const language = this.languageOverrides.get(documentIdentity(tab)) ?? recognizedLanguage(tab.document.path, api.languages.getLanguages(), this.languageRoutes, model.getLineContent(1));
    if (!api.languages.getLanguages().some(item => item.id === language)) api.languages.register({ id: language });
    if (model.getLanguageId() !== language) {
      this.languageClient?.unbind(model);
      api.editor.setModelLanguage(model, language);
    }
    this.publishLanguageSupport(tab, model);
    if (this.languageClient) { this.languageClient.bind(tab, model); return; }
    // Markdown stays off the analysis import path unless a provider was explicitly enabled.
    if (language === 'markdown' && !languageSupport(tab.document.path, this.languageRoutes)) return;
    this.languageLoading ??= import('../language/language-services').then(({ LanguageServices }) => {
      if (this.disposed || epoch !== this.languageEpoch) return;
      this.languageClient = new LanguageServices(api, { ...options, routes: () => this.languageRoutes ?? [],
        changed: () => {
          for (const current of this.options.contents?.() ?? this.options.tabs()) { const currentModel = this.models.get(documentIdentity(current)); if (currentModel) this.publishLanguageSupport(current, currentModel); }
          for (const update of this.languageContexts.values()) update();
        },
        status: state => { this.options.host.dataset.languageServer = state; },
      });
      for (const current of this.options.contents?.() ?? this.options.tabs()) {
        const currentModel = this.models.get(documentIdentity(current));
        if (currentModel) this.connectLanguage(current, currentModel, api);
      }
    }).catch(error => { if (epoch === this.languageEpoch) this.languageLoading = undefined; console.error('Could not load language support', error); });
  }
  private publishLanguageSupport(tab: DocumentContent, model: Monaco.editor.ITextModel): void {
    const api = this.apiValue;
    if (!api || model.isDisposed()) return;
    const language = model.getLanguageId();
    const choices = api.languages.getLanguages().map(item => ({ id: item.id, name: item.aliases?.[0] ?? item.id })).sort((a, b) => a.name.localeCompare(b.name));
    const ids = new Set([tab.id, ...(this.options.viewIds?.(tab) ?? this.options.tabs().filter(view => documentIdentity(view) === documentIdentity(tab)).map(view => view.id))]);
    for (const id of ids) documentSupport.set({ id, language, name: choices.find(item => item.id === language)?.name ?? language, path: tab.document.path,
      choices, providers: this.languageClient?.supportFor(model) ?? (builtinSupport(model).features.length ? [builtinSupport(model)] : []),
      setLanguage: id => {
        if (model.isDisposed() || (id && !choices.some(item => item.id === id))) return;
        if (id) this.languageOverrides.set(documentIdentity(tab), id); else this.languageOverrides.delete(documentIdentity(tab));
        this.languageClient?.unbind(model); this.connectLanguage(tab, model, api);
      },
      restart: async server => { retargetBuiltin(api, model, tab.document.path); await this.options.language!.port.restart(tab.document.path, server); this.languageClient?.retryUnavailable(); },
      answerMessage: (server, request, action) => this.options.language!.port.answerMessage(tab.document.path, server, request, action),
      environment: () => this.options.language!.port.environment(tab.document.path, language),
      selectEnvironment: selection => this.options.language!.port.selectEnvironment(tab.document.path, language, selection),
      prepareEnvironment: () => this.options.language!.port.prepareEnvironment(tab.document.path, language),
      cancelPreparation: () => this.options.language!.port.cancelPreparation(tab.document.path, language),
      problems: () => {
        const editor = [...this.groupEditors.values()].find(entry => entry.editor.getModel() === model)?.editor;
        if (editor) void this.languageClient?.showNavigation('problems', editor);
      },
    });
  }
  private installBindings(api: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor): void {
    if (this.options.pythonCells) editor.addAction({ id: 'setdown.python-cells', label: 'Open Python # %% cells as interactive notebook…', precondition: 'editorLangId == python', contextMenuGroupId: 'navigation', contextMenuOrder: 7, run: async () => {
      const tab = this.options.tabs().find(tab => this.models.get(documentIdentity(tab)) === editor.getModel()); const model = editor.getModel();
      if (tab?.document.path && model) await this.options.pythonCells!(tab.document.path, model.getValue());
    } });
    const symbols = editor.createContextKey<boolean>('setdownLanguageSymbols', false), calls = editor.createContextKey<boolean>('setdownLanguageCalls', false),
      types = editor.createContextKey<boolean>('setdownLanguageTypes', false), problems = editor.createContextKey<boolean>('setdownLanguageProblems', false);
    const updateLanguageContext = () => {
      const cap = this.languageClient?.capabilitiesFor(editor.getModel());
      symbols.set(!!cap?.workspaceSymbolProvider); calls.set(!!cap?.callHierarchyProvider); types.set(!!cap?.typeHierarchyProvider);
      problems.set(!!editor.getModel());
    };
    this.languageContexts.set(editor, updateLanguageContext);
    editor.onDidChangeModel(updateLanguageContext);
    editor.onDidDispose(() => this.languageContexts.delete(editor));
    for (const [kind, label] of Object.entries({ symbols: 'Go to Workspace Symbol…', incoming: 'Show Incoming Calls', outgoing: 'Show Outgoing Calls', supertypes: 'Show Supertypes', subtypes: 'Show Subtypes', problems: 'Show Problems in Open Files' }) as ['symbols' | 'incoming' | 'outgoing' | 'supertypes' | 'subtypes' | 'problems', string][]) {
      editor.addAction({ id: `setdown.language-${kind}`, label, precondition: kind === 'symbols' ? 'setdownLanguageSymbols' : kind === 'incoming' || kind === 'outgoing' ? 'setdownLanguageCalls' : kind === 'problems' ? 'setdownLanguageProblems' : 'setdownLanguageTypes', contextMenuGroupId: 'navigation', contextMenuOrder: 5,
        run: () => this.languageClient?.showNavigation(kind, editor) });
    }
    editor.addAction({ id: 'setdown.toggle-inlay-hints', label: 'Toggle Inlay Hints', run: () => {
      const enabled = editor.getOption(api.editor.EditorOption.inlayHints).enabled;
      editor.updateOptions({ inlayHints: { enabled: enabled === 'on' ? 'offUnlessPressed' : 'on' } });
    } });
    editor.addAction({ id: 'setdown.toggle-format-on-type', label: 'Toggle Format on Type', run: () => {
      editor.updateOptions({ formatOnType: !editor.getOption(api.editor.EditorOption.formatOnType) });
    } });
    editor.addAction({ id: 'setdown.toggle-code-lens', label: 'Toggle Code Lens', run: () => {
      editor.updateOptions({ codeLens: !editor.getOption(api.editor.EditorOption.codeLens) });
    } });
    editor.addAction({ id: 'setdown.restart-language', label: 'Restart Language Servers',
      run: async () => { await this.languageClient?.restart(); } });
    editor.addAction({ id: 'setdown.language-support', label: 'Language Support…',
      run: () => { window.dispatchEvent(new Event('setdown:language-support')); } });
    editor.onDidFocusEditorText(() => {
      const tab = this.options.active();
      if (tab && editor.getModel() === this.models.get(documentIdentity(tab))) this.owners.get(documentIdentity(tab))?.beginEditing(`document:${tab.id}`);
    });
    editor.onDidChangeCursorSelection(() => this.options.viewChanged?.());
    editor.onDidScrollChange((event) => {
      if (event.scrollTopChanged || event.scrollLeftChanged) this.options.viewChanged?.();
      if (editor === this.editorValue && event.scrollTopChanged && hasMarkdownPreview(this.options.active()?.document)) this.options.scrolled();
    });
    installMarkdownEditorActions(api, editor, this.options, () => hasMarkdownPreview(this.options.active()?.document));
    editor.addCommand(api.KeyCode.Escape, this.options.escape,
      'setdownMarkdownDocument && !suggestWidgetVisible && !findInputFocussed && !renameInputVisible && !compositionInProgress');
  }
}
