import * as monaco from 'monaco-editor/editor/editor.main';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type {
  ApplicationMenuEntry,
  ClaimedTabTransfer,
  DocumentSnapshot,
  PreviewHeading,
  ThemeSnapshot,
  TransferableTab,
} from '../shared/contracts';
import {
  normalizePreviewTheme,
  type PreviewThemeAssets,
  type PreviewThemeId,
} from '../shared/preview-preferences';
import {
  THEME_PROFILES,
  themeProfile,
  type ThemePalette,
} from '../shared/theme-catalog';
import { PreviewRenderCoordinator } from '../shared/preview-render-coordinator';
import {
  createMarkdownLink,
  createMarkdownTable,
  preferredEol,
  type TableAlignment,
} from '../shared/markdown-insertions';
import {
  GOLDEN_TOP_RATIO,
  clamp,
  clampAnchor,
  resolveEditorViewport,
  type ViewportAnchor,
} from '../shared/viewport-anchor';
import './style.css';

const SHELL_THEME_VARIABLES: Record<keyof ThemePalette, string> = {
  canvas: '--app-canvas',
  surface: '--app-surface',
  raisedSurface: '--app-raised-surface',
  chrome: '--app-chrome',
  editorBackground: '--app-editor-background',
  text: '--app-text',
  mutedText: '--app-muted-text',
  subtleText: '--app-subtle-text',
  border: '--app-border',
  strongBorder: '--app-strong-border',
  hover: '--app-hover',
  selected: '--app-selected',
  accent: '--app-accent',
  focusRing: '--app-focus-ring',
  warningSurface: '--app-warning-surface',
  warningText: '--app-warning-text',
  warningBorder: '--app-warning-border',
  dangerText: '--app-danger-text',
  shadow: '--app-shadow',
  overlay: '--app-overlay',
};

function monacoThemeName(themeId: PreviewThemeId) {
  return `setdown-${themeId}`;
}

