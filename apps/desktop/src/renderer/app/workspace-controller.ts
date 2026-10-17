import { imageSessions } from '../image/image-edit-sessions';
import { DocumentSessions } from '../workspace/document-sessions';
import { notebookContent, notebookViews } from '../notebook/document-content';
import { createBrowserActions } from '../browser/browser-actions';
import { createBrowserRuntime } from '../browser/browser-runtime';
import { browser } from '../browser/browser-state.svelte';
import { createGroupRuntime } from '../workspace/groups/group-runtime';
import { ReadingPositionController } from '../reading/reading-position-controller';
import { terminalOwnsInput } from '../terminal/terminal-state.svelte';
import { GOLDEN_TOP_RATIO, type ViewportAnchor } from '../../core/preview/viewport-anchor';
import { normalizePreviewTheme } from '../../core/preview/preview-preferences';
import { hasMarkdownPreview } from '../../core/document/document-capabilities';
import { isFileLocation } from '../../core/document/file-location';
import { isMarkdownDocument } from '../../core/document/document-profile';
import { createTabSession, isDocumentTab, WorkspaceState } from '../../core/workspace/workspace-state';
import type { ThemeSnapshot } from '../../protocol/desktop-api';
import { mount } from 'svelte';
import App from '../App.svelte';
import { MonacoEditor } from '../adapters/monaco-editor';
import { SurfaceController } from '../workspace/surface-controller';
import { ClosePromptController } from '../workspace/close-prompt-controller';
import { installWorkspaceEvents } from './workspace-events';
import { createEditorInsertions } from '../editor/editor-insertions';
import { installEditorImagePaste } from '../editor/editor-image-paste';
import { workingTreeMarkdownEditor } from '../editor/markdown-editor-port';
import type { MarkdownEditingTarget } from '../editor/markdown-editing-target';
import type { DesktopPort } from '../ports/desktop-port';
import { ProjectController } from '../project/project-controller';
import { project } from '../project/project-state.svelte';
import { installFolderDrop } from '../project/folder-drop';
import { PreviewSession } from '../reader/preview-session';
import { ReaderController } from '../reader/reader-controller';
import { createTabDrag } from '../workspace/tabs/tab-drag';
import { applyShellTheme } from '../theme';
import { restorePanelWidths } from '../shell/panel-resize';
import { rememberOutlineOpen } from '../shell/layout-session';
import { view } from '../workspace/workspace-view.svelte';
import type { AppActions } from '../ports/ui-actions';
import { DocumentActions } from '../workspace/document-actions';
import { AutoSaveController } from '../workspace/auto-save';
import { TabController } from '../workspace/tab-controller';
import '../style.css';

const EMPTY_ANCHOR: ViewportAnchor = {
  sourceLine: 1, yRatio: GOLDEN_TOP_RATIO, reason: 'empty-document', confidence: 'fallback',
};

