import * as monaco from 'monaco-editor/editor/editor.main';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type {
  ClaimedTabTransfer,
  DocumentSnapshot,
  TransferableTab,
} from '../shared/contracts';
import { PreviewRenderCoordinator } from '../shared/preview-render-coordinator';
import {
  GOLDEN_TOP_RATIO,
  clamp,
  clampAnchor,
  resolveEditorViewport,
  type ViewportAnchor,
} from '../shared/viewport-anchor';
import './style.css';

window.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <section class="shell" data-surface="empty" data-tabs="false">
    <nav class="tab-strip" aria-label="열린 문서" hidden>
      <div class="tab-list" role="tablist"></div>
      <div class="tab-actions">
        <button class="new-tab-button" type="button" title="새 문서 (Ctrl/Cmd+N)" aria-label="새 문서">+</button>
        <span class="tab-action-divider" aria-hidden="true"></span>
        <button class="mode-toggle" type="button" hidden>
          <svg class="mode-icon mode-icon-edit" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.862 3.487a2.25 2.25 0 0 1 3.182 3.182L8.41 18.303a2 2 0 0 1-.878.507l-3.42 1.026 1.026-3.42a2 2 0 0 1 .507-.878L16.862 3.487Zm1.06 1.06L6.705 15.765a.5.5 0 0 0-.127.22l-.538 1.792 1.792-.538a.5.5 0 0 0 .22-.127L19.104 5.608a.75.75 0 0 0-1.182-1.06Z"/></svg>
          <svg class="mode-icon mode-icon-view" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c4.75 0 8.27 3.13 9.66 6.35a1.62 1.62 0 0 1 0 1.3C20.27 15.87 16.75 19 12 19s-8.27-3.13-9.66-6.35a1.62 1.62 0 0 1 0-1.3C3.73 8.13 7.25 5 12 5Zm0 1.5c-4 0-7 2.63-8.28 5.45a.12.12 0 0 0 0 .1C5 14.87 8 17.5 12 17.5s7-2.63 8.28-5.45a.12.12 0 0 0 0-.1C19 9.13 16 6.5 12 6.5Zm0 2.25A3.25 3.25 0 1 1 12 15.25 3.25 3.25 0 0 1 12 8.75Zm0 1.5A1.75 1.75 0 1 0 12 13.75 1.75 1.75 0 0 0 12 10.25Z"/></svg>
        </button>
      </div>
    </nav>

    <div class="notice" hidden>
      <span>이 파일이 다른 프로그램에서 변경되었습니다.</span>
      <div>
        <button class="notice-keep" type="button">현재 내용 유지</button>
        <button class="notice-reload" type="button">다시 불러오기</button>
      </div>
    </div>

    <section class="empty-state">
      <img class="empty-mark" src="./setdown-mark.svg" alt="Setdown" />
      <div class="wordmark">Setdown</div>
      <h1>Write plain. Read beautifully.</h1>
      <p>Markdown 파일을 아름답게 읽고, 더블 클릭해 바로 고칠 수 있습니다.</p>
      <div class="empty-actions">
        <button class="primary-button empty-new" type="button">새 문서</button>
        <button class="secondary-button empty-open" type="button">Markdown 파일 열기</button>
      </div>
      <span class="shortcut">Ctrl/Cmd+N · Ctrl/Cmd+O</span>
    </section>

    <section class="viewer-surface" aria-label="렌더링된 Markdown">
      <div class="preview-frames"></div>
      <div class="render-state" hidden>
        <div class="spinner"></div><span>문서를 조판하고 있습니다…</span>
      </div>
      <div class="render-error" hidden>
        <strong>문서를 렌더링하지 못했습니다.</strong>
        <span></span>
        <button type="button">원문에서 확인</button>
      </div>
      <div class="viewer-hint">더블 클릭하여 수정</div>
    </section>

    <section class="editor-surface" aria-label="Markdown 원문 편집기">
      <div class="editor-host"></div>
      <div class="editor-hint"><kbd>Esc</kbd> Viewer로 돌아가기</div>
    </section>
  </section>
