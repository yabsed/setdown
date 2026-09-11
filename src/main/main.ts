import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Notebook,
  getDefaultNotebookConfig,
  utility,
} from 'crossnote';
import type { FileSystemApi, WebviewConfig } from 'crossnote';
import type {
  AppCommand,
  DiskVersion,
  DocumentSnapshot,
  RenderResult,
  SaveResult,
  ExportPdfResult,
} from '../shared/contracts';
import { applyTextRevision, isDirty, lineCount } from '../shared/document-state';
import { installSourceAnchors, type MarkdownItLike } from './source-anchors';

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
let watchedPath: string | null = null;
let activeRoot: string | null = null;
let closeAfterConfirmation = false;

type CrossnoteModule = typeof import('crossnote');
type NotebookInstance = Awaited<ReturnType<CrossnoteModule['Notebook']['init']>>;
let notebookCache: { root: string; notebook: NotebookInstance } | null = null;
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
  const roots = [crossnoteOut, activeRoot].filter((root): root is string => !!root);
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

async function getNotebook(filePath: string): Promise<NotebookInstance> {
  const root = canonicalPath(path.dirname(filePath));
  activeRoot = root;
  if (notebookCache?.root === root) return notebookCache.notebook;

  const defaults = getDefaultNotebookConfig();
  const notebook = await Notebook.init({
    notebookPath: root,
    fs: createReadOnlyFileSystem(root),
    config: {
      ...defaults,
      markdownParser: 'markdown-it',
      previewTheme: 'github-light.css',
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
  notebookCache = { root, notebook };
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
): Promise<RenderResult> {
  if (!currentDocument) throw new Error('No Markdown document is open.');
  if (currentDocument.path !== documentPath) {
    throw new Error('The preview request belongs to a document that is no longer open.');
  }
  currentDocument = applyTextRevision(currentDocument, text, revision);
  const renderPath = currentDocument.path;
  const notebook = await getNotebook(renderPath);
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
  while (previewDocuments.size > 5) {
    const oldest = previewDocuments.keys().next().value as string | undefined;
    if (!oldest) break;
    previewDocuments.delete(oldest);
  }
  return { revision, url: `marktex-preview://document/${token}` };
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
  return {
    // Crossnote의 상대 resource 해석에는 실제 absolute base path가 필요하다.
    // 이 경로에는 저장하지 않으며 첫 Save에서 반드시 Save As를 거친다.
    path: path.join(app.getPath('documents'), 'Untitled.md'),
    name: 'Untitled.md',
    text: '',
    revision: 0,
    savedRevision: 0,
    diskVersion: { mtimeMs: 0, size: 0 },
    isUntitled: true,
  };
}

function stopWatching() {
  if (watchedPath) unwatchFile(watchedPath);
  watchedPath = null;
}

function watchCurrentDocument() {
  stopWatching();
  if (!currentDocument || currentDocument.isUntitled) return;
  watchedPath = currentDocument.path;
  watchFile(watchedPath, { interval: 750 }, (current) => {
    if (!currentDocument || currentDocument.path !== watchedPath) return;
    const next = { mtimeMs: current.mtimeMs, size: current.size };
    if (current.nlink > 0 && !isSameDiskVersion(next, currentDocument.diskVersion)) {
      mainWindow?.webContents.send('document:external-change', {
        path: currentDocument.path,
        diskVersion: next,
      });
    }
  });
}

async function openPath(filePath: string, notify = true) {
  currentDocument = await readDocument(filePath);
  notebookCache = null;
  activeRoot = path.dirname(currentDocument.path);
  watchCurrentDocument();
  if (notify) mainWindow?.webContents.send('document:opened', currentDocument);
  return currentDocument;
}

async function createNewDocument() {
  if (!(await confirmReplaceCurrentDocument())) return null;
  stopWatching();
  notebookCache = null;
  currentDocument = blankDocument();
  activeRoot = path.dirname(currentDocument.path);
  return currentDocument;
}

async function confirmReplaceCurrentDocument(): Promise<boolean> {
  if (!currentDocument || !isDirty(currentDocument)) return true;
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'warning',
    message: `${currentDocument.name}의 변경 내용을 저장하시겠습니까?`,
    detail: '다른 문서를 열면 저장하지 않은 변경 내용은 사라집니다.',
    buttons: ['저장', '저장 안 함', '취소'],
    defaultId: 0,
    cancelId: 2,
  });
  if (result.response === 2) return false;
  if (result.response === 0) {
    const saved = await saveCurrentDocument(
      currentDocument.text,
      currentDocument.revision,
    );
    if (saved.canceled) return false;
  }
  return true;
}

async function chooseAndOpen() {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'rmd', 'qmd', 'mdx'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  if (!(await confirmReplaceCurrentDocument())) return null;
  return openPath(result.filePaths[0]);
}

async function confirmOverwriteIfChanged(): Promise<boolean> {
  if (!currentDocument) return false;
  try {
    const actual = snapshotStats(currentDocument.path);
    if (isSameDiskVersion(actual, currentDocument.diskVersion)) return true;
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

async function saveDocumentAs(text: string, revision: number): Promise<SaveResult> {
  const defaultPath = currentDocument?.isUntitled
    ? path.join(app.getPath('documents'), 'Untitled.md')
    : currentDocument?.path ?? path.join(app.getPath('documents'), 'Untitled.md');
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  notebookCache = null;
  return saveTo(result.filePath, text, revision);
}

async function saveCurrentDocument(text: string, revision: number): Promise<SaveResult> {
  if (!currentDocument) return { canceled: true };
  currentDocument = applyTextRevision(currentDocument, text, revision);
  if (currentDocument.isUntitled) return saveDocumentAs(text, revision);
  if (!(await confirmOverwriteIfChanged())) return { canceled: true };
  return saveTo(currentDocument.path, text, revision);
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
  mainWindow?.webContents.send('app:command', command);
}

function installMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new-document') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => void chooseAndOpen() },
        { type: 'separator' },
        { id: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('save-as') },
        { label: 'Export as PDF…', click: () => sendCommand('export-pdf') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Viewer / Editor', accelerator: 'CmdOrCtrl+E', click: () => sendCommand('toggle-surface') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  closeAfterConfirmation = false;
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 520,
    minHeight: 420,
    backgroundColor: '#f7f7f5',
    show: false,
    title: 'MarkTex',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (closeAfterConfirmation || !currentDocument || !isDirty(currentDocument)) return;
    event.preventDefault();
    void dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      message: `${currentDocument.name}의 변경 내용을 저장하시겠습니까?`,
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
    }).then(async ({ response }) => {
      if (response === 2 || !currentDocument) return;
      if (response === 0) {
        const saved = await saveCurrentDocument(
          currentDocument.text,
          currentDocument.revision,
        );
        if (saved.canceled) return;
      }
      closeAfterConfirmation = true;
      mainWindow?.close();
    }).catch((error) => dialog.showErrorBox('저장하지 못했습니다', String(error)));
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void mainWindow.loadURL(devServer);
  else void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function installIpc() {
  ipcMain.handle('document:get', () => currentDocument);
  ipcMain.handle('document:new', () => createNewDocument());
  ipcMain.handle('document:open', () => chooseAndOpen());
  ipcMain.on('document:update-text', (_event, { text, revision }) => {
    if (currentDocument) currentDocument = applyTextRevision(currentDocument, text, revision);
  });
  ipcMain.handle('document:render', (_event, { text, revision, documentPath }) =>
    renderCurrent(text, revision, documentPath),
  );
  ipcMain.handle('document:save', async (_event, { text, revision }): Promise<SaveResult> => {
    return saveCurrentDocument(text, revision);
  });
  ipcMain.handle('document:save-as', async (_event, { text, revision }): Promise<SaveResult> => {
    return saveDocumentAs(text, revision);
  });
  ipcMain.handle('document:export-pdf', (_event, { text, revision, documentPath }) =>
    exportCurrentPdf(text, revision, documentPath),
  );
  ipcMain.handle('document:reload', async () => {
    if (!currentDocument || currentDocument.isUntitled) return currentDocument;
    return openPath(currentDocument.path);
  });
  ipcMain.handle('document:open-link', async (_event, href: string) => {
    const decodedHref = decodeURIComponent(href);
    const localPath = pathFromResourceUrl(decodedHref);
    if (localPath) {
      const checked = assertReadablePath(localPath);
      if (/\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(checked)) {
        if (!(await confirmReplaceCurrentDocument())) return;
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
    if (markdownPath) {
      void confirmReplaceCurrentDocument().then((confirmed) => {
        if (confirmed) return openPath(path.resolve(markdownPath));
      });
    }
    mainWindow?.show();
    mainWindow?.focus();
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
    utility.useExternalAddFileProtocolFunction((filePath: string) => resourceUrl(filePath));
    installIpc();
    installMenu();
    const markdownPath = markdownPathFromArgs(process.argv);
    if (markdownPath) await openPath(path.resolve(markdownPath), false);
    createWindow();
  });

  app.on('before-quit', () => {
    stopWatching();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
