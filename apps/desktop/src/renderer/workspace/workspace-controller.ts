import { GOLDEN_TOP_RATIO, type ViewportAnchor } from '../../core/preview/viewport-anchor';
import { normalizePreviewTheme } from '../../core/preview/preview-preferences';
import { createTabSession, WorkspaceState } from '../../core/workspace/workspace-state';
import type { ThemeSnapshot } from '../../protocol/desktop-api';
import { mount } from 'svelte';
import App from '../App.svelte';
import { MonacoEditor } from '../adapters/monaco-editor';
import { SurfaceController } from '../application/surface-controller';
import { installWorkspaceEvents } from '../application/workspace-events';
import { createEditorInsertions } from '../editor/editor-insertions';
import type { DesktopPort } from '../ports/desktop-port';
import { PreviewSession } from '../reader/preview-session';
import { ReaderController } from '../reader/reader-controller';
import { createTabDrag } from '../tabs/tab-drag';
import { applyShellTheme } from '../theme';
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
  const initialTheme: ThemeSnapshot = {
    id: normalizePreviewTheme(desktop.initialTheme.id),
    revision: Math.max(0, desktop.initialTheme.revision),
  };
  applyShellTheme(initialTheme.id);

  const actions: AppActions = {
    loadMenu: (id) => desktop.getApplicationMenu(id),
    executeMenuItem: (id) => desktop.executeApplicationMenuItem(id),
    activateTab: (id) => void tabs.activate(id),
    closeTab: (id) => void tabs.close(id),
    startTabDrag: (id, event) => tabDrag.start(id, event),
    endTabDrag: (event) => tabDrag.end(event),
    newDocument: () => void documents.create(),
    openDocument: () => void documents.open(),
    toggleSurface: () => surfaces.toggle(),
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
  const previewFrames = document.querySelector<HTMLElement>('.preview-frames')!;
  const editorHost = document.querySelector<HTMLElement>('.editor-host')!;
  const tabStrip = document.querySelector<HTMLElement>('.tab-strip')!;
  const workspace = new WorkspaceState();
  const active = () => workspace.active;
  const session = createTabSession(active, EMPTY_ANCHOR);

  let surfaces: SurfaceController;
  let tabs: TabController;
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
  surfaces = new SurfaceController({ workspace, session, shell, editor, reader, preview });
  tabs = new TabController({ desktop, workspace, session, shell, editor, reader, preview, surfaces });

  const tabDrag = createTabDrag({
    desktop,
    shell,
    strip: tabStrip,
    tabs: workspace.tabs,
    activeId: () => workspace.activeId,
    activate: (id) => void tabs.activate(id),
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
  const insertions = createEditorInsertions({
    desktop,
    host: editorHost,
    editor: () => editor.editor,
    monaco: () => editor.api,
    model: () => editor.model,
    document: () => session.document,
    editing: () => session.surface === 'editor',
    save: () => documents.save(false),
  });

  function toggleToc() {
    const tab = workspace.active;
    if (!tab) return;
    tab.tocOpen = !tab.tocOpen;
    reader.syncUi();
    reader.syncView();
    if (tab.tocOpen) reader.send(tab.id, { command: 'marktex:collect-headings' });
  }

  function scrollToHeading(id: string) {
    if (workspace.activeId) reader.send(workspace.activeId, { command: 'marktex:scroll-to-heading', id });
  }

  installWorkspaceEvents(desktop, {
    previewMessage: (payload) => {
      preview.receive(payload);
      reader.handleMessage(payload);
    },
    previewFindRequested: (tabId) => {
      if (tabId === workspace.activeId && session.surface === 'viewer') reader.openFind();
    },
    documentOpened: (opened) => void tabs.show(opened),
    externalChange: (change) => {
      if (session.document?.path === change.path) view.notice = true;
    },
    themeChanged: (snapshot) => void reader.applyTheme(snapshot),
    command: (command) => {
      if (command === 'new-document') void documents.create();
      if (command === 'save') void documents.save(false);
      if (command === 'save-as') void documents.save(true);
      if (command === 'export-pdf') void documents.exportPdf();
      if (command === 'close-tab' && workspace.activeId) void tabs.close(workspace.activeId);
      if (command === 'next-tab') tabs.cycle(1);
      if (command === 'previous-tab') tabs.cycle(-1);
      if (command === 'insert-table') insertions.openTable();
      if (command === 'insert-link') insertions.openLink();
      if (command === 'open-find') reader.openFind();
      if (command === 'escape' && session.surface === 'editor') void surfaces.enterViewer();
      if (command === 'toggle-surface') surfaces.toggle();
    },
    saveBeforeClose: () => void documents.saveAll(),
    transferIncoming: (transfer) => void tabs.installTransferred(transfer),
    transferCompleted: ({ transferId, tabId }) => {
      tabDrag.reset();
      void tabs.removeTransferred(tabId).finally(() => desktop.releaseTabTransferSource(transferId));
    },
    keydown: (event) => {
      if (event.key === 'Escape') tabDrag.cancel();
      if (event.key === 'Escape' && session.surface === 'editor') {
        event.preventDefault();
        event.stopPropagation();
        void surfaces.enterViewer();
        return;
      }
      if (session.surface === 'viewer' && event.key.toLowerCase() === 'f'
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