`;

const shell = document.querySelector<HTMLElement>('.shell')!;
const modeToggle = document.querySelector<HTMLButtonElement>('.mode-toggle')!;
const previewFrames = document.querySelector<HTMLElement>('.preview-frames')!;
const editorHost = document.querySelector<HTMLElement>('.editor-host')!;
const renderState = document.querySelector<HTMLElement>('.render-state')!;
const renderError = document.querySelector<HTMLElement>('.render-error')!;
const renderErrorText = renderError.querySelector<HTMLElement>('span')!;
const notice = document.querySelector<HTMLElement>('.notice')!;
const tabStrip = document.querySelector<HTMLElement>('.tab-strip')!;
const tabList = document.querySelector<HTMLElement>('.tab-list')!;

type DocumentTab = {
  id: string;
  document: DocumentSnapshot;
  model: monaco.editor.ITextModel;
  revision: number;
  surface: 'viewer' | 'editor';
  anchor: ViewportAnchor;
  previewUrl: string | null;
  previewRevision: number | null;
  editorViewState: monaco.editor.ICodeEditorViewState | null;
  viewerScrollRatio: number | null;
};

const tabs: DocumentTab[] = [];
let activeTabId: string | null = null;
let draggedTabId: string | null = null;
let draggedTransferId: string | null = null;
let tabDragCanceled = false;

let currentDocument: DocumentSnapshot | null = null;
let model: monaco.editor.ITextModel | null = null;
let revision = 0;
let surface: 'empty' | 'viewer' | 'editor' = 'empty';
let previewGeneration = 0;
let previewTimer: number | null = null;
let previewError: { revision: number; message: string } | null = null;
let previewPositionRequest = 0;
const previewMessageListeners = new Set<(payload: {
  tabId: string;
  message: Record<string, unknown>;
}) => void>();

const PREVIEW_DEBOUNCE_MS = 700;
let previewCoordinator = new PreviewRenderCoordinator(renderRevision);

/**
 * Viewer와 Editor가 함께 보는 단 하나의 좌표. 화면 전환은 언제나 이 값을
 * 따르며, Monaco cursor는 편집 상태일 뿐 전환의 기준점이 아니다.
 */
let anchor: ViewportAnchor = {
  sourceLine: 1,
  yRatio: GOLDEN_TOP_RATIO,
  reason: 'empty-document',
  confidence: 'fallback',
};

const editor = monaco.editor.create(editorHost, {
  automaticLayout: true,
  language: 'markdown',
  theme: 'vs-dark',
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

/**
 * 지금 두 화면이 공유하고 있는 좌표를 DOM에 적어 둔다. confidence는 시험과
 * 디버깅을 위한 값이며, 전환을 취소하는 스위치가 아니다.
 */
function publishAnchor() {
  shell.dataset.anchorLine = String(anchor.sourceLine);
  shell.dataset.anchorReason = anchor.reason;
  shell.dataset.anchorConfidence = anchor.confidence;
}

function setSurface(next: typeof surface) {
  surface = next;
  shell.dataset.surface = next;
  modeToggle.hidden = next === 'empty';
  const toggleLabel = next === 'viewer' ? '편집기로 전환' : 'Viewer로 전환';
  modeToggle.title = `${toggleLabel} (Ctrl/Cmd+E)`;
  modeToggle.setAttribute('aria-label', toggleLabel);
  updatePreviewUi();
  window.requestAnimationFrame(syncPreviewView);
  if (next === 'editor') window.setTimeout(() => editor.layout(), 0);
}

function activeTab() {
  return tabs.find((tab) => tab.id === activeTabId) ?? null;
}

function createPreview(tabId: string) {
  window.marktex.createPreview(tabId);
}

function syncPreviewView() {
  const tab = activeTab();
  const visible = !!tab
    && (surface === 'viewer' || shell.dataset.previewPositioning === 'true')
    && previewCoordinator.readyRevision !== null;
  if (!visible || !tab) {
    window.marktex.showPreview(null, null);
    return;
  }
  const rect = previewFrames.getBoundingClientRect();
  window.marktex.showPreview(tab.id, {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  });
}

function saveActiveTabState() {
  const tab = activeTab();
  if (!tab || !currentDocument || !model) return;
  tab.document = currentDocument;
  tab.revision = revision;
  tab.surface = surface === 'empty' ? 'viewer' : surface;
  tab.anchor = anchor;
  tab.editorViewState = editor.saveViewState();
  if (previewCoordinator.readyRevision !== null) {
    tab.previewRevision = previewCoordinator.readyRevision;
  }
}

function transferableTab(tab: DocumentTab): TransferableTab {
  if (tab.id === activeTabId) saveActiveTabState();
  return {
    id: tab.id,
    document: tab.document,
    text: tab.model.getValue(),
    revision: tab.revision,
    surface: tab.surface,
    anchor: tab.anchor,
    editorViewState: tab.editorViewState,
    viewerScrollRatio: tab.viewerScrollRatio,
    previewUrl: tab.previewUrl,
    previewRevision: tab.previewRevision,
  };
}

function renderTabs() {
  tabStrip.hidden = tabs.length === 0;
  shell.dataset.tabs = tabs.length > 0 ? 'true' : 'false';
  shell.dataset.dirtyTabs = String(tabs.filter((tab) =>
    tab.revision !== tab.document.savedRevision,
  ).length);
  tabList.replaceChildren();
  for (const tab of tabs) {
    const button = document.createElement('button');
    button.className = 'document-tab';
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.id === activeTabId));
    button.title = tab.document.path;
    button.draggable = true;
    button.dataset.tabId = tab.id;

    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tab.document.name;
    button.append(name);
    if (tab.revision !== tab.document.savedRevision) {
      const dirty = document.createElement('span');
      dirty.className = 'tab-dirty';
      dirty.textContent = '•';
      dirty.setAttribute('aria-label', '저장되지 않은 변경');
      button.append(dirty);
    }
    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = '탭 닫기';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      void closeTab(tab.id);
    });
    button.append(close);
    button.addEventListener('click', () => void activateTab(tab.id));
    button.addEventListener('dragstart', (event) => {
      const transferId = crypto.randomUUID();
      draggedTabId = tab.id;
      draggedTransferId = transferId;
      tabDragCanceled = false;
      button.classList.add('is-dragging');
      shell.classList.add('is-tab-dragging');
      event.dataTransfer?.setData('application/x-setdown-tab', transferId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      window.marktex.registerTabTransfer(transferId, transferableTab(tab));
    });
    button.addEventListener('dragend', (event) => {
      button.classList.remove('is-dragging');
      const transferId = draggedTransferId;
      const shouldDetach = transferId
        && !tabDragCanceled;
      draggedTabId = null;
      draggedTransferId = null;
      tabDragCanceled = false;
      tabStrip.classList.remove('is-drop-target');
      shell.classList.remove('is-tab-dragging', 'is-window-drop-target');
      if (shouldDetach) {
        window.marktex.detachTabToWindow(transferId, event.screenX, event.screenY);
      } else if (transferId && event.dataTransfer?.dropEffect === 'none') {
        window.marktex.cancelTabTransfer(transferId);
      }
    });
    tabList.append(button);
  }
  window.marktex.updateTabState(tabs.map((tab) => ({
    name: tab.document.name,
    path: tab.document.path,
    dirty: tab.revision !== tab.document.savedRevision,
    isUntitled: tab.document.isUntitled,
  })));
}

function transferIdFromDrop(event: DragEvent) {
  return event.dataTransfer?.getData('application/x-setdown-tab') || null;
}

function isSetdownTabDrag(event: DragEvent) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  if (types.includes('application/x-setdown-tab') || draggedTransferId) return true;
  return false;
}

function isTabStripDropTarget(event: DragEvent) {
  return event.target instanceof Element && event.target.closest('.tab-strip') !== null;
}

function reorderDraggedTab(event: DragEvent, tabId: string) {
  const from = tabs.findIndex((tab) => tab.id === tabId);
  if (from < 0) return;
  const element = (event.target as Element | null)?.closest<HTMLElement>('.document-tab');
  let to = tabs.length - 1;
  if (element?.dataset.tabId) {
    const hovered = tabs.findIndex((tab) => tab.id === element.dataset.tabId);
    if (hovered >= 0) {
      const rect = element.getBoundingClientRect();
      to = hovered + (event.clientX > rect.left + rect.width / 2 ? 1 : 0);
    }
  }
  const [moved] = tabs.splice(from, 1);
  if (from < to) to -= 1;
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, moved);
  renderTabs();
}

tabStrip.addEventListener('dragover', (event) => {
  if (!isSetdownTabDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  tabStrip.classList.add('is-drop-target');
});
tabStrip.addEventListener('dragleave', (event) => {
  if (!tabStrip.contains(event.relatedTarget as Node | null)) {
    tabStrip.classList.remove('is-drop-target');
  }
});
tabStrip.addEventListener('drop', (event) => {
  const transferId = transferIdFromDrop(event);
  if (!transferId) return;
  event.preventDefault();
  event.stopPropagation();
  tabStrip.classList.remove('is-drop-target');
  if (draggedTabId) {
    reorderDraggedTab(event, draggedTabId);
    window.marktex.cancelTabTransfer(transferId);
    draggedTabId = null;
    draggedTransferId = null;
    return;
  }
  void window.marktex.claimTabTransfer(transferId).then((transfer) => {
    if (transfer) void installTransferredTab(transfer);
  });
});

window.addEventListener('dragover', (event) => {
  if (isTabStripDropTarget(event)) return;
  if (!isSetdownTabDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  shell.classList.add('is-window-drop-target');
}, { capture: true });
window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) shell.classList.remove('is-window-drop-target');
});
window.addEventListener('drop', (event) => {
  if (isTabStripDropTarget(event)) return;
  const transferId = transferIdFromDrop(event);
  if (!transferId) return;
  event.preventDefault();
  event.stopPropagation();
  shell.classList.remove('is-window-drop-target');
  if (draggedTabId) {
    draggedTabId = null;
    draggedTransferId = null;
    window.marktex.detachTabToWindow(transferId, event.screenX, event.screenY);
    return;
  }
  void window.marktex.claimTabTransfer(transferId).then((transfer) => {
    if (transfer) void installTransferredTab(transfer);
  });
}, { capture: true });

let tabActivation = 0;
async function activateTab(tabId: string) {
  if (tabId === activeTabId) return;
  const next = tabs.find((tab) => tab.id === tabId);
  if (!next) return;
  const activation = ++tabActivation;
  saveActiveTabState();
  resetPreviewState();
  previewCoordinator = new PreviewRenderCoordinator(renderRevision);
  activeTabId = next.id;
  currentDocument = next.document;
  model = next.model;
  revision = next.revision;
  surface = next.surface;
  anchor = next.anchor;
  editor.setModel(model);
  editor.restoreViewState(next.editorViewState);
  publishAnchor();
  notice.hidden = true;
  if (next.previewRevision === revision && next.previewUrl?.startsWith('marktex-preview:')) {
    previewCoordinator.readyRevision = revision;
  }
  updateChrome();
  setSurface(next.surface);
  await window.marktex.activateDocument(currentDocument, model.getValue(), revision);
  if (activation !== tabActivation || activeTabId !== next.id) return;

  // 탭마다 별도 WebContentsView를 유지한다. 이미 조판된 DOM과 scrollTop을
  // 그대로 다시 노출하므로 URL 재로드나 위치 재설정이 필요 없다.
  if (previewCoordinator.readyRevision === revision) {
    updatePreviewUi();
    return;
  }

  const ready = await ensurePreview(revision);
  if (ready && next.surface === 'viewer' && activation === tabActivation) {
    await requestPreviewPosition(anchor, revision);
  }
}

async function closeTab(tabId: string) {
  let index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return;
  const tab = tabs[index];
  if (tab.revision !== tab.document.savedRevision) {
    const decision = await window.marktex.confirmCloseDocument(tab.document.name);
    if (decision === 'cancel') return;
    if (decision === 'save') {
      const result = await window.marktex.saveTabDocument(
        tab.document,
        tab.model.getValue(),
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
  window.marktex.destroyPreview(tab.id);
  if (!wasActive) {
    tab.model.dispose();
    renderTabs();
    return;
  }
  activeTabId = null;
  tab.model.dispose();
  const replacement = tabs[Math.min(index, tabs.length - 1)];
  if (replacement) {
    await activateTab(replacement.id);
    return;
  }
  resetPreviewState();
  currentDocument = null;
  model = null;
  editor.setModel(null);
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
  // Preview WebContents는 이미 새 창으로 재부착되었다. 여기서 파괴하면
  // 새 창의 살아 있는 DOM까지 함께 사라진다.
  if (!wasActive) {
    tab.model.dispose();
    renderTabs();
    return;
  }
  activeTabId = null;
  const replacement = tabs[Math.min(index, tabs.length - 1)];
  if (replacement) {
    await activateTab(replacement.id);
    tab.model.dispose();
    return;
  }
  editor.setModel(null);
  tab.model.dispose();
  resetPreviewState();
  currentDocument = null;
  model = null;
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
  if (!currentDocument) {
    document.title = 'Setdown';
    return;
  }
  const dirty = revision !== currentDocument.savedRevision;
  document.title = `${dirty ? '• ' : ''}${currentDocument.name} — Setdown`;
  const tab = activeTab();
  if (tab) {
    tab.document = currentDocument;
    tab.revision = revision;
  }
  renderTabs();
}

function createDocumentModel(documentSnapshot: DocumentSnapshot, tabId: string) {
  const uri = monaco.Uri.file(documentSnapshot.path).with({ query: tabId });
  const created = monaco.editor.createModel(documentSnapshot.text, 'markdown', uri);
  created.onDidChangeContent(() => {
    if (model !== created || !currentDocument) return;
    revision += 1;
    window.marktex.updateText(created.getValue(), revision);
    updateChrome();
    if (surface === 'editor') schedulePreview(revision);
  });
  return created;
}

function installModel(documentSnapshot: DocumentSnapshot) {
  const previous = model;
  model = createDocumentModel(documentSnapshot, activeTabId ?? crypto.randomUUID());
  editor.setModel(model);
  previous?.dispose();
  revision = documentSnapshot.revision;
  const tab = activeTab();
  if (tab) {
    tab.model = model;
    tab.revision = revision;
  }
}

function cancelScheduledPreview() {
  if (previewTimer === null) return;
  window.clearTimeout(previewTimer);
  previewTimer = null;
}

function resetPreviewState() {
  previewGeneration += 1;
  cancelScheduledPreview();
  previewCoordinator.reset();
  previewError = null;
  updatePreviewUi();
}

function schedulePreview(targetRevision: number) {
  cancelScheduledPreview();
  previewTimer = window.setTimeout(() => {
    previewTimer = null;
    if (surface === 'editor' && revision === targetRevision) {
      void ensurePreview(targetRevision);
    }
  }, PREVIEW_DEBOUNCE_MS);
}

function updatePreviewUi() {
  const refreshing = surface === 'viewer'
    && previewCoordinator.isRendering
    && previewCoordinator.readyRevision !== revision;
  renderState.hidden = !refreshing;
  renderState.dataset.variant = previewCoordinator.readyRevision === null
    ? 'blocking'
    : 'refresh';

  const relevantError = surface === 'viewer' && previewError?.revision === revision;
  renderError.hidden = !relevantError;
  renderError.dataset.variant = previewCoordinator.readyRevision === null
    ? 'blocking'
    : 'refresh';
  if (relevantError && previewError) renderErrorText.textContent = previewError.message;
  window.requestAnimationFrame(syncPreviewView);
}

async function renderRevision(targetRevision: number): Promise<boolean> {
  if (!currentDocument || !model || targetRevision !== revision) return false;
  const generation = previewGeneration;
  const targetTabId = activeTabId;
  if (!targetTabId) return false;
  const documentPath = currentDocument.path;
  const text = model.getValue();
  if (previewError?.revision === targetRevision) previewError = null;
  try {
    const result = await window.marktex.renderDocument(text, targetRevision, documentPath);
    if (
      generation !== previewGeneration
      || activeTabId !== targetTabId
      || currentDocument?.path !== documentPath
      || result.revision !== targetRevision
      || revision !== targetRevision
    ) return false;

    await window.marktex.loadPreview(targetTabId, result.url);
    if (
      generation !== previewGeneration
      || activeTabId !== targetTabId
      || currentDocument?.path !== documentPath
    ) return false;
    const tab = activeTab();
    if (tab) {
      tab.previewUrl = result.url;
      tab.previewRevision = targetRevision;
    }
    previewError = null;
    return true;
  } catch (error) {
    if (generation !== previewGeneration) return false;
    previewError = {
      revision: targetRevision,
      message: error instanceof Error ? error.message : String(error),
    };
    return false;
  }
}

async function ensurePreview(targetRevision: number): Promise<boolean> {
  const pending = previewCoordinator.ensure(targetRevision);
  updatePreviewUi();
  const ready = await pending;
  updatePreviewUi();
  return ready;
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function requestPreviewPosition(
  target: ViewportAnchor,
  targetRevision: number,
  targetTabId: string = activeTabId ?? '',
  targetLineCount: number = model?.getLineCount() ?? 1,
): Promise<boolean> {
  const revealed = clampAnchor(target, targetLineCount);
  const requestId = ++previewPositionRequest;
  return new Promise((resolve) => {
    const cleanup = () => {
      previewMessageListeners.delete(handleMessage);
      window.clearTimeout(timeout);
    };
    const handleMessage = (payload: { tabId: string; message: Record<string, unknown> }) => {
      const message = payload.message;
      if (
        payload.tabId !== targetTabId
        || message.source !== 'crossnote'
        || message.type !== 'marktex:preview-positioned'
        || message.revision !== targetRevision
        || message.requestId !== requestId
      ) return;
      cleanup();
      resolve(true);
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, 1000);
    previewMessageListeners.add(handleMessage);
    window.marktex.sendPreviewCommand(targetTabId, {
      command: 'marktex:position-preview',
      sourceLine: revealed.sourceLine,
      topRatio: revealed.yRatio,
      requestId,
    });
  });
}

async function showPositionedPreview(
  target: ViewportAnchor,
  targetRevision: number,
  generation: number,
) {
  // Editor를 그대로 둔 채 Viewer에 실제 크기만 부여한다. 위치가 확정된 뒤
  // 두 surface를 같은 frame에서 맞바꿔 line 1이 잠깐 보이지 않게 한다.
  shell.dataset.previewPositioning = 'true';
  await nextAnimationFrame();
  syncPreviewView();
  await requestPreviewPosition(target, targetRevision);
  if (
    generation !== previewGeneration
    || previewCoordinator.readyRevision !== targetRevision
  ) {
    delete shell.dataset.previewPositioning;
    return;
  }
  setSurface('viewer');
  delete shell.dataset.previewPositioning;
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
  createPreview(id);
  const initialAnchor: ViewportAnchor = {
    sourceLine: 1,
    yRatio: GOLDEN_TOP_RATIO,
    reason: 'empty-document',
    confidence: 'fallback',
  };
  tabs.push({
    id,
    document: documentSnapshot,
    model: createDocumentModel(documentSnapshot, id),
    revision: documentSnapshot.revision,
    surface: initialSurface,
    anchor: initialAnchor,
    previewUrl: null,
    previewRevision: null,
    editorViewState: null,
    viewerScrollRatio: null,
  });
  renderTabs();
  await activateTab(id);
}

async function installTransferredTab(transfer: ClaimedTabTransfer) {
  const incoming = transfer.tab;
  if (!await window.marktex.adoptTabTransfer(transfer.transferId)) return;
  const restoredDocument: DocumentSnapshot = {
    ...incoming.document,
    text: incoming.text,
    revision: incoming.revision,
  };
  const restored: DocumentTab = {
    id: incoming.id,
    document: restoredDocument,
    model: createDocumentModel(restoredDocument, incoming.id),
    revision: incoming.revision,
    surface: incoming.surface,
    anchor: incoming.anchor as ViewportAnchor,
    previewUrl: incoming.previewUrl,
    previewRevision: incoming.previewRevision,
    editorViewState: incoming.editorViewState as monaco.editor.ICodeEditorViewState | null,
    viewerScrollRatio: incoming.viewerScrollRatio,
  };
  tabs.push(restored);
  renderTabs();
  await activateTab(restored.id);
  syncPreviewView();
  window.marktex.completeTabTransfer(transfer.transferId);
}

async function reloadActiveDocument(documentSnapshot: DocumentSnapshot) {
  const tab = activeTab();
  if (!tab) return;
  resetPreviewState();
  currentDocument = documentSnapshot;
  tab.document = documentSnapshot;
  tab.previewUrl = null;
  tab.previewRevision = null;
  installModel(documentSnapshot);
  updateChrome();
  const ready = await ensurePreview(revision);
  if (ready && surface === 'viewer') await requestPreviewPosition(anchor, revision);
}

/**
 * Viewer가 준 anchor로 Editor를 연다. 전환은 이미 확정된 사실이고,
 * anchor의 품질은 목적지만 바꾼다. confidence는 검사하지 않는다.
 */
function enterEditor(next: ViewportAnchor = anchor) {
  if (!model) return;
  anchor = clampAnchor(next, model.getLineCount());
  publishAnchor();
  setSurface('editor');
  const line = anchor.sourceLine;
  const column = Math.min(
    anchor.sourceColumn ?? 1,
    model.getLineMaxColumn(line),
  );
  editor.setPosition({ lineNumber: line, column });
  // 화면이 막 바뀐 참이라 layout이 아직 낡았다. 다음 tick에 자리를 잡는다.
  window.setTimeout(() => {
    editor.layout();
    // 사용자가 누른 높이에 그 행을 그대로 둔다. 가운데로 보내면 클릭할
    // 때마다 문서가 위아래로 뛴다.
    const height = editor.getLayoutInfo().height;
    const top = editor.getTopForLineNumber(line) - height * anchor.yRatio;
    editor.setScrollTop(Math.max(0, top));
    editor.focus();
  }, 0);
}

/**
 * Editor에서 Viewer로. 따라가야 하는 것은 cursor가 아니라 사용자가 보고
 * 있던 화면이다.
 */
function editorViewportAnchor(): ViewportAnchor {
  if (!model) return anchor;
  const node = editor.getDomNode();
  const yRatio = GOLDEN_TOP_RATIO;
  let probedLine: number | null = null;
  if (node) {
    const rect = node.getBoundingClientRect();
    // view zone이나 빈 영역이면 target이 없다. 그때는 첫 가시 행으로 내려간다.
    const target = editor.getTargetAtClientPoint(
      rect.left + editor.getLayoutInfo().contentLeft + 8,
      rect.top + rect.height * yRatio,
    );
    probedLine = target?.position?.lineNumber ?? null;
  }
  return resolveEditorViewport({
    probedLine,
    firstVisibleLine: editor.getVisibleRanges()[0]?.startLineNumber ?? null,
    lineCount: model.getLineCount(),
    yRatio,
  });
}

async function enterViewer() {
  if (!model) return;
  anchor = editorViewportAnchor();
  publishAnchor();
  cancelScheduledPreview();
  const generation = previewGeneration;
  const targetRevision = revision;
  const ready = await ensurePreview(targetRevision);
  if (generation !== previewGeneration) return;
  const availableRevision = ready
    ? targetRevision
    : previewCoordinator.readyRevision;
  if (availableRevision === null) {
    setSurface('viewer');
    return;
  }
  await showPositionedPreview(anchor, availableRevision, generation);
}

async function save(saveAs = false) {
  if (!model || !currentDocument) return;
  const result = saveAs
    ? await window.marktex.saveDocumentAs(model.getValue(), revision)
    : await window.marktex.saveDocument(model.getValue(), revision);
  if (!result.canceled && result.document) {
    const pathChanged = result.document.path !== currentDocument.path;
    currentDocument = result.document;
    revision = result.document.revision;
    if (pathChanged) {
      resetPreviewState();
      installModel(result.document);
      const tab = activeTab();
      if (tab) {
        tab.document = result.document;
        tab.previewUrl = null;
        tab.previewRevision = null;
      }
      if (surface === 'editor') schedulePreview(revision);
      else if (surface === 'viewer') {
        const target = revision;
        void ensurePreview(target).then((ready) => {
          if (ready && target === revision) void requestPreviewPosition(anchor, target);
        });
      }
    }
    updateChrome();
  }
}

async function saveAllDirtyTabs() {
  try {
    for (const tab of tabs) {
      if (tab.revision === tab.document.savedRevision) continue;
      const result = await window.marktex.saveTabDocument(
        tab.document,
        tab.model.getValue(),
        tab.revision,
      );
      if (result.canceled || !result.document) {
        window.marktex.finishWindowClose(false);
        return;
      }
      tab.document = result.document;
      tab.revision = result.document.revision;
    }
    renderTabs();
    window.marktex.finishWindowClose(true);
  } catch (error) {
    window.alert(`문서를 저장하지 못했습니다.\n${error instanceof Error ? error.message : String(error)}`);
    window.marktex.finishWindowClose(false);
  }
}

async function openDocument() {
  const opened = await window.marktex.openDocument();
  if (opened) await showDocument(opened);
}

async function newDocument() {
  const created = await window.marktex.newDocument();
  if (created) await showDocument(created, 'editor');
}

async function exportPdf() {
  if (!model || !currentDocument) return;
  try {
    await window.marktex.exportPdf(model.getValue(), revision, currentDocument.path);
  } catch (error) {
    window.alert(`PDF를 내보내지 못했습니다.\n${error instanceof Error ? error.message : String(error)}`);
  }
}

const IMAGE_URL_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i;

function safeRemoteImageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function remoteImageUrlFromClipboard(event: ClipboardEvent) {
  const html = event.clipboardData?.getData('text/html');
  if (html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const remote = safeRemoteImageUrl(parsed.querySelector('img[src]')?.getAttribute('src'));
    if (remote) return remote;
  }
  const plain = event.clipboardData?.getData('text/plain').trim();
  return plain && IMAGE_URL_PATTERN.test(plain) ? safeRemoteImageUrl(plain) : null;
}

function clipboardContainsStoredImage(event: ClipboardEvent) {
  const clipboard = event.clipboardData;
  const hasBitmap = Array.from(clipboard?.items ?? []).some(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
  const types = Array.from(clipboard?.types ?? []).map((type) => type.toLowerCase());
  const hasFileList = types.some((type) =>
    type === 'files' || type.includes('uri-list') || type.includes('gnome-copied-files'),
  );
  const plain = clipboard?.getData('text/plain').trim() ?? '';
  return hasBitmap || hasFileList || (plain.startsWith('file://') && IMAGE_URL_PATTERN.test(plain));
}

function insertImageMarkdown(markdown: string, selection: monaco.Selection | null) {
  if (!model) return;
  const range = selection
    ? monaco.Range.lift(selection)
    : new monaco.Range(1, 1, 1, 1);
  editor.executeEdits('paste-image', [{
    range,
    text: markdown,
    forceMoveMarkers: true,
  }]);
  const insertedEnd = model.getPositionAt(
    model.getOffsetAt(range.getStartPosition()) + markdown.length,
  );
  editor.setPosition(insertedEnd);
  editor.focus();
}

let isPastingImage = false;
async function pasteClipboardImage(remoteUrl: string | null) {
  if (!model || !currentDocument || isPastingImage) return;
  isPastingImage = true;
  const selection = editor.getSelection();
  try {
    if (remoteUrl) {
      insertImageMarkdown(`![외부 이미지](<${remoteUrl}>)`, selection);
      return;
    }
    const result = await window.marktex.pasteClipboardImage();
    if (result.canceled || !result.markdown || !model) return;
    insertImageMarkdown(result.markdown, selection);
  } catch (error) {
    window.alert(`이미지를 붙여넣지 못했습니다.\n${error instanceof Error ? error.message : String(error)}`);
  } finally {
    isPastingImage = false;
  }
}

editorHost.addEventListener('paste', (event) => {
  const remoteUrl = remoteImageUrlFromClipboard(event);
  if (!remoteUrl && !clipboardContainsStoredImage(event)) return;
  event.preventDefault();
  event.stopPropagation();
  void pasteClipboardImage(remoteUrl);
}, { capture: true });

editor.addCommand(
  monaco.KeyCode.Escape,
  () => void enterViewer(),
  '!suggestWidgetVisible && !findInputFocussed && !renameInputVisible && !compositionInProgress',
);

document.querySelectorAll('.open-button, .empty-open').forEach((button) => {
  button.addEventListener('click', () => void openDocument());
});
document.querySelector('.empty-new')?.addEventListener('click', () => void newDocument());
document.querySelector('.new-tab-button')?.addEventListener('click', () => void newDocument());
modeToggle.addEventListener('click', () => {
  if (surface === 'viewer') requestViewerAnchor();
  else if (surface === 'editor') void enterViewer();
});
document.querySelector('.render-error button')?.addEventListener('click', () => enterEditor());

/**
 * 화면 전환 단축키에도 같은 원칙을 적용한다. Viewer가 지금 보고 있는
 * 높이를 물어보고, 답이 오면 `edit-at-anchor`가 Editor를 연다. 답이 오지
 * 않아도 전환은 보장한다.
 */
function requestViewerAnchor() {
  const pendingSurface = surface;
  const pendingTabId = activeTabId;
  if (!pendingTabId) return;
  window.marktex.sendPreviewCommand(pendingTabId, {
    command: 'marktex:request-anchor',
    topRatio: GOLDEN_TOP_RATIO,
  });
  window.setTimeout(() => {
    if (
      activeTabId === pendingTabId
      && surface === pendingSurface
    ) enterEditor(anchor);
  }, 120);
}
document.querySelector('.notice-keep')?.addEventListener('click', () => {
  notice.hidden = true;
});
document.querySelector('.notice-reload')?.addEventListener('click', async () => {
  const reloaded = await window.marktex.reloadDocument();
  if (reloaded) await reloadActiveDocument(reloaded);
});

window.marktex.onPreviewMessage((payload) => {
  for (const listener of previewMessageListeners) listener(payload);
  if (payload.tabId !== activeTabId || payload.message.source !== 'crossnote') return;
  const message = payload.message;
  if (message.type === 'marktex:viewport-state') {
    if (message.revision !== revision || !model) return;
    const received = message.anchor as Partial<ViewportAnchor> | undefined;
    anchor = clampAnchor({
      sourceLine: Number(received?.sourceLine) || 1,
      sourceColumn: Number(received?.sourceColumn) || undefined,
      sourceEndLine: Number(received?.sourceEndLine) || undefined,
      yRatio: Number.isFinite(Number(received?.yRatio))
        ? clamp(Number(received?.yRatio), 0, 1)
        : GOLDEN_TOP_RATIO,
      reason: received?.reason ?? 'scroll-ratio',
      confidence: received?.confidence ?? 'fallback',
    }, model.getLineCount());
    const tab = activeTab();
    if (tab) {
      tab.anchor = anchor;
      tab.viewerScrollRatio = Number.isFinite(Number(message.scrollRatio))
        ? clamp(Number(message.scrollRatio), 0, 1)
        : null;
    }
    publishAnchor();
    return;
  }
  if (message.type === 'edit-at-anchor') {
    const received = message.anchor as Partial<ViewportAnchor> | undefined;
    // 전환은 무조건이다. anchor가 망가져 있어도 문서 처음으로 간다.
    enterEditor({
      sourceLine: Number(received?.sourceLine) || 1,
      sourceColumn: Number(received?.sourceColumn) || undefined,
      sourceEndLine: Number(received?.sourceEndLine) || undefined,
      yRatio: Number.isFinite(Number(received?.yRatio))
        ? clamp(Number(received?.yRatio), 0, 1)
        : GOLDEN_TOP_RATIO,
      reason: received?.reason ?? 'scroll-ratio',
      confidence: received?.confidence ?? 'fallback',
    });
    return;
  }
  if (message.command === 'clickTagA') {
    const args = message.args as Array<{ href?: string }> | undefined;
    const link = args?.[0];
    if (link?.href) void window.marktex.openLink(link.href);
  }
});

window.marktex.onDocumentOpened((opened) => void showDocument(opened));
window.marktex.onExternalChange((change) => {
  if (currentDocument?.path === change.path) notice.hidden = false;
});
window.marktex.onCommand((command) => {
  if (command === 'new-document') void newDocument();
  if (command === 'save') void save(false);
  if (command === 'save-as') void save(true);
  if (command === 'export-pdf') void exportPdf();
  if (command === 'close-tab' && activeTabId) void closeTab(activeTabId);
  if (command === 'next-tab') cycleTab(1);
  if (command === 'previous-tab') cycleTab(-1);
  if (command === 'toggle-surface') {
    if (surface === 'viewer') requestViewerAnchor();
    else if (surface === 'editor') void enterViewer();
  }
});
window.marktex.onSaveBeforeClose(() => void saveAllDirtyTabs());
window.marktex.onTabTransferIncoming((transfer) => void installTransferredTab(transfer));
window.marktex.onTabTransferCompleted((tabId) => {
  draggedTabId = null;
  draggedTransferId = null;
  tabDragCanceled = false;
  shell.classList.remove('is-tab-dragging', 'is-window-drop-target');
  void removeTransferredTab(tabId);
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && draggedTabId) tabDragCanceled = true;
}, { capture: true });

window.marktex.getDocument().then((documentSnapshot) => {
  if (documentSnapshot) void showDocument(documentSnapshot);
  else if (tabs.length === 0) {
    setSurface('empty');
    renderTabs();
  }
});

const previewResizeObserver = new ResizeObserver(syncPreviewView);
previewResizeObserver.observe(previewFrames);
window.addEventListener('resize', syncPreviewView);
