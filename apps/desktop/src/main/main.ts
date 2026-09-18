/** Electron main process의 composition root. */
import { app, BrowserWindow, net, protocol } from 'electron';
import { statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppCommand } from '../protocol/desktop-api';
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
import { WindowRegistry } from './windows/window-registry';

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

const registry = new WindowRegistry();
const crossnoteEntry = require.resolve('crossnote');
const crossnoteRoot = path.resolve(path.dirname(crossnoteEntry), '..');

let previews: PreviewManager;
let renderer: PreviewRenderer;
const themes = new ThemeManager({
  crossnoteRoot,
  windows: () => registry.values,
  updatePreviews: (theme) => previews.setTheme(theme),
});
previews = new PreviewManager({
  preload: path.join(__dirname, 'preview-preload.cjs'),
  stateFor: (id) => registry.stateForWebContents(id),
  theme: () => themes.id,
  themeAssets: (theme) => themes.assets(theme),
  forgetTab: (tabId) => renderer.forgetTab(tabId),
});
renderer = new PreviewRenderer({
  previews,
  roots: () => Array.from(registry.values)
    .flatMap((state) => [state.activeRoot, state.projectRoot])
    .filter((root): root is string => !!root),
  theme: () => themes.id,
  workerPath: path.join(__dirname, 'render-worker.cjs'),
});
const documents = new DocumentManager(() => renderer.forgetNotebooks());
const projectSearchRenderer = new ProjectSearchRenderer(
  path.join(__dirname, 'render-worker.cjs'),
  () => themes.id,
);
const projects = new ProjectService((documentPath, text, query, limit, root) =>
  projectSearchRenderer.search(documentPath, text, query, limit, root));
const windows = new WindowManager({ registry, previews, themes });
const transfers = new TabTransferManager({
  previews,
  stateFor: (id) => registry.stateForWebContents(id),
  theme: () => themes.id,
  createWindow: windows.create,
});
const channels = windowIpc((id) => registry.stateForWebContents(id));

function sendCommand(command: AppCommand): void {
  registry.focused()?.window.webContents.send('app:command', command);
}

function readableResource(candidate: string): string {
  const resolved = canonicalPath(candidate);
  const roots = [
    crossnoteRoot,
    ...Array.from(registry.values)
      .flatMap((state) => [state.activeRoot, state.projectRoot]),
  ].filter((root): root is string => !!root);
  if (!roots.some((root) => isInside(canonicalPath(root), resolved))) {
    throw new Error('The preview attempted to read outside the document folder.');
  }
  return resolved;
}

function installProtocols(): void {
  protocol.handle('marktex-preview', (request) => {
    const token = new URL(request.url).pathname.slice(1);
    const html = previews.html(token);
    return html
      ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      : new Response('Preview expired', { status: 404 });
  });
  protocol.handle('marktex-resource', (request) => {
    const filePath = pathFromResourceUrl(request.url);
    if (!filePath) return new Response('Bad resource URL', { status: 400 });
    try {
      return net.fetch(pathToFileURL(readableResource(filePath)).href);
    } catch {
      return new Response('Resource is outside the allowed roots', { status: 403 });
    }
  });
}

function markdownPathFromArgs(args: string[]): string | undefined {
  return args.find((arg) => {
    if (!/\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(arg)) return false;
    try {
      return statSync(path.resolve(arg)).isFile();
    } catch {
      return false;
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const markdownPath = markdownPathFromArgs(argv);
    const state = registry.focused();
    if (markdownPath && state) void documents.open(state, path.resolve(markdownPath));
    state?.window.show();
    state?.window.focus();
  });

  app.whenReady().then(async () => {
    installProtocols();
    themes.load();
    installIpc({ channels, documents, previews, projects, renderer, themes, transfers });
    installApplicationMenu({
      focusedState: () => registry.focused(),
      createWindow: windows.create,
      openDocument: (state) => documents.chooseAndOpen(state),
      reloadWindow: (state) => {
        previews.closeOwner(state.webContentsId);
        state.window.webContents.reload();
      },
      sendCommand,
      setTheme: (theme) => themes.set(theme),
      theme: () => themes.id,
    });
    renderer.warmup();
    const markdownPath = markdownPathFromArgs(process.argv);
    const initialDocument = markdownPath
      ? await documents.read(path.resolve(markdownPath))
      : null;
    windows.create(null, initialDocument);
  });

  app.on('before-quit', () => windows.disposeWatchers());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.create();
  });
}
