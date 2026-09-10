import * as monaco from 'monaco-editor/editor/editor.main';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type { DocumentSnapshot } from '../shared/contracts';
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
let renderToken = 0;
let anchorLine = 1;
let surface: 'empty' | 'viewer' | 'editor' = 'empty';

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

function setSurface(next: typeof surface) {
  surface = next;
  shell.dataset.surface = next;
  modeLabel.textContent = next === 'viewer' ? 'VIEWER' : next === 'editor' ? 'EDITOR' : '';
  if (next === 'editor') requestAnimationFrame(() => editor.layout());
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
  });
}

async function render(line = anchorLine) {
  if (!currentDocument || !model) return;
  const token = ++renderToken;
  const requestedRevision = revision;
  renderState.hidden = false;
  renderError.hidden = true;
  try {
    const result = await window.marktex.renderDocument(model.getValue(), requestedRevision);
    if (token !== renderToken || result.revision !== revision) return;
    frame.onload = () => {
      const reveal = () => frame.contentWindow?.postMessage({
        command: 'changeTextEditorSelection',
        line: Math.max(0, line - 1),
        topRatio: 0.35,
        forced: true,
      }, '*');
      reveal();
      window.setTimeout(reveal, 80);
    };
    frame.src = result.url;
    renderState.hidden = true;
  } catch (error) {
    if (token !== renderToken) return;
    renderState.hidden = true;
    renderError.hidden = false;
    renderErrorText.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function showDocument(documentSnapshot: DocumentSnapshot) {
  currentDocument = documentSnapshot;
  anchorLine = 1;
  notice.hidden = true;
  installModel(documentSnapshot);
  updateChrome();
  setSurface('viewer');
  await render(1);
}

function enterEditor(line = anchorLine) {
  if (!model) return;
  anchorLine = Math.min(Math.max(1, line), model.getLineCount());
  setSurface('editor');
  editor.setPosition({ lineNumber: anchorLine, column: 1 });
  editor.revealLineInCenter(anchorLine, monaco.editor.ScrollType.Smooth);
  window.setTimeout(() => editor.focus(), 0);
}

async function enterViewer() {
  if (!model) return;
  anchorLine = editor.getPosition()?.lineNumber ?? anchorLine;
  setSurface('viewer');
  await render(anchorLine);
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
    if (pathChanged) installModel(result.document);
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
document.querySelector('.notice-keep')?.addEventListener('click', () => {
  notice.hidden = true;
});
document.querySelector('.notice-reload')?.addEventListener('click', async () => {
  const reloaded = await window.marktex.reloadDocument();
  if (reloaded) await showDocument(reloaded);
});

window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.data?.source !== 'crossnote') return;
  if (event.data.type === 'edit-at-line') {
    enterEditor(Number(event.data.line));
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
    if (surface === 'viewer') enterEditor(anchorLine);
    else if (surface === 'editor') void enterViewer();
  }
});

window.marktex.getDocument().then((documentSnapshot) => {
  if (documentSnapshot) void showDocument(documentSnapshot);
  else setSurface('empty');
});
