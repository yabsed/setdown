import { documentIdentity, type DocumentContent } from '../../core/workspace/document-store';
import { isNotebookDocument } from '../../core/document/document-profile';
import { onTextZoom, textZoomOptions } from '../editor/text-zoom';
import { APP_FONT_FAMILY } from '../../core/theme/typography';
import type * as Monaco from 'monaco-editor';
import { isLargeText, sameDiskVersion, type DiskVersion, type DocumentSnapshot } from '../../core/document/document';
import { takeLargeText } from '../editor/large-text';
import { installLongLineSteps } from '../editor/long-line-steps';
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
import { applyMonacoTheme, monacoThemeName, registerMonacoThemes } from '../theme';
import { languageSupport, type LanguageRoute } from '../../core/document/language-support';
import type { LanguageOptions } from '../language/language-client';
import type { LanguageServices } from '../language/language-services';
import { toolFamilies } from '../../protocol/language-tools';
import { installSyntaxHighlighting } from '../language/syntax-runtime';
import { languageDisplayName, updateLanguageDefinitions } from '../../core/document/language-catalog';
import { documentSupport, openLanguageSupport, builtinSupport, onBuiltinSupport, retargetBuiltin, toolCommandList, toolContextKey, toolActionId, documentCommandIds, documentCommandNames, unlistedCommandIds,
  openHereMenu, gatherHere, arrangeHere, type HereItem } from '../language/language-runtime';
import { isLanguageAnswer } from '../../protocol/language';
import { isComposingInput } from '../editor/composition-guard';
import { recordRecentCommand } from '../editor/tools/command-list';
import { recognizedLanguage } from '../../core/document/language-policy';
import { largeTextModels, loadMonaco } from '../editor/monaco-runtime';
import { displayOptions, releaseDisplayOptions } from '../editor/tools/view-display';
import { onMarkdownWordWrap, sourceWordWrap } from '../editor/markdown-word-wrap';

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
  /** A large document was given a model without its text; it has to be read again. */
  unloaded?: (tab: DocumentContent) => void;
};
type SearchTarget = { line: number; column: number; ordinal: number };
type ProjectMatch = NonNullable<ProjectSearchDocument['matches']>[number];

/** What a file goes without because of its size, said where its language support is shown. The
 * editor decides the first part itself (VS Code names the same switches in a notification); a file
 * read in pieces is also never handed to an analysis tool. */
function largeFileLimits(document: DocumentSnapshot, model: Monaco.editor.ITextModel): string | undefined {
  const plain = (model as { isTooLargeForTokenization?(): boolean }).isTooLargeForTokenization?.() === true;
  const unanalysed = isLargeText(document);
  if (plain) return `Syntax highlighting, word wrap and folding are off for a file this large${unanalysed ? ', and it is not given to analysis tools' : ''}.`;
  return unanalysed ? 'A file this large is not given to analysis tools.' : undefined;
}

