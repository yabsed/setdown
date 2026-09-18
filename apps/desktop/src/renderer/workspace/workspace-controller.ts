import { GOLDEN_TOP_RATIO, type ViewportAnchor } from '../../core/preview/viewport-anchor';
import { normalizePreviewTheme } from '../../core/preview/preview-preferences';
import { createTabSession, WorkspaceState } from '../../core/workspace/workspace-state';
import type { ThemeSnapshot } from '../../protocol/desktop-api';
import { mount } from 'svelte';
import App from '../App.svelte';
import { MonacoEditor } from '../adapters/monaco-editor';
import { SurfaceController } from '../application/surface-controller';
import { ClosePromptController } from '../application/close-prompt-controller';
import { installWorkspaceEvents } from '../application/workspace-events';
import { createEditorInsertions } from '../editor/editor-insertions';
import { installEditorImagePaste } from '../editor/editor-image-paste';
import type { DesktopPort } from '../ports/desktop-port';
import { ProjectController } from '../project/project-controller';
import { project } from '../project/project-state.svelte';
import { installFolderDrop } from '../project/folder-drop';
import { PreviewSession } from '../reader/preview-session';
import { ReaderController } from '../reader/reader-controller';
import { createTabDrag } from '../tabs/tab-drag';
import { applyShellTheme } from '../theme';
import { restorePanelWidths } from '../shell/panel-resize';
import { rememberOutlineOpen } from '../shell/layout-session';
import { view, type AppActions } from '../view-state.svelte';
import { DocumentActions } from './document-actions';
import { TabController } from './tab-controller';
import '../style.css';

const EMPTY_ANCHOR: ViewportAnchor = {
  sourceLine: 1,
  yRatio: GOLDEN_TOP_RATIO,
  reason: 'empty-document',
  confidence: 'fallback',
};

