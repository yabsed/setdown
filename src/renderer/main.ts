import * as monaco from 'monaco-editor/editor/editor.main';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type { DocumentSnapshot } from '../shared/contracts';
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
  <section class="shell" data-surface="empty">
    <header class="titlebar">
      <button class="icon-button open-button" type="button" title="Markdown 파일 열기 (Ctrl/Cmd+O)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-10Zm2.5-.75a.75.75 0 0 0-.75.75v10c0 .414.336.75.75.75h13a.75.75 0 0 0 .75-.75v-8a.75.75 0 0 0-.75-.75h-7.225l-2-2H5.5Z"/></svg>
      </button>
      <div class="document-title">
        <span class="filename">MarkTex</span><span class="dirty-dot" aria-label="저장되지 않은 변경">•</span>
      </div>
      <div class="mode-label" aria-live="polite"></div>
    </header>

    <div class="notice" hidden>
      <span>이 파일이 다른 프로그램에서 변경되었습니다.</span>
      <div>
        <button class="notice-keep" type="button">현재 내용 유지</button>
        <button class="notice-reload" type="button">다시 불러오기</button>
      </div>
    </div>

    <section class="empty-state">
      <div class="empty-mark">M</div>
      <h1>한 편의 문서에 집중하세요.</h1>
      <p>Markdown 파일을 아름답게 읽고, 더블 클릭해 바로 고칠 수 있습니다.</p>
      <button class="primary-button empty-open" type="button">Markdown 파일 열기</button>
      <span class="shortcut">Ctrl/Cmd+O</span>
    </section>

    <section class="viewer-surface" aria-label="렌더링된 Markdown">
      <iframe class="preview-frame" title="Markdown 미리보기" sandbox="allow-scripts allow-same-origin"></iframe>
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
const filename = document.querySelector<HTMLElement>('.filename')!;
const dirtyDot = document.querySelector<HTMLElement>('.dirty-dot')!;
const modeLabel = document.querySelector<HTMLElement>('.mode-label')!;
const frame = document.querySelector<HTMLIFrameElement>('.preview-frame')!;
const editorHost = document.querySelector<HTMLElement>('.editor-host')!;
const renderState = document.querySelector<HTMLElement>('.render-state')!;
const renderError = document.querySelector<HTMLElement>('.render-error')!;
const renderErrorText = renderError.querySelector<HTMLElement>('span')!;
const notice = document.querySelector<HTMLElement>('.notice')!;

let currentDocument: DocumentSnapshot | null = null;
let model: monaco.editor.ITextModel | null = null;
let revision = 0;
let surface: 'empty' | 'viewer' | 'editor' = 'empty';
let previewGeneration = 0;
let previewTimer: number | null = null;
let previewError: { revision: number; message: string } | null = null;

const PREVIEW_DEBOUNCE_MS = 700;
const previewCoordinator = new PreviewRenderCoordinator(renderRevision);

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
  modeLabel.textContent = next === 'viewer' ? 'VIEWER' : next === 'editor' ? 'EDITOR' : '';
  updatePreviewUi();
  if (next === 'editor') window.setTimeout(() => editor.layout(), 0);
}

function updateChrome() {
  if (!currentDocument) {
    filename.textContent = 'MarkTex';
    dirtyDot.hidden = true;
    document.title = 'MarkTex';
    return;
  }
  const dirty = revision !== currentDocument.savedRevision;
  filename.textContent = currentDocument.name;
  dirtyDot.hidden = !dirty;
  document.title = `${dirty ? '• ' : ''}${currentDocument.name} — MarkTex`;
}

function installModel(documentSnapshot: DocumentSnapshot) {
  const previous = model;
  const uri = monaco.Uri.file(documentSnapshot.path);
  model = monaco.editor.createModel(documentSnapshot.text, 'markdown', uri);
  editor.setModel(model);
  previous?.dispose();
  revision = documentSnapshot.revision;
  model.onDidChangeContent(() => {
    if (!model || !currentDocument) return;
    revision += 1;
    window.marktex.updateText(model.getValue(), revision);
    updateChrome();
    if (surface === 'editor') schedulePreview(revision);
  });
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
}

function loadPreviewFrame(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      frame.removeEventListener('load', handleLoad);
      frame.removeEventListener('error', handleError);
    };
    const handleLoad = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error('The preview frame could not load the rendered document.'));
    };
    frame.addEventListener('load', handleLoad, { once: true });
    frame.addEventListener('error', handleError, { once: true });
    frame.src = url;
  });
}

