import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
  utilityProcess,
  WebContentsView,
} from 'electron';
import type { MenuItem } from 'electron';
import {
  promises as fs,
  readFileSync,
  realpathSync,
  statSync,
  watchFile,
  unwatchFile,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  ApplicationMenuEntry,
  AppCommand,
  CloseDecision,
  DiskVersion,
  DocumentSnapshot,
  RenderResult,
  SaveResult,
  ExportPdfResult,
  PasteImageResult,
  PickLinkTargetResult,
  TabStateSummary,
  ThemeSnapshot,
  TransferableTab,
} from '../shared/contracts';
import {
  DEFAULT_PREVIEW_THEME,
  codeThemeFile,
  normalizePreviewTheme,
  PREVIEW_THEMES,
  previewThemeBackground,
  previewThemeFile,
  type PreviewThemeId,
} from '../shared/preview-preferences';
import { themeProfile } from '../shared/theme-catalog';
import { applyTextRevision, isDirty, lineCount } from '../shared/document-state';
import type { BandLine } from '../shared/viewport-anchor';
import type { PreviewBlockPatch } from '../shared/preview-blocks';
import { installSourceAnchors, type MarkdownItLike } from './source-anchors';
import {
  isSupportedImagePath,
  savePastedImageFile,
  savePastedPng,
} from './pasted-image';
import { previewRelativeReference } from './preview-resources';
import { discardDraftBundle, saveDraftBundle } from './draft-assets';
import { markdownDestinationForFile } from './markdown-link';

app.setName('Setdown');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'marktex-resource',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: 'marktex-preview',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
let currentDocument: DocumentSnapshot | null = null;
let activeRoot: string | null = null;
let untitledSequence = 0;

type WindowState = {
  window: BrowserWindow;
  currentDocument: DocumentSnapshot | null;
  activeRoot: string | null;
  watchedPath: string | null;
  closeAfterConfirmation: boolean;
  rendererTabs: TabStateSummary[];
};

type PendingTabTransfer = {
  sourceWebContentsId: number;
  tab: TransferableTab;
  claimedByWebContentsId: number | null;
  expiresAt: number;
  detachPosition: { x: number; y: number } | null;
  previewAdopted: boolean;
  preparedWindow: BrowserWindow | null;
  previewScrollPosition: Promise<{ x: number; y: number }>;
  /** dragstart 순간 source Viewer에 보이던 띠. 무게중심 정렬의 재료다. */
  previewBand: Promise<BandLine[]>;
  /** 탭을 내보낸 창의 content 크기. 목적지와 같으면 조판이 그대로다. */
  sourceContentSize: { width: number; height: number } | null;
};

const windowStates = new Map<number, WindowState>();
const pendingTabTransfers = new Map<string, PendingTabTransfer>();
type PreviewViewState = {
  view: WebContentsView;
  ownerWebContentsId: number;
  pendingScrollPosition: { x: number; y: number } | null;
  pendingScrollRatio: number | null;
  /** 마지막으로 실제 적용한 bounds. 같은 값을 다시 밀지 않는다. */
  appliedBounds: Electron.Rectangle | null;
};
const previewViews = new Map<string, PreviewViewState>();
const previewUpdateWaiters = new Map<string, () => void>();

/**
 * 부팅만 끝내 둔 예비 Preview.
 *
 * 새 WebContentsView의 첫 `loadURL`은 crossnote 런타임, KaTeX·Font Awesome
 * stylesheet, bridge script를 처음부터 올린다. 측정으로 이 고정 비용이 문서
 * 내용과 무관하게 약 860ms였다. 탭마다 새로 내는 대신, 본문이 빈 template을
 * 미리 한 장 띄워 두고 새 탭에 넘긴다. 넘겨받은 view는 이미
 * `marktex-preview://` 문서를 띄우고 있으므로 `preview:load`가 `loadURL`이
 * 아니라 `marktex:update-html`로 내용만 갈아끼운다.
 */
type SparePreview = { view: WebContentsView; ready: boolean };
const sparePreviews = new Map<number, SparePreview>();
/** 마지막 render의 template에서 본문만 비운 것. 자산은 그대로 남는다. */
let warmupPreviewUrl: string | null = null;

function rememberWarmupTemplate(template: string) {
  const blank = template.replace(/(<body\b[^>]*\bdata-html=")[^"]*(")/i, '$1$2');
  if (blank === template) return;
  const token = `warmup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  previewDocuments.set(token, blank);
  warmupPreviewUrl = `marktex-preview://document/${token}`;
}

/**
 * 목적지 창이 원래 창과 같은 content 크기인가. 같으면 조판이 그대로이므로
 * Preview의 scroll을 손대지 않는다.
 */
function transferKeepsGeometry(
  transfer: PendingTabTransfer,
  destinationWebContentsId: number,
): boolean {
  const source = transfer.sourceContentSize;
  const destination = sourceContentSize(destinationWebContentsId);
  return !!source && !!destination
    && source.width === destination.width
    && source.height === destination.height;
}

/** 탭을 내보내는 창의 content 크기. 분리된 창을 같은 크기로 열기 위한 값이다. */
function sourceContentSize(ownerWebContentsId: number): { width: number; height: number } | null {
  const owner = stateForWebContentsId(ownerWebContentsId)?.window;
  if (!owner || owner.isDestroyed()) return null;
  const [width, height] = owner.getContentSize();
  return width > 0 && height > 0 ? { width, height } : null;
}

function createPreviewView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preview-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  view.setBackgroundColor(previewThemeBackground(globalPreviewTheme));
  view.setVisible(false);
  return view;
}

function ensureSparePreview(ownerWebContentsId: number) {
  if (sparePreviews.has(ownerWebContentsId) || !warmupPreviewUrl) return;
  const owner = stateForWebContentsId(ownerWebContentsId)?.window;
  if (!owner || owner.isDestroyed()) return;
  const view = createPreviewView();
  owner.contentView.addChildView(view);
  const spare: SparePreview = { view, ready: false };
  sparePreviews.set(ownerWebContentsId, spare);
  view.webContents.loadURL(warmupPreviewUrl).then(() => {
    if (sparePreviews.get(ownerWebContentsId) === spare) spare.ready = true;
  }).catch(() => {
    if (sparePreviews.get(ownerWebContentsId) === spare) {
      sparePreviews.delete(ownerWebContentsId);
    }
    if (!view.webContents.isDestroyed()) view.webContents.close();
  });
}

/** 부팅이 끝난 예비 view를 꺼낸다. 준비 전이면 쓰지 않는다. */
function takeSparePreview(ownerWebContentsId: number): WebContentsView | null {
  const spare = sparePreviews.get(ownerWebContentsId);
  if (!spare?.ready || spare.view.webContents.isDestroyed()) return null;
  sparePreviews.delete(ownerWebContentsId);
  return spare.view;
}

function discardSparePreview(ownerWebContentsId: number) {
  const spare = sparePreviews.get(ownerWebContentsId);
  if (!spare) return;
  sparePreviews.delete(ownerWebContentsId);
  if (!spare.view.webContents.isDestroyed()) spare.view.webContents.close();
}

/**
 * 값이 달라졌을 때만 bounds를 민다.
 *
 * drag resize 동안 renderer의 ResizeObserver가 `preview:show`를 초당 수십 번
 * 두드린다. 같은 bounds를 반복해서 적용하고 view를 숨겼다 다시 붙이면
 * compositor가 surface를 놓쳐 빈 화면이 남는다.
 */
function applyPreviewBounds(preview: PreviewViewState, bounds: Electron.Rectangle) {
  const applied = preview.appliedBounds;
  if (
    applied
    && applied.x === bounds.x
    && applied.y === bounds.y
    && applied.width === bounds.width
    && applied.height === bounds.height
  ) return;
  preview.appliedBounds = bounds;
  preview.view.setBounds(bounds);
}

function restorePendingPreviewScroll(preview: PreviewViewState) {
  const owner = stateForWebContentsId(preview.ownerWebContentsId)?.window;
  const scroll = preview.pendingScrollPosition;
  if (!owner?.isVisible() || !scroll || !preview.view.getVisible()) return;
  preview.pendingScrollPosition = null;
  const ratio = preview.pendingScrollRatio;
  preview.pendingScrollRatio = null;
  void preview.view.webContents.executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      const ratioY = Number.isFinite(${JSON.stringify(ratio)})
        ? maximum * ${JSON.stringify(ratio)}
        : 0;
      window.scrollTo(${JSON.stringify(scroll.x)}, Math.max(${JSON.stringify(scroll.y)}, ratioY));
      window.__setdownTransferScroll = {
        ...(window.__setdownTransferScroll || {}),
        restoredX: window.scrollX,
        restoredY: window.scrollY,
      };
      resolve();
    }));
  })`);
}
let selectedState: WindowState | null = null;
let stateQueue: Promise<unknown> = Promise.resolve();

function stateForWebContentsId(id: number) {
  return windowStates.get(id) ?? null;
}

function stateForWindow(window: BrowserWindow | null) {
  return window ? stateForWebContentsId(window.webContents.id) : null;
}

function focusedState() {
  return stateForWindow(BrowserWindow.getFocusedWindow())
    ?? stateForWindow(mainWindow)
    ?? windowStates.values().next().value
    ?? null;
}

function selectWindowState(state: WindowState) {
  selectedState = state;
  mainWindow = state.window;
  currentDocument = state.currentDocument;
  activeRoot = state.activeRoot;
}

function persistWindowState(state: WindowState) {
  state.currentDocument = currentDocument;
  state.activeRoot = activeRoot;
}

function withWindowState<T>(state: WindowState, action: () => Promise<T> | T): Promise<T> {
  const scheduled = stateQueue.then(async () => {
    selectWindowState(state);
    try {
      return await action();
    } finally {
      persistWindowState(state);
    }
  });
  stateQueue = scheduled.catch(() => undefined);
  return scheduled;
}

const previewDocuments = new Map<string, string>();
let globalPreviewTheme: PreviewThemeId = DEFAULT_PREVIEW_THEME;
let globalThemeRevision = 0;

const crossnoteEntry = require.resolve('crossnote');
const crossnoteOut = path.resolve(path.dirname(crossnoteEntry), '..');

function snapshotStats(filePath: string): DiskVersion {
  const stat = statSync(filePath);
  return { mtimeMs: stat.mtimeMs, size: stat.size };
}

function isSameDiskVersion(a: DiskVersion, b: DiskVersion): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalPath(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function assertReadablePath(candidate: string): string {
  const resolved = canonicalPath(candidate);
  const roots = [
    crossnoteOut,
    activeRoot,
    ...Array.from(windowStates.values(), (state) => state.activeRoot),
  ].filter((root): root is string => !!root);
  if (!roots.some((root) => isInside(canonicalPath(root), resolved))) {
    throw new Error('The preview attempted to read outside the document folder.');
  }
  return resolved;
}

/**
 * 경로를 URL의 path로 그대로 실어 보낸다. 경로를 통째로 encoding하면 URL에
 * segment가 하나뿐이라, stylesheet 안의 상대 참조(KaTeX의 `fonts/...`,
 * Font Awesome의 `../webfonts/...`)가 엉뚱한 곳을 가리켜 web font가 전부
 * 로드에 실패한다. file:// URL을 거쳐 platform별 구분자와 특수문자만 표준
 * 방식으로 encoding한다.
 */
function resourceUrl(filePath: string): string {
  const { pathname } = pathToFileURL(path.resolve(filePath));
  // path.resolve는 끝의 구분자를 지운다. `<base href>`는 그 구분자가 있어야
  // 상대 참조가 문서 폴더 안에서 풀리므로 되살린다.
  const trailingSeparator = /[\\/]$/.test(filePath) ? '/' : '';
  return `marktex-resource://file${pathname}${trailingSeparator}`;
}

