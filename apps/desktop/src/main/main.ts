import { installZoomSettings } from './windows/zoom-settings';
/** Electron main process composition root. */
import { ReadingPositionStore } from './reading/reading-position-store';
import { installReadingIpc } from './reading/reading-ipc';
import { app, BrowserWindow, dialog, net, protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppCommand, DocumentSnapshot } from '../protocol/desktop-api';
import { isMarkdownDocument, isVideoDocument, videoMimeType } from '../core/document/document-profile';
import { documentPathFromArgs } from './documents/document-args';
import { canonicalPath, isInside } from './documents/file-system';
import { DocumentManager } from './documents/document-manager';
import { installIpc } from './ipc/install-ipc';
import { windowIpc } from './ipc/window-ipc';
import { installApplicationMenu } from './menu/application-menu';
import { PreviewManager } from './preview/preview-manager';
import { PreviewRenderer } from './preview/preview-renderer';
import { ProjectService } from './project/project-service';
import { ProjectSearchRenderer } from './project/project-search-renderer';
import { pathFromResourceUrl } from './preview/resource-url';
import { TabTransferManager } from './tabs/tab-transfer-manager';
import { ThemeManager } from './theme/theme-manager';
import { WindowManager } from './windows/window-manager';
import { installTerminalIpc } from './terminal/terminal-ipc';
import { WindowRegistry } from './windows/window-registry';

app.setName('Setdown');
protocol.registerSchemesAsPrivileged([
  { scheme: 'marktex-resource', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'marktex-preview', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const registry = new WindowRegistry();
const crossnoteEntry = require.resolve('crossnote');
const crossnoteRoot = path.resolve(path.dirname(crossnoteEntry), '..');
let previews: PreviewManager;
let renderer: PreviewRenderer;
const themes = new ThemeManager({ crossnoteRoot, windows: () => registry.values,
  updatePreviews: (theme) => previews.setTheme(theme) });
previews = new PreviewManager({ preload: path.join(__dirname, 'preview-preload.cjs'),
  stateFor: (id) => registry.stateForWebContents(id), theme: () => themes.id,
  themeAssets: (theme) => themes.assets(theme), forgetTab: (tabId) => renderer.forgetTab(tabId) });
renderer = new PreviewRenderer({ previews,
  roots: () => Array.from(registry.values).flatMap((state) => [state.activeRoot, state.projectRoot])
    .filter((root): root is string => !!root),
  theme: () => themes.id, workerPath: path.join(__dirname, 'render-worker.cjs') });
const positions = new ReadingPositionStore(path.join(app.getPath('userData'), 'reading-positions.json'));
const documents = new DocumentManager(() => renderer.forgetNotebooks(), positions);
const projectSearchRenderer = new ProjectSearchRenderer(path.join(__dirname, 'render-worker.cjs'), () => themes.id);
const projects = new ProjectService((documentPath, text, query, limit, root) =>
  projectSearchRenderer.search(documentPath, text, query, limit, root));
const windows = new WindowManager({ registry, previews, themes });
const transfers = new TabTransferManager({ previews, stateFor: (id) => registry.stateForWebContents(id),
  theme: () => themes.id, createWindow: windows.create });
const channels = windowIpc((id) => registry.stateForWebContents(id));
function sendCommand(command: AppCommand): void { registry.focused()?.window.webContents.send('app:command', command); }
function openError(error: unknown): void {
  dialog.showErrorBox('Could not open the file', error instanceof Error ? error.message : String(error));
}
function readableResource(candidate: string): string {
  const resolved = canonicalPath(candidate);
  const states = Array.from(registry.values);
  const roots = [crossnoteRoot, ...states.flatMap((state) => [state.activeRoot, state.projectRoot])]
    .filter((root): root is string => !!root);
  if (roots.some((root) => isInside(canonicalPath(root), resolved))) return resolved;
  // An open video tab keeps streaming even after the active document moves away
  // from its folder; the same ownership rule as the reading IPC applies.
  if (isVideoDocument(resolved) && states.some((state) => state.currentDocument?.path === resolved
    || state.rendererTabs.some((tab) => !tab.isUntitled && tab.path === resolved))) return resolved;
  throw new Error('The preview attempted to read outside the document folder.');
}
async function videoResponse(request: Request, filePath: string): Promise<Response> {
  const { size } = await fs.stat(filePath);
  const headers = { 'content-type': videoMimeType(filePath) ?? 'application/octet-stream', 'accept-ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (!range || (!range[1] && !range[2])) {
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream,
      { headers: { ...headers, 'content-length': String(size) } });
  }
  let start: number;
  let end = size - 1;
  if (range[1]) {
    start = parseInt(range[1], 10);
    if (range[2]) end = Math.min(parseInt(range[2], 10), size - 1);
  } else {
    start = Math.max(0, size - parseInt(range[2], 10));
  }
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }
  return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream,
    { status: 206, headers: { ...headers, 'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}` } });
}
function installProtocols(): void {
  protocol.handle('marktex-preview', (request) => {
    const token = new URL(request.url).pathname.slice(1);
    const html = previews.html(token);
    return html ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      : new Response('Preview expired', { status: 404 });
  });
  protocol.handle('marktex-resource', (request) => {
    const filePath = pathFromResourceUrl(request.url);
    if (!filePath) return new Response('Bad resource URL', { status: 400 });
    let resolved: string;
    try { resolved = readableResource(filePath); }
    catch { return new Response('Resource is outside the allowed roots', { status: 403 }); }
    // Media elements seek with Range requests; answer them from an explicit
    // stream instead of buffering the whole file through net.fetch.
    if (isVideoDocument(resolved)) return videoResponse(request, resolved);
    return net.fetch(pathToFileURL(resolved).href);
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    const filePath = documentPathFromArgs(argv, app.isPackaged);
    const state = registry.focused();
    if (filePath && state) void documents.open(state, filePath).catch(openError);
    state?.window.show(); state?.window.focus();
  });
  app.whenReady().then(async () => {
    installProtocols(); themes.load();
    const flushZoom = installZoomSettings(path.join(app.getPath('userData'), 'zoom-settings.json'), previews.zoom, () => {
      for (const state of registry.values) if (!state.window.isDestroyed())
        state.window.webContents.send('workspace:zoom-changed', previews.zoom.snapshot);
    });
    app.on('will-quit', flushZoom);
    installIpc({ channels, documents, previews, projects, renderer, themes, transfers });
    installReadingIpc(channels, positions, (id) => registry.stateForWebContents(id));
    app.on('will-quit', () => positions.flush());
    const terminals = installTerminalIpc(channels);
    app.on('before-quit', () => terminals.dispose());
    installApplicationMenu({ focusedState: () => registry.focused(), createWindow: windows.create,
      openDocument: (state) => documents.chooseAndOpen(state).catch(openError),
      reloadWindow: (state) => { previews.closeOwner(state.webContentsId); state.window.webContents.reload(); },
      zoom: (steps, scope) => { previews.zoom.change(steps, scope); },
      sendCommand, setTheme: (theme) => themes.set(theme), theme: () => themes.id });
    const filePath = documentPathFromArgs(process.argv, app.isPackaged);
    // Keep Markdown's eager worker warmup; a source-only startup needs none.
    if (!filePath || isMarkdownDocument(filePath)) renderer.warmup();
    let initialDocument: DocumentSnapshot | null = null;
    if (filePath) {
      try { initialDocument = await documents.read(filePath); } catch (error) { openError(error); }
    }
    windows.create(null, initialDocument);
  });
  app.on('before-quit', () => { windows.disposeWatchers(); void projects.dispose(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) windows.create(); });
}