async function renderRevision(targetRevision: number): Promise<boolean> {
  if (!currentDocument || !model || targetRevision !== revision) return false;
  const generation = previewGeneration;
  const documentPath = currentDocument.path;
  const text = model.getValue();
  if (previewError?.revision === targetRevision) previewError = null;
  try {
    const result = await window.marktex.renderDocument(text, targetRevision, documentPath);
    if (
      generation !== previewGeneration
      || currentDocument?.path !== documentPath
      || result.revision !== targetRevision
      || revision !== targetRevision
    ) return false;

    await loadPreviewFrame(result.url);
    if (generation !== previewGeneration || currentDocument?.path !== documentPath) return false;
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

function revealPreview(target: ViewportAnchor) {
  if (!model) return;
  const revealed = clampAnchor(target, model.getLineCount());
  const reveal = () => frame.contentWindow?.postMessage({
    command: 'changeTextEditorSelection',
    line: Math.max(0, revealed.sourceLine - 1),
    topRatio: revealed.yRatio,
    forced: true,
  }, '*');
  window.requestAnimationFrame(() => {
    reveal();
    window.setTimeout(reveal, 80);
  });
}

async function showDocument(documentSnapshot: DocumentSnapshot) {
  resetPreviewState();
  const generation = previewGeneration;
  currentDocument = documentSnapshot;
  anchor = {
    sourceLine: 1,
    yRatio: GOLDEN_TOP_RATIO,
    reason: 'empty-document',
    confidence: 'fallback',
  };
  publishAnchor();
  notice.hidden = true;
  installModel(documentSnapshot);
  updateChrome();
  setSurface('viewer');
  const ready = await ensurePreview(revision);
  if (ready && generation === previewGeneration) revealPreview(anchor);
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
  setSurface('viewer');
  const generation = previewGeneration;
  const targetRevision = revision;
  const ready = await ensurePreview(targetRevision);
  if (
    ready
    && generation === previewGeneration
    && previewCoordinator.readyRevision === revision
  ) revealPreview(anchor);
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
      if (surface === 'editor') schedulePreview(revision);
      else if (surface === 'viewer') {
        const target = revision;
        void ensurePreview(target).then((ready) => {
          if (ready && target === revision) revealPreview(anchor);
        });
      }
    }
    updateChrome();
  }
}

async function openDocument() {
  const opened = await window.marktex.openDocument();
  if (opened) await showDocument(opened);
}

editor.addCommand(
  monaco.KeyCode.Escape,
  () => void enterViewer(),
  '!suggestWidgetVisible && !findInputFocussed && !renameInputVisible && !compositionInProgress',
);

document.querySelectorAll('.open-button, .empty-open').forEach((button) => {
  button.addEventListener('click', () => void openDocument());
});
document.querySelector('.render-error button')?.addEventListener('click', () => enterEditor());

/**
 * 화면 전환 단축키에도 같은 원칙을 적용한다. Viewer가 지금 보고 있는
 * 높이를 물어보고, 답이 오면 `edit-at-anchor`가 Editor를 연다. 답이 오지
 * 않아도 전환은 보장한다.
 */
function requestViewerAnchor() {
  const pendingSurface = surface;
  frame.contentWindow?.postMessage(
    { command: 'marktex:request-anchor', topRatio: GOLDEN_TOP_RATIO },
    '*',
  );
  window.setTimeout(() => {
    if (surface === pendingSurface) enterEditor(anchor);
  }, 120);
}
document.querySelector('.notice-keep')?.addEventListener('click', () => {
  notice.hidden = true;
});
document.querySelector('.notice-reload')?.addEventListener('click', async () => {
  const reloaded = await window.marktex.reloadDocument();
  if (reloaded) await showDocument(reloaded);
});

window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.data?.source !== 'crossnote') return;
  if (event.data.type === 'edit-at-anchor') {
    const received = event.data.anchor as Partial<ViewportAnchor> | undefined;
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
  if (event.data.command === 'clickTagA') {
    const payload = event.data.args?.[0];
    if (payload?.href) void window.marktex.openLink(payload.href);
  }
});

window.marktex.onDocumentOpened((opened) => void showDocument(opened));
window.marktex.onExternalChange(() => {
  notice.hidden = false;
});
window.marktex.onCommand((command) => {
  if (command === 'save') void save(false);
  if (command === 'save-as') void save(true);
  if (command === 'toggle-surface') {
    if (surface === 'viewer') requestViewerAnchor();
    else if (surface === 'editor') void enterViewer();
  }
});

window.marktex.getDocument().then((documentSnapshot) => {
  if (documentSnapshot) void showDocument(documentSnapshot);
  else setSurface('empty');
});