function previewThemeAssets(requestedTheme: unknown) {
  const themeId = normalizePreviewTheme(requestedTheme);
  return {
    themeId,
    backgroundColor: previewThemeBackground(themeId),
    // 제품 테마는 문서 자산이 아니다. activeRoot에 따라 상대 경로로 만들면
    // 창 transfer 중 다른 window state가 선택된 순간 bridge allowlist를
    // 통과하지 못한다. 항상 명시적인 app-local protocol URL을 사용한다.
    previewCssUrl: resourceUrl(path.resolve(
      crossnoteOut,
      'styles',
      'preview_theme',
      previewThemeFile(themeId),
    )),
    codeCssUrl: resourceUrl(path.resolve(
      crossnoteOut,
      'styles',
      'prism_theme',
      codeThemeFile(themeId),
    )),
  };
}

function pathFromResourceUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'marktex-resource:') return null;
    return fileURLToPath(`file://${url.pathname}`);
  } catch {
    return null;
  }
}

/**
 * 조판은 utility process에서 돈다. 메인은 요청과 결과 보관만 한다.
 *
 * 조판이 메인에서 돌면 수식 문서에서 한 번에 500ms 넘게 프로세스를 멈추고,
 * 타자마다 오는 IPC가 그 뒤에 줄을 선다. 여기서는 기다리기만 하므로 메인이
 * 계속 응답한다.
 */
type RenderWorkerResult = {
  totalLineCount: number;
  baseHref: string;
  themeId: PreviewThemeId;
  template?: string;
  html?: string;
  patch?: PreviewBlockPatch | null;
};

let renderWorker: Electron.UtilityProcess | null = null;
let renderRequestId = 0;
const renderWaiters = new Map<number, {
  resolve: (value: RenderWorkerResult) => void;
  reject: (error: Error) => void;
}>();

function ensureRenderWorker(): Electron.UtilityProcess {
  if (renderWorker) return renderWorker;
  const worker = utilityProcess.fork(path.join(__dirname, 'render-worker.cjs'));
  renderWorker = worker;
  worker.on('message', (reply: {
    kind?: string; id?: number; ok?: boolean; message?: string;
  } & Partial<RenderWorkerResult>) => {
    if (reply?.kind !== 'render' || typeof reply.id !== 'number') return;
    const waiter = renderWaiters.get(reply.id);
    if (!waiter) return;
    renderWaiters.delete(reply.id);
    if (reply.ok) {
      waiter.resolve({
        totalLineCount: Math.max(1, Number(reply.totalLineCount) || 1),
        baseHref: String(reply.baseHref ?? ''),
        themeId: normalizePreviewTheme(reply.themeId),
        template: reply.template,
        html: reply.html,
        patch: reply.patch,
      });
    } else {
      waiter.reject(new Error(String(reply.message ?? 'The preview renderer failed.')));
    }
  });
  worker.on('exit', () => {
    if (renderWorker === worker) renderWorker = null;
    for (const waiter of renderWaiters.values()) {
      waiter.reject(new Error('The preview renderer stopped.'));
    }
    renderWaiters.clear();
  });
  return worker;
}

/** 조판이 읽어도 되는 디렉터리. 보안 경계를 요청마다 함께 보낸다. */
function readableRoots(): string[] {
  return [activeRoot, ...Array.from(windowStates.values(), (state) => state.activeRoot)]
    .filter((root): root is string => !!root);
}

function forgetWorkerNotebooks() {
  renderWorker?.postMessage({ kind: 'forget-notebooks' });
}

function callRenderWorker(
  tabId: string,
  text: string,
  revision: number,
  documentPath: string,
  themeId: PreviewThemeId,
  hasPage: boolean,
): Promise<RenderWorkerResult> {
  const worker = ensureRenderWorker();
  const id = ++renderRequestId;
  return new Promise<RenderWorkerResult>((resolve, reject) => {
    renderWaiters.set(id, { resolve, reject });
    worker.postMessage({
      kind: 'render', id, tabId, text, revision, documentPath, themeId,
      roots: readableRoots(), hasPage,
    });
  });
}

/**
 * 조판하고 그 결과를 Preview에 설치한다. 한 번의 요청으로 끝난다.
 *
 * 예전에는 렌더러가 조판을 요청해 1.4MB를 받고, 그것을 그대로 메인으로 돌려
 * 보내 설치했다. 렌더러는 내용을 읽지도 않으면서 프로세스 경계를 네 번 더
 * 넘겼다. 이제 조판·분할·비교는 워커가, 설치는 메인이 하고 렌더러는 결과만
 * 받는다.
 */
/** PDF 내보내기처럼 Preview view 없이 완성된 페이지가 필요할 때. */
async function renderExportTemplate(
  text: string,
  revision: number,
  documentPath: string,
): Promise<{ url: string }> {
  const exportTabId = `export:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  activeRoot = path.dirname(documentPath);
  const rendered = await callRenderWorker(
    exportTabId, text, revision, documentPath, globalPreviewTheme, false,
  );
  renderWorker?.postMessage({ kind: 'forget-tab', tabId: exportTabId });
  if (typeof rendered.template !== 'string') {
    throw new Error('The preview renderer did not return a page.');
  }
  const token = `${Date.now()}-${revision}-${Math.random().toString(36).slice(2)}`;
  previewDocuments.set(token, rendered.template);
  return { url: `marktex-preview://document/${token}` };
}

