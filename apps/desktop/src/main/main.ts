import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} from 'electron';
import {
  promises as fs,
  readFileSync,
  statSync,
  unwatchFile,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  AppCommand,
  CloseDecision,
  DocumentSnapshot,
  SaveResult,
  ExportPdfResult,
  TabStateSummary,
  ThemeSnapshot,
} from '../shared/contracts';
import {
  DEFAULT_PREVIEW_THEME,
  codeThemeFile,
  normalizePreviewTheme,
  previewThemeBackground,
  previewThemeFile,
  type PreviewThemeId,
} from '../shared/preview-preferences';
import { themeProfile } from '../shared/theme-catalog';
import { isDirty } from '../shared/document-state';
import { canonicalPath, isInside } from './documents/file-system';
import {
  applicationMenuEntries,
  executeApplicationMenu,
  installApplicationMenu,
} from './menu/application-menu';
import { DocumentManager } from './documents/document-manager';
import { PreviewManager } from './preview/preview-manager';
import { PreviewRenderer } from './preview/preview-renderer';
import { TabTransferManager } from './tabs/tab-transfer-manager';
import { windowIpc } from './ipc/window-ipc';
import type { WindowState } from './windows/window-state';
import { resourceUrl } from './preview/resource-url';

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

const windowStates = new Map<number, WindowState>();
// Preview WebContents와 warmup 문서의 수명주기는 PreviewManager가 소유한다.
// Preview 생성·표시·복원은 PreviewManager에 위임한다.
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

let globalPreviewTheme: PreviewThemeId = DEFAULT_PREVIEW_THEME;
let globalThemeRevision = 0;

const crossnoteEntry = require.resolve('crossnote');
const crossnoteOut = path.resolve(path.dirname(crossnoteEntry), '..');

