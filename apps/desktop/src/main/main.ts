/** Electron main process composition root. */
import { app, BrowserWindow, dialog, net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppCommand, DocumentSnapshot } from '../protocol/desktop-api';
import { isMarkdownDocument } from '../core/document/document-profile';
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
  { scheme: 'marktex-resource', privileges: { standard: true, secure: true, supportFetchAPI: true } },
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
const documents = new DocumentManager(() => renderer.forgetNotebooks());
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
  const roots = [crossnoteRoot, ...Array.from(registry.values).flatMap((state) => [state.activeRoot, state.projectRoot])]
    .filter((root): root is string => !!root);
  if (!roots.some((root) => isInside(canonicalPath(root), resolved))) {
    throw new Error('The preview attempted to read outside the document folder.');
  }
  return resolved;
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
    try { return net.fetch(pathToFileURL(readableResource(filePath)).href); }
    catch { return new Response('Resource is outside the allowed roots', { status: 403 }); }
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
    installIpc({ channels, documents, previews, projects, renderer, themes, transfers });
    const terminals = installTerminalIpc(channels);
    app.on('before-quit', () => terminals.dispose());
    installApplicationMenu({ focusedState: () => registry.focused(), createWindow: windows.create,
      openDocument: (state) => documents.chooseAndOpen(state).catch(openError),
      reloadWindow: (state) => { previews.closeOwner(state.webContentsId); state.window.webContents.reload(); },
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