async function preparePreview(
  tabId: string,
  text: string,
  revision: number,
  documentPath: string,
  requestedTheme: PreviewThemeId,
  senderId: number,
): Promise<RenderResult> {
  const preview = previewViews.get(tabId);
  if (!preview || preview.ownerWebContentsId !== senderId) {
    throw new Error('The preview is not owned by this window.');
  }
  if (!currentDocument) throw new Error('No Markdown document is open.');
  if (currentDocument.path !== documentPath) {
    throw new Error('The preview request belongs to a document that is no longer open.');
  }
  currentDocument = applyTextRevision(currentDocument, text, revision);
  const renderPath = currentDocument.path;
  const themeId = normalizePreviewTheme(requestedTheme);
  activeRoot = path.dirname(renderPath);

  const hasPage = preview.view.webContents.getURL()
    .startsWith('marktex-preview://document/');
  const rendered = await callRenderWorker(
    tabId, text, revision, renderPath, themeId, hasPage,
  );
  if (currentDocument?.path !== renderPath) {
    throw new Error('The document changed while its preview was being prepared.');
  }
  preview.view.setBackgroundColor(previewThemeBackground(themeId));

  // 첫 로드: 완성된 페이지를 실는다.
  if (typeof rendered.template === 'string') {
    const token = `${Date.now()}-${revision}-${Math.random().toString(36).slice(2)}`;
    previewDocuments.set(token, rendered.template);
    rememberWarmupTemplate(rendered.template);
    while (previewDocuments.size > 64) {
      const oldest = previewDocuments.keys().next().value as string | undefined;
      if (!oldest) break;
      previewDocuments.delete(oldest);
    }
    const url = `marktex-preview://document/${token}`;
    await preview.view.webContents.loadURL(url);
    setImmediate(() => ensureSparePreview(senderId));
    return { revision, url, themeId };
  }

  const waitForPreview = () => {
    const waiterKey = `${tabId}:${revision}`;
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        previewUpdateWaiters.delete(waiterKey);
        resolve();
      }, 5000);
      previewUpdateWaiters.set(waiterKey, () => {
        clearTimeout(timeout);
        previewUpdateWaiters.delete(waiterKey);
        resolve();
      });
    });
  };
  const shared = {
    totalLineCount: rendered.totalLineCount,
    revision,
    baseHref: rendered.baseHref,
  };

  // 페이지는 있으나 블록 기록이 없다. 예비 view를 넘겨받은 경우다.
  //
  // 이때는 navigate하지 않으므로 새 url이 없다. 그래도 렌더러에는 지금 이
  // view가 띄우고 있는 url을 돌려줘야 한다. `tab.previewUrl`이 비어 있으면
  // `syncPreviewView`가 "보여 줄 Preview가 없다"고 보아 탭이 빈 채로 남는다.
  if (typeof rendered.html === 'string') {
    const updated = waitForPreview();
    preview.view.webContents.send('preview:command', {
      command: 'marktex:update-html', html: rendered.html, markdown: text, ...shared,
    });
    await updated;
    setImmediate(() => ensureSparePreview(senderId));
    return { revision, url: preview.view.webContents.getURL(), themeId };
  }

  // 바뀐 것이 없으면 설정만 맞춘다.
  if (!rendered.patch) {
    preview.view.webContents.send('preview:command', {
      command: 'marktex:sync-config', ...shared,
    });
    return { revision, url: preview.view.webContents.getURL(), themeId };
  }

  const updated = waitForPreview();
  preview.view.webContents.send('preview:command', {
    command: 'marktex:patch-blocks', ...rendered.patch, markdown: text, ...shared,
  });
  await updated;
  return { revision, url: preview.view.webContents.getURL(), themeId };
}

async function readDocument(filePath: string): Promise<DocumentSnapshot> {
  const absolute = canonicalPath(filePath);
  const text = await fs.readFile(absolute, 'utf8');
  const diskVersion = snapshotStats(absolute);
  return {
    path: absolute,
    name: path.basename(absolute),
    text,
    revision: 0,
    savedRevision: 0,
    diskVersion,
    isUntitled: false,
  };
}

function blankDocument(): DocumentSnapshot {
  untitledSequence += 1;
  const name = untitledSequence === 1 ? 'Untitled.md' : `Untitled ${untitledSequence}.md`;
  const documentPath = path.join(app.getPath('userData'), 'drafts', randomUUID(), name);
  return {
    // 아직 사용자가 소유할 경로는 정하지 않는다. 이 draft 경로가 저장 전
    // 이미지와 상대 resource의 실제 기준 디렉터리가 된다.
    path: documentPath,
    name: path.basename(documentPath),
    text: '',
    revision: 0,
    savedRevision: 0,
    diskVersion: { mtimeMs: 0, size: 0 },
    isUntitled: true,
  };
}

function stopWatching() {
  const state = selectedState;
  if (!state) return;
  if (state.watchedPath) unwatchFile(state.watchedPath);
  state.watchedPath = null;
}

function watchCurrentDocument() {
  stopWatching();
  const state = selectedState;
  if (!state || !currentDocument || currentDocument.isUntitled) return;
  state.currentDocument = currentDocument;
  state.watchedPath = currentDocument.path;
  const watchedPath = state.watchedPath;
  watchFile(watchedPath, { interval: 750 }, (current) => {
    const watchedDocument = state.currentDocument;
    if (!watchedDocument || watchedDocument.path !== watchedPath) return;
    const next = { mtimeMs: current.mtimeMs, size: current.size };
    if (current.nlink > 0 && !isSameDiskVersion(next, watchedDocument.diskVersion)) {
      state.window.webContents.send('document:external-change', {
        path: watchedDocument.path,
        diskVersion: next,
      });
    }
  });
}

async function openPath(filePath: string, notify = true) {
  currentDocument = await readDocument(filePath);
  forgetWorkerNotebooks();
  activeRoot = path.dirname(currentDocument.path);
  watchCurrentDocument();
  if (notify) mainWindow?.webContents.send('document:opened', currentDocument);
  return currentDocument;
}

async function createNewDocument() {
  stopWatching();
  forgetWorkerNotebooks();
  currentDocument = blankDocument();
  activeRoot = path.dirname(currentDocument.path);
  return currentDocument;
}

async function chooseAndOpen(notify = true) {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'rmd', 'qmd', 'mdx'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return openPath(result.filePaths[0], notify);
}

async function activateDocument(
  document: DocumentSnapshot,
  text: string,
  revision: number,
) {
  stopWatching();
  currentDocument = applyTextRevision(document, text, revision);
  activeRoot = path.dirname(currentDocument.path);
  watchCurrentDocument();
  if (!currentDocument.isUntitled) {
    try {
      const diskVersion = snapshotStats(currentDocument.path);
      if (!isSameDiskVersion(diskVersion, currentDocument.diskVersion)) {
        mainWindow?.webContents.send('document:external-change', {
          path: currentDocument.path,
          diskVersion,
        });
      }
    } catch {
      // 삭제되거나 잠시 접근할 수 없는 파일은 다음 저장/새로고침에서 처리한다.
    }
  }
  return currentDocument;
}

async function confirmOverwriteIfChanged(document = currentDocument): Promise<boolean> {
  if (!document) return false;
  try {
    const actual = snapshotStats(document.path);
    if (isSameDiskVersion(actual, document.diskVersion)) return true;
  } catch {
    return true;
  }
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'warning',
    message: '파일이 다른 프로그램에서 변경되었습니다.',
    detail: '현재 편집 내용을 덮어쓰시겠습니까?',
    buttons: ['취소', '덮어쓰기'],
    defaultId: 0,
    cancelId: 0,
  });
  return result.response === 1;
}

async function atomicWrite(filePath: string, text: string) {
  const stat = await fs.stat(filePath).catch(() => null);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(temporary, text, { encoding: 'utf8', mode: stat?.mode });
  await fs.rename(temporary, filePath);
}

async function saveTo(filePath: string, text: string, revision: number): Promise<SaveResult> {
  await atomicWrite(filePath, text);
  const diskVersion = snapshotStats(filePath);
  currentDocument = {
    path: canonicalPath(filePath),
    name: path.basename(filePath),
    text,
    revision,
    savedRevision: revision,
    diskVersion,
    isUntitled: false,
  };
  activeRoot = path.dirname(currentDocument.path);
  watchCurrentDocument();
  return { canceled: false, document: currentDocument };
}

