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
  WebContentsView,
} from 'electron';
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
import {
  Notebook,
  getDefaultNotebookConfig,
  utility,
} from 'crossnote';
import type { FileSystemApi, WebviewConfig } from 'crossnote';
import type {
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
  TransferableTab,
} from '../shared/contracts';
import {
  DEFAULT_PREVIEW_THEME,
  normalizePreviewTheme,
  previewThemeFile,
  type PreviewThemeId,
} from '../shared/preview-preferences';
import { applyTextRevision, isDirty, lineCount } from '../shared/document-state';
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
  detachTimer: ReturnType<typeof setTimeout> | null;
  detachPosition: { x: number; y: number } | null;
  previewAdopted: boolean;
};

const TAB_DETACH_GRACE_MS = 250;

const windowStates = new Map<number, WindowState>();
const pendingTabTransfers = new Map<string, PendingTabTransfer>();
const previewViews = new Map<string, {
  view: WebContentsView;
  ownerWebContentsId: number;
  pendingScrollPosition: { x: number; y: number } | null;
}>();
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

type CrossnoteModule = typeof import('crossnote');
type NotebookInstance = Awaited<ReturnType<CrossnoteModule['Notebook']['init']>>;
const notebookCaches = new Map<string, NotebookInstance>();
const previewDocuments = new Map<string, string>();

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

/**
 * Crossnote의 preview sanitizer는 사용자 콘텐츠의 custom protocol media URL을
 * 제거한다. 문서 폴더 안 파일은 상대 URL로 유지하면 sanitizer를 통과하고,
 * preview의 <base>가 이를 marktex-resource: URL로 안전하게 해석한다.
 */