export class MonacoEditor {
  private languageRoutes: LanguageRoute[] | undefined;
  private readonly unknownLanguageFiles=new Set<string>();
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
  /** A large document is unchanged while its model is at the version that was read or saved as
   * this file version. Its text is never compared: there is no second copy to compare with. */
  private readonly savedPoints = new Map<string, { version: number; disk: DiskVersion }>();
  /** The model version a save in progress took its snapshot at. */
  private readonly captured = new Map<string, number>();
  /** Large documents whose model was made without their text. Empty models are never saved. */
  private readonly unloaded = new Set<string>();
  private readonly unregisterZoom = onTextZoom(id => {
    for (const entry of this.groupEditors.values()) {
      const tab = this.options.tabs().find(tab => tab.id === entry.tabId);
      if (tab && (!id || tab.id === id)) entry.editor.updateOptions(textZoomOptions(tab.id));
    }
  });
  private readonly unregisterWrap = onMarkdownWordWrap(() => {
    for (const entry of this.groupEditors.values()) {
      const tab = this.options.tabs().find(tab => tab.id === entry.tabId);
      if (tab) entry.editor.updateOptions({ wordWrap: sourceWordWrap(tab.document.path) });
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
      if (event.servers) this.languageClient?.invalidate(event.servers, event.documents, event.roots, event.retainedDocuments);
      else { this.languageClient?.dispose(); this.languageClient = undefined; }
      this.languageLoading = undefined; this.languageRoutes = undefined; this.languageConfiguration = undefined;
      this.unknownLanguageFiles.clear();
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
    this.unregisterZoom(); this.unregisterWrap();
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
  /** A large document answers with no text: its model is the only holder of it, and nothing that
   * asks here (dirty checks, messages to the main process, recovery snapshots) may copy it. */
  text(tab: DocumentContent): string {
    return isLargeText(tab.document) ? '' : this.models.get(documentIdentity(tab))?.getValue() ?? tab.text;
  }
  /** Whether a large document differs from the file version it was read from or saved as. */
  modified(tab: DocumentContent): boolean {
    const id = documentIdentity(tab), model = this.models.get(id), saved = this.savedPoints.get(id);
    if (!model || this.unloaded.has(id)) return false; // Never shown, or not read yet: nothing of the person's is in it.
    return !saved || model.getAlternativeVersionId() !== saved.version || !sameDiskVersion(saved.disk, tab.document.diskVersion);
  }
  /** A large document's text for saving. The snapshot stays as taken while typing goes on. */
  capture(tab: DocumentContent): Monaco.editor.ITextSnapshot | null {
    const id = documentIdentity(tab), model = this.models.get(id);
    if (!model || this.unloaded.has(id)) return null;
    this.captured.set(id, model.getAlternativeVersionId());
    return model.createSnapshot();
  }
  /** The file a large document was read from moved or was saved elsewhere: same text, new version. */
  rebase(tab: DocumentContent, from: DiskVersion, to: DiskVersion): void {
    const saved = this.savedPoints.get(documentIdentity(tab));
    if (saved && sameDiskVersion(saved.disk, from)) saved.disk = to;
  }
  modelFor(tab: DocumentContent): Monaco.editor.ITextModel { return this.ensureModel(tab); }
  documentSymbols(model: Monaco.editor.ITextModel) { return this.languageClient?.documentSymbols(model) ?? Promise.resolve([]); }
  async beforeSave(tab: DocumentContent, reason: 1 | 2 = 1): Promise<void> {
    const model = this.models.get(documentIdentity(tab));
    if (model) await this.languageClient?.beforeSave(model, reason);
  }
  saved(tab: DocumentContent): void {
    const id = documentIdentity(tab), model = this.models.get(id);
    if (model && isLargeText(tab.document)) {
      this.savedPoints.set(id, { version: this.captured.get(id) ?? model.getAlternativeVersionId(), disk: tab.document.diskVersion });
      this.captured.delete(id);
    } else if (model) this.languageClient?.saved(model, tab.document.savedText);
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
      applyMonacoTheme(api, this.options.theme());
      // Syntax selection lives on each model and wrapping is reapplied per tab on
      // activation, so a text tab cannot leak its unwrapped layout into Markdown.
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
    const entry = this.groupEditor(api, id);
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
  /** Each group keeps one editor instance for as long as it exists. */
  private groupEditor(api: typeof Monaco, id: string) {
    let entry = this.groupEditors.get(id);
    if (entry) return entry;
    const host = document.createElement('div');
    host.className = 'group-monaco-instance';
    this.options.host.append(host);
    const editor = api.editor.create(host, {
      // Group/surface containers clip their contents. Fixed widgets keep LSP
      // hovers and suggestions visible when Monaco places them beyond a pane.
      fixedOverflowWidgets: true,
      // The menu at the cursor is the app's own (`openHere`): it holds the tools' answers for
      // that position instead of the editor's fixed list. What a tool's lens offers is an entry
      // of that menu, so lenses are not drawn between the lines.
      contextmenu: false,
      automaticLayout: true, 'semanticHighlighting.enabled': true, codeLens: false, inlayHints: { enabled: 'offUnlessPressed' }, linkedEditing: true, language: 'markdown', theme: monacoThemeName(this.options.theme()),
      wordWrap: 'off', wrappingIndent: 'same', lineNumbers: 'on', minimap: { enabled: true },
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
    const longLines = installLongLineSteps(api.editor.MouseTargetType.CONTENT_TEXT, editor);
    editor.onDidDispose(() => longLines.dispose());

    this.installBindings(api, editor);
    editor.onDidFocusEditorText(() => {
      const tab = this.options.tabs().find(t => t.id === this.groupEditors.get(id)?.tabId);
      if (tab && tab.id !== this.options.active()?.id) this.options.focusTab?.(tab.id);
    });
    entry = { host, editor, tabId: null };
    this.groupEditors.set(id, entry);
    return entry;
  }
  private moveHost(host: HTMLElement, parent: HTMLElement): void {
    // Removing/reinserting a focused editor can detach Chromium's EditContext
    // during its focus event. An atomic DOM move retains focus, caret and IME.
    const target = parent as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
    if (host.isConnected && parent.isConnected && target.moveBefore) target.moveBefore(host, null);
    else parent.append(host);
  }
  syncGroups(groups: readonly { id: string; activeId: string | null }[], focusedId: string): void {
    const api = this.apiValue;
    if (!this.editorValue || !api) return;
    for (const [id, entry] of this.groupEditors) if (!groups.some(group => group.id === id)) {
      entry.editor.dispose(); entry.host.remove(); this.groupEditors.delete(id);
    }
    for (const { id, activeId } of groups) {
      if (id === focusedId) continue;
      const tab = this.options.tabs().find(tab => tab.id === activeId);
      const host = document.querySelector<HTMLElement>(`.group-editor-host[data-group-id="${id}"]`);
      // A group that never had command focus has no editor yet. A source tab selected in it without
      // focus gets one here, once the group's own host is laid out.
      const entry = this.groupEditors.get(id) ?? (tab?.surface === 'editor' && host ? this.groupEditor(api, id) : null);
      if (!entry) continue;
      if (entry.tabId && entry.tabId !== tab?.id) this.views.set(entry.tabId, entry.editor.saveViewState());
      entry.tabId = tab?.id ?? null;
      if (host && entry.host.parentElement !== host) this.moveHost(entry.host, host);
      entry.host.style.visibility = tab?.surface === 'editor' ? 'visible' : 'hidden';
      const model = tab?.surface === 'editor' ? this.ensureModel(tab) : null;
      if (entry.editor.getModel() !== model) {
        entry.editor.setModel(model);
        if (tab) entry.editor.updateOptions({ ...displayOptions(tab.id, tab.document.path), ...textZoomOptions(tab.id), readOnly: isLanguageAnswer(tab.document.path) });
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
    // A tool's answer is a document to read: it is the tool's text, not the person's.
    this.editorValue.updateOptions({ ...displayOptions(tab.id, tab.document.path), ...textZoomOptions(tab.id), readOnly: isLanguageAnswer(tab.document.path) });
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
    // Save As or a rename can turn a text file into Markdown, or back.
    for (const entry of this.groupEditors.values()) if (entry.editor.getModel() === model)
      entry.editor.updateOptions({ wordWrap: sourceWordWrap(tab.document.path) });
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
    if (isLargeText(document)) { this.replaceLarge(tab, document, model); return; }
    this.savedPoints.delete(documentIdentity(tab));
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
  /** A reload of a large file. Without a model its text waits for `ensureModel`. */
  private replaceLarge(tab: DocumentContent, document: DocumentSnapshot, model: Monaco.editor.ITextModel | undefined): void {
    const id = documentIdentity(tab), pieces = model ? takeLargeText(document) : undefined;
    if (model && pieces) {
      this.replacing.add(id);
      try { largeTextModels().updateLargeTextModel(this.apiValue!, model, pieces); }
      finally { this.replacing.delete(id); }
      this.savedPoints.set(id, { version: model.getAlternativeVersionId(), disk: document.diskVersion });
      this.captured.delete(id); this.unloaded.delete(id);
    }
    tab.text = '';
    tab.revision = document.revision;
    this.retarget(tab);
  }
  /** Explicit external edit. Normal Working Tree typing already uses our model. */
  setText(tab: DocumentContent, text: string, edits?: WorkingTreeEdit[]): boolean {
    if (isNotebookDocument(tab.document.path)) throw Error("Edit notebook cells in the notebook tab.");
    const model = this.models.get(documentIdentity(tab));
    if (isLargeText(tab.document)) throw Error('A large file is edited in its own tab.');
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
    this.savedPoints.delete(id); this.captured.delete(id); this.unloaded.delete(id);
    documentSupport.remove(id);
    owner?.releaseOwner();
    if (path) liveDocumentModels.publish({ type: 'closed', path });
  }
  clear(): void { this.editorValue?.setModel(null); }
  setTheme(theme: PreviewThemeId): void { window.dispatchEvent(new CustomEvent('setdown:notebook-theme', { detail: theme })); if (this.apiValue) applyMonacoTheme(this.apiValue, theme); }
  layout(): void { this.editorValue?.layout(); }
  restoreView(tab: WorkspaceTab): void {
    const editor = this.editorValue;
    if (!editor || editor.getModel() !== this.models.get(documentIdentity(tab))) return;
    editor.layout();
    const view = this.views.get(tab.id);
    if (view) {
      editor.restoreViewState(view);
      // This is the initial text-tab restoration after shell layout. Commit
      // its visible lines now, so a previously queued render cannot paint the
      // hidden viewport's clamped position before the restored one.
      editor.render();
    }
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
      // A jump made since (a definition, a result) put the cursor and the view where it belongs:
      // scrolling back to the anchor would leave the place it went to out of sight.
      if (editor.getPosition()?.lineNumber === line) editor.setScrollTop(Math.max(0, editor.getTopForLineNumber(line) - editor.getLayoutInfo().height * anchor.yRatio));
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
    // A large file's text was read in pieces and becomes the model's buffer as it is.
    const pieces = takeLargeText(tab.document);
    const unloaded = isLargeText(tab.document) && !pieces;
    const head = pieces ? (pieces[0] ?? '').slice(0, 4096) : tab.text;
    const language = documentLanguage(tab.document.path, api.languages.getLanguages(), head.split(/[\r\n]/, 1)[0]);
    const model = pieces ? largeTextModels().createLargeTextModel(pieces, language, uri) : api.editor.createModel(tab.text, language, uri);
    if (tab.document.eol) model.setEOL(tab.document.eol === 'crlf'
      ? api.editor.EndOfLineSequence.CRLF : api.editor.EndOfLineSequence.LF);
    if (pieces) this.savedPoints.set(documentIdentity(tab), { version: model.getAlternativeVersionId(), disk: tab.document.diskVersion });
    if (unloaded) {
      // No path is known to lead here. The empty model is never saved, and the file is read again.
      console.error('A large document reached the editor without its text:', tab.document.path);
      this.unloaded.add(documentIdentity(tab));
      queueMicrotask(() => this.options.unloaded?.(tab));
    }
    const listener = model.onDidChangeContent(() => {
      if (this.replacing.has(documentIdentity(tab)) || this.models.get(documentIdentity(tab)) !== model) return;
      // Single authoritative notification regardless of which editor produced
      // the edit, Undo, Redo, IME update, or diff revert operation.
      // A large document is reported as changed without its text: copying it out on every
      // keystroke is what VS Code's version-based dirty state avoids.
      if (isLargeText(tab.document)) { this.options.changed(tab, ''); return; }
      const text = model.getValue();
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
      this.languageConfiguration ??= Promise.all([options.port.configuration(),options.port.definitions?.(tab.document.isUntitled?undefined:tab.document.path)??Promise.resolve([])]).then(([routes,definitions])=>{
        if(!this.disposed && epoch===this.languageEpoch){updateLanguageDefinitions(definitions);installSyntaxHighlighting(api);}
        return routes;
      });
      void this.languageConfiguration.then(routes => {
        if (this.disposed || epoch !== this.languageEpoch || model.isDisposed()) return;
        this.languageRoutes = routes;
        this.connectLanguage(tab, model, api);
      }).catch(error => console.error('Could not read language configuration', error));
      return;
    }
    const language = this.languageOverrides.get(documentIdentity(tab)) ?? recognizedLanguage(tab.document.path, api.languages.getLanguages(), this.languageRoutes, model.getLineContent(1));
    if(language==='plaintext' && !tab.document.isUntitled && !this.unknownLanguageFiles.has(tab.document.path)) {
      this.unknownLanguageFiles.add(tab.document.path);
      void options.port.definitions?.(tab.document.path).catch(error=>console.warn('Language discovery:',String(error)));
    }
    if (!api.languages.getLanguages().some(item => item.id === language)) api.languages.register({ id: language });
    if (model.getLanguageId() !== language) {
      this.languageClient?.unbind(model);
      api.editor.setModelLanguage(model, language);
    }
    this.publishLanguageSupport(tab, model);
    // A tool's answer is coloured as its language and analysed by no tool: it belongs to no project.
    if (isLanguageAnswer(tab.document.path)) return;
    // A language server is sent the whole text, and again on full-sync changes. VS Code does not
    // sync a model past 50 MB to its extension host; here no large document is sent to a server.
    if (isLargeText(tab.document)) { this.languageClient?.unbind(model); return; }
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
        inspect: (target, page, item) => {
          const views = this.options.tabs().filter(view => this.models.get(documentIdentity(view)) === target);
          const view = views.find(view => view.id === this.options.active()?.id) ?? views[0];
          if (view) openLanguageSupport(documentSupport.get(view.id), page, item);
        },
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
    const language = model.getLanguageId(), path = tab.document.path;
    const resource = model.id + '\0' + path + '\0' + language;
    const valid = () => !model.isDisposed() && tab.document.path === path && model.getLanguageId() === language;
    const requireCurrent = () => { if (!valid()) throw Error('This document has changed. Reopen language support.'); };
    const choices = api.languages.getLanguages().map(item => ({ id: item.id, name: languageDisplayName(item.id, item.aliases) })).sort((a, b) => a.name.localeCompare(b.name));
    const ids = new Set([tab.id, ...(this.options.viewIds?.(tab) ?? this.options.tabs().filter(view => documentIdentity(view) === documentIdentity(tab)).map(view => view.id))]);
    for (const id of ids) documentSupport.set({ id, resource, language, name: choices.find(item => item.id === language)?.name ?? language, path: tab.document.path,
      choices, providers: this.languageClient?.supportFor(model) ?? (builtinSupport(model).features.length ? [builtinSupport(model)] : []),
      limits: largeFileLimits(tab.document, model),
      setLanguage: id => {
        if (!valid() || (id && !choices.some(item => item.id === id))) return;
        if (id) this.languageOverrides.set(documentIdentity(tab), id); else this.languageOverrides.delete(documentIdentity(tab));
        this.languageClient?.unbind(model); this.connectLanguage(tab, model, api);
      },
      restart: async server => { requireCurrent(); retargetBuiltin(api, model, path); await this.options.language!.port.restart(path, server); this.languageClient?.retryUnavailable(); },
      answerMessage: async (server, request, action) => { requireCurrent(); await this.options.language!.port.answerMessage(path, server, request, action); },
      // A setup change reconnects through the configuration broadcast; documents it does not reach retry here.
      useAutomatic: async server => { requireCurrent(); await this.options.language!.port.useAutomatic(server); this.languageClient?.retryUnavailable(); },
      allowDownload: async server => { requireCurrent(); await this.options.language!.port.allowDownload(server); this.languageClient?.retryUnavailable(); },
      chooseExecutable: async server => { requireCurrent(); if (await this.options.language!.port.chooseExecutable(server)) this.languageClient?.retryUnavailable(); },
      openHelp: async (server, runtime) => { requireCurrent(); await this.options.language!.port.openHomepage(server, runtime); },
      environment: async () => { requireCurrent(); return this.options.language!.port.environment(path, language); },
      selectEnvironment: async (selection) => { requireCurrent(); return this.options.language!.port.selectEnvironment(path, language, selection); },
      prepareEnvironment: async () => { requireCurrent(); return this.options.language!.port.prepareEnvironment(path, language); },
      cancelPreparation: async () => { requireCurrent(); return this.options.language!.port.cancelPreparation(path, language); },
      inspectProvider: async server => { requireCurrent(); return (await this.options.language!.port.catalog(path)).entries.find(entry => entry.id === server); },
      configureProvider: async (server, options) => {
        requireCurrent();
        const entry = (await this.options.language!.port.catalog(path)).entries.find(item => item.id === server);
        requireCurrent();
        if (!entry?.projectRoot || options.scope !== entry.projectRoot) throw Error('The analysis project changed. Reopen its connection settings.');
        await this.options.language!.port.configure(server, options);
      },
      problems: () => {
        const editors = [...this.groupEditors.values()];
        const editor = (editors.find(entry => entry.tabId === id && entry.editor.getModel() === model) ?? editors.find(entry => entry.editor.getModel() === model))?.editor;
        if (editor) void this.languageClient?.showNavigation('problems', editor);
      },
      toolEnvironments: this.languageClient?.toolEnvironmentRows(model) ?? [],
      toolEnvironment: async row => { requireCurrent(); return this.languageClient!.toolEnvironment(model, row); },
      chooseToolEnvironment: async (row, choice) => { requireCurrent(); return this.languageClient!.chooseToolEnvironment(model, row, choice); },
      toolActions: this.languageClient?.toolActions(model) ?? [],
      runToolAction: async action => {
        requireCurrent();
        const editors = [...this.groupEditors.values()];
        const editor = (editors.find(entry => entry.tabId === id && entry.editor.getModel() === model) ?? editors.find(entry => entry.editor.getModel() === model))?.editor;
        if (!editor || !await this.languageClient?.runToolCommand(action, editor)) throw Error('The tool is not running for this document.');
      },
    });
  }
  /** For the command list: what applies at this editor's cursor, which commands concern the
   * document as a whole, and which are behaviours of a key that are never listed. */
  async commandsHere(target: Monaco.editor.ICodeEditor | null): Promise<{ here: HereItem[]; document: readonly string[]; never: readonly string[]; plain: Readonly<Record<string, string>> }> {
    const places = { document: documentCommandIds, never: unlistedCommandIds, plain: documentCommandNames };
    const entry = [...this.groupEditors.values()].find(entry => entry.editor === target);
    if (!entry || !this.languageClient || !entry.editor.getModel()) return { here: [], ...places };
    return { here: arrangeHere((await gatherHere(this.languageClient.hereProbes(entry.editor))).items), ...places };
  }
  /** The menu at the cursor (`here-menu.ts`): the tools' answers for this position, then the
   * editing every text has. It opens at the pointer, or below the cursor when a key asked. */
  private async openHere(api: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor, at?: { x: number; y: number }): Promise<void> {
    const model = editor.getModel(), position = editor.getPosition();
    if (!model || !position || isComposingInput()) return;
    if (!at) {
      const visible = editor.getScrolledVisiblePosition(position), box = editor.getDomNode()?.getBoundingClientRect();
      if (!visible || !box) return;
      at = { x: box.left + visible.left, y: box.top + visible.top + visible.height };
    }
    const version = model.getVersionId(), selection = editor.getSelection(), readOnly = editor.getOption(api.editor.EditorOption.readOnly);
    const selected = !!selection && !selection.isEmpty();
    // Asked before anything is drawn: the tools answer while the menu is being prepared.
    const probes = this.languageClient?.hereProbes(editor) ?? [];
    const key = (await import('../editor/monaco-keys')).actionKeys(editor.getDomNode());
    const keyed = (items: HereItem[]) => items.map(item => ({ ...item, key: (item.action && key(item.action)) || item.key }));
    const act = (id: string) => () => { editor.focus(); editor.trigger('setdown.here', id, {}); };
    const own = (id: string, label: string): HereItem[] => { const action = editor.getAction(id); return action?.isSupported() ? [{ id, group: 'edit', label, action: id, run: () => { editor.focus(); return action.run(); } }] : []; };
    const fixed: HereItem[] = [
      ...(selected && !readOnly ? [{ id: 'cut', group: 'edit' as const, label: 'Cut', action: 'editor.action.clipboardCutAction', run: act('editor.action.clipboardCutAction') }] : []),
      { id: 'copy', group: 'edit', label: 'Copy', action: 'editor.action.clipboardCopyAction', run: act('editor.action.clipboardCopyAction') },
      ...(readOnly ? [] : [{ id: 'paste', group: 'edit' as const, label: 'Paste', action: 'editor.action.clipboardPasteAction', run: act('editor.action.clipboardPasteAction') }]),
      ...own('setdown.insertLink', 'Insert URL'), ...own('setdown.insertTable', 'Insert Table'),
      { id: 'commands', group: 'edit', label: 'All Commands…', key: 'F1', run: () => { editor.focus(); return editor.getAction('setdown.commands')?.run(); } }];
    const tab = this.options.tabs().find(view => this.models.get(documentIdentity(view)) === model);
    // What the pointer was told about this place a moment ago would stay open under the menu and
    // around it. Closing it is not enough: a pointer that moved while it was open made the editor
    // promise to look at the place again in a moment, and it then opened the explanation under
    // the menu that had appeared meanwhile. The promise is withdrawn too (the pinned editor's own
    // `_cancelSchedulerAndHide`), now and for every move until the menu closes.
    const hover = editor.getContribution('editor.contrib.contentHover') as { hideContentHover?(): void; _cancelSchedulerAndHide?(): void } | null;
    const silence = () => { if (hover?._cancelSchedulerAndHide) hover._cancelSchedulerAndHide(); else hover?.hideContentHover?.(); };
    silence();
    const quiet = editor.onMouseMove(silence);
    await openHereMenu({ at, fixed: keyed(fixed), probes: probes.map(probe => probe.then(keyed)), closed: () => quiet.dispose(),
      subject: (selected ? model.getValueInRange(selection!).trim().split(/\r?\n/, 1)[0] : model.getWordAtPosition(position)?.word)?.slice(0, 80) || undefined,
      language: tab && documentSupport.get(tab.id)?.name,
      alive: () => editor.getModel() === model && !model.isDisposed() && model.getVersionId() === version,
      restore: () => { if (editor.getModel() === model) editor.focus(); },
      // What was done here by name is offered first the next time the command list opens.
      chosen: item => { if (item.action && item.id !== 'commands') recordRecentCommand(item.action); } }).catch((error: unknown) => { quiet.dispose(); throw error; });
  }
  private installBindings(api: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor): void {
    if (this.options.pythonCells) editor.addAction({ id: 'setdown.python-cells', label: 'Open Python # %% cells as interactive notebook…', precondition: 'editorLangId == python', run: async () => {
      const tab = this.options.tabs().find(tab => this.models.get(documentIdentity(tab)) === editor.getModel()); const model = editor.getModel();
      if (tab?.document.path && model) await this.options.pythonCells!(tab.document.path, model.getValue());
    } });
    const symbols = editor.createContextKey<boolean>('setdownLanguageSymbols', false), calls = editor.createContextKey<boolean>('setdownLanguageCalls', false),
      types = editor.createContextKey<boolean>('setdownLanguageTypes', false), problems = editor.createContextKey<boolean>('setdownLanguageProblems', false),
      companion = editor.createContextKey<boolean>('setdownLanguageCompanion', false);
    // One key for each tool whose own extension adds commands: true while the document's tool is that one.
    const tools = new Map(toolFamilies.map(tool => [tool, editor.createContextKey<boolean>(toolContextKey(tool), false)]));
    const updateLanguageContext = () => {
      const cap = this.languageClient?.capabilitiesFor(editor.getModel());
      symbols.set(!!cap?.workspaceSymbolProvider); calls.set(!!cap?.callHierarchyProvider); types.set(!!cap?.typeHierarchyProvider);
      problems.set(!!editor.getModel()); companion.set(!!this.languageClient?.hasCompanion(editor.getModel()));
      const running = this.languageClient?.toolsFor(editor.getModel()) ?? [];
      for (const [tool, key] of tools) key.set(running.includes(tool));
    };
    this.languageContexts.set(editor, updateLanguageContext);
    editor.onDidChangeModel(updateLanguageContext);
    editor.onDidDispose(() => this.languageContexts.delete(editor));
    for (const [kind, label] of Object.entries({ symbols: 'Go to Workspace Symbol…', incoming: 'Show Incoming Calls', outgoing: 'Show Outgoing Calls', supertypes: 'Show Supertypes', subtypes: 'Show Subtypes', problems: 'Show Problems in Open Files' }) as ['symbols' | 'incoming' | 'outgoing' | 'supertypes' | 'subtypes' | 'problems', string][]) {
      editor.addAction({ id: `setdown.language-${kind}`, label, precondition: kind === 'symbols' ? 'setdownLanguageSymbols' : kind === 'incoming' || kind === 'outgoing' ? 'setdownLanguageCalls' : kind === 'problems' ? 'setdownLanguageProblems' : 'setdownLanguageTypes',
        run: () => this.languageClient?.showNavigation(kind, editor) });
    }
    // vendor/vscode-clangd/package.json: the command, its place in the menu and its key (Alt+O, ⌥⌘O on macOS).
    editor.addAction({ id: 'setdown.language-companion', label: 'Switch Between Source/Header', precondition: 'setdownLanguageCompanion',
      keybindings: [(/Mac/i.test(navigator.platform) ? api.KeyMod.Alt | api.KeyMod.CtrlCmd : api.KeyMod.Alt) | api.KeyCode.KeyO],
      run: async () => {
        const model = editor.getModel(), position = editor.getPosition();
        if (!model || await this.languageClient?.openCompanion(model) || editor.getModel() !== model || !position) return;
        (editor.getContribution('editor.contrib.messageController') as unknown as { showMessage?(message: string, position: Monaco.IPosition): void } | null)?.showMessage?.('Didn\'t find a corresponding file.', position);
      } });
    // The commands each tool's own extension adds (`tool-command-list.ts`), with the extension's
    // keys. They are found by name in the command list; none is a fixed line of a menu.
    const toolKeys = { 'ctrl-shift-u': api.KeyMod.CtrlCmd | api.KeyMod.Shift | api.KeyCode.KeyU, 'ctrl-shift-j': api.KeyMod.CtrlCmd | api.KeyMod.Shift | api.KeyCode.KeyJ, enter: api.KeyCode.Enter };
    for (const command of toolCommandList) editor.addAction({ id: toolActionId(command.id), label: command.title, precondition: toolContextKey(command.tool),
      ...(command.key ? { keybindings: [toolKeys[command.key]],
        // Enter stays the editor's own wherever it already means something else, and during composition.
        keybindingContext: command.key === 'enter' ? 'editorTextFocus && !editorReadonly && !suggestWidgetVisible && !renameInputVisible && !inSnippetMode && !parameterHintsVisible && !editorHasMultipleSelections && !compositionInProgress' : 'editorTextFocus' } : {}),
      // A key the command took from the editor is given back when the command could not run.
      run: async () => { if (!await this.languageClient?.runToolCommand(command.id, editor) && command.key === 'enter') editor.trigger('keyboard', 'type', { text: '\n' }); } });
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
      run: () => { const model = editor.getModel(); const views = this.options.tabs().filter(view => this.models.get(documentIdentity(view)) === model);
        const view = views.find(view => view.id === this.options.active()?.id) ?? views[0]; openLanguageSupport(view && documentSupport.get(view.id)); } });
    editor.onDidFocusEditorText(() => {
      const tab = this.options.active();
      if (tab && editor.getModel() === this.models.get(documentIdentity(tab))) this.owners.get(documentIdentity(tab))?.beginEditing(`document:${tab.id}`);
    });
    // Right-click, and the menu key or Shift+F10 at the cursor.
    editor.onContextMenu(event => {
      event.event.preventDefault(); event.event.stopPropagation();
      const at = event.target.position;
      if (at && !editor.getSelection()?.containsPosition(at)) editor.setPosition(at);
      void this.openHere(api, editor, { x: event.event.posx, y: event.event.posy });
    });
    // An action, not `addCommand`: a key added with `addCommand` belongs to every editor of the
    // window at once, and the editor that registered last would answer for the one in use.
    editor.addAction({ id: 'setdown.here', label: 'Actions Here…', keybindings: [api.KeyMod.Shift | api.KeyCode.F10, api.KeyCode.ContextMenu],
      keybindingContext: 'editorTextFocus && !compositionInProgress', run: () => this.openHere(api, editor) });
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