async function saveDocumentSnapshot(
  document: DocumentSnapshot,
  text: string,
  revision: number,
): Promise<SaveResult> {
  const updated = applyTextRevision(document, text, revision);
  if (updated.isUntitled) {
    const selected = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: path.join(app.getPath('documents'), updated.name),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    const saved = await saveDraftBundle(
      path.join(app.getPath('userData'), 'drafts'),
      updated.path,
      selected.filePath,
      text,
    );
    const absolute = canonicalPath(selected.filePath);
    return {
      canceled: false,
      document: {
        path: absolute,
        name: path.basename(absolute),
        text: saved.text,
        revision,
        savedRevision: revision,
        diskVersion: snapshotStats(absolute),
        isUntitled: false,
      },
    };
  }
  if (!updated.isUntitled && !(await confirmOverwriteIfChanged(updated))) {
    return { canceled: true };
  }
  await fs.mkdir(path.dirname(updated.path), { recursive: true });
  await atomicWrite(updated.path, text);
  const absolute = canonicalPath(updated.path);
  return {
    canceled: false,
    document: {
      path: absolute,
      name: path.basename(absolute),
      text,
      revision,
      savedRevision: revision,
      diskVersion: snapshotStats(absolute),
      isUntitled: false,
    },
  };
}

async function saveDocumentAs(text: string, revision: number): Promise<SaveResult> {
  if (currentDocument?.isUntitled) {
    return saveDocumentSnapshot(currentDocument, text, revision);
  }
  const defaultPath = currentDocument?.isUntitled
    ? path.join(app.getPath('documents'), 'Untitled.md')
    : currentDocument?.path ?? path.join(app.getPath('documents'), 'Untitled.md');
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  forgetWorkerNotebooks();
  return saveTo(result.filePath, text, revision);
}

async function saveCurrentDocument(text: string, revision: number): Promise<SaveResult> {
  if (!currentDocument) return { canceled: true };
  const result = await saveDocumentSnapshot(currentDocument, text, revision);
  if (result.canceled || !result.document) return result;
  currentDocument = result.document;
  activeRoot = path.dirname(currentDocument.path);
  watchCurrentDocument();
  return result;
}

async function pasteClipboardImage(): Promise<PasteImageResult> {
  if (!currentDocument) return { canceled: true };

  const localImages = clipboard.availableFormats()
    .filter((format) => /uri-list|gnome-copied-files/i.test(format))
    .flatMap((format) => {
      try {
        return clipboard.readBuffer(format).toString('utf8').replace(/\0/g, '').split(/\r?\n/);
      } catch {
        return [];
      }
    });
  const plainText = clipboard.readText().trim();
  if (plainText.startsWith('file://')) localImages.push(...plainText.split(/\r?\n/));

  const localPaths = [...new Set(localImages
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== 'copy' && entry !== 'cut' && !entry.startsWith('#'))
    .flatMap((entry) => {
      try {
        const url = new URL(entry);
        return url.protocol === 'file:' ? [fileURLToPath(url)] : [];
      } catch {
        return [];
      }
    })
    .filter(isSupportedImagePath))];

  if (localPaths.length > 0) {
    const saved = await Promise.all(localPaths.map((sourcePath) =>
      savePastedImageFile(currentDocument!.path, sourcePath),
    ));
    return {
      canceled: false,
      markdown: saved.map((image) => image.markdown).join('\n\n'),
      relativePath: saved[0]?.markdownPath,
    };
  }

  const image = clipboard.readImage();
  if (image.isEmpty()) return { canceled: true };
  const saved = await savePastedPng(currentDocument.path, image.toPNG());
  return {
    canceled: false,
    markdown: saved.markdown,
    relativePath: saved.markdownPath,
  };
}

async function pickLinkTarget(documentPath: string): Promise<PickLinkTargetResult> {
  if (!currentDocument || currentDocument.path !== documentPath || currentDocument.isUntitled) {
    return { canceled: true };
  }
  const result = await dialog.showOpenDialog(mainWindow!, {
    defaultPath: path.dirname(currentDocument.path),
    properties: ['openFile'],
    filters: [{ name: 'All files', extensions: ['*'] }],
  });
  const targetPath = result.filePaths[0];
  if (result.canceled || !targetPath) return { canceled: true };
  return {
    canceled: false,
    destination: markdownDestinationForFile(currentDocument.path, targetPath),
    label: path.basename(targetPath),
  };
}

async function waitForPrintablePreview(window: BrowserWindow) {
  await window.webContents.executeJavaScript(`new Promise((resolve) => {
    const started = Date.now();
    let stableSince = 0;
    let previousSignature = '';
    const check = () => {
      const preview = document.querySelector('.markdown-preview[data-for="preview"]');
      const pendingDiagrams = document.querySelectorAll('.mermaid:not([data-processed])').length;
      const pendingImages = Array.from(document.images).filter((image) => !image.complete).length;
      const signature = preview
        ? [preview.childElementCount, preview.scrollHeight, pendingDiagrams, pendingImages].join(':')
        : '';
      if (signature && signature === previousSignature && pendingDiagrams === 0 && pendingImages === 0) {
        if (!stableSince) stableSince = Date.now();
      } else {
        stableSince = 0;
        previousSignature = signature;
      }
      if ((stableSince && Date.now() - stableSince >= 300) || Date.now() - started > 15000) {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  })`);
}

async function exportCurrentPdf(
  text: string,
  revision: number,
  documentPath: string,
): Promise<ExportPdfResult> {
  if (!currentDocument || currentDocument.path !== documentPath) return { canceled: true };
  const baseName = currentDocument.name.replace(/\.[^.]+$/, '') || 'document';
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: path.join(
      currentDocument.isUntitled ? app.getPath('documents') : path.dirname(currentDocument.path),
      `${baseName}.pdf`,
    ),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const rendered = await renderExportTemplate(text, revision, documentPath);
  const printWindow = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await printWindow.loadURL(rendered.url);
    await waitForPrintablePreview(printWindow);
    const pdf = await printWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    await fs.writeFile(result.filePath, pdf);
    return { canceled: false, path: result.filePath };
  } finally {
    printWindow.destroy();
  }
}

function sendCommand(command: AppCommand) {
  focusedState()?.window.webContents.send('app:command', command);
}

function previewSettingsPath() {
  return path.join(app.getPath('userData'), 'reader-settings.json');
}

function loadGlobalPreviewTheme() {
  try {
    const stored = JSON.parse(readFileSync(previewSettingsPath(), 'utf8')) as {
      previewTheme?: unknown;
    };
    globalPreviewTheme = normalizePreviewTheme(stored.previewTheme);
  } catch {
    globalPreviewTheme = DEFAULT_PREVIEW_THEME;
  }
}

function saveGlobalPreviewTheme() {
  const settingsPath = previewSettingsPath();
  void fs.mkdir(path.dirname(settingsPath), { recursive: true })
    .then(() => fs.writeFile(settingsPath, JSON.stringify({
      previewTheme: globalPreviewTheme,
    }, null, 2), 'utf8'))
    .catch((error) => console.error('Failed to save reader settings:', error));
}

function setGlobalPreviewTheme(value: unknown) {
  const themeId = normalizePreviewTheme(value);
  globalPreviewTheme = themeId;
  globalThemeRevision += 1;
  saveGlobalPreviewTheme();
  const snapshot: ThemeSnapshot = { id: themeId, revision: globalThemeRevision };
  for (const state of windowStates.values()) {
    const profile = themeProfile(themeId);
    state.window.setTitleBarOverlay({
      color: profile.palette.chrome,
      symbolColor: profile.palette.text,
      height: 36,
    });
    state.window.webContents.send('theme:changed', snapshot);
  }
}