/** Renderer composition root. 모든 실제 동작은 주입된 책임 객체가 수행한다. */
export function startWorkspace(desktop: DesktopPort) {
  desktop.updateGitReviewState(null);
  const initialTheme: ThemeSnapshot = {
    id: normalizePreviewTheme(desktop.initialTheme.id),
    revision: Math.max(0, desktop.initialTheme.revision),
  };
  applyShellTheme(initialTheme.id);

  const actions: AppActions = {
    loadMenu: (id) => desktop.getApplicationMenu(id),
    executeMenuItem: (id) => desktop.executeApplicationMenuItem(id),
    resolveClosePrompt: (decision) => closePrompt.resolve(decision),
    activateTab: (id) => {
      projects.deactivateGitDiff();
      void tabs.activate(id);
    },
    closeTab: (id) => void tabs.close(id),
    startTabDrag: (id, event) => tabDrag.start(id, event),
    endTabDrag: (event) => tabDrag.end(event),
    newDocument: () => {
      projects.deactivateGitDiff();
      void documents.create();
    },
    openDocument: () => {
      projects.deactivateGitDiff();
      void documents.open();
    },
    toggleProjectSidebar: () => projects.toggle(),
    selectProjectView: (target) => projects.select(target),
    chooseProjectFolder: () => void projects.chooseFolder(),
    refreshProjectExplorer: () => void projects.refreshExplorer(),
    collapseProjectExplorer: () => projects.collapseExplorer(),
    toggleProjectDirectory: (path) => void projects.toggleDirectory(path),
    openProjectFile: (path) => void projects.openFile(path),
    createProjectEntry: (parent, name, kind) => projects.createEntry(parent, name, kind),
    renameProjectEntry: (path, name) => projects.renameEntry(path, name),
    moveProjectEntry: (path, target) => projects.moveEntry(path, target),
    trashProjectEntry: (path) => projects.trashEntry(path),
    openProjectSearchResult: (result) => void projects.openSearchResult(result),
    searchProject: (query) => projects.search(query),
    toggleProjectSearchGroup: (path) => projects.toggleSearchGroup(path),
    refreshProjectGit: () => void projects.refreshGit(),
    reviewProjectGitChange: (path, staged) => void projects.reviewGitChange(path, staged),
    activateProjectGitDiff: () => projects.activateGitDiff(),
    closeProjectGitDiff: () => void closeGitDiff(),
    layoutProjectGitDiff: (bounds) => projects.layoutGitDiff(bounds),
    changeProjectGitWorkingTree: (text) => projects.changeGitWorkingTree(text),
    saveProjectGitWorkingTree: () => void projects.saveGitWorkingTree(),
    initializeProjectGit: () => void projects.initializeGit(),
    stageProjectGit: (paths) => void projects.stageGit(paths),
    unstageProjectGit: (paths) => void projects.unstageGit(paths),
    discardProjectGit: (paths) => void projects.discardGit(paths),
    commitProjectGit: (message) => void projects.commitGit(message),
    runProjectGitRemote: (action) => void projects.runGitRemote(action),
    toggleSurface: () => {
      if (project.gitDiffActive && project.gitDiff) projects.toggleGitDiffMode();
      else surfaces.toggle();
    },
    openTable: () => insertions.openTable(),
    openLink: () => insertions.openLink(),
    submitTable: () => insertions.submitTable(),
    closeTable: () => insertions.closeTable(),
    submitLink: () => insertions.submitLink(),
    closeLink: () => insertions.closeLink(),
    pickLinkFile: () => void insertions.pickLinkFile(),
    toggleToc,
    find: (query, direction, next) => reader.find(query, direction, next),
    closeFind: () => reader.closeFind(false),
    scrollToHeading,
    keepExternalChange: () => documents.keepExternalChange(),
    reloadExternalChange: () => void documents.reloadExternalChange(),
    showRenderError: () => void surfaces.enterEditor(),
  };

  mount(App, { target: document.querySelector<HTMLDivElement>('#app')!, props: { actions } });

  const shell = document.querySelector<HTMLElement>('.shell')!;
  restorePanelWidths(shell);
  const previewFrames = document.querySelector<HTMLElement>('.preview-frames')!;
  const editorHost = document.querySelector<HTMLElement>('.editor-host')!;
  const tabStrip = document.querySelector<HTMLElement>('.tab-strip')!;
  const workspace = new WorkspaceState();
  const active = () => workspace.active;
  const session = createTabSession(active, EMPTY_ANCHOR);
  const closePrompt = new ClosePromptController();

  let surfaces: SurfaceController;
  let tabs: TabController;
  let projects: ProjectController;
  let projectContextChanged = () => {};
  const reader = new ReaderController({
    desktop,
    shell,
    frames: previewFrames,
    tabs: workspace.tabs,
    active,
    activeId: () => workspace.activeId,
    initialTheme,
    applyProductTheme: (themeId) => {
      applyShellTheme(themeId);
      editor.setTheme(themeId);
    },
    edit: (anchor) => void surfaces.enterEditor(anchor),
    anchorChanged: () => surfaces.publishAnchor(),
  });
  const preview = new PreviewSession({
    desktop,
    tabs: workspace.tabs,
    active,
    activeId: () => workspace.activeId,
    text: () => tabs.currentText(),
    lineCount: () => tabs.lineCount(),
    reader,
  });
  const editor = new MonacoEditor({
    host: editorHost,
    tabs: () => workspace.tabs,
    active,
    theme: () => reader.themeId,
    status: (status) => shell.dataset.editorRuntime = status,
    changed: (tab, text) => tabs.editorChanged(tab, text),
    scrolled: () => surfaces.editorScrolled(),
    escape: () => void surfaces.enterViewer(),
    insertLink: () => insertions.openLink(),
    insertTable: () => insertions.openTable(),
  });
  surfaces = new SurfaceController({
    workspace,
    session,
    shell,
    editor,
    reader,
    preview,
    changed: () => projectContextChanged(),
  });
  tabs = new TabController({
    desktop,
    workspace,
    session,
    shell,
    editor,
    reader,
    preview,
    surfaces,
    confirmClose: (names) => closePrompt.request('tab', names),
    workspaceChanged: () => projectContextChanged(),
  });

  const tabDrag = createTabDrag({
    desktop,
    shell,
    strip: tabStrip,
    tabs: workspace.tabs,
    activeId: () => workspace.activeId,
    activate: (id) => {
      projects.deactivateGitDiff();
      void tabs.activate(id);
    },
    serialize: tabs.transferable,
    render: tabs.render,
    install: (transfer) => void tabs.installTransferred(transfer),
  });
  const documents = new DocumentActions({
    desktop,
    tabs: workspace.tabs,
    active,
    text: tabs.text,
    dirty: tabs.dirty,
    preview,
    installModel: tabs.installModel,
    show: tabs.show,
    reload: tabs.reload,
    renderTabs: tabs.render,
    updateChrome: tabs.updateChrome,
  });
  projects = new ProjectController({
    desktop,
    searchDocuments: (query) => workspace.tabs.map((tab) => ({
      path: tab.document.path,
      text: tabs.text(tab),
      surface: tab.surface,
      matches: tab.surface === 'editor' ? editor.projectMatches(tab, query.trim()) : undefined,
    })),
    showDocument: async (path) => {
      const documentSnapshot = await desktop.openProjectFile(path);
      if (!documentSnapshot) return false;
      await tabs.show(documentSnapshot);
      return true;
    },
    pathMoved: tabs.relocatePath,
    prepareRemove: tabs.prepareRemove,
    preferRenderedDiff: () => session.surface !== 'editor',
    reviewChanged: (open, activeReview) => {
      shell.dataset.gitDiff = String(open);
      reader.setSuspended(activeReview);
    },
    canSaveWorkingTree: tabs.canAcceptWorkingTreeEdit,
    workingTreeSaved: tabs.acceptWorkingTreeSave,
    highlight: (query, target) => {
      const editing = workspace.active?.surface === 'editor';
      const currentTarget = target?.surface === (editing ? 'editor' : 'viewer')
        ? target : undefined;
      reader.projectSearch(editing ? '' : query, editing ? undefined : currentTarget);
      editor.projectSearch(editing ? query : '', editing ? currentTarget : undefined);
    },
    resized: reader.syncView,
  });
  projectContextChanged = projects.contextChanged;
  installFolderDrop(shell, desktop, (path) => void projects.openFolderPath(path));
  void projects.restore();
  const editorContext = {
    desktop,
    host: editorHost,
    editor: () => editor.editor,
    monaco: () => editor.api,
    model: () => editor.model,
    document: () => session.document,
  };
  const insertions = createEditorInsertions({
    ...editorContext,
    editing: () => session.surface === 'editor',
    save: () => documents.save(false),
  });
  installEditorImagePaste(editorContext);

  function toggleToc() {
    const tab = workspace.active;
    if (!tab) return;
    tab.tocOpen = !tab.tocOpen;
    rememberOutlineOpen(tab.tocOpen);
    reader.syncUi();
    reader.syncView();
    if (tab.tocOpen) reader.send(tab.id, { command: 'marktex:collect-headings' });
  }

  function scrollToHeading(id: string) {
    if (workspace.activeId) reader.send(workspace.activeId, { command: 'marktex:scroll-to-heading', id });
  }

  function gitDiffName() {
    const filePath = project.gitDiff?.filePath ?? project.gitDiffTarget?.filePath ?? 'Working Tree';
    const name = filePath.split(/[\\/]/).at(-1) ?? filePath;
    return `${name} (${project.gitDiff?.staged ? 'Index' : 'Working Tree'})`;
  }

  async function closeGitDiff() {
    if (!project.gitDiffDirty) return projects.closeGitDiff();
    const decision = await closePrompt.request('tab', [gitDiffName()]);
    if (decision === 'cancel') return;
    if (decision === 'save') {
      await projects.saveGitWorkingTree();
      if (project.gitDiffDirty) return;
    }
    projects.closeGitDiff();
  }

  installWorkspaceEvents(desktop, {
    previewMessage: (payload) => {
      if (payload.message.type === 'marktex:folder-drop'
        && typeof payload.message.path === 'string') {
        void projects.openFolderPath(payload.message.path);
        return;
      }
      if (projects.previewMessage(payload)) return;
      preview.receive(payload);
      reader.handleMessage(payload);
    },
    previewFindRequested: (tabId) => {
      if (tabId === workspace.activeId && session.surface === 'viewer') reader.openFind();
    },
    documentOpened: (opened) => {
      projects.deactivateGitDiff();
      void tabs.show(opened);
    },
    externalChange: (change) => {
      if (session.document?.path === change.path) view.notice = true;
    },
    projectFilesChanged: (event) => projects.filesChanged(event.root),
    themeChanged: (snapshot) => {
      void reader.applyTheme(snapshot);
      void projects.applyTheme(snapshot.id);
    },
    windowCloseRequested: (names) => {
      void closePrompt.request('window', names).then((decision) => {
        desktop.resolveWindowClose(decision);
      });
    },
    command: (command) => {
      if (command === 'new-document') {
        projects.deactivateGitDiff();
        void documents.create();
      }
      if (command === 'open-folder') void projects.chooseFolder();
      if (command === 'save') {
        if (project.gitDiffActive) void projects.saveGitWorkingTree();
        else void documents.save(false);
      }
      if (command === 'save-as') {
        if (project.gitDiffActive) void projects.saveGitWorkingTree();
        else void documents.save(true);
      }
      if (command === 'export-pdf') void documents.exportPdf();
      if (command === 'close-tab') {
        if (project.gitDiffActive) {
          void closeGitDiff();
        } else if (workspace.activeId) void tabs.close(workspace.activeId);
      }
      if (command === 'next-tab') {
        projects.deactivateGitDiff();
        tabs.cycle(1);
      }
      if (command === 'previous-tab') {
        projects.deactivateGitDiff();
        tabs.cycle(-1);
      }
      if (command === 'open-find' && !project.gitDiffActive) reader.openFind();
      if (command === 'escape' && project.gitDiffActive && project.gitDiff) {
        if (project.gitDiffMode === 'source') projects.showRenderedGitDiff();
      } else if (command === 'escape' && session.surface === 'editor') void surfaces.enterViewer();
      if (command === 'toggle-folder-tools') projects.toggle();
      if (command === 'toggle-surface') {
        if (project.gitDiffActive && project.gitDiff) projects.toggleGitDiffMode();
        else surfaces.toggle();
      }
    },
    saveBeforeClose: () => void (async () => {
      if (project.gitDiffDirty) await projects.saveGitWorkingTree();
      if (project.gitDiffDirty) {
        desktop.finishWindowClose(false);
        return;
      }
      await documents.saveAll();
    })(),
    transferIncoming: (transfer) => {
      projects.deactivateGitDiff();
      void tabs.installTransferred(transfer);
    },
    transferCompleted: ({ transferId, tabId }) => {
      tabDrag.reset();
      void tabs.removeTransferred(tabId).finally(() => desktop.releaseTabTransferSource(transferId));
    },
    keydown: (event) => {
      if (event.key === 'Escape') tabDrag.cancel();
      if (event.key === 'Escape' && project.gitDiffActive && project.gitDiff) {
        event.preventDefault();
        event.stopPropagation();
        if (project.gitDiffMode === 'source' && project.gitDiffPreviewReady) {
          projects.showRenderedGitDiff();
        }
        return;
      }
      if (event.key === 'Escape' && session.surface === 'editor') {
        event.preventDefault();
        event.stopPropagation();
        void surfaces.enterViewer();
        return;
      }
      if (!project.gitDiffActive && session.surface === 'viewer' && event.key.toLowerCase() === 'f'
        && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        reader.openFind();
      }
    },
  });

  void desktop.getTheme().then(async (snapshot) => {
    await reader.applyTheme(snapshot, true);
    const documentSnapshot = await desktop.getDocument();
    if (documentSnapshot) void tabs.show(documentSnapshot);
    else if (workspace.tabs.length === 0) {
      surfaces.set('empty');
      tabs.render();
    }
  });

  const previewResizeObserver = new ResizeObserver(reader.syncView);
  previewResizeObserver.observe(previewFrames);
  window.addEventListener('resize', reader.syncView);
}