/** Renderer composition root. Document capabilities gate Markdown-only actions. */
export function startWorkspace(desktop: DesktopPort) {
  const initialTheme: ThemeSnapshot = {
    id: normalizePreviewTheme(desktop.initialTheme.id), revision: Math.max(0, desktop.initialTheme.revision),
  };
  applyShellTheme(initialTheme.id);
  let projectOpenRequest = 0;
  let fileMutation: Promise<unknown> = Promise.resolve();
  const saveDocument = (saveAs = false) => {
    const result = fileMutation.then(() => documents.save(saveAs));
    fileMutation = result.catch(() => {}); return result;
  };
  const actions: AppActions = {
    openLanguageLocation: async (path, selection) => {
        const tab = await tabs.prepareLanguageDocument(path);
        await tabs.activate(tab.id);
        await surfaces.enterEditor();
        if (selection && editor.editor) {
          if ('startLineNumber' in selection) { editor.editor.setSelection(selection); editor.editor.revealRangeInCenter(selection); }
          else { editor.editor.setPosition(selection); editor.editor.revealPositionInCenter(selection); }
          editor.editor.focus();
        }
      },
    changeZoom: (steps, scope, tabId) => desktop.changeZoom(steps, scope, tabId),
    newTerminal: () => { projects.deactivateGitDiff(); void tabs.openTerminal(); },
    openTerminalSession: id => { projects.deactivateGitDiff(); void tabs.openTerminalSession(id).catch(error => { browser.error = String(error); }); },
    closeTerminalSession: id => { void tabs.closeTerminalSession(id); },
    terminalChanged: (id, info) => tabs.terminalChanged(id, info),
    newWebTab: (input, background) => { projects.deactivateGitDiff(); void tabs.openWeb(input, background).catch(error => { browser.error = String(error); }); },
    navigateLocation: async (groupId, input) => {
      const target = workspace.groups.groups.find(group => group.id === groupId);
      const id = target?.activeId;
      const previous = id ? workspace.find(id) : null;
      if (id && workspace.activeId !== id) await tabs.activate(id);
      projects.deactivateGitDiff();
      if (id) {
        if (await tabs.navigateLocation(id, input) && previous && isDocumentTab(previous)
          && workspace.find(id) !== previous) projects.closeWorkingTreeReviews(previous.document.path);
      } else if (isFileLocation(input)) await tabs.show(await desktop.readDocumentLocation(input));
      else await tabs.openWeb(input);
    },
    navigateHistory: (id, direction) => {
      void (async () => {
        const previous = workspace.find(id);
        if (!previous) return;
        if (workspace.activeId !== id) await tabs.activate(id);
        projects.deactivateGitDiff();
        if (await tabs.navigateHistory(id, direction) && isDocumentTab(previous) && workspace.find(id) !== previous) {
          projects.closeWorkingTreeReviews(previous.document.path);
        }
      })().catch(error => { browser.error = String(error); });
    },
    ...createBrowserActions({
      api: desktop.browser,
      tab: id => workspace.find(id), activeId: () => workspace.activeId,
      navigateHistory: (id, direction) => actions.navigateHistory(id, direction),
      sync: () => browsers?.sync(true),
    }),
    focusGroup: (id) => {
      projectOpenRequest++;
      const group = workspace.groups.groups.find(group => group.id === id);
      if (group?.activeId) { projects.deactivateGitDiff(); void tabs.activate(group.activeId); }
    },
    resizeGroup: (id, ratio) => { workspace.groups.resize(id, ratio); tabs.render(); },
    menuOverlay: desktop.menuOverlay,
    locationSuggestions: desktop.locationSuggestions,
    loadMenu: (id) => desktop.getApplicationMenu(id),
    executeMenuItem: (id) => desktop.executeApplicationMenuItem(id),
    resolveClosePrompt: (decision) => closePrompt.resolve(decision),
    activateTab: (id) => { projectOpenRequest++; projects.deactivateGitDiff(); void tabs.activate(id); },
    pinTab: (id) => tabs.pin(id),
    closeTab: (id) => void closeDocumentTab(id),
    startTabDrag: (id, event) => tabDrag.start(id, event),
    endTabDrag: (event) => tabDrag.end(event),
    newDocument: () => { projects.deactivateGitDiff(); void documents.create(); },
    // A canceled dialog or decoding failure must not hide the current reader.
    openDocument: () => void documents.open(),
    toggleProjectSidebar: () => projects.toggle(),
    selectProjectView: (target) => projects.select(target),
    chooseProjectFolder: () => void projects.chooseFolder(),
    refreshProjectExplorer: () => void projects.refreshExplorer(),
    collapseProjectExplorer: () => projects.collapseExplorer(),
    toggleProjectExplorerRoot: () => projects.toggleExplorerRoot(),
    toggleProjectDirectory: (path) => void projects.toggleDirectory(path),
    openProjectFile: (path, options) => void projects.openFile(path, options),
    createProjectEntry: (parent, name, kind) => projects.createEntry(parent, name, kind),
    renameProjectEntry: (path, name) => projects.renameEntry(path, name),
    moveProjectEntry: (path, target) => projects.moveEntry(path, target),
    moveProjectEntries: (paths, target) => projects.moveEntries(paths, target),
    explorer: desktop.explorer,
    transferProjectEntries: request => projects.transferEntries(request),
    revealActiveProjectEntry: async () => {
      const active = workspace.active;
      if (active && isDocumentTab(active)) await projects.revealEntry(active.document.path);
    },
    openProjectTerminal: path => { projects.deactivateGitDiff(); void tabs.openTerminal(path); },
    openProjectFiles: async paths => { for (const path of paths) await projects.openFile(path, { pinned: true }); },
    trashProjectEntry: (path) => projects.trashEntry(path),
    openProjectSearchResult: (result) => void projects.openSearchResult(result),
    searchProject: (query) => projects.search(query),
    toggleProjectSearchGroup: (path) => projects.toggleSearchGroup(path),
    refreshProjectGit: () => void projects.refreshGit(),
    toggleProjectGitGroup: (title) => projects.toggleGitGroup(title),
    reviewGitHistory: (selection) => void projects.reviewGitHistory(selection),
    reviewProjectGitChange: (path, staged) => void projects.reviewGitChange(path, staged),
    activateProjectGitDiff: (id) => projects.activateGitDiff(id),
    closeProjectGitDiff: (id) => projects.closeGitDiff(id),
    layoutProjectGitDiff: (bounds) => projects.layoutGitDiff(bounds),
    updateProjectGitDiffLine: (line) => projects.updateGitDiffLine(line),
    changeProjectGitWorkingTree: (text, edits) => projects.changeGitWorkingTree(text, edits),
    saveProjectGitWorkingTree: () => void saveDocument(),
    initializeProjectGit: () => void projects.initializeGit(),
    stageProjectGit: (paths) => void stageProjectChanges(paths),
    unstageProjectGit: (paths) => void projects.unstageGit(paths),
    discardProjectGit: (paths) => void projects.discardGit(paths),
    commitProjectGit: (message) => void projects.commitGit(message),
    runProjectGitRemote: (action) => void projects.runGitRemote(action),
    toggleSurface: () => {
      if (project.gitDiffActive && project.gitDiff) projects.toggleGitDiffMode(); else surfaces.toggle();
    },
    openTable: () => insertions.openTable(), openLink: () => insertions.openLink(),
    submitTable: () => insertions.submitTable(), closeTable: () => insertions.closeTable(),
    submitLink: () => insertions.submitLink(), closeLink: () => insertions.closeLink(),
    pickLinkFile: () => void insertions.pickLinkFile(), toggleToc,
    find: (query, direction, next) => reader.find(query, direction, next),
    closeFind: () => reader.closeFind(false), scrollToHeading,
    keepExternalChange: () => documents.keepExternalChange(),
    reloadExternalChange: () => void documents.reloadExternalChange(),
    showRenderError: () => void surfaces.enterEditor(),
  };
  mount(App, { target: document.querySelector<HTMLDivElement>('#app')!, props: { actions, terminalApi: desktop.terminal, desktop,
    mediaPosition: (id: string, position: import('../../core/reading/reading-position').ReadingPosition) => { const tab = workspace.find(id); if (tab && isDocumentTab(tab) && workspace.groups.groups.some(group => group.activeId === id) && !(workspace.activeId === id && project.gitDiffActive)) positions.remember(tab, position); } } });
  const shell = document.querySelector<HTMLElement>('.shell')!;
  restorePanelWidths(shell);
  const previewFrames = document.querySelector<HTMLElement>('.preview-frames')!;
  const editorHost = document.querySelector<HTMLElement>('.editor-host')!;
  const workspace = new WorkspaceState();
  const active = () => workspace.activeDocument;
  const session = createTabSession(() => workspace.active, EMPTY_ANCHOR);
  const closePrompt = new ClosePromptController();
  let surfaces: SurfaceController;
  let tabs: TabController;
  let autoSave: AutoSaveController;
  let positions: ReadingPositionController;
  let projects: ProjectController;
  let projectContextChanged = () => {};
  let groups: ReturnType<typeof createGroupRuntime> | undefined;
  let browsers: ReturnType<typeof createBrowserRuntime> | undefined;
  const reader = new ReaderController({ desktop, shell, frames: previewFrames, get tabs() { return workspace.documents; }, active,
    activeId: () => workspace.activeId, initialTheme,
    syncBackgrounds: () => groups?.backgrounds() ?? [],
    layoutGuide: (previews) => groups?.layoutGuide(previews),
    applyProductTheme: (themeId) => { applyShellTheme(themeId); editor.setTheme(themeId); },
    edit: (anchor) => void surfaces.enterEditor(anchor), anchorChanged: () => { surfaces.publishAnchor(); positions?.schedule(); } });
  const preview = new PreviewSession({ desktop, get tabs() { return workspace.documents; }, active,
    activeId: () => workspace.activeId, text: () => tabs.currentText(), lineCount: () => tabs.lineCount(), reader });
  const editor: MonacoEditor = new MonacoEditor({ host: editorHost, tabs: () => workspace.documents, active,
    releaseDocuments: () => documentSessions.releaseAll(),
    pythonCells: async (path, source) => {
      try { const file = await desktop.notebook.pythonCells(path, source); if (file) await projects.openFile(file, { pinned: true }); }
      catch (error) { window.alert(String(error)); }
    },
    language: { port: desktop.language,
      prepare: async path => { const tab = await tabs.prepareLanguageDocument(path); return { tab, model: editor.modelFor(tab) }; },
      open: actions.openLanguageLocation },
    theme: () => reader.themeId, status: (status) => shell.dataset.editorRuntime = status,
    viewChanged: () => positions?.schedule(),
    focusTab: (id) => actions.activateTab(id),
    changed: (tab, text) => tabs.editorChanged(tab, text), scrolled: () => surfaces.editorScrolled(),
    escape: () => void surfaces.enterViewer(), insertLink: () => insertions.openLink(), insertTable: () => insertions.openTable() });
  const documentSessions = new DocumentSessions(editor, [notebookContent, imageSessions], desktop);
  imageSessions.configure(desktop.imageEdit, () => workspace.documents, () => tabs?.updateChrome());
  imageSessions.saveFromToolbar = (id, saveAs) => {
    const tab = workspace.documents.find(t => t.id === id);
    if (!tab) return Promise.resolve();
    const task = fileMutation.then(async () => {
      try {
        const result = await documentSessions.save(tab, saveAs);
        if (result.document && !result.canceled) { await tabs.acceptSaved(tab, result.document); await projects.documentSaved(result.document); }
      } catch (error) { imageSessions.fail(id, error); }
    });
    fileMutation = task.catch(() => {}); return task;
  };
  surfaces = new SurfaceController({ workspace, session, shell, editor, reader, preview,
    changed: () => { projectContextChanged(); positions?.schedule(); } });
  positions = new ReadingPositionController({ desktop, editor, active, suspended: () => project.gitDiffActive });
  tabs = new TabController({ documents: documentSessions,
    publishDocuments: () => { view.notebookTabs = notebookViews(workspace, (tab, refresh) => {
      if (refresh) tabs.updateChrome();
      autoSave.schedule(tab);
    }); },
    desktop, workspace, session, shell, editor, reader, preview, surfaces,
    shouldFocusWeb: () => !document.activeElement?.matches('.location-bar input'),
    capturePosition: (tab) => positions.capture(tab),
    reviewZoomId: () => project.gitDiffActive && project.activeGitDiffId ? `git-diff:${project.activeGitDiffId}` : null,
    shouldSchedulePreview: () => !project.gitDiffActive,
    confirmClose: (names) => closePrompt.request('tab', names), workspaceChanged: () => projectContextChanged(), groupsChanged: () => { groups?.sync(); browsers?.sync(true); },
    autoSave: { schedule: (tab) => autoSave.schedule(tab), cancel: (tabId) => autoSave.cancel(tabId) } });
  groups = createGroupRuntime({ workspace, desktop, editor, reader, activate: id => actions.activateTab(id) });
  browsers = createBrowserRuntime(workspace, desktop, tabs, actions.activateTab, actions.navigateHistory,
    id => actions.browserReaderEnter(id));
  /** Open shell menus/dialogs own Escape first (they close on it); reader
   * entry is the last stop for an unconsumed Esc. */
  const popupOwnsEscape = () => [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="alertdialog"], dialog[open]')]
    .some(element => element.getClientRects().length > 0);
  const sidebarOwnsEscape = (target = document.activeElement) => target instanceof Element
    && !!target.closest('.explorer-tree, .explorer-root, .explorer-filter, .project-context-menu, .project-confirm, .language-support');
  const tabDrag = createTabDrag({ desktop, shell, tabs: workspace.tabs, groups: workspace.groups,
    dragging: (active) => groups?.drag(active),
    openFile: async (path, placement) => {
      const request = ++projectOpenRequest;
      const opened = await desktop.openProjectFile(path);
      if (!opened || request !== projectOpenRequest) return;
      projects.deactivateGitDiff(); await tabs.show(opened, 'viewer', 'document', placement);
    },
    activeId: () => workspace.activeId,
    activate: (id) => { projects.deactivateGitDiff(); void tabs.activate(id); },
    serialize: tabs.transferable, render: tabs.render,
    install: (transfer, placement) => tabs.installTransferred(transfer, placement) });
  autoSave = new AutoSaveController({ desktop, get tabs() { return workspace.documents; }, activeId: () => workspace.activeId,
    text: tabs.text, dirty: tabs.dirty, beforeSave: tab => documentSessions.beforeSave(tab, 2), acceptSaved: tabs.acceptSaved,
    saved: (document) => projects.documentSaved(document) });
  const documents = new DocumentActions({ desktop, get tabs() { return workspace.documents; }, active, text: tabs.text, dirty: tabs.dirty,
    preview, saveTab: documentSessions.save, beforeSave: tab => documentSessions.beforeSave(tab), installModel: tabs.installModel, acceptSaved: tabs.acceptSaved,
    show: (document, surface) => { projectOpenRequest++; projects.deactivateGitDiff(); return tabs.show(document, surface); },
    reload: tabs.reload, saved: (document) => projects.documentSaved(document),
    renderTabs: tabs.render, updateChrome: tabs.updateChrome, autoSave });
  projects = new ProjectController({ desktop,
    searchDocuments: (query) => workspace.documents.filter((tab) => !tab.document.kind).map((tab) => ({ path: tab.document.path, text: tabs.text(tab),
      surface: tab.surface === 'viewer' ? 'viewer' : 'editor', matches: tab.surface === 'editor' ? editor.projectMatches(tab, query.trim()) : undefined })),
    showDocument: async (path, options) => {
      const request = ++projectOpenRequest;
      const documentSnapshot = await desktop.openProjectFile(path);
      if (!documentSnapshot || request !== projectOpenRequest) return false;
      projects.deactivateGitDiff();
      await tabs.show(documentSnapshot, 'viewer', 'document', undefined, options);
      return request === projectOpenRequest;
    },
    openWorkingTree: async (path) => {
      const request = ++projectOpenRequest;
      const documentSnapshot = await desktop.openProjectFile(path);
      if (!documentSnapshot || request !== projectOpenRequest) return false;
      await tabs.show(documentSnapshot, 'viewer', 'review');
      return request === projectOpenRequest;
    },
    activateWorkingTree: tabs.activateWorkingTreePath, workingTreeBuffer: tabs.documentBuffer,
    workingTreeChanged: tabs.acceptWorkingTreeBuffer, reloadDocuments: tabs.reloadDocumentPaths,
    pathMoved: tabs.relocatePath, prepareRemove: tabs.prepareRemove, commitRemove: tabs.commitRemove,
    runMutation: operation => {
      const result = fileMutation.then(async () => {
        const release = await autoSave.hold();
        try { return await operation(); } finally { release(); }
      });
      fileMutation = result.catch(() => {}); return result;
    },
    reviewChanged: (open, activeReview) => {
      const wasOpen = shell.dataset.gitDiff === 'true';
      shell.dataset.gitDiff = String(open);
      reader.setSuspended(activeReview); browsers?.sync();
      if (activeReview) { positions.capture(); preview.cancelSchedule(); }
      else if (wasOpen && !open && workspace.activeId) {
        // A first-open review may never have prepared the ordinary document.
        // Closing the last review is an explicit return to that document.
        void tabs.activate(workspace.activeId);
      }
    },
    highlight: (query, target) => {
      const editing = workspace.active?.surface === 'editor';
      const currentTarget = target?.surface === (editing ? 'editor' : 'viewer') ? target : undefined;
      reader.projectSearch(editing ? '' : query, editing ? undefined : currentTarget);
      editor.projectSearch(editing ? query : '', editing ? currentTarget : undefined);
    },
    resized: reader.syncView, folderChanged: root => editor.setLanguageRoot(root),
  });
  projectContextChanged = projects.contextChanged;
  installFolderDrop(shell, desktop, (path) => void projects.openFolderPath(path));
  void projects.restore();
  const editorContext = { desktop, host: shell,
    target: (): MarkdownEditingTarget | null => {
      const document = session.document;
      if (!document || !hasMarkdownPreview(document)) return null;
      if (project.gitDiffActive) {
        const target = workingTreeMarkdownEditor.read();
        return target && target.filePath === document.path ? { ...target, document } : null;
      }
      if (session.surface !== 'editor' || !workspace.activeId || !editor.editor || !editor.api || !editor.model) return null;
      return { identity: `document:${workspace.activeId}`, document, editor: editor.editor, monaco: editor.api, model: editor.model };
    },
  };
  const insertions = createEditorInsertions({ ...editorContext, save: () => saveDocument() });
  const removeImagePaste = installEditorImagePaste(editorContext);
  void desktop.getAutoSave().then((enabled) => autoSave.setEnabled(enabled));
  const unsubscribeAutoSave = desktop.onAutoSaveChanged((enabled) => autoSave.setEnabled(enabled));
  window.addEventListener('beforeunload', () => { positions.flush(); insertions.dispose(); removeImagePaste(); unsubscribeAutoSave(); editor.disposeWorkspace(); }, { once: true });
  function toggleToc() {
    const tab = workspace.activeDocument;
    if (!tab || !hasMarkdownPreview(tab.document)) return;
    tab.tocOpen = !tab.tocOpen;
    rememberOutlineOpen(tab.tocOpen);
    reader.syncUi(); reader.syncView();
    if (tab.tocOpen) reader.send(tab.id, { command: 'marktex:collect-headings' });
  }
  function scrollToHeading(id: string) {
    if (workspace.activeId && hasMarkdownPreview(session.document)) reader.send(workspace.activeId, { command: 'marktex:scroll-to-heading', id });
  }
  let stagingChanges = false;
  async function stageProjectChanges(paths: string[]) {
    if (stagingChanges) return;
    stagingChanges = true;
    try { if (await documents.savePaths(paths)) await projects.stageGit(paths); }
    finally { stagingChanges = false; }
  }
  async function closeDocumentTab(id: string) {
    const path = workspace.documents.find(tab => tab.id === id)?.document.path;
    if (await tabs.close(id) && path) projects.closeWorkingTreeReviews(path);
  }
  function cycleTab(direction: -1 | 1) {
    const all = [...workspace.groups.focused.tabs.flatMap(id => workspace.find(id) ?? []).map((tab) => ({ id: tab.id, diff: false })),
      ...project.gitDiffTabs.map((tab) => ({ id: tab.id, diff: true }))];
    if (all.length < 2) return;
    const activeId = project.gitDiffActive ? project.activeGitDiffId : workspace.activeId;
    const current = Math.max(0, all.findIndex((tab) => tab.id === activeId));
    const next = all[(current + direction + all.length) % all.length];
    if (next.diff) projects.activateGitDiff(next.id);
    else { projects.deactivateGitDiff(); void tabs.activate(next.id); }
  }
  const renderedReview = () => !!project.gitDiff && isMarkdownDocument(project.gitDiff.filePath);
  installWorkspaceEvents(desktop, {
    previewMessage: (payload) => {
      if (payload.message.type === 'marktex:focus' && payload.tabId !== workspace.activeId
        && workspace.groups.groups.some(group => group.activeId === payload.tabId)) {
        actions.activateTab(payload.tabId); return;
      }
      if (payload.message.type === 'marktex:reader-export') {
        void (async () => { await tabs.activate(payload.tabId); if (workspace.activeId === payload.tabId && !project.gitDiffActive) await documents.exportPdf(); })(); return;
      }
      if (payload.message.type === 'marktex:folder-drop' && typeof payload.message.path === 'string') {
        void projects.openFolderPath(payload.message.path); return;
      }
      if (projects.previewMessage(payload)) return;
      preview.receive(payload); reader.handleMessage(payload);
    },
    previewFindRequested: (tabId) => { if (tabId === workspace.activeId && session.surface === 'viewer') reader.openFind(); },
    documentOpened: (opened) => { projectOpenRequest++; projects.deactivateGitDiff(); void tabs.show(opened); },
    externalChange: (change) => {
      const active = workspace.activeDocument;
      if (!active || active.document.path !== change.path) {
        const background = workspace.documents.find(tab => tab.document.path === change.path);
        if (background && !tabs.dirty(background)) void tabs.reloadDocumentPaths([change.path], true).catch(error => console.error('Could not refresh background document', error));
        return;
      }
      if (tabs.dirty(active)) { view.notice = true; return; }
      const revision = active.revision;
      void desktop.reloadDocument().then((documentSnapshot) => {
        if (documentSnapshot && workspace.active?.id === active.id && active.revision === revision
          && active.document.path === documentSnapshot.path) void tabs.reload(documentSnapshot);
      }).catch((error) => { console.error('Could not reload changed file', error); view.notice = true; });
    },
    projectFilesChanged: (event) => projects.filesChanged(event.root, event.paths),
    themeChanged: (snapshot) => { void reader.applyTheme(snapshot); void projects.applyTheme(snapshot.id); },
    windowCloseRequested: (names) => {
      void closePrompt.request('window', names).then((decision) => desktop.resolveWindowClose(decision));
    },
    command: (command) => {
      if (command === 'escape' && sidebarOwnsEscape()) return;
      if (command.startsWith('explorer:')) {
        window.dispatchEvent(new CustomEvent('setdown:explorer-command', { detail: command.slice('explorer:'.length) })); return;
      }
      if (command === 'language-support') { window.dispatchEvent(new Event('setdown:language-support')); return; }
      if (command === 'new-web-tab') { actions.newWebTab(); return; }
      if (command === 'reopen-web-tab') { void desktop.browser.reopen().catch(error => { browser.error = String(error); }); return; }
      if (command === 'focus-location') { window.dispatchEvent(new Event('setdown:focus-location')); return; }
      if ((command === 'navigate-back' || command === 'navigate-forward') && workspace.activeId && !project.gitDiffActive) {
        actions.navigateHistory(workspace.activeId, command === 'navigate-back' ? -1 : 1); return;
      }
      if (workspace.active?.kind === 'web' && !project.gitDiffActive) {
        if (command === 'escape' && browser.findId === workspace.active.id) {
          actions.browserFind(workspace.active.id, ''); browser.findId = null;
          if (browser.readers[workspace.active.id]) window.dispatchEvent(new CustomEvent('setdown:reader-focus', { detail: workspace.active.id }));
          else actions.browserCommand(workspace.active.id, 'focus');
          return;
        }
        if (command === 'escape' && !popupOwnsEscape()) { actions.browserReaderEnter(workspace.active.id); return; }
        if (command === 'open-find') { window.dispatchEvent(new Event('setdown:browser-find')); return; }
        if (command === 'export-pdf' && browser.readers[workspace.active.id]) { void actions.browserReaderExport(workspace.active.id, 'pdf'); return; }
        if (command === 'save' || command === 'save-as') { actions.browserCommand(workspace.active.id, 'save'); return; }
      }
      if (command === 'image:undo' || command === 'image:redo') {
        if (document.activeElement?.matches('input, textarea, [contenteditable="true"]')) document.execCommand(command.slice(6));
        else if (active()) { if (command === 'image:undo') imageSessions.undo(active()!.id); else imageSessions.redo(active()!.id); }
        return;
      }
      if (command === 'toggle-terminal') { projects.select('terminal'); return; }
      if (command === 'escape' && terminalOwnsInput()) return;
      if (command === 'escape' && insertions.dismissOnEscape('native')) return;
      if (command === 'new-document') { projects.deactivateGitDiff(); void documents.create(); }
      if (command === 'open-folder') void projects.chooseFolder();
      if (command === 'save' && (!project.gitDiffActive || (!project.gitDiff?.staged && !project.gitDiff?.history))) void saveDocument();
      if (command === 'save-as' && (!project.gitDiffActive || (!project.gitDiff?.staged && !project.gitDiff?.history))) void saveDocument(true);
      if (command === 'export-pdf' && !project.gitDiffActive) void documents.exportPdf();
      if (command === 'close-tab') {
        if (project.gitDiffActive) projects.closeGitDiff(); else if (workspace.activeId) void closeDocumentTab(workspace.activeId);
      }
      if (command === 'next-tab') cycleTab(1);
      if (command === 'previous-tab') cycleTab(-1);
      if (command === 'open-find' && !project.gitDiffActive) {
        if (session.surface === 'notebook') window.dispatchEvent(new Event('setdown:notebook-find'));
        else if (session.surface === 'pdf') window.dispatchEvent(new Event('setdown:pdf-find'));
        else if (session.surface === 'editor') editor.find(); else reader.openFind();
      }
      if (command === 'escape' && project.gitDiffActive) {
        if (renderedReview() && project.gitDiffMode === 'source') projects.showRenderedGitDiff();
      } else if (command === 'escape' && session.surface === 'editor' && hasMarkdownPreview(session.document)) {
        void surfaces.enterViewer();
      }
      if (command === 'toggle-folder-tools') projects.toggle();
      if (command === 'toggle-surface') {
        if (project.gitDiffActive && project.gitDiff) projects.toggleGitDiffMode(); else surfaces.toggle();
      }
    },
    saveBeforeClose: () => void fileMutation.then(() => documents.saveAll()),
    transferIncoming: (transfer) => { projects.deactivateGitDiff(); void tabs.installTransferred(transfer); },
    transferCompleted: ({ transferId, tabId }) => {
      tabDrag.reset(); void tabs.removeTransferred(tabId).finally(() => desktop.releaseTabTransferSource(transferId));
    },
    keydown: (event) => {
      if (event.key === 'Escape' && sidebarOwnsEscape(event.target instanceof Element ? event.target : null)) return;
      if (!event.isComposing && event.altKey && !event.ctrlKey && !event.metaKey && !terminalOwnsInput(event.target)
        && ['ArrowLeft', 'ArrowRight'].includes(event.key) && !project.gitDiffActive && workspace.activeId) {
        event.preventDefault(); actions.navigateHistory(workspace.activeId, event.key === 'ArrowLeft' ? -1 : 1); return;
      }
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && !event.altKey && ['l', 't'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (event.key.toLowerCase() === 't') {
          if (event.shiftKey) void desktop.browser.reopen().catch(error => { browser.error = String(error); }); else actions.newWebTab();
        } else window.dispatchEvent(new Event('setdown:focus-location'));
        return;
      }
      if (workspace.active?.kind === 'web' && !project.gitDiffActive && (event.ctrlKey || event.metaKey) && ['f', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (event.key.toLowerCase() === 'f') window.dispatchEvent(new Event('setdown:browser-find'));
        else actions.browserCommand(workspace.active.id, 'save');
        return;
      }
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.code === 'Backquote') {
        event.preventDefault(); projects.select('terminal'); return;
      }
      if (terminalOwnsInput(event.target)) return;
      // Shadow-DOM inputs and graph navigation own Escape/Find themselves.
      if (event.composedPath().some((node) => node instanceof HTMLElement && node.localName === 'web-git-graph')) return;
      if (session.surface === 'pdf' && !project.gitDiffActive && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault(); window.dispatchEvent(new Event('setdown:pdf-find')); return;
      }
      if (event.key === 'Escape' && insertions.dismissOnEscape('dom')) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation();
        if (!project.gitDiffActive || (!project.gitDiff?.staged && !project.gitDiff?.history)) void saveDocument();
        return;
      }
      if (event.key === 'Escape' && !project.gitDiffActive && workspace.active?.kind === 'web'
        && !(event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))
        && !popupOwnsEscape()) {
        event.preventDefault(); event.stopPropagation();
        // One-way like the Markdown viewer: Esc enters the reader; returning
        // to the live page is the reader's double-click.
        if (!browser.readers[workspace.active.id]) actions.browserReaderEnter(workspace.active.id);
        return;
      }
      if (event.key === 'Escape') tabDrag.cancel();
      if (event.key === 'Escape' && project.gitDiffActive && renderedReview()) {
        event.preventDefault(); event.stopPropagation();
        if (project.gitDiffMode === 'source') projects.showRenderedGitDiff();
        return;
      }
      if (event.key === 'Escape' && !project.gitDiffActive && session.surface === 'editor'
        && hasMarkdownPreview(session.document)) {
        event.preventDefault(); event.stopPropagation(); void surfaces.enterViewer(); return;
      }
      if (!project.gitDiffActive && session.surface === 'viewer' && event.key.toLowerCase() === 'f'
        && (event.ctrlKey || event.metaKey) && !event.altKey) { event.preventDefault(); reader.openFind(); }
    },
  });
  void desktop.getTheme().then(async (snapshot) => {
    await reader.applyTheme(snapshot, true);
    const documentSnapshot = await desktop.getDocument();
    if (documentSnapshot) await tabs.show(documentSnapshot);
    else if (workspace.tabs.length === 0) { surfaces.set('empty'); tabs.render(); }
    const pages = await desktop.browser.restore();
    for (const page of pages) await tabs.addWeb(page, true);
    if (!workspace.activeId && pages.length) await tabs.activate(pages[0].id);
    desktop.browser.ready();
  });
  const previewResizeObserver = new ResizeObserver(reader.syncView);
  previewResizeObserver.observe(previewFrames);
}