function previewFileReference(filePath: string): string {
  const absolute = canonicalPath(filePath);
  if (activeRoot) {
    const relative = previewRelativeReference(canonicalPath(activeRoot), absolute);
    if (relative !== null) return relative;
  }
  return resourceUrl(absolute);
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

function createReadOnlyFileSystem(root: string): FileSystemApi {
  const checked = (candidate: string) => {
    const absolute = path.resolve(candidate);
    if (!isInside(root, absolute)) throw new Error('Path escapes the document folder.');
    if (absolute.split(path.sep).includes('.crossnote')) {
      throw new Error('Per-folder Crossnote configuration is disabled for untrusted documents.');
    }
    return assertReadablePath(absolute);
  };

  return {
    readFile: async (candidate, encoding = 'utf8') =>
      (await fs.readFile(checked(candidate), encoding)).toString(),
    writeFile: async () => {
      throw new Error('Crossnote preview file system is read-only.');
    },
    mkdir: async () => {
      throw new Error('Crossnote preview file system is read-only.');
    },
    exists: async (candidate) => {
      if (path.resolve(candidate).split(path.sep).includes('.crossnote')) return false;
      try {
        await fs.access(checked(candidate));
        return true;
      } catch {
        return false;
      }
    },
    stat: async (candidate) => {
      const stats = await fs.lstat(checked(candidate));
      return {
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        size: stats.size,
        isFile: () => stats.isFile(),
        isDirectory: () => stats.isDirectory(),
        isSymbolicLink: () => stats.isSymbolicLink(),
      };
    },
    readdir: async (candidate) => fs.readdir(checked(candidate)),
    unlink: async () => {
      throw new Error('Crossnote preview file system is read-only.');
    },
  };
}

async function getNotebook(
  filePath: string,
  requestedTheme: PreviewThemeId = DEFAULT_PREVIEW_THEME,
): Promise<NotebookInstance> {
  const root = canonicalPath(path.dirname(filePath));
  activeRoot = root;
  const themeId = normalizePreviewTheme(requestedTheme);
  const cacheKey = `${root}\0${themeId}`;
  const cached = notebookCaches.get(cacheKey);
  if (cached) return cached;

  const defaults = getDefaultNotebookConfig();
  const notebook = await Notebook.init({
    notebookPath: root,
    fs: createReadOnlyFileSystem(root),
    config: {
      ...defaults,
      markdownParser: 'markdown-it',
      previewTheme: previewThemeFile(themeId),
      codeBlockTheme: 'auto.css',
      mathRenderingOption: 'KaTeX',
      enablePreviewZenMode: true,
      enablePreviewContextMenu: false,
      enableScriptExecution: false,
      enableHTML5Embed: false,
      includeInHeader: '',
      globalCss: '',
      protocolsWhiteList:
        'http://, https://, file://, marktex-resource://, mailto:, tel:',
    },
  });
  notebook.previewScriptsEnabled = false;
  installSourceAnchors(notebook.md as unknown as MarkdownItLike);
  notebookCaches.set(cacheKey, notebook);
  return notebook;
}

let bridgeSourceCache: string | null = null;

function bridgeSource(): string {
  if (bridgeSourceCache === null) {
    const bundle = readFileSync(path.join(__dirname, 'preview-bridge.js'), 'utf8');
    // 인라인 <script> 안으로 들어가므로 태그 종료 시퀀스만 막는다.
    bridgeSourceCache = bundle.replace(/<\/script/gi, '<\\/script');
  }
  return bridgeSourceCache;
}

function previewBridgeScript(
  totalLines: number,
  documentIsBlank: boolean,
  revision: number,
): string {
  const config = JSON.stringify({
    totalLineCount: totalLines,
    documentIsBlank,
    revision,
  });
  return `<script>window.__marktexPreview = ${config};</script>
<script>${bridgeSource()}</script>`;
}

async function renderCurrent(
  text: string,
  revision: number,
  documentPath: string,
  requestedTheme: PreviewThemeId = DEFAULT_PREVIEW_THEME,
): Promise<RenderResult> {
  if (!currentDocument) throw new Error('No Markdown document is open.');
  if (currentDocument.path !== documentPath) {
    throw new Error('The preview request belongs to a document that is no longer open.');
  }
  currentDocument = applyTextRevision(currentDocument, text, revision);
  const renderPath = currentDocument.path;
  const themeId = normalizePreviewTheme(requestedTheme);
  const notebook = await getNotebook(renderPath, themeId);
  if (currentDocument?.path !== renderPath) {
    throw new Error('The document changed while its preview was being prepared.');
  }
  const engine = notebook.getNoteMarkdownEngine(renderPath);
  const sourceUrl = resourceUrl(renderPath);
  const fakePanel = {} as never;
  const config: WebviewConfig = {
    ...notebook.config,
    sourceUri: sourceUrl,
    cursorLine: 0,
    scrollSync: true,
    isVSCode: false,
    enablePreviewZenMode: true,
    enablePreviewContextMenu: false,
  };
  const html = await engine.generateHTMLTemplateForPreview({
    inputString: text.length > 0 ? text : '\n',
    config,
    vscodePreviewPanel: fakePanel,
    head: `<base href="${resourceUrl(path.join(path.dirname(renderPath), path.sep))}">`,
    scripts: previewBridgeScript(lineCount(text), text.trim().length === 0, revision),
    styles: `<style>
      [data-source-line] { cursor: text; }
      .topbar, footer, .footer { display: none !important; }
      .markdown-preview { padding-bottom: 5rem !important; }
      /* 수식이 나르는 source wrapper는 조판을 바꾸지 않는다. */
      .crossnote-math-source, .crossnote-html-source { display: block; }
      .crossnote-inline-math-source { display: inline; }
    </style>`,
  });
  if (currentDocument?.path !== renderPath) {
    throw new Error('The document changed while its preview was being prepared.');
  }
  const token = `${Date.now()}-${revision}-${Math.random().toString(36).slice(2)}`;
  previewDocuments.set(token, html);
  while (previewDocuments.size > 64) {
    const oldest = previewDocuments.keys().next().value as string | undefined;
    if (!oldest) break;
    previewDocuments.delete(oldest);
  }
  return { revision, url: `marktex-preview://document/${token}`, themeId };
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
  notebookCaches.clear();
  activeRoot = path.dirname(currentDocument.path);
  watchCurrentDocument();
  if (notify) mainWindow?.webContents.send('document:opened', currentDocument);
  return currentDocument;
}

async function createNewDocument() {
  stopWatching();
  notebookCaches.clear();
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
  notebookCaches.clear();
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

  const rendered = await renderCurrent(text, revision, documentPath);
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

function installMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new-document') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => {
          const state = focusedState();
          if (state) void withWindowState(state, () => chooseAndOpen());
        } },
        { type: 'separator' },
        { id: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('save-as') },
        { label: 'Export as PDF…', click: () => sendCommand('export-pdf') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendCommand('close-tab') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Viewer / Editor', accelerator: 'CmdOrCtrl+E', click: () => sendCommand('toggle-surface') },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => sendCommand('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => sendCommand('previous-tab') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: 'Insert',
      submenu: [
        { label: 'Table…', click: () => sendCommand('insert-table') },
        { label: 'Link…', accelerator: 'CmdOrCtrl+K', click: () => sendCommand('insert-link') },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow(
  position: { x: number; y: number } | null = null,
  initialDocument: DocumentSnapshot | null = null,
) {
  const createdWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    ...(position ? { x: position.x, y: position.y } : {}),
    minWidth: 520,
    minHeight: 420,
    backgroundColor: '#f7f7f5',
    show: false,
    title: 'Setdown',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
  mainWindow = createdWindow;

  createdWindow.once('ready-to-show', () => createdWindow.show());
  createdWindow.on('focus', () => {
    mainWindow = createdWindow;
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

function installIpc() {
  ipcMain.on('preview:create', (event, tabId: string) => {
    if (typeof tabId !== 'string' || previewViews.has(tabId)) return;
    const owner = stateForWebContentsId(event.sender.id)?.window;
    if (!owner) return;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preview-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.webContents.on('before-input-event', (inputEvent, input) => {
      if (
        input.type !== 'keyDown'
        || input.key.toLowerCase() !== 'f'
        || (!input.control && !input.meta)
        || input.alt
      ) return;
      inputEvent.preventDefault();
      const preview = previewViews.get(tabId);
      if (!preview) return;
      stateForWebContentsId(preview.ownerWebContentsId)?.window.webContents.send(
        'preview:open-find',
        tabId,
      );
    });
    view.setVisible(false);
    owner.contentView.addChildView(view);
    previewViews.set(tabId, {
      view,
      ownerWebContentsId: event.sender.id,
      pendingScrollPosition: null,
    });
  });
  ipcMain.handle('preview:load', async (event, { tabId, url }) => {
    const preview = previewViews.get(tabId);
    if (!preview || preview.ownerWebContentsId !== event.sender.id) {
      throw new Error('The preview is not owned by this window.');
    }
    const previewUrl = String(url);
    if (!previewUrl.startsWith('marktex-preview://document/')) {
      throw new Error('Only rendered Setdown previews may be loaded.');
    }
    await preview.view.webContents.loadURL(previewUrl);
  });
  ipcMain.on('preview:show', (event, { tabId, bounds }) => {
    const owner = stateForWebContentsId(event.sender.id)?.window;
    if (!owner) return;
    for (const preview of previewViews.values()) {
      if (preview.ownerWebContentsId === event.sender.id) preview.view.setVisible(false);
    }
    if (typeof tabId !== 'string' || !bounds) return;
    const preview = previewViews.get(tabId);
    if (!preview || preview.ownerWebContentsId !== event.sender.id) return;
    preview.view.setBounds({
      x: Math.max(0, Math.round(Number(bounds.x) || 0)),
      y: Math.max(0, Math.round(Number(bounds.y) || 0)),
      width: Math.max(1, Math.round(Number(bounds.width) || 1)),
      height: Math.max(1, Math.round(Number(bounds.height) || 1)),
    });
    owner.contentView.addChildView(preview.view);
    preview.view.setVisible(true);
    const scrollPosition = preview.pendingScrollPosition;
    if (scrollPosition) {
      preview.pendingScrollPosition = null;
      void preview.view.webContents.executeJavaScript(
        `window.scrollTo(${JSON.stringify(scrollPosition.x)}, ${JSON.stringify(scrollPosition.y)})`,
      );
    }
  });
  ipcMain.on('preview:command', (event, { tabId, message }) => {
    const preview = previewViews.get(tabId);
    if (preview?.ownerWebContentsId === event.sender.id) {
      preview.view.webContents.send('preview:command', message);
    }
  });
  ipcMain.on('preview:destroy', (event, tabId: string) => {
    const preview = previewViews.get(tabId);
    if (!preview || preview.ownerWebContentsId !== event.sender.id) return;
    stateForWebContentsId(event.sender.id)?.window.contentView.removeChildView(preview.view);
    preview.view.webContents.close();
    previewViews.delete(tabId);
  });
  ipcMain.on('preview:message', (event, message: Record<string, unknown>) => {
    const found = Array.from(previewViews.entries()).find(([, preview]) =>
      preview.view.webContents.id === event.sender.id,
    );
    if (!found) return;
    const [tabId, preview] = found;
    stateForWebContentsId(preview.ownerWebContentsId)?.window.webContents.send(
      'preview:message',
      { tabId, message },
    );
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
      detachTimer: null,
      detachPosition: null,
      previewAdopted: false,
    });
    setTimeout(() => {
      const pending = pendingTabTransfers.get(transferId);
      if (pending && pending.expiresAt <= Date.now()) {
        if (pending.detachTimer) clearTimeout(pending.detachTimer);
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
    const scrollPosition = await preview.view.webContents.executeJavaScript(
      '({ x: window.scrollX, y: window.scrollY })',
    ).catch(() => ({ x: 0, y: 0 })) as { x: number; y: number };
    const source = stateForWebContentsId(transfer.sourceWebContentsId)?.window;
    preview.view.setVisible(false);
    source?.contentView.removeChildView(preview.view);
    destination.contentView.addChildView(preview.view);
    preview.ownerWebContentsId = event.sender.id;
    preview.pendingScrollPosition = scrollPosition;
    transfer.previewAdopted = true;
    return true;
  });
  ipcMain.handle('tabs:claim-transfer', (event, transferId: string) => {
    const transfer = pendingTabTransfers.get(transferId);
    if (!transfer || transfer.expiresAt < Date.now()) {
      pendingTabTransfers.delete(transferId);
      return null;
    }
    if (transfer.sourceWebContentsId === event.sender.id || transfer.claimedByWebContentsId !== null) {
      return null;
    }
    if (transfer.detachTimer) {
      clearTimeout(transfer.detachTimer);
      transfer.detachTimer = null;
    }
    transfer.claimedByWebContentsId = event.sender.id;
    return { transferId, tab: transfer.tab };
  });
  ipcMain.on('tabs:complete-transfer', (event, transferId: string) => {
    const transfer = pendingTabTransfers.get(transferId);
    if (!transfer || transfer.claimedByWebContentsId !== event.sender.id || !transfer.previewAdopted) return;
    if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
    const source = stateForWebContentsId(transfer.sourceWebContentsId)?.window;
    source?.webContents.send('tabs:transfer-completed', transfer.tab.id);
    pendingTabTransfers.delete(transferId);
  });
  ipcMain.on('tabs:cancel-transfer', (event, transferId: string) => {
    const transfer = pendingTabTransfers.get(transferId);
    if (transfer?.sourceWebContentsId === event.sender.id && transfer.claimedByWebContentsId === null) {
      if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
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
    // destination의 drop/claim과 source의 dragend는 서로 다른 WebContents에서
    // 오므로 도착 순서가 보장되지 않는다. claim에 우선권을 줄 짧은 유예를
    // 둔 뒤, 끝내 아무 창도 가져가지 않은 탭만 새 창으로 분리한다.
    if (transfer.detachTimer) clearTimeout(transfer.detachTimer);
    transfer.detachTimer = setTimeout(() => {
      const pending = pendingTabTransfers.get(transferId);
      if (!pending || pending.claimedByWebContentsId !== null || !pending.detachPosition) return;
      pending.detachTimer = null;
      const detachedWindow = createWindow(pending.detachPosition);
      pending.claimedByWebContentsId = detachedWindow.webContents.id;
      detachedWindow.webContents.once('did-finish-load', () => {
        detachedWindow.webContents.send('tabs:transfer-incoming', {
          transferId,
          tab: pending.tab,
        });
      });
    }, TAB_DETACH_GRACE_MS);
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
  ipcMain.handle('document:render', (event, { text, revision, documentPath, themeId }) => {
    const state = stateForWebContentsId(event.sender.id);
    if (!state) throw new Error('The window no longer exists.');
    return withWindowState(
      state,
      () => renderCurrent(text, revision, documentPath, normalizePreviewTheme(themeId)),
    );
  });
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
    utility.useExternalAddFileProtocolFunction((filePath: string) =>
      previewFileReference(filePath),
    );
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