function installMenu() {
  const menu = Menu.buildFromTemplate([
    {
      id: 'application-menu-file',
      label: 'File',
      submenu: [
        { id: 'menu-new-window', label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { id: 'menu-new-document', label: 'New', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new-document') },
        { id: 'menu-open-document', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => {
          const state = focusedState();
          if (state) void withWindowState(state, () => chooseAndOpen());
        } },
        { type: 'separator' },
        { id: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
        { id: 'menu-save-as', label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('save-as') },
        { id: 'menu-export-pdf', label: 'Export as PDF…', click: () => sendCommand('export-pdf') },
        { type: 'separator' },
        { id: 'menu-close-tab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendCommand('close-tab') },
        { type: 'separator' },
        { id: 'menu-quit', label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      id: 'application-menu-view',
      label: 'View',
      submenu: [
        { id: 'menu-toggle-surface', label: 'Toggle Viewer / Editor', accelerator: 'CmdOrCtrl+E', click: () => sendCommand('toggle-surface') },
        { id: 'menu-next-tab', label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => sendCommand('next-tab') },
        { id: 'menu-previous-tab', label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => sendCommand('previous-tab') },
        { type: 'separator' },
        { id: 'preview-find', label: 'Find in Preview', accelerator: 'CmdOrCtrl+F', click: () => sendCommand('open-find') },
        {
          id: 'menu-theme',
          label: 'Theme',
          submenu: PREVIEW_THEMES.map((theme) => ({
            id: `preview-theme-${theme.id}`,
            label: theme.label,
            type: 'radio' as const,
            checked: theme.id === globalPreviewTheme,
            click: () => setGlobalPreviewTheme(theme.id),
          })),
        },
        { type: 'separator' },
        { id: 'menu-reload', label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => focusedState()?.window.webContents.reload() },
        { id: 'menu-toggle-devtools', label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => focusedState()?.window.webContents.toggleDevTools() },
        { type: 'separator' },
        { id: 'menu-reset-zoom', label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => focusedState()?.window.webContents.setZoomLevel(0) },
        { id: 'menu-zoom-in', label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => {
          const contents = focusedState()?.window.webContents;
          if (contents) contents.setZoomLevel(contents.getZoomLevel() + 0.5);
        } },
        { id: 'menu-zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => {
          const contents = focusedState()?.window.webContents;
          if (contents) contents.setZoomLevel(contents.getZoomLevel() - 0.5);
        } },
      ],
    },
    {
      id: 'application-menu-insert',
      label: 'Insert',
      submenu: [
        { id: 'menu-insert-table', label: 'Table…', click: () => sendCommand('insert-table') },
        { id: 'menu-insert-link', label: 'Link…', accelerator: 'CmdOrCtrl+K', click: () => sendCommand('insert-link') },
      ],
    },
    {
      id: 'application-menu-edit',
      label: 'Edit',
      submenu: [
        { id: 'menu-undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => focusedState()?.window.webContents.undo() },
        { id: 'menu-redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => focusedState()?.window.webContents.redo() },
        { type: 'separator' },
        { id: 'menu-cut', label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => focusedState()?.window.webContents.cut() },
        { id: 'menu-copy', label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => focusedState()?.window.webContents.copy() },
        { id: 'menu-paste', label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => focusedState()?.window.webContents.paste() },
        { type: 'separator' },
        { id: 'menu-select-all', label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => focusedState()?.window.webContents.selectAll() },
      ],
    },
    {
      id: 'application-menu-window',
      label: 'Window',
      submenu: [
        { id: 'menu-minimize-window', label: 'Minimize', accelerator: 'CmdOrCtrl+M', click: () => focusedState()?.window.minimize() },
        { id: 'menu-toggle-maximize-window', label: 'Toggle Maximize', click: () => {
          const window = focusedState()?.window;
          if (!window) return;
          if (window.isMaximized()) window.unmaximize();
          else window.maximize();
        } },
        { id: 'menu-close-window', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => focusedState()?.window.close() },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow(
  position: { x: number; y: number } | null = null,
  initialDocument: DocumentSnapshot | null = null,
  showWhenReady = true,
  contentSize: { width: number; height: number } | null = null,
) {
  const createdWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    // 탭을 분리해 만든 창은 원래 창과 같은 크기로 연다. 폭이 같으면 본문이
    // 재배치되지 않으므로 보고 있던 화면이 그대로 옮겨진다.
    ...(contentSize
      ? { width: contentSize.width, height: contentSize.height, useContentSize: true }
      : {}),
    ...(position ? { x: position.x, y: position.y } : {}),
    minWidth: 520,
    minHeight: 420,
    backgroundColor: themeProfile(globalPreviewTheme).palette.canvas,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: themeProfile(globalPreviewTheme).palette.chrome,
      symbolColor: themeProfile(globalPreviewTheme).palette.text,
      height: 36,
    },
    show: false,
    title: 'Setdown',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--setdown-theme=${globalPreviewTheme}`,
        `--setdown-theme-revision=${globalThemeRevision}`,
      ],
    },
  });
  const state: WindowState = {
    window: createdWindow,
    currentDocument: initialDocument,
    activeRoot: initialDocument ? path.dirname(initialDocument.path) : null,
    watchedPath: null,
    closeAfterConfirmation: false,
    rendererTabs: [],
  };
  const webContentsId = createdWindow.webContents.id;
  windowStates.set(webContentsId, state);
  if (showWhenReady) mainWindow = createdWindow;
  createdWindow.setMenuBarVisibility(false);
  createdWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      createdWindow.webContents.send('app:command', 'escape');
    }
  });

  if (showWhenReady) createdWindow.once('ready-to-show', () => createdWindow.show());
  createdWindow.on('focus', () => {
    mainWindow = createdWindow;
  });
  // Renderer의 ResizeObserver보다 native compositor가 먼저 커지는 구간에도
  // 현재 Preview가 새 content 영역을 즉시 덮도록 한다. 축소는 창 clip이 맡고,
  // 정밀한 최종 bounds는 같은 frame의 preview:show가 보정한다.
  createdWindow.on('resize', () => {
    const [contentWidth, contentHeight] = createdWindow.getContentSize();
    for (const preview of previewViews.values()) {
      if (preview.ownerWebContentsId !== webContentsId || !preview.view.getVisible()) continue;
      const bounds = preview.view.getBounds();
      applyPreviewBounds(preview, {
        ...bounds,
        width: Math.max(1, contentWidth - bounds.x),
        height: Math.max(1, contentHeight - bounds.y),
      });
    }
  });
  createdWindow.on('close', (event) => {
    if (state.closeAfterConfirmation) return;
    const dirtyTabs = state.rendererTabs.filter((tab) => tab.dirty);
    if (dirtyTabs.length === 0 && state.currentDocument && isDirty(state.currentDocument)) {
      dirtyTabs.push({
        name: state.currentDocument.name,
        path: state.currentDocument.path,
        dirty: true,
        isUntitled: state.currentDocument.isUntitled,
      });
    }
    if (dirtyTabs.length === 0) return;
    event.preventDefault();
    const names = dirtyTabs.map((tab) => tab.name).join('\n');
    void dialog.showMessageBox(createdWindow, {
      type: 'warning',
      message: '바뀐 내용을 저장하시겠습니까?',
      detail: names,
      buttons: ['취소', '저장 안 함', '저장'],
      defaultId: 2,
      cancelId: 0,
    }).then(async ({ response }) => {
      if (response === 0) return;
      if (response === 1) {
        await Promise.all(state.rendererTabs
          .filter((tab) => tab.isUntitled)
          .map((tab) => discardDraftBundle(
            path.join(app.getPath('userData'), 'drafts'),
            tab.path,
          )));
        state.closeAfterConfirmation = true;
        createdWindow.close();
        return;
      }
      createdWindow.webContents.send('app:save-before-close');
    }).catch((error) => dialog.showErrorBox('창을 닫지 못했습니다', String(error)));
  });
  createdWindow.on('closed', () => {
    if (state.watchedPath) unwatchFile(state.watchedPath);
    discardSparePreview(webContentsId);
    for (const [tabId, preview] of previewViews) {
      if (preview.ownerWebContentsId !== webContentsId) continue;
      preview.view.webContents.close();
      previewViews.delete(tabId);
    }
    windowStates.delete(webContentsId);
    if (mainWindow === createdWindow) mainWindow = BrowserWindow.getAllWindows()[0] ?? null;
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void createdWindow.loadURL(devServer);
  else void createdWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return createdWindow;
}

const APPLICATION_MENU_IDS = new Set([
  'application-menu-file',
  'application-menu-view',
  'application-menu-insert',
  'application-menu-edit',
  'application-menu-window',
]);

function serializeMenuItems(items: readonly MenuItem[], parentId: string): ApplicationMenuEntry[] {
  return items
    .filter((item) => item.visible)
    .map((item, index) => {
      const type: ApplicationMenuEntry['type'] = item.submenu
        ? 'submenu'
        : item.type === 'separator' || item.type === 'checkbox' || item.type === 'radio'
          ? item.type
          : 'normal';
      return {
        id: item.id || `${parentId}-separator-${index}`,
        label: item.label,
        ...(item.accelerator ? { accelerator: String(item.accelerator) } : {}),
        type,
        enabled: item.enabled,
        checked: item.checked,
        ...(item.submenu
          ? { submenu: serializeMenuItems(item.submenu.items, item.id || parentId) }
          : {}),
      };
    });
}

function findApplicationMenuItem(items: readonly MenuItem[], id: string): MenuItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.submenu) {
      const nested = findApplicationMenuItem(item.submenu.items, id);
      if (nested) return nested;
    }
  }
  return null;
}

function installIpc() {
  ipcMain.on('preview:create', (event, tabId: unknown) => {
    if (typeof tabId !== 'string' || previewViews.has(tabId)) return;
    const ownerState = stateForWebContentsId(event.sender.id);
    if (!ownerState) return;
    // 부팅이 끝난 예비 view가 있으면 그것을 쓴다. 없으면 새로 만든다.
    const view = takeSparePreview(event.sender.id) ?? createPreviewView();
    view.setBackgroundColor(previewThemeBackground(globalPreviewTheme));
    view.setVisible(false);
    ownerState.window.contentView.addChildView(view);
    // 다음 탭이 쓸 예비를 background에서 다시 채운다.
    setImmediate(() => ensureSparePreview(event.sender.id));
    previewViews.set(tabId, {
      view,
      ownerWebContentsId: event.sender.id,
      pendingScrollPosition: null,
      pendingScrollRatio: null,
      appliedBounds: null,
    });
    view.webContents.on('before-input-event', (inputEvent, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        inputEvent.preventDefault();
        const preview = previewViews.get(tabId);
        const owner = preview && stateForWebContentsId(preview.ownerWebContentsId);
        if (owner) {
          owner.window.webContents.focus();
          owner.window.webContents.send('app:command', 'escape');
        }
        return;
      }
      if (
        input.type !== 'keyDown'
        || input.key.toLowerCase() !== 'f'
        || (!input.control && !input.meta)
        || input.alt
      ) return;
      inputEvent.preventDefault();
      const preview = previewViews.get(tabId);
      const owner = preview && stateForWebContentsId(preview.ownerWebContentsId);
      if (!owner) return;
      owner.window.webContents.focus();
      owner.window.webContents.send('preview:open-find', tabId);
    });
  });

  ipcMain.on('preview:show', (event, { tabId, bounds }) => {
    const owner = stateForWebContentsId(event.sender.id)?.window;
    if (!owner) return;
    const target = typeof tabId === 'string' ? previewViews.get(tabId) : undefined;
    const shown = target?.ownerWebContentsId === event.sender.id ? target : undefined;
    // 보여 줄 view는 건드리지 않는다. 숨겼다 다시 붙이는 왕복이 drag resize
    // 동안 매 frame 반복되면 빈 화면이 남는다.
    for (const preview of previewViews.values()) {
      if (preview.ownerWebContentsId !== event.sender.id || preview === shown) continue;
      if (preview.view.getVisible()) preview.view.setVisible(false);
    }
    if (!shown || !bounds) return;
    const [contentWidth, contentHeight] = owner.getContentSize();
    const x = Math.max(0, Math.round(Number(bounds.x) || 0));
    const y = Math.max(0, Math.round(Number(bounds.y) || 0));
    // DOM rect의 반올림이 content 영역을 1px 넘기면 창 resize 보정과 매 frame
    // 서로를 덮어쓴다. content 영역 안으로 접어 두 값을 일치시킨다.
    applyPreviewBounds(shown, {
      x,
      y,
      width: Math.max(1, Math.min(Math.round(Number(bounds.width) || 1), contentWidth - x)),
      height: Math.max(1, Math.min(Math.round(Number(bounds.height) || 1), contentHeight - y)),
    });
    // 이미 보이는 view를 다시 부모에 붙이면 compositor가 surface를 버린다.
    if (!shown.view.getVisible()) {
      // 다시 드러나는 첫 frame이 흰색으로 칠해지지 않게 한다.
      shown.view.setBackgroundColor(previewThemeBackground(globalPreviewTheme));
      owner.contentView.addChildView(shown.view);
      shown.view.setVisible(true);
    }
    restorePendingPreviewScroll(shown);
  });

  ipcMain.handle('preview:capture', async (event, tabId: unknown) => {
    const preview = previewViews.get(String(tabId));
    if (!preview || preview.ownerWebContentsId !== event.sender.id) return null;
    if (!preview.view.getVisible() || preview.view.webContents.isCrashed()) return null;
    const image = await preview.view.webContents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  });

  ipcMain.on('preview:command', (event, { tabId, message }) => {
    const preview = previewViews.get(String(tabId));
    if (!preview || preview.ownerWebContentsId !== event.sender.id) return;
    if (message?.command === 'marktex:apply-theme') {
      const assets = previewThemeAssets(message.themeId);
      preview.view.setBackgroundColor(assets.backgroundColor);
      preview.view.webContents.send('preview:command', {
        command: 'marktex:apply-theme',
        ...assets,
      });
      return;
    }
    preview.view.webContents.send('preview:command', message);
  });

  ipcMain.on('preview:destroy', (event, tabId: unknown) => {
    if (typeof tabId !== 'string') return;
    const preview = previewViews.get(tabId);
    if (!preview || preview.ownerWebContentsId !== event.sender.id) return;
    stateForWebContentsId(event.sender.id)?.window.contentView.removeChildView(preview.view);
    preview.view.webContents.close();
    previewViews.delete(tabId);
    renderWorker?.postMessage({ kind: 'forget-tab', tabId });
  });

  ipcMain.on('preview:message', (event, message: Record<string, unknown>) => {
    const found = Array.from(previewViews.entries()).find(([, preview]) =>
      preview.view.webContents.id === event.sender.id,
    );
    if (!found) return;
    const [tabId, preview] = found;
    if (message.type === 'marktex:html-updated') {
      previewUpdateWaiters.get(`${tabId}:${Math.max(0, Number(message.revision) || 0)}`)?.();
    }
    stateForWebContentsId(preview.ownerWebContentsId)?.window.webContents.send(
      'preview:message',
      { tabId, message },
    );
  });

  ipcMain.handle('menu:get', (event, menuId: unknown): ApplicationMenuEntry[] => {
    const state = stateForWebContentsId(event.sender.id);
    if (!state || typeof menuId !== 'string' || !APPLICATION_MENU_IDS.has(menuId)) return [];
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId);
    return item?.submenu ? serializeMenuItems(item.submenu.items, menuId) : [];
  });

  ipcMain.on('menu:execute', (event, itemId: unknown) => {
    const state = stateForWebContentsId(event.sender.id);
    const applicationMenu = Menu.getApplicationMenu();
    if (!state || !applicationMenu || typeof itemId !== 'string') return;
    const item = findApplicationMenuItem(applicationMenu.items, itemId);
    if (!item?.click || item.submenu || item.type === 'separator') return;
    selectWindowState(state);
    item.click(item, state.window, { triggeredByAccelerator: false } as Electron.KeyboardEvent);
  });

  ipcMain.handle('theme:get', (event): ThemeSnapshot => {
    if (!stateForWebContentsId(event.sender.id)) {
      throw new Error('The window no longer exists.');
    }
    return { id: globalPreviewTheme, revision: globalThemeRevision };
  });
  ipcMain.handle('preview:theme-assets', (event, themeId) => {
    if (!stateForWebContentsId(event.sender.id)) {
      throw new Error('The window no longer exists.');
    }
    return previewThemeAssets(themeId);
  });
  ipcMain.handle('document:get', (event) => stateForWebContentsId(event.sender.id)?.currentDocument ?? null);
  ipcMain.handle('document:new', (event) => {
    const state = stateForWebContentsId(event.sender.id);
    return state ? withWindowState(state, () => createNewDocument()) : null;
  });
  ipcMain.handle('document:activate', (event, { document, text, revision }) => {
    const state = stateForWebContentsId(event.sender.id);
    return state
      ? withWindowState(state, () => activateDocument(document, text, revision))
      : document;
  });
  ipcMain.on('tabs:update-state', (event, tabs: TabStateSummary[]) => {
    const state = stateForWebContentsId(event.sender.id);
    if (!state) return;
    state.rendererTabs = Array.isArray(tabs)
      ? tabs.map((tab) => ({
        name: String(tab.name),
        path: String(tab.path),
        dirty: Boolean(tab.dirty),
        isUntitled: Boolean(tab.isUntitled),
      }))
      : [];
  });
  ipcMain.on('tabs:register-transfer', (event, { transferId, tab }) => {
    if (typeof transferId !== 'string' || !tab || typeof tab.id !== 'string') return;
    pendingTabTransfers.set(transferId, {
      sourceWebContentsId: event.sender.id,
      tab: tab as TransferableTab,
      claimedByWebContentsId: null,
      expiresAt: Date.now() + 60_000,
      detachPosition: null,
      previewAdopted: false,
      // 새 OS 창 생성도 drop의 선행 조건에서 뺀다. 실제 drag 동안 숨은
      // renderer를 부팅하고, transfer commit 전에는 사용자에게 보이지 않는다.
      preparedWindow: createWindow(null, null, false, sourceContentSize(event.sender.id)),
      // reparent 직전이 아니라 dragstart 순간의 좌표를 잡는다. 준비 중이던
      // updateHtml이 뒤늦게 DOM을 승격해 viewport를 바꿔도 사용자가 이동을
      // 시작했을 때 보던 위치가 transfer의 authority다.
      previewScrollPosition: previewViews.get(String(tab.id))?.view.webContents
        .executeJavaScript('({ x: window.scrollX, y: window.scrollY })')
        .catch(() => ({ x: 0, y: 0 }))
        ?? Promise.resolve({ x: 0, y: 0 }),
      // 화면에 온전히 들어온 줄만 모은다. 위로 걸친 block을 넣으면 비율이
      // 음수가 되어 clamp에 눌리고, 무게중심이 한쪽으로 치우친다.
      sourceContentSize: sourceContentSize(event.sender.id),
      previewBand: previewViews.get(String(tab.id))?.view.webContents
        .executeJavaScript(`(() => {
          const root = document.querySelector('.markdown-preview[data-for="preview"]');
          if (!root) return [];
          const height = window.innerHeight || 1;
          const band = [];
          root.querySelectorAll('[data-source-line]').forEach((element) => {
            const line = Number(element.getAttribute('data-source-line'));
            if (!Number.isFinite(line) || line < 1) return;
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            if (rect.top < 0 || rect.top > height) return;
            band.push({ sourceLine: line, yRatio: rect.top / height });
          });
          return band;
        })()`)
        .catch(() => [] as BandLine[])
        ?? Promise.resolve([] as BandLine[]),
    });
    setTimeout(() => {
      const pending = pendingTabTransfers.get(transferId);
      if (pending && pending.expiresAt <= Date.now()) {
        if (pending.preparedWindow && !pending.preparedWindow.isDestroyed()) {
          pending.preparedWindow.destroy();
        }
        pendingTabTransfers.delete(transferId);
      }
    }, 60_500);
  });
  ipcMain.handle('tabs:adopt-transfer', async (event, transferId: string) => {
    const transfer = pendingTabTransfers.get(transferId);
    if (!transfer || transfer.claimedByWebContentsId !== event.sender.id) return false;
    const preview = previewViews.get(transfer.tab.id);
    const destination = stateForWebContentsId(event.sender.id)?.window;
    if (!preview || !destination || preview.ownerWebContentsId !== transfer.sourceWebContentsId) {
      return false;
    }
    const scroll = await transfer.previewScrollPosition;
    void preview.view.webContents.executeJavaScript(
      `window.__setdownTransferScroll = { capturedX: ${JSON.stringify(scroll.x)}, capturedY: ${JSON.stringify(scroll.y)} }`,
    );
    const source = stateForWebContentsId(transfer.sourceWebContentsId)?.window;
    // 같은 WebContents를 파괴하거나 navigate하지 않는다. remove/add는 같은
    // main-process task에서 끝내 viewport=0 구간을 최소화한다.
    preview.view.setVisible(false);
    source?.contentView.removeChildView(preview.view);
    destination.contentView.addChildView(preview.view);
    preview.ownerWebContentsId = event.sender.id;
    // 새 창의 좌표계에서는 기억한 bounds가 의미 없다.
    preview.appliedBounds = null;
    // reparent 뒤 compositor가 surface를 다시 만들면서 첫 frame을 배경색으로
    // 칠한다. 기본값은 흰색이므로 테마 색을 다시 못박아 흰 섬광을 없앤다.
    preview.view.setBackgroundColor(previewThemeBackground(
      transfer.tab.previewTheme ?? globalPreviewTheme,
    ));
    // 크기가 같으면 조판이 그대로다. scroll은 reparent만으로 이미 보존되므로
    // 아무것도 하지 않는 것이 정답이다. 띠를 얻었으면 좌표계를 하나로 둔다.
    // 픽셀 복원과 무게중심 정렬이 함께 돌면 서로 다른 답을 내어 두 번 튄다.
    const keepsGeometry = transferKeepsGeometry(transfer, event.sender.id);
    const band = await transfer.previewBand.catch(() => [] as BandLine[]);
    preview.pendingScrollPosition = keepsGeometry || band.length > 0 ? null : scroll;
    preview.pendingScrollRatio = keepsGeometry || band.length > 0
      || !Number.isFinite(Number(transfer.tab.viewerScrollRatio))
      ? null
      : Math.max(0, Math.min(1, Number(transfer.tab.viewerScrollRatio)));
    transfer.previewAdopted = true;
    return true;
  });
  ipcMain.handle('tabs:claim-transfer', async (event, transferId: string) => {
    const transfer = pendingTabTransfers.get(transferId);
    if (!transfer || transfer.expiresAt < Date.now()) {
      pendingTabTransfers.delete(transferId);
      return null;
    }
    if (transfer.sourceWebContentsId === event.sender.id || transfer.claimedByWebContentsId !== null) {
      return null;
    }
    transfer.claimedByWebContentsId = event.sender.id;
    if (
      transfer.preparedWindow
      && !transfer.preparedWindow.isDestroyed()
      && transfer.preparedWindow.webContents.id !== event.sender.id
    ) {
      transfer.preparedWindow.destroy();
      transfer.preparedWindow = null;
    }
    return {
      transferId,
      tab: {
        ...transfer.tab,
        viewerBand: await transfer.previewBand,
        previewGeometryUnchanged: transferKeepsGeometry(transfer, event.sender.id),
      },
    };
  });
  ipcMain.on('tabs:complete-transfer', (event, transferId: string) => {
    const transfer = pendingTabTransfers.get(transferId);
    if (
      !transfer
      || transfer.claimedByWebContentsId !== event.sender.id
      || !transfer.previewAdopted
    ) return;
    const source = stateForWebContentsId(transfer.sourceWebContentsId)?.window;
    source?.webContents.send('tabs:transfer-completed', {
      transferId,
      tabId: transfer.tab.id,
    });
  });
  ipcMain.on('tabs:release-source', (event, transferId: string) => {
    const transfer = pendingTabTransfers.get(transferId);
    if (!transfer || transfer.sourceWebContentsId !== event.sender.id) return;
    const destination = transfer.claimedByWebContentsId === null
      ? null
      : stateForWebContentsId(transfer.claimedByWebContentsId)?.window;
    pendingTabTransfers.delete(transferId);
    if (destination && !destination.isDestroyed()) {
      if (!destination.isVisible()) {
        destination.once('show', () => {
          setImmediate(() => {
            for (const preview of previewViews.values()) {
              if (preview.ownerWebContentsId === destination.webContents.id) {
                restorePendingPreviewScroll(preview);
              }
            }
          });
        });
        destination.show();
      }
      destination.focus();
    }
  });
  ipcMain.on('tabs:cancel-transfer', (event, transferId: string) => {
    const transfer = pendingTabTransfers.get(transferId);
    if (transfer?.sourceWebContentsId === event.sender.id && transfer.claimedByWebContentsId === null) {
      if (transfer.preparedWindow && !transfer.preparedWindow.isDestroyed()) {
        transfer.preparedWindow.destroy();
      }
      pendingTabTransfers.delete(transferId);
    }
  });
  ipcMain.on('tabs:detach-to-window', (event, { transferId, x, y }) => {
    const transfer = pendingTabTransfers.get(transferId);
    if (!transfer || transfer.sourceWebContentsId !== event.sender.id || transfer.claimedByWebContentsId !== null) return;
    transfer.detachPosition = {
      x: Math.round(Number(x) - 120),
      y: Math.round(Number(y) - 18),
    };
    const detachedWindow = transfer.preparedWindow && !transfer.preparedWindow.isDestroyed()
      ? transfer.preparedWindow
      : createWindow(transfer.detachPosition, null, false,
        sourceContentSize(event.sender.id));
    transfer.preparedWindow = detachedWindow;
    detachedWindow.setPosition(transfer.detachPosition.x, transfer.detachPosition.y, false);
    transfer.claimedByWebContentsId = detachedWindow.webContents.id;
    // Preview를 옮기기 전에 목적지 창을 화면에 올린다.
    //
    // 화면에 올라가지 않은 창의 WebContents는 display 배율을 모른다.
    // devicePixelRatio가 1로 떨어지고, 분수 배율(예: 1.333) 환경에서는 모든
    // 줄 높이가 다르게 반올림된다. 측정에서 15,285px 문서가 15,428px로
    // 부풀었다가 창이 보이는 순간 되돌아왔다. 그 중간 레이아웃이 사용자가
    // 보는 "탁탁"이다. 순서를 바꾸면 뷰는 같은 배율에서 같은 배율로 옮겨
    // 가므로 중간 레이아웃이 생기지 않는다. 기다리지 않으므로 전환은 그대로
    // 즉시다.
    // showInactive로 올린다. 배율을 얻는 데 필요한 것은 display에 붙는 것뿐이고,
    // 포커스는 transfer가 끝난 뒤 tabs:release-source가 준다.
    if (!detachedWindow.isVisible()) detachedWindow.showInactive();
    // 새 창으로 분리하는 경로는 claim-transfer를 지나지 않는다. 띠를 여기서
    // 직접 실어 보내지 않으면 목적지가 무게중심 정렬을 쓸 수 없다.
    const sendIncoming = async () => {
      if (!pendingTabTransfers.has(transferId) || detachedWindow.isDestroyed()) return;
      const band = await transfer.previewBand.catch(() => [] as BandLine[]);
      if (!pendingTabTransfers.has(transferId) || detachedWindow.isDestroyed()) return;
      detachedWindow.webContents.send('tabs:transfer-incoming', {
        transferId,
        tab: {
          ...transfer.tab,
          viewerBand: band,
          previewGeometryUnchanged:
            transferKeepsGeometry(transfer, detachedWindow.webContents.id),
        },
      });
    };
    if (detachedWindow.webContents.isLoadingMainFrame()) {
      detachedWindow.webContents.once('did-finish-load', () => void sendIncoming());
    } else {
      void sendIncoming();
    }
  });
  ipcMain.on('app:close-empty-window', (event) => {
    const state = stateForWebContentsId(event.sender.id);
    if (!state || state.rendererTabs.length > 0) return;
    state.closeAfterConfirmation = true;
    state.window.close();
  });
  // invoke의 반환값으로 renderer가 직접 문서를 설치하므로 opened 이벤트를
  // 함께 보내지 않는다. 두 경로가 겹치면 showDocument가 같은 문서를 두 번
  // 초기화하여 진행 중 Preview를 무효화한다.
  ipcMain.handle('document:open', (event) => {
    const state = stateForWebContentsId(event.sender.id);
    return state ? withWindowState(state, () => chooseAndOpen(false)) : null;
  });
  ipcMain.on('document:update-text', (event, { text, revision }) => {
    const state = stateForWebContentsId(event.sender.id);
    if (!state) return;
    void withWindowState(state, () => {
      if (currentDocument) currentDocument = applyTextRevision(currentDocument, text, revision);
    });
  });
  ipcMain.handle(
    'preview:prepare',
    (event, { tabId, text, revision, documentPath, themeId }) => {
      const state = stateForWebContentsId(event.sender.id);
      if (!state) throw new Error('The window no longer exists.');
      return withWindowState(state, () => preparePreview(
        String(tabId), text, revision, documentPath,
        normalizePreviewTheme(themeId), event.sender.id,
      ));
    },
  );
  ipcMain.handle('document:save', async (event, { text, revision }): Promise<SaveResult> => {
    const state = stateForWebContentsId(event.sender.id);
    return state ? withWindowState(state, () => saveCurrentDocument(text, revision)) : { canceled: true };
  });
  ipcMain.handle('document:save-as', async (event, { text, revision }): Promise<SaveResult> => {
    const state = stateForWebContentsId(event.sender.id);
    return state ? withWindowState(state, () => saveDocumentAs(text, revision)) : { canceled: true };
  });
  ipcMain.handle(
    'document:save-tab',
    async (event, { document, text, revision }): Promise<SaveResult> => {
      const state = stateForWebContentsId(event.sender.id);
      if (!state) return { canceled: true };
      return withWindowState(state, async () => {
      const wasCurrent = currentDocument?.path === document.path;
      const result = await saveDocumentSnapshot(document, text, revision);
      if (wasCurrent && !result.canceled && result.document) {
        currentDocument = result.document;
        activeRoot = path.dirname(currentDocument.path);
        watchCurrentDocument();
      }
      return result;
      });
    },
  );
  ipcMain.handle('document:confirm-close', async (event, name: string): Promise<CloseDecision> => {
    const parent = stateForWebContentsId(event.sender.id)?.window;
    if (!parent) return 'cancel';
    const { response } = await dialog.showMessageBox(parent, {
      type: 'warning',
      message: `${name}의 변경 내용을 저장하시겠습니까?`,
      detail: '저장하지 않은 내용은 완전히 잃게 됩니다.',
      buttons: ['취소', '저장 안 함', '저장'],
      defaultId: 2,
      cancelId: 0,
    });
    return response === 2 ? 'save' : response === 1 ? 'discard' : 'cancel';
  });
  ipcMain.handle('document:discard', async (_event, document: DocumentSnapshot) => {
    if (!document.isUntitled) return;
    await discardDraftBundle(
      path.join(app.getPath('userData'), 'drafts'),
      document.path,
    );
  });
  ipcMain.on('app:finish-window-close', (event, saved: boolean) => {
    const state = stateForWebContentsId(event.sender.id);
    if (!saved || !state) return;
    state.closeAfterConfirmation = true;
    state.window.close();
  });
  ipcMain.handle('document:export-pdf', (event, { text, revision, documentPath }) => {
    const state = stateForWebContentsId(event.sender.id);
    return state
      ? withWindowState(state, () => exportCurrentPdf(text, revision, documentPath))
      : { canceled: true };
  });
  ipcMain.handle('document:paste-clipboard-image', (event) => {
    const state = stateForWebContentsId(event.sender.id);
    return state ? withWindowState(state, () => pasteClipboardImage()) : { canceled: true };
  });
  ipcMain.handle('document:pick-link-target', (event, documentPath: string) => {
    const state = stateForWebContentsId(event.sender.id);
    return state
      ? withWindowState(state, () => pickLinkTarget(documentPath))
      : { canceled: true };
  });
  ipcMain.handle('document:reload', async (event) => {
    const state = stateForWebContentsId(event.sender.id);
    if (!state) return null;
    return withWindowState(state, async () => {
      if (!currentDocument || currentDocument.isUntitled) return currentDocument;
      return openPath(currentDocument.path, false);
    });
  });
  ipcMain.handle('document:open-link', async (event, href: string) => {
    const state = stateForWebContentsId(event.sender.id);
    if (state) selectWindowState(state);
    const decodedHref = decodeURIComponent(href);
    const localPath = pathFromResourceUrl(decodedHref);
    if (localPath) {
      const checked = assertReadablePath(localPath);
      if (/\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(checked)) {
        await openPath(checked);
      } else {
        await shell.openPath(checked);
      }
      return;
    }
    const url = new URL(decodedHref);
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
      await shell.openExternal(url.href);
    }
  });
}

function markdownPathFromArgs(args: string[]) {
  return args.find((arg) => {
    if (!/\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(arg)) return false;
    try {
      return statSync(path.resolve(arg)).isFile();
    } catch {
      return false;
    }
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const markdownPath = markdownPathFromArgs(argv);
    const state = focusedState();
    if (markdownPath && state) {
      void withWindowState(state, () => openPath(path.resolve(markdownPath)));
    }
    state?.window.show();
    state?.window.focus();
  });

  app.whenReady().then(async () => {
    protocol.handle('marktex-preview', (request) => {
      const token = new URL(request.url).pathname.slice(1);
      const html = previewDocuments.get(token);
      if (!html) return new Response('Preview expired', { status: 404 });
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
    protocol.handle('marktex-resource', (request) => {
      const filePath = pathFromResourceUrl(request.url);
      if (!filePath) return new Response('Bad resource URL', { status: 400 });
      try {
        return net.fetch(pathToFileURL(assertReadablePath(filePath)).href);
      } catch {
        return new Response('Resource is outside the allowed roots', { status: 403 });
      }
    });
    loadGlobalPreviewTheme();
    installIpc();
    installMenu();
    const markdownPath = markdownPathFromArgs(process.argv);
    const initialDocument = markdownPath
      ? await readDocument(path.resolve(markdownPath))
      : null;
    createWindow(null, initialDocument);
  });

  app.on('before-quit', () => {
    for (const state of windowStates.values()) {
      if (state.watchedPath) unwatchFile(state.watchedPath);
      state.watchedPath = null;
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