function withAlpha(color: string, alpha: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

function registerMonacoThemes() {
  for (const profile of THEME_PROFILES) {
    const { palette, syntax } = profile;
    monaco.editor.defineTheme(monacoThemeName(profile.id), {
      base: profile.appearance === 'dark' ? 'vs-dark' : 'vs',
      inherit: true,
      colors: {
        'editor.background': palette.editorBackground,
        'editor.foreground': syntax.foreground,
        'editorCursor.foreground': palette.accent,
        'editorLineNumber.foreground': palette.subtleText,
        'editorLineNumber.activeForeground': palette.text,
        'editor.lineHighlightBackground': withAlpha(palette.hover, '80'),
        'editor.selectionBackground': withAlpha(palette.accent, '55'),
        'editor.inactiveSelectionBackground': withAlpha(palette.accent, '32'),
        'editor.findMatchBackground': withAlpha(palette.accent, '66'),
        'editor.findMatchHighlightBackground': withAlpha(palette.accent, '36'),
        'editorWidget.background': palette.raisedSurface,
        'editorWidget.border': palette.border,
        'input.background': palette.surface,
        'input.foreground': palette.text,
        'input.border': palette.border,
        'focusBorder': palette.focusRing,
        'scrollbarSlider.background': withAlpha(palette.mutedText, '44'),
        'scrollbarSlider.hoverBackground': withAlpha(palette.mutedText, '66'),
        'editorGutter.background': palette.editorBackground,
        'editorIndentGuide.background1': palette.border,
        'editorIndentGuide.activeBackground1': palette.strongBorder,
      },
      rules: [
        { token: 'comment', foreground: syntax.comment.slice(1), fontStyle: 'italic' },
        { token: 'keyword', foreground: syntax.keyword.slice(1) },
        { token: 'string', foreground: syntax.string.slice(1) },
        { token: 'number', foreground: syntax.number.slice(1) },
        { token: 'tag', foreground: syntax.heading.slice(1), fontStyle: 'bold' },
        { token: 'type', foreground: syntax.heading.slice(1) },
        { token: 'string.link', foreground: syntax.link.slice(1), fontStyle: 'underline' },
        { token: 'markup.heading.markdown', foreground: syntax.heading.slice(1), fontStyle: 'bold' },
        { token: 'markup.inline.raw.markdown', foreground: syntax.code.slice(1) },
        { token: 'delimiter', foreground: syntax.punctuation.slice(1) },
      ],
    });
  }
}

function applyShellTheme(themeId: PreviewThemeId) {
  const profile = themeProfile(themeId);
  const root = document.documentElement;
  root.dataset.theme = profile.id;
  root.dataset.appearance = profile.appearance;
  root.style.colorScheme = profile.appearance;
  root.style.setProperty('--preview-background', profile.preview.background);
  for (const [name, value] of Object.entries(profile.palette)) {
    root.style.setProperty(SHELL_THEME_VARIABLES[name as keyof ThemePalette], value);
  }
}

const initialTheme: ThemeSnapshot = {
  id: normalizePreviewTheme(window.marktex.initialTheme.id),
  revision: Math.max(0, window.marktex.initialTheme.revision),
};
let appliedThemeRevision = initialTheme.revision;
registerMonacoThemes();
applyShellTheme(initialTheme.id);

window.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="product-titlebar">
    <div class="product-identity" aria-label="Setdown">Setdown</div>
    <nav class="application-menu" aria-label="애플리케이션 메뉴">
      <button type="button" data-menu-id="application-menu-file">File</button>
      <button type="button" data-menu-id="application-menu-view">View</button>
      <button type="button" data-menu-id="application-menu-insert">Insert</button>
      <button type="button" data-menu-id="application-menu-edit">Edit</button>
      <button type="button" data-menu-id="application-menu-window">Window</button>
    </nav>
    <div class="application-menu-popup" hidden></div>
    <div class="titlebar-drag-space" aria-hidden="true"></div>
  </header>
  <section class="shell" data-surface="empty" data-tabs="false">
    <nav class="tab-strip" aria-label="열린 문서" hidden>
      <div class="tab-list" role="tablist"></div>
      <div class="tab-actions">
        <button class="new-tab-button" type="button" title="새 문서 (Ctrl/Cmd+N)" aria-label="새 문서">+</button>
        <button class="editor-action insert-table-button" type="button" title="표 삽입" aria-label="표 삽입">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.75A1.75 1.75 0 0 1 5.75 3h12.5A1.75 1.75 0 0 1 20 4.75v14.5A1.75 1.75 0 0 1 18.25 21H5.75A1.75 1.75 0 0 1 4 19.25V4.75Zm1.5 3.75h4.75v-4H5.75a.25.25 0 0 0-.25.25V8.5Zm6.25 0h6.75V4.75a.25.25 0 0 0-.25-.25h-6.5v4Zm-6.25 1.5v4h4.75v-4H5.5Zm6.25 0v4h6.75v-4h-6.75ZM5.5 15.5v3.75c0 .14.11.25.25.25h4.5v-4H5.5Zm6.25 4h6.5a.25.25 0 0 0 .25-.25V15.5h-6.75v4Z"/></svg>
        </button>
        <button class="editor-action insert-link-button" type="button" title="링크 삽입 (Ctrl/Cmd+K)" aria-label="링크 삽입">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 15.5 8 17a3.54 3.54 0 0 1-5-5l3-3a3.54 3.54 0 0 1 5 0 .75.75 0 0 1-1.06 1.06 2.04 2.04 0 0 0-2.88 0l-3 3a2.04 2.04 0 0 0 2.88 2.88l1.5-1.5A.75.75 0 1 1 9.5 15.5Zm5-7L16 7a3.54 3.54 0 0 1 5 5l-3 3a3.54 3.54 0 0 1-5 0 .75.75 0 0 1 1.06-1.06 2.04 2.04 0 0 0 2.88 0l3-3a2.04 2.04 0 0 0-2.88-2.88l-1.5 1.5A.75.75 0 1 1 14.5 8.5Zm1.03.97a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 0 1-1.06-1.06l5-5a.75.75 0 0 1 1.06 0Z"/></svg>
        </button>
        <button class="viewer-action toc-toggle" type="button" aria-expanded="false" title="목차 열기" aria-label="목차 열기">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h2v2H4v-2Zm4 .25h12v1.5H8v-1.5ZM4 11h2v2H4v-2Zm4 .25h12v1.5H8v-1.5ZM4 16.5h2v2H4v-2Zm4 .25h12v1.5H8v-1.5Z"/></svg>
        </button>
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
      <div class="reader-body">
        <div class="preview-frames">
          <div class="preview-search" role="search" hidden>
            <input type="search" autocomplete="off" spellcheck="false" aria-label="렌더링된 문서에서 찾기" placeholder="찾기…">
            <span class="find-count" aria-live="polite">0 / 0</span>
            <button class="find-previous" type="button" aria-label="이전 검색 결과">↑</button>
            <button class="find-next" type="button" aria-label="다음 검색 결과">↓</button>
            <button class="find-close" type="button" aria-label="검색 닫기">×</button>
          </div>
        </div>
        <aside class="toc-panel" aria-label="문서 목차" hidden>
          <div class="toc-panel-title"><strong>목차</strong><span class="toc-count"></span></div>
          <nav class="toc-list"></nav>
        </aside>
      </div>
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

    <dialog class="insertion-dialog table-dialog" aria-labelledby="table-dialog-title">
      <form class="insertion-form table-form">
        <header>
          <div><h2 id="table-dialog-title">표 삽입</h2><p>셀 내용과 열 정렬을 지정하세요.</p></div>
          <button class="dialog-close" type="button" aria-label="닫기">×</button>
        </header>
        <div class="table-size-controls">
          <label>열 <input class="table-columns" type="number" min="1" max="12" value="3"></label>
          <label>데이터 행 <input class="table-rows" type="number" min="0" max="30" value="2"></label>
        </div>
        <div class="table-editor-scroll"><div class="table-grid-editor"></div></div>
        <footer><button class="secondary-button table-cancel" type="button">취소</button><button class="primary-button table-submit" type="button">삽입</button></footer>
      </form>
    </dialog>

    <dialog class="insertion-dialog link-dialog" aria-labelledby="link-dialog-title">
      <form class="insertion-form link-form">
        <header>
          <div><h2 id="link-dialog-title">링크 삽입</h2><p>URL을 입력하거나 현재 문서에서 연결할 파일을 고르세요.</p></div>
          <button class="dialog-close" type="button" aria-label="닫기">×</button>
        </header>
        <label>표시할 텍스트<input class="link-label" type="text" autocomplete="off"></label>
        <label>URL 또는 경로<span class="link-destination-row"><input class="link-destination" type="text" required spellcheck="false" placeholder="https://example.com"><button class="secondary-button pick-link-file" type="button">파일 선택…</button></span></label>
        <label>제목 <span class="optional-label">선택 사항</span><input class="link-title" type="text" autocomplete="off"></label>
        <div class="dialog-error" role="alert" hidden></div>
        <footer><button class="secondary-button link-cancel" type="button">취소</button><button class="primary-button" type="submit">삽입</button></footer>
      </form>
    </dialog>
  </section>
`;

const shell = document.querySelector<HTMLElement>('.shell')!;
const applicationMenu = document.querySelector<HTMLElement>('.application-menu')!;
const applicationMenuPopup = document.querySelector<HTMLElement>('.application-menu-popup')!;
const modeToggle = document.querySelector<HTMLButtonElement>('.mode-toggle')!;
const previewFrames = document.querySelector<HTMLElement>('.preview-frames')!;
const tocToggle = document.querySelector<HTMLButtonElement>('.toc-toggle')!;
const tocPanel = document.querySelector<HTMLElement>('.toc-panel')!;
const tocList = document.querySelector<HTMLElement>('.toc-list')!;
const tocCount = document.querySelector<HTMLElement>('.toc-count')!;
const previewSearch = document.querySelector<HTMLElement>('.preview-search')!;
const findInput = previewSearch.querySelector<HTMLInputElement>('input')!;
const findCount = previewSearch.querySelector<HTMLElement>('.find-count')!;
const editorHost = document.querySelector<HTMLElement>('.editor-host')!;
const renderState = document.querySelector<HTMLElement>('.render-state')!;
const renderError = document.querySelector<HTMLElement>('.render-error')!;
const renderErrorText = renderError.querySelector<HTMLElement>('span')!;
const notice = document.querySelector<HTMLElement>('.notice')!;
const tabStrip = document.querySelector<HTMLElement>('.tab-strip')!;
const tabList = document.querySelector<HTMLElement>('.tab-list')!;
const tableDialog = document.querySelector<HTMLDialogElement>('.table-dialog')!;
const tableForm = document.querySelector<HTMLFormElement>('.table-form')!;
const tableColumnsInput = document.querySelector<HTMLInputElement>('.table-columns')!;
const tableRowsInput = document.querySelector<HTMLInputElement>('.table-rows')!;
const tableGridEditor = document.querySelector<HTMLElement>('.table-grid-editor')!;
const linkDialog = document.querySelector<HTMLDialogElement>('.link-dialog')!;
const linkForm = document.querySelector<HTMLFormElement>('.link-form')!;
const linkLabelInput = document.querySelector<HTMLInputElement>('.link-label')!;
const linkDestinationInput = document.querySelector<HTMLInputElement>('.link-destination')!;
const linkTitleInput = document.querySelector<HTMLInputElement>('.link-title')!;
const linkError = document.querySelector<HTMLElement>('.dialog-error')!;

type DocumentTab = {
  id: string;
  document: DocumentSnapshot;
  model: monaco.editor.ITextModel;
  revision: number;
  surface: 'viewer' | 'editor';
  anchor: ViewportAnchor;
  previewUrl: string | null;
  previewRevision: number | null;
  previewTheme: PreviewThemeId | null;
  editorViewState: monaco.editor.ICodeEditorViewState | null;
  viewerScrollRatio: number | null;
  headings: PreviewHeading[];
  activeHeadingId: string | null;
  find: {
    open: boolean;
    query: string;
    activeMatch: number;
    matches: number;
  };
};

const READER_PREFERENCES_KEY = 'setdown.readerPreferences';

function loadReaderPreferences(): { tocOpen: boolean; themeId: PreviewThemeId } {
  try {
    const value = JSON.parse(localStorage.getItem(READER_PREFERENCES_KEY) ?? '{}') as {
      tocOpen?: unknown;
    };
    return {
      tocOpen: value.tocOpen === true,
      // Preview theme의 authority는 main process의 app-global setting이다.
      themeId: initialTheme.id,
    };
  } catch {
    return { tocOpen: false, themeId: initialTheme.id };
  }
}

const readerPreferences = loadReaderPreferences();

function saveReaderPreferences() {
  localStorage.setItem(READER_PREFERENCES_KEY, JSON.stringify({
    tocOpen: readerPreferences.tocOpen,
  }));
}

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
  theme: monacoThemeName(initialTheme.id),
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
  syncReaderUi();
  updatePreviewUi();
  syncPreviewView();
  if (next === 'editor') window.setTimeout(() => editor.layout(), 0);
}

function activeTab() {
  return tabs.find((tab) => tab.id === activeTabId) ?? null;
}

function renderToc(tab: DocumentTab | null) {
  tocList.replaceChildren();
  const headings = tab?.headings ?? [];
  tocCount.textContent = headings.length > 0 ? String(headings.length) : '';
  if (headings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'toc-empty';
    empty.textContent = '이 문서에는 제목이 없습니다.';
    tocList.append(empty);
    return;
  }
  for (const heading of headings) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toc-item';
    button.textContent = heading.text;
    button.style.paddingLeft = `${8 + (heading.level - 1) * 13}px`;
    button.classList.toggle('is-active', heading.id === tab?.activeHeadingId);
    button.setAttribute('aria-current', heading.id === tab?.activeHeadingId ? 'location' : 'false');
    button.addEventListener('click', () => {
      if (!activeTabId) return;
      sendPreviewCommand(activeTabId, {
        command: 'marktex:scroll-to-heading',
        id: heading.id,
      });
    });
    tocList.append(button);
  }
}

function syncReaderUi() {
  const tab = activeTab();
  const viewerVisible = surface === 'viewer';
  shell.dataset.tocOpen = readerPreferences.tocOpen && viewerVisible ? 'true' : 'false';
  tocPanel.hidden = !readerPreferences.tocOpen || !viewerVisible;
  tocToggle.setAttribute('aria-expanded', String(readerPreferences.tocOpen));
  tocToggle.title = readerPreferences.tocOpen ? '목차 닫기' : '목차 열기';
  tocToggle.setAttribute('aria-label', tocToggle.title);
  tocToggle.classList.toggle('is-active', readerPreferences.tocOpen);
  previewSearch.hidden = !tab?.find.open || !viewerVisible;
  shell.dataset.findOpen = tab?.find.open && viewerVisible ? 'true' : 'false';
  if (tab && findInput.value !== tab.find.query) findInput.value = tab.find.query;
  findCount.textContent = tab?.find.matches
    ? `${tab.find.activeMatch} / ${tab.find.matches}`
    : '0 / 0';
  renderToc(tab);
}

function runPreviewFind(direction: 'forward' | 'backward' = 'forward', findNext = false) {
  const tab = activeTab();
  if (!tab) return;
  tab.find.query = findInput.value;
  tab.find.activeMatch = 0;
  tab.find.matches = 0;
  findCount.textContent = '0 / 0';
  if (!tab.find.query) {
    sendPreviewCommand(tab.id, { command: 'marktex:stop-find' });
    return;
  }
  sendPreviewCommand(tab.id, {
    command: 'marktex:find',
    query: tab.find.query,
    direction,
    findNext,
  });
}

function openPreviewFind() {
  const tab = activeTab();
  if (!tab || surface !== 'viewer') return;
  tab.find.open = true;
  syncReaderUi();
  syncPreviewView();
  findInput.focus({ preventScroll: true });
  findInput.select();
  queueMicrotask(() => {
    if (document.activeElement !== findInput) findInput.focus({ preventScroll: true });
  });
  if (tab.find.query) runPreviewFind('forward', false);
}

function closePreviewFind(clearQuery = false) {
  const tab = activeTab();
  if (!tab) return;
  sendPreviewCommand(tab.id, { command: 'marktex:stop-find' });
  tab.find.open = false;
  tab.find.activeMatch = 0;
  tab.find.matches = 0;
  if (clearQuery) tab.find.query = '';
  syncReaderUi();
  syncPreviewView();
}

async function applyProductTheme(snapshot: ThemeSnapshot, forceAssets = false) {
  const nextTheme = normalizePreviewTheme(snapshot.id);
  if (snapshot.revision < appliedThemeRevision) return;
  if (!forceAssets && snapshot.revision === appliedThemeRevision
    && readerPreferences.themeId === nextTheme) return;
  appliedThemeRevision = snapshot.revision;
  readerPreferences.themeId = nextTheme;
  applicationMenuCache.delete('application-menu-view');
  applyShellTheme(nextTheme);
  monaco.editor.setTheme(monacoThemeName(nextTheme));
  syncReaderUi();
  const assets = await window.marktex.getPreviewThemeAssets(nextTheme);
  if (
    appliedThemeRevision !== snapshot.revision
    || readerPreferences.themeId !== assets.themeId
  ) return;
  currentPreviewThemeAssets = assets;
  for (const tab of tabs) applyThemeAssetsToTab(tab, assets);
}

function applyThemeAssetsToTab(tab: DocumentTab, assets: PreviewThemeAssets) {
  if (!tab.previewUrl) return;
  sendPreviewCommand(tab.id, {
    command: 'marktex:apply-theme',
    ...assets,
  });
  tab.previewTheme = assets.themeId;
}

type PreviewFrame = {
  element: HTMLIFrameElement;
  url: string | null;
  origin: string | null;
  loadSequence: number;
  ready: boolean;
  pendingCommands: Record<string, unknown>[];
  settleLoad: ((error?: Error) => void) | null;
};

const previewFrameByTab = new Map<string, PreviewFrame>();
// 테마는 일회성 command가 아니라 모든 문서 frame이 수렴해야 하는 전역
// reader state다. navigation과 command가 엇갈려도 ready 때 다시 적용한다.
let currentPreviewThemeAssets: PreviewThemeAssets | null = null;

function createPreview(tabId: string) {
  if (previewFrameByTab.has(tabId)) return;
  const element = document.createElement('iframe');
  element.className = 'preview-frame';
  element.dataset.tabId = tabId;
  element.title = '렌더링된 Markdown 문서';
  element.setAttribute('aria-hidden', 'true');
  element.inert = true;
  element.referrerPolicy = 'no-referrer';
  element.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-downloads');
  previewFrames.append(element);
  previewFrameByTab.set(tabId, {
    element,
    url: null,
    origin: null,
    loadSequence: 0,
    ready: false,
    pendingCommands: [],
    settleLoad: null,
  });
}

function loadPreview(tabId: string, url: string): Promise<void> {
  const frame = previewFrameByTab.get(tabId);
  if (!frame) return Promise.reject(new Error('Preview frame does not exist.'));
  const parsed = new URL(url);
  if (parsed.protocol !== 'marktex-preview:' || parsed.hostname !== 'document') {
    return Promise.reject(new Error('Only rendered Setdown previews may be loaded.'));
  }
  const sequence = ++frame.loadSequence;
  frame.settleLoad?.(new Error('A newer Preview replaced this load.'));
  frame.url = url;
  frame.origin = parsed.origin;
  frame.ready = false;
  frame.pendingCommands = [];
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settle(new Error('The Preview bridge did not become ready.'));
    }, 5000);
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      frame.element.removeEventListener('error', failed);
      if (frame.settleLoad === settle) frame.settleLoad = null;
      if (error) reject(error);
      else resolve();
    };
    const failed = () => {
      if (frame.loadSequence === sequence) {
        settle(new Error('The Preview frame failed to load.'));
      }
    };
    frame.element.addEventListener('error', failed);
    frame.settleLoad = settle;
    frame.element.src = url;
  });
}

function sendPreviewCommand(tabId: string, message: Record<string, unknown>) {
  const frame = previewFrameByTab.get(tabId);
  if (!frame?.element.contentWindow || !frame.origin) return;
  if (!frame.ready) {
    frame.pendingCommands.push(message);
    if (frame.pendingCommands.length > 50) frame.pendingCommands.shift();
    return;
  }
  frame.element.contentWindow.postMessage(message, frame.origin);
}

function destroyPreview(tabId: string) {
  const frame = previewFrameByTab.get(tabId);
  if (!frame) return;
  frame.loadSequence += 1;
  frame.settleLoad?.(new Error('The Preview frame was destroyed.'));
  frame.element.remove();
  previewFrameByTab.delete(tabId);
}

function syncPreviewView() {
  const tab = activeTab();
  const visible = !!tab
    && (surface === 'viewer' || shell.dataset.previewPositioning === 'true')
    && !!tab.previewUrl;
  for (const [tabId, frame] of previewFrameByTab) {
    const active = visible && tabId === tab?.id;
    frame.element.classList.toggle('is-active', active);
    frame.element.setAttribute('aria-hidden', String(!active));
    frame.element.inert = !active;
  }
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
    previewTheme: tab.previewTheme,
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
  if (
    next.previewRevision === revision
    && next.previewTheme === readerPreferences.themeId
    && next.previewUrl?.startsWith('marktex-preview:')
  ) {
    previewCoordinator.readyRevision = revision;
  }
  updateChrome();
  setSurface(next.surface);
  sendPreviewCommand(next.id, { command: 'marktex:collect-headings' });
  await window.marktex.activateDocument(currentDocument, model.getValue(), revision);
  if (activation !== tabActivation || activeTabId !== next.id) return;

  // 탭마다 별도 iframe을 유지한다. CSS로 보이는 frame만 바꾸므로 이미
  // 조판된 DOM과 scroll 상태를 건드리지 않는다.
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
  destroyPreview(tab.id);
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
  // destination은 독립된 iframe을 이미 복원했다. source frame만 제거한다.
  destroyPreview(tab.id);
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
  syncPreviewView();
}

async function renderRevision(targetRevision: number): Promise<boolean> {
  if (!currentDocument || !model || targetRevision !== revision) return false;
  const generation = previewGeneration;
  const targetTabId = activeTabId;
  const targetTheme = readerPreferences.themeId;
  if (!targetTabId) return false;
  const documentPath = currentDocument.path;
  const text = model.getValue();
  let attemptedUrl: string | null = null;
  if (previewError?.revision === targetRevision) previewError = null;
  try {
    const result = await window.marktex.renderDocument(
      text,
      targetRevision,
      documentPath,
      targetTheme,
    );
    if (
      generation !== previewGeneration
      || activeTabId !== targetTabId
      || currentDocument?.path !== documentPath
      || result.revision !== targetRevision
      || result.themeId !== targetTheme
      || revision !== targetRevision
    ) return false;

    const loadingTab = tabs.find((candidate) => candidate.id === targetTabId);
    attemptedUrl = result.url;
    if (loadingTab) {
      // navigation 중 탭이 이동해도 같은 WebContents를 재사용할 수 있도록
      // URL의 소유 identity를 navigation 시작 전에 함께 기록한다.
      loadingTab.previewUrl = result.url;
      loadingTab.previewRevision = targetRevision;
      loadingTab.previewTheme = targetTheme;
    }
    if (activeTabId === targetTabId) {
      await nextAnimationFrame();
      syncPreviewView();
    }
    await loadPreview(targetTabId, result.url);
    // load 도중 사용자가 다른 탭으로 가더라도 완성된 WebContents는 요청을
    // 시작한 탭의 자산이다. 활성 탭 여부와 별개로 먼저 그 탭에 귀속시킨다.
    const renderedTab = tabs.find((candidate) => candidate.id === targetTabId);
    if (
      renderedTab
      && renderedTab.document.path === documentPath
      && renderedTab.revision === targetRevision
    ) {
      renderedTab.previewUrl = result.url;
      renderedTab.previewRevision = targetRevision;
      renderedTab.previewTheme = targetTheme;
    }
    if (renderedTab && readerPreferences.themeId !== targetTheme) {
      const assets = await window.marktex.getPreviewThemeAssets(readerPreferences.themeId);
      if (readerPreferences.themeId === assets.themeId) applyThemeAssetsToTab(renderedTab, assets);
    }
    sendPreviewCommand(targetTabId, { command: 'marktex:collect-headings' });
    if (renderedTab?.find.open && renderedTab.find.query) {
      sendPreviewCommand(targetTabId, {
        command: 'marktex:find',
        query: renderedTab.find.query,
        direction: 'forward',
        findNext: false,
      });
    }
    if (
      generation !== previewGeneration
      || activeTabId !== targetTabId
      || currentDocument?.path !== documentPath
    ) return false;
    previewError = null;
    return true;
  } catch (error) {
    const failedTab = tabs.find((candidate) => candidate.id === targetTabId);
    if (attemptedUrl && failedTab?.previewUrl === attemptedUrl) {
      failedTab.previewUrl = null;
      failedTab.previewRevision = null;
      failedTab.previewTheme = null;
    }
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
    sendPreviewCommand(targetTabId, {
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
    previewTheme: null,
    editorViewState: null,
    viewerScrollRatio: null,
    headings: [],
    activeHeadingId: null,
    find: { open: false, query: '', activeMatch: 0, matches: 0 },
  });
  renderTabs();
  await activateTab(id);
}

async function installTransferredTab(transfer: ClaimedTabTransfer) {
  const incoming = transfer.tab;
  createPreview(incoming.id);
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
    previewTheme: incoming.previewTheme,
    editorViewState: incoming.editorViewState as monaco.editor.ICodeEditorViewState | null,
    viewerScrollRatio: incoming.viewerScrollRatio,
    headings: [],
    activeHeadingId: null,
    find: { open: false, query: '', activeMatch: 0, matches: 0 },
  };
  tabs.push(restored);
  if (
    restored.previewUrl?.startsWith('marktex-preview:')
    && restored.previewRevision === restored.revision
  ) {
    try {
      await loadPreview(restored.id, restored.previewUrl);
    } catch {
      restored.previewUrl = null;
      restored.previewRevision = null;
      restored.previewTheme = null;
    }
  }
  renderTabs();
  await activateTab(restored.id);
  syncPreviewView();
  if (restored.previewRevision === restored.revision && restored.surface === 'viewer') {
    await requestPreviewPosition(
      restored.anchor,
      restored.revision,
      restored.id,
      restored.model.getLineCount(),
    );
  }
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
  tab.previewTheme = null;
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
  if (activeTab()?.find.open) closePreviewFind(false);
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
  if (!model || !currentDocument) return false;
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
        tab.previewTheme = null;
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
    return true;
  }
  return false;
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

function safeExternalUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function safeRemoteImageUrl(value: string | null | undefined) {
  const url = safeExternalUrl(value);
  return url && /^https?:/i.test(url) ? url : null;
}

type TableEditorState = {
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
};

let pendingTableSelection: monaco.Selection | null = null;
let pendingLinkSelection: monaco.Selection | null = null;
let tableEditorState: TableEditorState = {
  headers: ['열 1', '열 2', '열 3'],
  rows: [['', '', ''], ['', '', '']],
  alignments: ['none', 'none', 'none'],
};

function boundedInteger(input: HTMLInputElement, fallback: number, maximum: number) {
  const value = Number.parseInt(input.value, 10);
  return Math.max(Number(input.min) || 0, Math.min(maximum, Number.isFinite(value) ? value : fallback));
}

function readTableEditorState() {
  const columns = boundedInteger(tableColumnsInput, 3, 12);
  const rowCount = boundedInteger(tableRowsInput, 2, 30);
  const headers = Array.from(tableGridEditor.querySelectorAll<HTMLInputElement>('[data-table-header]'))
    .map((input) => input.value);
  const alignments = Array.from(tableGridEditor.querySelectorAll<HTMLSelectElement>('[data-table-alignment]'))
    .map((select) => select.value as TableAlignment);
  const rows = Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columns }, (_, column) =>
      tableGridEditor.querySelector<HTMLInputElement>(
        `[data-table-row="${row}"][data-table-column="${column}"]`,
      )?.value ?? ''),
  );
  return { headers, rows, alignments };
}

function renderTableEditor() {
  const columns = boundedInteger(tableColumnsInput, 3, 12);
  const rowCount = boundedInteger(tableRowsInput, 2, 30);
  tableColumnsInput.value = String(columns);
  tableRowsInput.value = String(rowCount);
  tableEditorState = {
    headers: Array.from({ length: columns }, (_, column) =>
      tableEditorState.headers[column] ?? `열 ${column + 1}`),
    alignments: Array.from({ length: columns }, (_, column) =>
      tableEditorState.alignments[column] ?? 'none'),
    rows: Array.from({ length: rowCount }, (_, row) =>
      Array.from({ length: columns }, (_, column) => tableEditorState.rows[row]?.[column] ?? '')),
  };

  tableGridEditor.replaceChildren();
  tableGridEditor.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  tableGridEditor.style.minWidth = `${columns * 170}px`;
  for (let column = 0; column < columns; column += 1) {
    const header = document.createElement('div');
    header.className = 'table-column-header';
    const input = document.createElement('input');
    input.value = tableEditorState.headers[column];
    input.dataset.tableHeader = String(column);
    input.setAttribute('aria-label', `${column + 1}열 제목`);
    const alignment = document.createElement('select');
    alignment.dataset.tableAlignment = String(column);
    alignment.setAttribute('aria-label', `${column + 1}열 정렬`);
    for (const [value, label] of [
      ['none', '기본 정렬'], ['left', '왼쪽 정렬'], ['center', '가운데 정렬'], ['right', '오른쪽 정렬'],
    ] as Array<[TableAlignment, string]>) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = tableEditorState.alignments[column] === value;
      alignment.append(option);
    }
    header.append(input, alignment);
    tableGridEditor.append(header);
  }
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const input = document.createElement('input');
      input.className = 'table-cell-input';
      input.value = tableEditorState.rows[row][column];
      input.dataset.tableRow = String(row);
      input.dataset.tableColumn = String(column);
      input.setAttribute('aria-label', `${row + 1}행 ${column + 1}열`);
      tableGridEditor.append(input);
    }
  }
}

function tableFromTabSeparatedSelection(value: string): TableEditorState | null {
  if (!value.includes('\t')) return null;
  const lines = value.replace(/\r\n|\r/g, '\n').split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  const cells = lines.map((line) => line.split('\t'));
  const columns = Math.min(12, Math.max(...cells.map((row) => row.length)));
  return {
    headers: Array.from({ length: columns }, (_, column) => cells[0][column] ?? ''),
    rows: cells.slice(1, 31).map((row) =>
      Array.from({ length: columns }, (_, column) => row[column] ?? '')),
    alignments: Array(columns).fill('none') as TableAlignment[],
  };
}

function blockAffixes(range: monaco.Range, eol: string) {
  if (!model) return { prefix: '', suffix: '' };
  const start = model.getOffsetAt(range.getStartPosition());
  const end = model.getOffsetAt(range.getEndPosition());
  const before = model.getValue().slice(0, start);
  const after = model.getValue().slice(end);
  const prefix = !before || /(?:\r\n|\r|\n){2}$/.test(before)
    ? ''
    : /(?:\r\n|\r|\n)$/.test(before) ? eol : eol + eol;
  const suffix = !after || /^(?:\r\n|\r|\n){2}/.test(after)
    ? ''
    : /^(?:\r\n|\r|\n)/.test(after) ? eol : eol + eol;
  return { prefix, suffix };
}

function openTableDialog() {
  if (!model || surface !== 'editor') return;
  pendingTableSelection = editor.getSelection();
  const selected = pendingTableSelection ? model.getValueInRange(pendingTableSelection) : '';
  tableEditorState = tableFromTabSeparatedSelection(selected) ?? {
    headers: ['열 1', '열 2', '열 3'],
    rows: [['', '', ''], ['', '', '']],
    alignments: ['none', 'none', 'none'],
  };
  tableColumnsInput.value = String(tableEditorState.headers.length);
  tableRowsInput.value = String(tableEditorState.rows.length);
  renderTableEditor();
  tableDialog.showModal();
  tableGridEditor.querySelector<HTMLInputElement>('[data-table-header]')?.select();
}

function insertTableFromDialog() {
  if (!model || !pendingTableSelection) return;
  tableEditorState = readTableEditorState();
  const eol = preferredEol(model.getValue());
  const table = createMarkdownTable(tableEditorState, eol);
  const range = monaco.Range.lift(pendingTableSelection);
  const { prefix, suffix } = blockAffixes(range, eol);
  const text = prefix + table + suffix;
  const startOffset = model.getOffsetAt(range.getStartPosition());
  editor.executeEdits('insert-table', [{ range, text, forceMoveMarkers: true }]);
  const firstHeaderOffset = startOffset + prefix.length + 2;
  const firstHeaderEnd = firstHeaderOffset + tableEditorState.headers[0].length;
  editor.setSelection(monaco.Selection.fromPositions(
    model.getPositionAt(firstHeaderOffset),
    model.getPositionAt(firstHeaderEnd),
  ));
  editor.focus();
}

function openLinkDialog() {
  if (!model || surface !== 'editor') return;
  pendingLinkSelection = editor.getSelection();
  const selected = pendingLinkSelection ? model.getValueInRange(pendingLinkSelection) : '';
  const selectedUrl = safeExternalUrl(selected);
  linkLabelInput.value = selected.replace(/\r\n|\r|\n/g, ' ');
  linkDestinationInput.value = selectedUrl ?? '';
  linkTitleInput.value = '';
  linkError.hidden = true;
  linkDialog.showModal();
  (selectedUrl ? linkLabelInput : linkDestinationInput).focus();
}

function insertLinkMarkdown(label: string, destination: string, title: string, selection: monaco.Selection) {
  if (!model) return;
  const markdown = createMarkdownLink(label, destination, title);
  const range = monaco.Range.lift(selection);
  const startOffset = model.getOffsetAt(range.getStartPosition());
  editor.executeEdits('insert-link', [{ range, text: markdown, forceMoveMarkers: true }]);
  if (!label) {
    const labelStart = startOffset + 1;
    editor.setSelection(monaco.Selection.fromPositions(
      model.getPositionAt(labelStart),
      model.getPositionAt(labelStart + destination.trim().length),
    ));
  } else {
    editor.setPosition(model.getPositionAt(startOffset + markdown.length));
  }
  editor.focus();
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
  const selection = editor.getSelection();
  const pastedUrl = safeExternalUrl(event.clipboardData?.getData('text/plain'));
  if (selection && !selection.isEmpty() && pastedUrl && model) {
    event.preventDefault();
    event.stopPropagation();
    insertLinkMarkdown(model.getValueInRange(selection), pastedUrl, '', selection);
    return;
  }
  const remoteUrl = remoteImageUrlFromClipboard(event);
  if (!remoteUrl && !clipboardContainsStoredImage(event)) return;
  event.preventDefault();
  event.stopPropagation();
  void pasteClipboardImage(remoteUrl);
}, { capture: true });

document.querySelector('.insert-table-button')?.addEventListener('click', openTableDialog);
document.querySelector('.insert-link-button')?.addEventListener('click', openLinkDialog);

for (const input of [tableColumnsInput, tableRowsInput]) {
  input.addEventListener('change', () => {
    tableEditorState = readTableEditorState();
    renderTableEditor();
  });
}

document.querySelector('.table-submit')?.addEventListener('click', () => {
  insertTableFromDialog();
  tableDialog.close();
});
tableForm.addEventListener('submit', (event) => event.preventDefault());
tableForm.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  event.preventDefault();
  if (!tableGridEditor.contains(target)) {
    target.blur();
    return;
  }
  const cells = Array.from(tableGridEditor.querySelectorAll<HTMLInputElement>('input'));
  const current = cells.indexOf(target);
  const next = cells[current + (event.shiftKey ? -1 : 1)];
  if (next) {
    next.focus();
    next.select();
  }
});
tableDialog.querySelectorAll('.dialog-close, .table-cancel').forEach((button) => {
  button.addEventListener('click', () => tableDialog.close());
});
tableDialog.addEventListener('close', () => {
  pendingTableSelection = null;
  editor.focus();
});

linkForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!pendingLinkSelection) return;
  try {
    insertLinkMarkdown(
      linkLabelInput.value,
      linkDestinationInput.value,
      linkTitleInput.value,
      pendingLinkSelection,
    );
    linkDialog.close();
  } catch (error) {
    linkError.textContent = error instanceof Error ? error.message : String(error);
    linkError.hidden = false;
  }
});
linkDialog.querySelectorAll('.dialog-close, .link-cancel').forEach((button) => {
  button.addEventListener('click', () => linkDialog.close());
});
linkDialog.addEventListener('close', () => {
  pendingLinkSelection = null;
  editor.focus();
});
document.querySelector('.pick-link-file')?.addEventListener('click', async () => {
  if (!currentDocument) return;
  linkError.hidden = true;
  if (currentDocument.isUntitled) {
    const saved = await save(false);
    if (!saved || !currentDocument || currentDocument.isUntitled) {
      linkError.textContent = '로컬 파일의 상대 경로를 만들려면 문서를 먼저 저장해야 합니다.';
      linkError.hidden = false;
      return;
    }
  }
  const result = await window.marktex.pickLinkTarget(currentDocument.path);
  if (result.canceled || !result.destination) return;
  linkDestinationInput.value = result.destination;
  if (!linkLabelInput.value && result.label) linkLabelInput.value = result.label;
  linkTitleInput.focus();
});

editor.addAction({
  id: 'setdown.insertLink',
  label: '링크 삽입',
  keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
  contextMenuGroupId: '1_modification',
  run: openLinkDialog,
});

editor.addAction({
  id: 'setdown.insertTable',
  label: '표 삽입',
  contextMenuGroupId: '1_modification',
  run: openTableDialog,
});

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
tocToggle.addEventListener('click', () => {
  readerPreferences.tocOpen = !readerPreferences.tocOpen;
  saveReaderPreferences();
  syncReaderUi();
  // iframe은 reader-body의 실제 flex child이므로 이 변경과 같은 layout에 참여한다.
  syncPreviewView();
  if (readerPreferences.tocOpen && activeTabId) {
    sendPreviewCommand(activeTabId, { command: 'marktex:collect-headings' });
  }
});
const applicationMenuCache = new Map<string, ApplicationMenuEntry[]>();
let openApplicationMenuId: string | null = null;
let applicationMenuRequest = 0;

function closeApplicationMenu() {
  openApplicationMenuId = null;
  applicationMenuPopup.hidden = true;
  applicationMenuPopup.replaceChildren();
  applicationMenu.querySelectorAll('button').forEach((button) => {
    button.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
  });
}

function displayAccelerator(value: string | undefined) {
  if (!value) return '';
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return value
    .replace(/CmdOrCtrl/g, isMac ? '⌘' : 'Ctrl')
    .replace(/CommandOrControl/g, isMac ? '⌘' : 'Ctrl')
    .replace(/\+Plus$/, '++');
}

function menuEntryList(entries: ApplicationMenuEntry[], nested = false): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = nested ? 'product-submenu' : 'product-menu-root';
  list.setAttribute('role', 'menu');
  for (const entry of entries) {
    const row = document.createElement('li');
    row.setAttribute('role', 'none');
    if (entry.type === 'separator') {
      row.className = 'product-menu-separator';
      row.setAttribute('aria-hidden', 'true');
      list.append(row);
      continue;
    }
    row.className = 'product-menu-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.menuItemId = entry.id;
    button.disabled = !entry.enabled;
    button.setAttribute('role', entry.type === 'radio' ? 'menuitemradio' : 'menuitem');
    if (entry.type === 'radio') button.setAttribute('aria-checked', String(entry.checked));

    const marker = document.createElement('span');
    marker.className = 'product-menu-marker';
    marker.textContent = entry.type === 'radio' && entry.checked ? '•' : '';
    const label = document.createElement('span');
    label.className = 'product-menu-label';
    label.textContent = entry.label;
    const accelerator = document.createElement('span');
    accelerator.className = 'product-menu-accelerator';
    accelerator.textContent = displayAccelerator(entry.accelerator);
    const arrow = document.createElement('span');
    arrow.className = 'product-menu-arrow';
    arrow.textContent = entry.submenu?.length ? '›' : '';
    button.append(marker, label, accelerator, arrow);
    row.append(button);
    if (entry.submenu?.length) {
      row.classList.add('has-submenu');
      row.append(menuEntryList(entry.submenu, true));
      button.addEventListener('click', () => row.classList.toggle('is-submenu-open'));
    } else {
      button.addEventListener('click', () => {
        window.marktex.executeApplicationMenuItem(entry.id);
        closeApplicationMenu();
      });
    }
    list.append(row);
  }
  return list;
}

async function loadApplicationMenu(menuId: string) {
  const entries = await window.marktex.getApplicationMenu(menuId);
  applicationMenuCache.set(menuId, entries);
  return entries;
}

function showApplicationMenu(button: HTMLButtonElement, entries: ApplicationMenuEntry[]) {
  const menuId = button.dataset.menuId!;
  const bounds = button.getBoundingClientRect();
  openApplicationMenuId = menuId;
  applicationMenuPopup.replaceChildren(menuEntryList(entries));
  const menuWidth = 286;
  const left = Math.min(bounds.left, Math.max(6, window.innerWidth - menuWidth - 6));
  applicationMenuPopup.style.left = `${Math.round(left)}px`;
  applicationMenuPopup.style.top = `${Math.round(bounds.bottom + 2)}px`;
  applicationMenuPopup.hidden = false;
  applicationMenu.querySelectorAll('button').forEach((candidate) => {
    const isOpen = candidate === button;
    candidate.classList.toggle('is-open', isOpen);
    candidate.setAttribute('aria-expanded', String(isOpen));
  });
}

async function openApplicationMenu(button: HTMLButtonElement) {
  const menuId = button.dataset.menuId!;
  if (openApplicationMenuId === menuId) {
    closeApplicationMenu();
    return;
  }
  const request = ++applicationMenuRequest;
  const cached = applicationMenuCache.get(menuId);
  if (cached) showApplicationMenu(button, cached);
  const entries = await loadApplicationMenu(menuId);
  if (request !== applicationMenuRequest) return;
  showApplicationMenu(button, entries);
}

applicationMenu.querySelectorAll<HTMLButtonElement>('button[data-menu-id]').forEach((button) => {
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  void loadApplicationMenu(button.dataset.menuId!);
});
applicationMenu.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-menu-id]');
  if (button) void openApplicationMenu(button);
});
applicationMenu.addEventListener('pointerover', (event) => {
  if (!openApplicationMenuId) return;
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-menu-id]');
  if (button && button.dataset.menuId !== openApplicationMenuId) void openApplicationMenu(button);
});
document.addEventListener('pointerdown', (event) => {
  const target = event.target as Node;
  if (!applicationMenu.contains(target) && !applicationMenuPopup.contains(target)) {
    closeApplicationMenu();
  }
});
applicationMenuPopup.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeApplicationMenu();
  }
});
findInput.addEventListener('input', () => runPreviewFind('forward', false));
findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    runPreviewFind(event.shiftKey ? 'backward' : 'forward', true);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closePreviewFind(false);
  }
});
previewSearch.querySelector('.find-previous')?.addEventListener(
  'click',
  () => runPreviewFind('backward', true),
);
previewSearch.querySelector('.find-next')?.addEventListener(
  'click',
  () => runPreviewFind('forward', true),
);
previewSearch.querySelector('.find-close')?.addEventListener(
  'click',
  () => closePreviewFind(false),
);
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
  sendPreviewCommand(pendingTabId, {
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

function handlePreviewMessage(payload: { tabId: string; message: Record<string, unknown> }) {
  for (const listener of previewMessageListeners) listener(payload);
  if (payload.tabId !== activeTabId || payload.message.source !== 'crossnote') return;
  const message = payload.message;
  if (message.type === 'marktex:headings') {
    if (message.revision !== revision || !Array.isArray(message.headings)) return;
    const tab = activeTab();
    if (!tab) return;
    tab.headings = message.headings.slice(0, 500).flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return [];
      const heading = candidate as Record<string, unknown>;
      const level = Number(heading.level);
      if (
        typeof heading.id !== 'string'
        || typeof heading.text !== 'string'
        || !Number.isInteger(level)
        || level < 1
        || level > 6
      ) return [];
      return [{
        id: heading.id.slice(0, 512),
        text: heading.text.slice(0, 500),
        level: level as PreviewHeading['level'],
        sourceLine: Number.isFinite(Number(heading.sourceLine))
          ? Number(heading.sourceLine)
          : undefined,
      }];
    });
    renderToc(tab);
    return;
  }
  if (message.type === 'marktex:active-heading') {
    if (message.revision !== revision) return;
    const tab = activeTab();
    if (!tab) return;
    tab.activeHeadingId = typeof message.id === 'string' ? message.id : null;
    renderToc(tab);
    return;
  }
  if (message.type === 'marktex:find-result') {
    if (message.revision !== revision) return;
    const tab = activeTab();
    if (!tab) return;
    tab.find.activeMatch = Math.max(0, Number(message.activeMatch) || 0);
    tab.find.matches = Math.max(0, Number(message.matches) || 0);
    syncReaderUi();
    return;
  }
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
}

window.addEventListener('message', (event) => {
  const found = Array.from(previewFrameByTab.entries()).find(([, frame]) =>
    frame.element.contentWindow === event.source,
  );
  if (!found) return;
  const [tabId, frame] = found;
  if (frame.origin && event.origin !== frame.origin) return;
  if (!event.data || typeof event.data !== 'object') return;
  const message = event.data as Record<string, unknown>;
  if (message.source !== 'crossnote') return;
  if (message.type === 'marktex:ready') {
    frame.ready = true;
    frame.settleLoad?.();
    for (const pending of frame.pendingCommands.splice(0)) {
      frame.element.contentWindow?.postMessage(pending, frame.origin ?? '*');
    }
    if (currentPreviewThemeAssets?.themeId === readerPreferences.themeId) {
      frame.element.contentWindow?.postMessage({
        command: 'marktex:apply-theme',
        ...currentPreviewThemeAssets,
      }, frame.origin ?? '*');
    }
    return;
  }
  if (message.type === 'marktex:open-find') {
    if (tabId === activeTabId && surface === 'viewer') openPreviewFind();
    return;
  }
  handlePreviewMessage({ tabId, message });
});

window.marktex.onDocumentOpened((opened) => void showDocument(opened));
window.marktex.onExternalChange((change) => {
  if (currentDocument?.path === change.path) notice.hidden = false;
});
window.marktex.onThemeChanged((snapshot) => void applyProductTheme(snapshot));
window.marktex.onCommand((command) => {
  if (command === 'new-document') void newDocument();
  if (command === 'save') void save(false);
  if (command === 'save-as') void save(true);
  if (command === 'export-pdf') void exportPdf();
  if (command === 'close-tab' && activeTabId) void closeTab(activeTabId);
  if (command === 'next-tab') cycleTab(1);
  if (command === 'previous-tab') cycleTab(-1);
  if (command === 'insert-table') openTableDialog();
  if (command === 'insert-link') openLinkDialog();
  if (command === 'open-find') openPreviewFind();
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
  if (event.key === 'Escape' && openApplicationMenuId) {
    event.preventDefault();
    event.stopPropagation();
    closeApplicationMenu();
    return;
  }
  if (event.key === 'Escape' && draggedTabId) tabDragCanceled = true;
  if (
    surface === 'viewer'
    && event.key.toLowerCase() === 'f'
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
  ) {
    event.preventDefault();
    openPreviewFind();
  }
}, { capture: true });

async function initializeRenderer() {
  const snapshot = await window.marktex.getTheme();
  await applyProductTheme(snapshot, true);
  const documentSnapshot = await window.marktex.getDocument();
  if (documentSnapshot) void showDocument(documentSnapshot);
  else if (tabs.length === 0) {
    setSurface('empty');
    renderTabs();
  }
}

void initializeRenderer();