function assertReadablePath(candidate: string): string {
  const resolved = canonicalPath(candidate);
  const roots = [
    crossnoteOut,
    ...Array.from(windowStates.values(), (state) => state.activeRoot),
  ].filter((root): root is string => !!root);
  if (!roots.some((root) => isInside(canonicalPath(root), resolved))) {
    throw new Error('The preview attempted to read outside the document folder.');
  }
  return resolved;
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

/**
 * Preview 페이지의 theme은 template에 구워진다. 그 뒤로 그것을 바꾸는 것은
 * `marktex:apply-theme` 하나뿐이다. 어느 view가 지금 무엇을 그리고 있는지는
 * 여기 한 곳에서만 센다. webContents.id로 세므로 예비 view가 탭으로
 * 채택되거나 탭이 다른 창으로 넘어가도 장부가 따라간다.
 */
const previews = new PreviewManager({
  preload: path.join(__dirname, 'preview-preload.cjs'),
  stateFor: stateForWebContentsId,
  theme: () => globalPreviewTheme,
  themeAssets: previewThemeAssets,
  forgetTab: (tabId) => renderer.forgetTab(tabId),
});
const renderer = new PreviewRenderer({
  previews,
  roots: () => Array.from(windowStates.values(), (state) => state.activeRoot)
    .filter((root): root is string => !!root),
  theme: () => globalPreviewTheme,
  workerPath: path.join(__dirname, 'render-worker.cjs'),
});
const documents = new DocumentManager(() => renderer.forgetNotebooks());
const transfers = new TabTransferManager({
  previews,
  stateFor: stateForWebContentsId,
  theme: () => globalPreviewTheme,
  createWindow,
});
const windowChannels = windowIpc(stateForWebContentsId);
function pathFromResourceUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'marktex-resource:') return null;
    return fileURLToPath(`file://${url.pathname}`);
  } catch {
    return null;
  }
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
  state: WindowState,
  text: string,
  revision: number,
  documentPath: string,
): Promise<ExportPdfResult> {
  const document = state.currentDocument;
  if (!document || document.path !== documentPath) return { canceled: true };
  const baseName = document.name.replace(/\.[^.]+$/, '') || 'document';
  const result = await dialog.showSaveDialog(state.window, {
    defaultPath: path.join(
      document.isUntitled ? app.getPath('documents') : path.dirname(document.path),
      `${baseName}.pdf`,
    ),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const url = await renderer.renderExport(state, text, revision, documentPath);
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
    await printWindow.loadURL(url);
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
  // 예비 view는 탭이 아니어서 renderer의 theme 전파가 닿지 않는다. 여기서
  // 맞춰 두지 않으면 다음에 여는 문서가 옛 theme으로 떠오른다.
  previews.setTheme(themeId);
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
    previews.resizeOwner(webContentsId, contentWidth, contentHeight);
  });
  createdWindow.on('close', (event) => {
    if (state.closeAfterConfirmation) return;
    const dirtyTabs = state.rendererTabs.filter((tab) => tab.dirty);
    // renderer가 탭 상태를 보낸 뒤에는 문자열 기반 판정을 신뢰한다. revision만
    // 보고 fallback하면 편집 후 원문으로 되돌린 clean 탭도 다시 dirty가 된다.
    if (
      state.rendererTabs.length === 0
      && state.currentDocument
      && isDirty(state.currentDocument)
    ) {
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
          .map((tab) => documents.discardDraft(tab.path)));
        state.closeAfterConfirmation = true;
        createdWindow.close();
        return;
      }
      createdWindow.webContents.send('app:save-before-close');
    }).catch((error) => dialog.showErrorBox('창을 닫지 못했습니다', String(error)));
  });
  createdWindow.on('closed', () => {
    if (state.watchedPath) unwatchFile(state.watchedPath);
    previews.closeOwner(webContentsId);
    windowStates.delete(webContentsId);
    if (mainWindow === createdWindow) mainWindow = BrowserWindow.getAllWindows()[0] ?? null;
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void createdWindow.loadURL(devServer);
  else void createdWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return createdWindow;
}

// IPC endpoints are registered together so startup has one explicit boundary.

function installIpc() {
  previews.registerIpc();

  windowChannels.handle('menu:get', (_state, menuId: unknown) => applicationMenuEntries(menuId));
  windowChannels.on('menu:execute', (state, itemId: unknown) =>
    executeApplicationMenu(itemId, state.window));
  windowChannels.handle('theme:get', (): ThemeSnapshot =>
    ({ id: globalPreviewTheme, revision: globalThemeRevision }));
  windowChannels.handle('preview:theme-assets', (_state, themeId: unknown) =>
    previewThemeAssets(themeId));
  windowChannels.handle('document:get', (state) => state.currentDocument);
  windowChannels.handle('document:new', (state) => documents.newDocument(state));
  windowChannels.handle(
    'document:activate',
    (state, { document, text, revision }: {
      document: DocumentSnapshot; text: string; revision: number;
    }) => documents.activate(state, document, text, revision),
  );
  windowChannels.on('tabs:update-state', (state, tabs: TabStateSummary[]) => {
    state.rendererTabs = Array.isArray(tabs)
      ? tabs.map((tab) => ({
        name: String(tab.name),
        path: String(tab.path),
        dirty: Boolean(tab.dirty),
        isUntitled: Boolean(tab.isUntitled),
      }))
      : [];
  });
  transfers.registerIpc();
  windowChannels.on('app:close-empty-window', (state) => {
    if (state.rendererTabs.length > 0) return;
    state.closeAfterConfirmation = true;
    state.window.close();
  });
  // invoke의 반환값으로 renderer가 직접 문서를 설치하므로 opened 이벤트를
  // 함께 보내지 않는다. 두 경로가 겹치면 showDocument가 같은 문서를 두 번
  // 초기화하여 진행 중 Preview를 무효화한다.
  windowChannels.handle('document:open', (state) => documents.chooseAndOpen(state, false));
  windowChannels.on(
    'document:update-text',
    (state, { text, revision }: { text: string; revision: number }) =>
      documents.updateText(state, text, revision),
  );
  windowChannels.handle(
    'preview:prepare',
    (state, request: {
      tabId: unknown; text: string; revision: number; documentPath: string; themeId: unknown;
    }) => renderer.prepare(
      state, String(request.tabId), request.text, request.revision, request.documentPath,
      normalizePreviewTheme(request.themeId), state.window.webContents.id,
    ),
  );
  windowChannels.handle(
    'document:save',
    (state, { text, revision }: { text: string; revision: number }): Promise<SaveResult> =>
      documents.saveCurrent(state, text, revision),
  );
  windowChannels.handle(
    'document:save-as',
    (state, { text, revision }: { text: string; revision: number }): Promise<SaveResult> =>
      documents.saveAs(state, text, revision),
  );
  windowChannels.handle(
    'document:save-tab',
    async (state, { document, text, revision }: {
      document: DocumentSnapshot; text: string; revision: number;
    }): Promise<SaveResult> => {
      const wasCurrent = state.currentDocument?.path === document.path;
      const result = await documents.saveSnapshot(state, document, text, revision);
      if (wasCurrent && !result.canceled && result.document) {
        state.currentDocument = result.document;
        state.activeRoot = path.dirname(result.document.path);
        documents.watch(state);
      }
      return result;
    },
  );
  windowChannels.handle('document:confirm-close', async (state, name: string): Promise<CloseDecision> => {
    const { response } = await dialog.showMessageBox(state.window, {
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
    await documents.discard(document);
  });
  windowChannels.on('app:finish-window-close', (state, saved: boolean) => {
    if (!saved) return;
    state.closeAfterConfirmation = true;
    state.window.close();
  });
  windowChannels.handle(
    'document:export-pdf',
    (state, { text, revision, documentPath }: {
      text: string; revision: number; documentPath: string;
    }) => exportCurrentPdf(state, text, revision, documentPath),
  );
  windowChannels.handle('document:paste-clipboard-image', (state) => documents.pasteImage(state));
  windowChannels.handle('document:pick-link-target', (state, documentPath: string) =>
    documents.pickLink(state, documentPath));
  windowChannels.handle('document:reload', (state) => documents.reload(state));
  windowChannels.handle('document:open-link', async (state, href: string) => {
    let decodedHref: string;
    try {
      decodedHref = decodeURIComponent(String(href));
    } catch {
      return;
    }
    const localPath = pathFromResourceUrl(decodedHref);
    if (localPath) {
      // resource protocol의 일반 요청은 문서 root 안으로 제한하지만, 링크 클릭은
      // 사용자가 명시적으로 선택한 navigation이다. 그래서 ../로 연결된 파일도
      // 열되 실제 일반 파일인지 확인하고, Markdown만 앱 탭으로 들인다.
      const checked = canonicalPath(localPath);
      try {
        if (!(await fs.stat(checked)).isFile()) return;
      } catch {
        return;
      }
      if (/\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(checked)) {
        // 자기 자신으로 가는 링크 때문에 저장하지 않은 현재 문서를 디스크
        // snapshot으로 덮어쓰지 않는다.
        if (state.currentDocument && canonicalPath(state.currentDocument.path) === checked) return;
        const document = await documents.open(state, checked, false);
        state.window.webContents.send('document:opened', document);
      } else {
        await shell.openPath(checked);
      }
      return;
    }
    try {
      const url = new URL(decodedHref);
      if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
        await shell.openExternal(url.href);
      }
    } catch {
      // 상대 주소는 bridge에서 절대 주소로 바뀌어 와야 한다.
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
      void documents.open(state, path.resolve(markdownPath));
    }
    state?.window.show();
    state?.window.focus();
  });

  app.whenReady().then(async () => {
    protocol.handle('marktex-preview', (request) => {
      const token = new URL(request.url).pathname.slice(1);
      const html = previews.html(token);
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
    installApplicationMenu({
      focusedState,
      createWindow,
      openDocument: (state) => documents.chooseAndOpen(state),
      sendCommand,
      setTheme: setGlobalPreviewTheme,
      theme: () => globalPreviewTheme,
    });
    // 조판 worker는 crossnote를 읽어 들이는 데만 0.6초를 쓴다. 첫 요청을
    // 기다렸다 fork하면 그 시간이 renderer 부팅 뒤에 그대로 붙는다. 여기서
    // 미리 띄우면 renderer가 뜨는 동안 나란히 준비된다.
    renderer.warmup();
    const markdownPath = markdownPathFromArgs(process.argv);
    const initialDocument = markdownPath
      ? await documents.read(path.resolve(markdownPath))
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
