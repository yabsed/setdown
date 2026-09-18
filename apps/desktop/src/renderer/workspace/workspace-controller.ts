import type * as Monaco from 'monaco-editor';
import type {
  ClaimedTabTransfer,
  DocumentSnapshot,
  ThemeSnapshot,
  TransferableTab,
} from '../../shared/contracts';
import {
  normalizePreviewTheme,
} from '../../shared/preview-preferences';
import { hasUnsavedText } from '../../shared/document-state';
import {
  GOLDEN_TOP_RATIO,
  clampAnchor,
  type BandLine,
  type ViewportAnchor,
} from '../../shared/viewport-anchor';
import { mount } from 'svelte';
import App from '../App.svelte';
import { createEditorInsertions } from '../editor/editor-insertions';
import { readEditorViewport } from '../editor/editor-viewport';
import { ReaderController } from '../reader/reader-controller';
import { PreviewSession } from '../reader/preview-session';
import { applyShellTheme, monacoThemeName, registerMonacoThemes } from '../theme';
import { createTabDrag } from '../tabs/tab-drag';
import { createTabSession, type DocumentTab } from '../tabs/tab-state';
import { view, type AppActions } from '../view-state.svelte';
import { DocumentActions } from './document-actions';
import '../style.css';

export function startWorkspace() {

const initialTheme: ThemeSnapshot = {
  id: normalizePreviewTheme(window.marktex.initialTheme.id),
  revision: Math.max(0, window.marktex.initialTheme.revision),
};
applyShellTheme(initialTheme.id);

const actions: AppActions = {
  activateTab: (id) => void activateTab(id),
  closeTab: (id) => void closeTab(id),
  startTabDrag: (id, event) => tabDrag.start(id, event),
  endTabDrag: (event) => tabDrag.end(event),
  newDocument: () => void documents.create(),
  openDocument: () => void documents.open(),
  toggleSurface,
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
  showRenderError: () => void enterEditor(),
};

mount(App, { target: document.querySelector<HTMLDivElement>('#app')!, props: { actions } });

const shell = document.querySelector<HTMLElement>('.shell')!;
const previewFrames = document.querySelector<HTMLElement>('.preview-frames')!;
const editorHost = document.querySelector<HTMLElement>('.editor-host')!;
const tabStrip = document.querySelector<HTMLElement>('.tab-strip')!;

const tabs: DocumentTab[] = [];
let activeTabId: string | null = null;
let monaco: typeof Monaco | null = null;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let editorLoad: Promise<Monaco.editor.IStandaloneCodeEditor> | null = null;
/** Viewer의 anchor 요청 세대. 뒤늦은 fallback을 걸러 내는 데 쓴다. */
let viewerAnchorRequest = 0;
/**
 * 인계받은 탭의 조판 안내를 최대 이만큼만 붙잡아 둔다. Preview의 위치 확정
 * 응답을 기다리다 새 창만 느려 보이는 일을 막는다.
 */
const TRANSFER_ANNOUNCE_GRACE_MS = 150;

/**
 * Viewer와 Editor가 함께 보는 단 하나의 좌표. 화면 전환은 언제나 이 값을
 * 따르며, Monaco cursor는 편집 상태일 뿐 전환의 기준점이 아니다.
 */
const EMPTY_ANCHOR: ViewportAnchor = {
  sourceLine: 1,
  yRatio: GOLDEN_TOP_RATIO,
  reason: 'empty-document',
  confidence: 'fallback',
};

function activeTab() {
  return tabs.find((tab) => tab.id === activeTabId) ?? null;
}

const session = createTabSession(activeTab, EMPTY_ANCHOR);
const reader = new ReaderController({
  shell,
  frames: previewFrames,
  tabs,
  active: activeTab,
  activeId: () => activeTabId,
  initialTheme,
  applyProductTheme: (themeId) => {
    applyShellTheme(themeId);
    monaco?.editor.setTheme(monacoThemeName(themeId));
  },
  edit: (anchor) => void enterEditor(anchor),
  anchorChanged: publishAnchor,
});
const preview = new PreviewSession({
  tabs,
  active: activeTab,
  activeId: () => activeTabId,
  text: currentText,
  lineCount: activeLineCount,
  reader,
});

function tabText(tab: DocumentTab): string {
  return tab.model?.getValue() ?? tab.text;
}

function isTabDirty(tab: DocumentTab): boolean {
  return hasUnsavedText(tab.document, tabText(tab));
}

function currentText(): string | null {
  const tab = activeTab();
  return tab ? tabText(tab) : session.document?.text ?? null;
}

function textLineCount(text: string): number {
  return text.length === 0 ? 1 : text.split(/\r\n|\r|\n/).length;
}

function activeLineCount(): number {
  return session.model?.getLineCount() ?? textLineCount(currentText() ?? '');
}

function ensureTabModel(tab: DocumentTab): Monaco.editor.ITextModel {
  if (tab.model) return tab.model;
  tab.model = createDocumentModel(tab.document, tab.id, tab.text);
  return tab.model;
}

/**
 * 읽기 모드의 첫 문서가 표시될 때까지 Monaco의 module graph와 worker를 요청하지
 * 않는다. 편집 전환은 이 Promise를 기다리고, Viewer가 준비된 뒤에는 background로
 * 시작해 보통 사용자가 편집을 누르기 전에 끝난다.
 */
function ensureEditorLoaded(): Promise<Monaco.editor.IStandaloneCodeEditor> {
  if (editor) return Promise.resolve(editor);
  if (editorLoad) return editorLoad;
  shell.dataset.editorRuntime = 'loading';
  editorLoad = Promise.all([
    import('monaco-editor/editor/editor.main'),
    import('monaco-editor/editor/editor.worker?worker'),
  ]).then(([loadedMonaco, workerModule]) => {
    monaco = loadedMonaco;
    window.MonacoEnvironment = {
      getWorker: () => new workerModule.default(),
    };
    registerMonacoThemes(monaco);
    editor = monaco.editor.create(editorHost, {
      automaticLayout: true,
      language: 'markdown',
      theme: monacoThemeName(reader.themeId),
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
    installEditorBindings(editor, monaco);
    for (const tab of tabs) ensureTabModel(tab);
    const tab = activeTab();
    session.model = tab ? ensureTabModel(tab) : null;
    editor.setModel(session.model);
    if (tab?.editorViewState) editor.restoreViewState(tab.editorViewState);
    shell.dataset.editorRuntime = 'ready';
    return editor;
  }).catch((error) => {
    editorLoad = null;
    shell.dataset.editorRuntime = 'error';
    throw error;
  });
  return editorLoad;
}

/**
 * 지금 두 화면이 공유하고 있는 좌표를 DOM에 적어 둔다. confidence는 시험과
 * 디버깅을 위한 값이며, 전환을 취소하는 스위치가 아니다.
 */
function publishAnchor() {
  shell.dataset.anchorLine = String(session.anchor.sourceLine);
  shell.dataset.anchorReason = session.anchor.reason;
  shell.dataset.anchorConfidence = session.anchor.confidence;
}

function setSurface(next: typeof session.surface) {
  session.surface = next;
  view.surface = next;
  shell.dataset.surface = next;
  reader.syncUi();
  preview.updateUi();
  reader.syncView();
  if (next === 'editor') window.setTimeout(() => editor?.layout(), 0);
}

function saveActiveTabState() {
  const tab = activeTab();
  if (!tab || !session.document) return;
  tab.text = tabText(tab);
  tab.editorViewState = editor?.saveViewState() ?? tab.editorViewState;
  if (preview.readyRevision !== null) {
    tab.previewRevision = preview.readyRevision;
  }
}

function transferableTab(tab: DocumentTab): TransferableTab {
  if (tab.id === activeTabId) saveActiveTabState();
  return {
    id: tab.id,
    document: tab.document,
    text: tabText(tab),
    revision: tab.revision,
    surface: tab.surface,
    anchor: tab.anchor,
    editorViewState: tab.editorViewState,
    viewerScrollRatio: tab.viewerScrollRatio,
    previewUrl: tab.previewUrl,
    previewRevision: tab.previewRevision,
    previewTheme: tab.previewTheme,
    tocOpen: tab.tocOpen,
  };
}

function renderTabs() {
  const summaries = tabs.map((tab) => ({
    id: tab.id,
    name: tab.document.name,
    path: tab.document.path,
    active: tab.id === activeTabId,
    dirty: isTabDirty(tab),
  }));
  view.tabs = summaries;
  shell.dataset.tabs = summaries.length > 0 ? 'true' : 'false';
  shell.dataset.dirtyTabs = String(summaries.filter((tab) => tab.dirty).length);
  window.marktex.updateTabState(tabs.map((tab) => ({
    name: tab.document.name,
    path: tab.document.path,
    dirty: isTabDirty(tab),
    isUntitled: tab.document.isUntitled,
  })));
}

const tabDrag = createTabDrag({
  shell,
  strip: tabStrip,
  tabs,
  activeId: () => activeTabId,
  activate: (id) => void activateTab(id),
  serialize: transferableTab,
  render: renderTabs,
  install: (transfer) => void installTransferredTab(transfer),
});

let tabActivation = 0;
async function activateTab(tabId: string) {
  if (tabId === activeTabId) {
    // 다른 탭이 Monaco 로드를 기다리며 활성화 대기 중일 수 있다. 사용자가 현재
    // 탭을 다시 고른 것도 최신 선택이므로 그 대기 요청을 취소한다.
    tabActivation += 1;
    return;
  }
  const next = tabs.find((tab) => tab.id === tabId);
  if (!next) return;
  const activation = ++tabActivation;
  if (next.surface === 'editor') await ensureEditorLoaded();
  // Monaco를 기다리는 동안 사용자가 다른 탭을 골랐다면 이전 요청이 선택을
  // 되가져가서는 안 된다.
  if (activation !== tabActivation) return;
  saveActiveTabState();
  preview.newSession();
  activeTabId = next.id;
  session.model = editor ? ensureTabModel(next) : null;
  editor?.setModel(session.model);
  if (next.editorViewState) editor?.restoreViewState(next.editorViewState);
  publishAnchor();
  view.notice = false;
  if (
    next.previewRevision === session.revision
    && next.previewTheme === reader.themeId
    && next.previewUrl?.startsWith('marktex-preview:')
  ) {
    preview.readyRevision = session.revision;
  }
  updateChrome();
  setSurface(next.surface);
  reader.send(next.id, { command: 'marktex:collect-headings' });
  await window.marktex.activateDocument(next.document, tabText(next), session.revision);
  if (activation !== tabActivation || activeTabId !== next.id) return;

  // 탭마다 별도 iframe을 유지한다. CSS로 보이는 frame만 바꾸므로 이미
  // 조판된 DOM과 scroll 상태를 건드리지 않는다.
  if (preview.readyRevision === session.revision) {
    preview.updateUi();
    return;
  }

  const ready = await preview.ensure(session.revision);
  if (ready && next.surface === 'viewer' && activation === tabActivation) {
    await preview.position(session.anchor, session.revision);
  }
}

async function closeTab(tabId: string) {
  let index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return;
  const tab = tabs[index];
  if (isTabDirty(tab)) {
    const decision = await window.marktex.confirmCloseDocument(tab.document.name);
    if (decision === 'cancel') return;
    if (decision === 'save') {
      const result = await window.marktex.saveTabDocument(
        tab.document,
        tabText(tab),
        tab.revision,
      );
      if (result.canceled || !result.document) return;
      tab.document = result.document;
      tab.revision = result.document.revision;
    }
  }
  if (tab.document.isUntitled) await window.marktex.discardDocument(tab.document);
  index = tabs.findIndex((candidate) => candidate.id === tabId);
  if (index < 0) return;
  const wasActive = tab.id === activeTabId;
  tabs.splice(index, 1);
  reader.destroy(tab.id);
  if (!wasActive) {
    tab.model?.dispose();
    renderTabs();
    return;
  }
  activeTabId = null;
  tab.model?.dispose();
  const replacement = tabs[Math.min(index, tabs.length - 1)];
  if (replacement) {
    await activateTab(replacement.id);
    return;
  }
  preview.reset();
  session.document = null;
  session.model = null;
  editor?.setModel(null);
  setSurface('empty');
  updateChrome();
  renderTabs();
}

async function removeTransferredTab(tabId: string) {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return;
  const tab = tabs[index];
  const wasActive = tab.id === activeTabId;
  tabs.splice(index, 1);
  // 살아 있는 Preview는 이미 destination BrowserWindow가 소유한다. source는
  // Monaco model과 탭 metadata만 버려야 한다.
  if (!wasActive) {
    tab.model?.dispose();
    renderTabs();
    return;
  }
  activeTabId = null;
  const replacement = tabs[Math.min(index, tabs.length - 1)];
  if (replacement) {
    await activateTab(replacement.id);
    tab.model?.dispose();
    return;
  }
  editor?.setModel(null);
  tab.model?.dispose();
  preview.reset();
  session.document = null;
  session.model = null;
  setSurface('empty');
  updateChrome();
  renderTabs();
  window.marktex.closeEmptyWindow();
}

function cycleTab(direction: -1 | 1) {
  if (tabs.length < 2 || !activeTabId) return;
  const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  void activateTab(tabs[nextIndex].id);
}

function updateChrome() {
  if (!session.document) {
    document.title = 'Setdown';
    return;
  }
  const dirty = hasUnsavedText(session.document, currentText() ?? session.document.text);
  document.title = `${dirty ? '• ' : ''}${session.document.name} — Setdown`;
  renderTabs();
}

function createDocumentModel(documentSnapshot: DocumentSnapshot, tabId: string, text = documentSnapshot.text) {
  if (!monaco) throw new Error('Monaco is not loaded.');
  const uri = monaco.Uri.file(documentSnapshot.path).with({ query: tabId });
  const created = monaco.editor.createModel(text, 'markdown', uri);
  created.onDidChangeContent(() => {
    if (session.model !== created || !session.document) return;
    const tab = activeTab();
    if (tab) tab.text = created.getValue();
    session.revision += 1;
    window.marktex.updateText(created.getValue(), session.revision);
    updateChrome();
    if (session.surface === 'editor') preview.schedule(session.revision);
  });
  return created;
}

function installModel(documentSnapshot: DocumentSnapshot) {
  const previous = session.model;
  previous?.dispose();
  const tab = activeTab();
  if (tab) tab.text = documentSnapshot.text;
  session.model = editor
    ? createDocumentModel(documentSnapshot, activeTabId ?? crypto.randomUUID())
    : null;
  editor?.setModel(session.model);
  session.revision = documentSnapshot.revision;
}

async function showDocument(
  documentSnapshot: DocumentSnapshot,
  initialSurface: 'viewer' | 'editor' = 'viewer',
) {
  if (!documentSnapshot.isUntitled) {
    const existing = tabs.find((tab) =>
      !tab.document.isUntitled && tab.document.path === documentSnapshot.path,
    );
    if (existing) {
      await activateTab(existing.id);
      return;
    }
  }
  const id = crypto.randomUUID();
  reader.create(id);
  const initialAnchor: ViewportAnchor = {
    sourceLine: 1,
    yRatio: GOLDEN_TOP_RATIO,
    reason: 'empty-document',
    confidence: 'fallback',
  };
  tabs.push({
    id,
    document: documentSnapshot,
    text: documentSnapshot.text,
    model: null,
    revision: documentSnapshot.revision,
    surface: initialSurface,
    anchor: initialAnchor,
    previewUrl: null,
    previewRevision: null,
    previewTheme: null,
    tocOpen: false,
    editorViewState: null,
    viewerScrollRatio: null,
    headings: [],
    activeHeadingId: null,
    find: { open: false, query: '', activeMatch: 0, matches: 0 },
  });
  renderTabs();
  await activateTab(id);
  if (initialSurface === 'viewer') {
    // Preview가 실제로 표시된 다음에야 편집기를 준비한다. 첫 화면의 network,
    // parse, compile과 Monaco가 CPU·I/O를 놓고 경쟁하지 않게 한다.
    window.setTimeout(() => {
      void ensureEditorLoaded().catch((error) => console.error('Failed to load editor', error));
    }, 0);
  }
}

async function installTransferredTab(transfer: ClaimedTabTransfer) {
  const incoming = transfer.tab;
  // 빈 창이 인계받는 경우에만 알린다. 이미 문서를 보여 주고 있는 창을
  // 덮어 가리면 그게 더 나쁘다.
  const announceTypesetting = tabs.length === 0;
  const finishAnnouncement = () => {
    if (!announceTypesetting || !reader.awaiting) return;
    reader.awaiting = false;
    preview.updateUi();
  };
  if (announceTypesetting) {
    reader.awaiting = true;
    // 빈 상태 화면 대신 Viewer를 띄운다. 조판 안내는 그 위에 올라간다.
    setSurface('viewer');
  }
  if (!await window.marktex.adoptTabTransfer(transfer.transferId)) {
    finishAnnouncement();
    return;
  }
  shell.dataset.lastTransferUsedSnapshot = 'false';
  const restoredDocument: DocumentSnapshot = {
    ...incoming.document,
    text: incoming.text,
    revision: incoming.revision,
  };
  const restored: DocumentTab = {
    id: incoming.id,
    document: restoredDocument,
    text: incoming.text,
    model: null,
    revision: incoming.revision,
    surface: incoming.surface,
    anchor: incoming.anchor as ViewportAnchor,
    previewUrl: incoming.previewUrl,
    previewRevision: incoming.previewRevision,
    previewTheme: incoming.previewTheme,
    tocOpen: incoming.tocOpen === true,
    editorViewState: incoming.editorViewState as Monaco.editor.ICodeEditorViewState | null,
    viewerScrollRatio: incoming.viewerScrollRatio,
    headings: [],
    activeHeadingId: null,
    find: { open: false, query: '', activeMatch: 0, matches: 0 },
  };
  tabs.push(restored);
  // 이미 조판된 WebContents 자체를 인계했다. 새 navigation, snapshot, theme
  // 재적용 없이 destination의 실제 bounds를 주는 것이 transfer의 전부다.
  renderTabs();
  await activateTab(restored.id);
  reader.syncView();
  // 창 크기가 같으면 조판이 한 픽셀도 다르지 않다. 위치를 다시 계산하지
  // 않는다. reparent만으로 scroll은 그대로 남아 있고, 재계산은 몇 px의
  // 어긋남을 만들어 화면이 흔들리는 것으로 보인다.
  const positioned = restored.surface === 'viewer'
    && restored.previewRevision !== null
    && incoming.previewGeometryUnchanged !== true
    ? preview.position(
      restored.anchor,
      restored.previewRevision,
      restored.id,
      textLineCount(restored.text),
      false,
      // source 창에서 보던 띠 전체를 무게중심으로 맞춘다. 목적지의 폭이
      // 달라 본문이 재배치되어도 보던 구간이 같은 자리에 선다.
      Array.isArray(incoming.viewerBand) ? incoming.viewerBand : [],
    )
    : Promise.resolve(true);
  window.marktex.completeTabTransfer(transfer.transferId);
  // 안내를 걷는 시점을 Preview의 왕복 응답에 걸지 않는다. 응답이 늦으면
  // 그 대기 시간이 그대로 안내 노출 시간이 되어, 같은 일을 하는 기존 창
  // 경로보다 새 창만 느려 보인다. 응답이 제때 오면 쓰고, 아니면 짧은 유예
  // 뒤에 그냥 드러낸다.
  void Promise.race([
    positioned,
    new Promise((resolve) => window.setTimeout(resolve, TRANSFER_ANNOUNCE_GRACE_MS)),
  ]).then(finishAnnouncement);
}

async function reloadActiveDocument(documentSnapshot: DocumentSnapshot) {
  const tab = activeTab();
  if (!tab) return;
  preview.reset();
  session.document = documentSnapshot;
  tab.document = documentSnapshot;
  tab.previewUrl = null;
  tab.previewRevision = null;
  tab.previewTheme = null;
  installModel(documentSnapshot);
  view.notice = false;
  updateChrome();
  const ready = await preview.ensure(session.revision);
  if (ready && session.surface === 'viewer') await preview.position(session.anchor, session.revision);
}

/**
 * Viewer가 준 anchor로 Editor를 연다. 전환은 이미 확정된 사실이고,
 * anchor의 품질은 목적지만 바꾼다. confidence는 검사하지 않는다.
 */
async function enterEditor(next: ViewportAnchor = session.anchor) {
  // 편집기가 열렸으니 대기 중이던 anchor 요청의 fallback은 무효다.
  viewerAnchorRequest += 1;
  const targetTabId = activeTabId;
  if (!targetTabId) return;
  const loadedEditor = await ensureEditorLoaded();
  if (activeTabId !== targetTabId) return;
  const tab = activeTab();
  if (!tab) return;
  editor = loadedEditor;
  const targetEditor = loadedEditor;
  session.model = ensureTabModel(tab);
  targetEditor.setModel(session.model);
  if (tab.editorViewState) targetEditor.restoreViewState(tab.editorViewState);
  if (activeTab()?.find.open) reader.closeFind(false);
  session.anchor = clampAnchor(next, session.model.getLineCount());
  publishAnchor();
  setSurface('editor');
  const line = session.anchor.sourceLine;
  const column = Math.min(
    session.anchor.sourceColumn ?? 1,
    session.model.getLineMaxColumn(line),
  );
  targetEditor.setPosition({ lineNumber: line, column });
  // 화면이 막 바뀐 참이라 layout이 아직 낡았다. 다음 tick에 자리를 잡는다.
  window.setTimeout(() => {
    targetEditor.layout();
    // 사용자가 누른 높이에 그 행을 그대로 둔다. 가운데로 보내면 클릭할
    // 때마다 문서가 위아래로 뛴다.
    const height = targetEditor.getLayoutInfo().height;
    const top = targetEditor.getTopForLineNumber(line) - height * session.anchor.yRatio;
    targetEditor.setScrollTop(Math.max(0, top));
    targetEditor.focus();
  }, 0);
}

function editorViewport(): { anchor: ViewportAnchor; band: BandLine[] } {
  return readEditorViewport(editor, monaco, session.model, session.anchor);
}

async function enterViewer() {
  if (!editor || !session.model) return;
  const transitionStartedAt = performance.now();
  const viewport = editorViewport();
  session.anchor = viewport.anchor;
  publishAnchor();
  preview.cancelSchedule();
  const generation = preview.generation;
  const targetRevision = session.revision;
  const targetAnchor = session.anchor;
  const targetBand = viewport.band;
  const availableRevision = preview.readyRevision;

  // 전환은 렌더나 위치 acknowledgement의 결과가 아니다. 이미 살아 있는
  // Preview를 즉시 노출하고, 최신 revision은 뒤에서 원자적으로 교체한다.
  if (availableRevision !== null) {
    void preview.position(targetAnchor, availableRevision, activeTabId ?? '',
      session.model.getLineCount(), false, targetBand);
  }
  setSurface('viewer');
  window.requestAnimationFrame(() => {
    shell.dataset.lastViewerFirstFrameMs = String(performance.now() - transitionStartedAt);
  });
  void preview.ensure(targetRevision).then((ready) => {
    if (!ready || generation !== preview.generation || session.revision !== targetRevision) return;
    void preview.position(targetAnchor, targetRevision, activeTabId ?? '',
      session.model?.getLineCount() ?? 1, false, targetBand);
  });
}

let editorPreviewPositionFrame: number | null = null;
function installEditorScrollBinding(targetEditor: Monaco.editor.IStandaloneCodeEditor) {
  targetEditor.onDidScrollChange((event) => {
    if (!event.scrollTopChanged || session.surface !== 'editor' || !activeTabId) return;
    if (editorPreviewPositionFrame !== null) window.cancelAnimationFrame(editorPreviewPositionFrame);
    editorPreviewPositionFrame = window.requestAnimationFrame(() => {
      editorPreviewPositionFrame = null;
      if (session.surface !== 'editor' || !session.model || !activeTabId) return;
      const viewport = editorViewport();
      session.anchor = viewport.anchor;
      publishAnchor();
      const availableRevision = preview.readyRevision;
      if (availableRevision === null) return;
      const revealed = clampAnchor(session.anchor, session.model.getLineCount());
      reader.send(activeTabId, {
        command: 'marktex:position-preview',
        sourceLine: revealed.sourceLine,
        topRatio: revealed.yRatio,
        band: viewport.band,
        settle: false,
      });
    });
  });
}

const documents = new DocumentActions({
  tabs,
  active: activeTab,
  text: tabText,
  dirty: isTabDirty,
  preview,
  installModel,
  show: showDocument,
  reload: reloadActiveDocument,
  renderTabs,
  updateChrome,
});

const insertions = createEditorInsertions({
  host: editorHost,
  editor: () => editor,
  monaco: () => monaco,
  model: () => session.model,
  document: () => session.document,
  editing: () => session.surface === 'editor',
  save: () => documents.save(false),
});

function installEditorBindings(
  targetEditor: Monaco.editor.IStandaloneCodeEditor,
  api: typeof Monaco,
) {
  installEditorScrollBinding(targetEditor);
  targetEditor.addAction({
    id: 'setdown.insertLink',
    label: '링크 삽입',
    keybindings: [api.KeyMod.CtrlCmd | api.KeyCode.KeyK],
    contextMenuGroupId: '1_modification',
    run: insertions.openLink,
  });

  targetEditor.addAction({
    id: 'setdown.insertTable',
    label: '표 삽입',
    contextMenuGroupId: '1_modification',
    run: insertions.openTable,
  });

  targetEditor.addCommand(
    api.KeyCode.Escape,
    () => void enterViewer(),
    '!suggestWidgetVisible && !findInputFocussed && !renameInputVisible && !compositionInProgress',
  );
}

function toggleSurface() {
  if (session.surface === 'viewer') requestViewerAnchor();
  else if (session.surface === 'editor') void enterViewer();
}

function toggleToc() {
  const tab = activeTab();
  if (!tab) return;
  tab.tocOpen = !tab.tocOpen;
  reader.syncUi();
  // iframe은 reader-body의 실제 flex child이므로 이 변경과 같은 layout에 참여한다.
  reader.syncView();
  if (tab.tocOpen && activeTabId) {
    reader.send(activeTabId, { command: 'marktex:collect-headings' });
  }
}

function scrollToHeading(id: string) {
  if (activeTabId) reader.send(activeTabId, { command: 'marktex:scroll-to-heading', id });
}

/**
 * 화면 전환 단축키에도 같은 원칙을 적용한다. Viewer가 지금 보고 있는
 * 높이를 물어보고, 답이 오면 `edit-at-anchor`가 Editor를 연다. 답이 오지
 * 않아도 전환은 보장한다.
 */
function requestViewerAnchor() {
  const pendingTabId = activeTabId;
  if (!pendingTabId) return;
  const request = ++viewerAnchorRequest;
  reader.send(pendingTabId, {
    command: 'marktex:request-anchor',
    topRatio: GOLDEN_TOP_RATIO,
  });
  window.setTimeout(() => {
    // 답이 끝내 오지 않았을 때만 대신 연다.
    //
    // 예전에는 "지금 surface가 요청할 때와 같은가"로 판정했다. 그런데 편집기가
    // 열린 뒤 120ms 안에 Esc로 돌아오면 surface가 다시 viewer가 되어, 이미
    // 소임을 다한 fallback이 편집기를 한 번 더 열어 버렸다. 판정은 화면이
    // 아니라 "이 요청이 아직 유효한가"여야 한다.
    if (request !== viewerAnchorRequest || activeTabId !== pendingTabId) return;
    enterEditor(session.anchor);
  }, 120);
}

window.marktex.onPreviewMessage((payload) => {
  preview.receive(payload);
  reader.handleMessage(payload);
});
window.marktex.onPreviewFindRequested((tabId) => {
  if (tabId === activeTabId && session.surface === 'viewer') reader.openFind();
});

window.marktex.onDocumentOpened((opened) => void showDocument(opened));
window.marktex.onExternalChange((change) => {
  if (session.document?.path === change.path) view.notice = true;
});
window.marktex.onThemeChanged((snapshot) => void reader.applyTheme(snapshot));
window.marktex.onCommand((command) => {
  if (command === 'new-document') void documents.create();
  if (command === 'save') void documents.save(false);
  if (command === 'save-as') void documents.save(true);
  if (command === 'export-pdf') void documents.exportPdf();
  if (command === 'close-tab' && activeTabId) void closeTab(activeTabId);
  if (command === 'next-tab') cycleTab(1);
  if (command === 'previous-tab') cycleTab(-1);
  if (command === 'insert-table') insertions.openTable();
  if (command === 'insert-link') insertions.openLink();
  if (command === 'open-find') reader.openFind();
  if (command === 'escape' && session.surface === 'editor') void enterViewer();
  if (command === 'toggle-surface') {
    if (session.surface === 'viewer') requestViewerAnchor();
    else if (session.surface === 'editor') void enterViewer();
  }
});
window.marktex.onSaveBeforeClose(() => void documents.saveAll());
window.marktex.onTabTransferIncoming((transfer) => void installTransferredTab(transfer));
window.marktex.onTabTransferCompleted(({ transferId, tabId }) => {
  tabDrag.reset();
  void removeTransferredTab(tabId).finally(() => {
    window.marktex.releaseTabTransferSource(transferId);
  });
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') tabDrag.cancel();
  if (event.key === 'Escape' && session.surface === 'editor') {
    event.preventDefault();
    event.stopPropagation();
    void enterViewer();
    return;
  }
  if (
    session.surface === 'viewer'
    && event.key.toLowerCase() === 'f'
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
  ) {
    event.preventDefault();
    reader.openFind();
  }
}, { capture: true });

async function initializeRenderer() {
  const snapshot = await window.marktex.getTheme();
  await reader.applyTheme(snapshot, true);
  const documentSnapshot = await window.marktex.getDocument();
  if (documentSnapshot) void showDocument(documentSnapshot);
  else if (tabs.length === 0) {
    setSurface('empty');
    renderTabs();
  }
}

void initializeRenderer();

// Native Preview의 bounds는 DOM placeholder에서 파생된다. 창 resize와 목차
// layout을 모두 같은 observer로 수렴시켜 별도 타이머를 두지 않는다.
const previewResizeObserver = new ResizeObserver(reader.syncView);
previewResizeObserver.observe(previewFrames);
window.addEventListener('resize', reader.syncView);
}
