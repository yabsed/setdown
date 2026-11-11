import { BrowserManager } from './browser/browser-manager';
import { installZoomSettings } from './windows/zoom-settings';
/** Electron main process composition root. */
import { ReadingPositionStore } from './reading/reading-position-store';
import { installReadingIpc } from './reading/reading-ipc';
import { app, BrowserWindow, dialog, net, protocol, powerMonitor } from 'electron';
import { spawn } from 'node:child_process';
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
import { AutoSaveStore } from './settings/auto-save-store';
import { PreviewManager } from './preview/preview-manager';
import { PreviewRenderer } from './preview/preview-renderer';
import { ProjectService } from './project/project-service';
import { RecentFolders } from './project/recent-folders';
import { ProjectSearchRenderer } from './project/project-search-renderer';
import { pathFromResourceUrl } from './preview/resource-url';
import { TabTransferManager } from './tabs/tab-transfer-manager';
import { ThemeManager } from './theme/theme-manager';
import { WindowManager } from './windows/window-manager';
import { TerminalManager } from './terminal/terminal-manager';
import { installTerminalIpc } from './terminal/terminal-ipc';
import { WindowRegistry } from './windows/window-registry';
import { LanguageManager } from './language/language-manager';
import { displayBackend, hasGlobalWindowPositions } from './windows/display-backend';
import { MemoryMonitor } from './memory/memory-monitor';
import { installX11Pinch } from './windows/x11-pinch';
import { installPathPicker } from './dialogs/path-picker';
import { FolderRequests, folderRequestFromArgs, requestsFromFileManagerCall, startFileManagerDbus } from './files/file-manager-launch';

// Electron populates its own default ozone switch before running main. Only an
// actual launch argument is an explicit user choice.
const ozoneArgument = process.argv.find(value => value.startsWith('--ozone-platform='))?.split('=')[1]
  ?? (process.argv.includes('--ozone-platform') ? process.argv[process.argv.indexOf('--ozone-platform') + 1] : '');
const backend = displayBackend(process.platform, process.env, ozoneArgument ?? '');
if (backend === 'x11' && app.commandLine.getSwitchValue('ozone-platform') !== 'x11') {
  // Ozone is initialized before the application entry point. Changing only the
  // switch here leaves native windows on the old backend and breaks focus.
  const args = process.argv.slice(1).filter(value => !value.startsWith('--ozone-platform='));
  const separate = args.indexOf('--ozone-platform');
  if (separate >= 0) args.splice(separate, 2);
  // Electron's Chromium relauncher sets Linux no_new_privs on its child. That
  // irreversible flag reaches every PTY and prevents sudo from working. Node
  // spawn preserves the caller's privileges without changing renderer sandboxing.
  // This handoff runs before acquiring the single-instance lock or opening files.
  const replacement = spawn(process.execPath, ['--ozone-platform=x11', ...args], {
    detached: true, stdio: 'inherit',
  });
  if (!replacement.pid) {
    console.error('Could not restart Setdown with the X11 display backend.');
    app.exit(1);
  }
  replacement.unref();
  app.exit(0);
}
app.setName('Setdown');
protocol.registerSchemesAsPrivileged([
  { scheme: 'marktex-resource', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'marktex-preview', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const registry = new WindowRegistry();
const crossnoteEntry = require.resolve('crossnote');
const crossnoteRoot = path.resolve(path.dirname(crossnoteEntry), '..');
let previews: PreviewManager;
let renderer: PreviewRenderer;
const themes = new ThemeManager({ crossnoteRoot, windows: () => registry.values,
  updatePreviews: (theme) => { previews.setTheme(theme); browsers.webThemes.refresh(); } });
const previewCacheDirectory = path.join(app.getPath('userData'), 'preview-cache');
previews = new PreviewManager({ cacheDirectory: previewCacheDirectory, preload: path.join(__dirname, 'preview-preload.cjs'),
  stateFor: (id) => registry.stateForWebContents(id), theme: () => themes.id,
  themeAssets: (theme) => themes.assets(theme), forgetTab: (tabId) => renderer.forgetTab(tabId) });
renderer = new PreviewRenderer({ previews,
  roots: () => Array.from(registry.values).flatMap((state) => [state.activeRoot, state.projectRoot])
    .filter((root): root is string => !!root),
  theme: () => themes.id, workerPath: path.join(__dirname, 'render-worker.cjs') });
const positions = new ReadingPositionStore(path.join(app.getPath('userData'), 'reading-positions.json'));
const autoSave = new AutoSaveStore(path.join(app.getPath('userData'), 'auto-save.json'));
const documents = new DocumentManager(() => renderer.forgetNotebooks(), positions);
const projectSearchRenderer = new ProjectSearchRenderer(path.join(__dirname, 'render-worker.cjs'), () => themes.id);
const projects = new ProjectService((documentPath, text, query, limit, root) =>
  projectSearchRenderer.search(documentPath, text, query, limit, root), undefined, () => registry.values,
  new RecentFolders(path.join(app.getPath('userData'), 'recent-folders.json')));
const windows = new WindowManager({ registry, previews, themes });
const browsers: BrowserManager = new BrowserManager({ createWindow: () => windows.create(null, null, false), stateFor: id => registry.stateForWebContents(id), states: () => registry.values, zoom: previews.zoom,
  memoryProtected: id => transfers.memoryProtectedIds().includes(id),
  fullscreenChanged: (owner, active) => previews.suspendPresentation(owner, active),
  globalTabDragPointer: process.platform === 'linux' && ['', 'auto', 'x11'].includes(backend)
    && hasGlobalWindowPositions(process.platform, process.env, backend),
  openFile: (state, file) => documents.open(state, file), theme: () => themes.id });
let lastPressure = 'normal';
const memory = new MemoryMonitor(async (pressure, contexts) => {
  const moving = transfers.memoryProtectedIds();
  const protectedContexts = new Map([...contexts].map(([owner, context]) => [owner, { ...context, protected: [...context.protected, ...moving] }]));
  previews.reclaim(pressure, protectedContexts); renderer.reclaim(pressure); projectSearchRenderer.reclaim(pressure);
  await browsers.reclaim(pressure, contexts);
  if (pressure !== lastPressure) {
    lastPressure = pressure;
    for (const state of registry.values) if (!state.window.isDestroyed()) state.window.webContents.send('memory:pressure', pressure);
  }
}, () => ({ ...previews.memoryStats, ...renderer.memoryStats, ...browsers.memoryStats, searchWorkers: Number(projectSearchRenderer.running) }));
const memoryCrashes: Array<{ at: number; reason: string; exitCode: number; type: string; memory: typeof memory.snapshot }> = [];
let crashWrite = Promise.resolve();
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    memoryCrashes.push({ at: Date.now(), reason: details.reason, exitCode: details.exitCode, type: contents.getType(), memory: memory.snapshot });
    if (memoryCrashes.length > 16) memoryCrashes.shift();
    const data = JSON.stringify(memoryCrashes, null, 2);
    crashWrite = crashWrite.then(() => fs.writeFile(path.join(app.getPath('userData'), 'memory-crashes.json'), data, { mode: 0o600 })).catch(console.error);
  });
});
const terminals = new TerminalManager();
const transfers: TabTransferManager = new TabTransferManager({ previews, browsers, terminals, stateFor: (id) => registry.stateForWebContents(id),
  globalWindowPositions: hasGlobalWindowPositions(process.platform, process.env, backend),
  windows: () => registry.values, theme: () => themes.id, createWindow: windows.create });
const channels = windowIpc((id) => registry.stateForWebContents(id));
function sendCommand(command: AppCommand): void { registry.focused()?.window.webContents.send('app:command', command); }
const folderRequests = new FolderRequests();
/** Show a folder in the focused window, creating one when Setdown has none. */
function showFolder(request: import('../core/files/folder-types').FolderOpenRequest): void {
  if (!registry.focused()) windows.create();
  const state = registry.focused();
  if (state) folderRequests.deliver(state, request);
}
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
  protocol.handle('marktex-preview', async (request) => {
    const token = new URL(request.url).pathname.slice(1);
    const html = await previews.html(token);
    return html ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      : new Response('Preview expired', { status: 404 });
  });
  protocol.handle('marktex-resource', async (request) => {
    const filePath = pathFromResourceUrl(request.url);
    if (!filePath) return new Response('Bad resource URL', { status: 400 });
    let resolved: string;
    try { resolved = readableResource(filePath); }
    catch { return new Response('Resource is outside the allowed roots', { status: 403 }); }
    // Media elements seek with Range requests; answer them from an explicit
    // stream instead of buffering the whole file through net.fetch.
    const response = isVideoDocument(resolved) ? await videoResponse(request, resolved)
      : await net.fetch(pathToFileURL(resolved).href);
    // Shell/preview origins differ from this local resource origin. Chromium
    // requires a CORS-enabled scheme even for fetch() of a permitted file range.
    // The canonical-path/root check above still gates every resource read.
    const headers = new Headers(response.headers);
    headers.set('access-control-allow-origin', '*');
    headers.set('access-control-expose-headers', 'Content-Range, Accept-Ranges');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  // macOS Finder delivers files through open-file, not argv, including while running.
  const queuedOpenFiles: string[] = [];
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    const state = registry.focused();
    if (state) void documents.open(state, filePath).catch(openError);
    else queuedOpenFiles.push(filePath);
  });
  app.on('second-instance', (_event, argv) => {
    const filePath = documentPathFromArgs(argv, app.isPackaged);
    const state = registry.focused();
    if (filePath && state) void documents.open(state, filePath).catch(openError);
    // `setdown <folder>` (the inode/directory handler) and `setdown --files` open a folder tab.
    const folder = filePath ? null : folderRequestFromArgs(argv, app.isPackaged);
    if (folder) { showFolder(folder); return; }
    state?.window.show(); state?.window.focus();
  });
  app.whenReady().then(async () => {
    if (process.platform === 'linux' && process.env.DISPLAY && hasGlobalWindowPositions(process.platform, process.env, backend)) installX11Pinch();
    // Owned regenerable disk cache, including residue after a previous crash.
    // Do not use /tmp: on Linux it commonly consumes tmpfs RAM.
    await fs.rm(previewCacheDirectory, { recursive: true, force: true });
    installProtocols(); themes.load(); autoSave.load();
    const languages = new LanguageManager(id => registry.stateForWebContents(id));
    languages.install();
    projects.setLanguageFileOperations((state, operation, phase) => languages.fileOperation(state, operation, phase));
    app.on('browser-window-created', (_event, window) => window.once('closed', () => setImmediate(() => {
      if (!Array.from(registry.values).length) browsers.dispose();
    })));
    const flushZoom = installZoomSettings(path.join(app.getPath('userData'), 'zoom-settings.json'), previews.zoom, () => {
      for (const state of registry.values) if (!state.window.isDestroyed())
        state.window.webContents.send('workspace:zoom-changed', previews.zoom.snapshot);
    });
    app.on('will-quit', flushZoom);
    installIpc({ channels, documents, previews, projects, renderer, themes, transfers, autoSave, browsers, folderRequests });
    installPathPicker(channels, (id) => registry.stateForWebContents(id));
    browsers.registerIpc(channels);
    channels.on('memory:context', (state, context: unknown) => {
      const first = !memory.contexts.has(state.webContentsId);
      memory.context(state.webContentsId, context);
      if (first) {
        state.window.webContents.send('memory:pressure', memory.snapshot.pressure);
        const owner = state.webContentsId;
        state.window.once('closed', () => memory.contexts.delete(owner));
      }
    });
    channels.handle('memory:snapshot', () => memory.sample());
    channels.handle('memory:reclaim', () => memory.trim());
    memory.start();
    app.on('will-quit', () => { memory.stop(); previews.dispose(); });
    installReadingIpc(channels, positions, (id) => registry.stateForWebContents(id));
    app.on('will-quit', () => positions.flush());
    powerMonitor.on('resume', () => { for (const state of registry.values) state.checkDocumentVersions?.(); });
    installTerminalIpc(channels, terminals);
    app.on('will-quit', () => terminals.dispose());
    installApplicationMenu({ showMemory: () => { void (async () => {
      const state = registry.focused(); if (!state) return;
      const snapshot = await memory.sample();
      const mb = (bytes: number) => `${Math.round(bytes / 1048576)} MiB`;
      const answer = await dialog.showMessageBox(state.window, { title: 'Memory Usage', message: `Setdown: ${mb(snapshot.appBytes)} (${snapshot.metric})`,
        detail: `Available: ${mb(snapshot.available)}\nApp budget: ${mb(snapshot.budget)}\nPressure: ${snapshot.pressure}\n`
          + Object.entries(snapshot.resources).map(([key, value]) => `${key}: ${key.endsWith('Bytes') ? mb(value) : value}`).join('\n')
          + '\n\nInactive tabs can sleep automatically. Edited forms, media and visible tabs remain awake.',
        buttons: ['Close', 'Reclaim Inactive Resources'], defaultId: 0, cancelId: 0 });
      if (answer.response === 1) await memory.trim();
    })().catch(console.error); }, focusedState: () => registry.focused(), createWindow: windows.create,
      openDocument: (state) => documents.chooseAndOpen(state).catch(openError),
      reloadWindow: (state, ignoreCache) => {
        if (browsers.reloadFocused(state.webContentsId, ignoreCache)) return;
        state.window.webContents.send('app:command', 'reload-document');
      },
      zoom: (steps, scope) => {
        const state = registry.focused();
        const id = state && previews.zoom.activeTab(state.webContentsId);
        if (scope && scope !== 'app') { if (id) previews.zoom.changeTab(id, steps); }
        else previews.zoom.change(steps);
      },
      selectReaderContents: state => {
        const id = previews.zoom.activeTab(state.webContentsId);
        if (!id || !browsers.readerReady(state.webContentsId, id) || browsers.views.get(id)?.view.getVisible()) return false;
        state.window.webContents.send('app:command', 'reader-select-all'); return true;
      },
      sendCommand, setTheme: (theme) => themes.set(theme), theme: () => themes.id,
      webTheme: () => browsers.webThemes.snapshot().mode === 'app',
      toggleWebTheme: () => { void browsers.webThemes.update({ mode: browsers.webThemes.snapshot().mode === 'app' ? 'original' : 'app' })
        .catch(error => console.error('Could not save web theme settings:', error)); },
      autoSave: () => autoSave.enabled,
      toggleAutoSave: () => {
        autoSave.set(!autoSave.enabled);
        for (const state of registry.values) if (!state.window.isDestroyed())
          state.window.webContents.send('auto-save:changed', autoSave.enabled);
        return autoSave.enabled;
      } });
    const filePath = documentPathFromArgs(process.argv, app.isPackaged);
    // Keep Markdown's eager worker warmup; a source-only startup needs none.
    if (!filePath || isMarkdownDocument(filePath)) renderer.warmup();
    let initialDocument: DocumentSnapshot | null = null;
    if (filePath) {
      try { initialDocument = await documents.read(filePath); } catch (error) { openError(error); }
    }
    windows.create(null, initialDocument);
    const state = registry.focused();
    const launchFolder = filePath ? null : folderRequestFromArgs(process.argv, app.isPackaged);
    if (launchFolder && state) folderRequests.deliver(state, launchFolder);
    // "Show in folder" from other applications (org.freedesktop.FileManager1). Started
    // after launch so the helper never competes with the first window.
    const dbusTimer = setTimeout(() => {
      const stop = startFileManagerDbus(path.join(__dirname, 'file-manager-dbus.py'),
        (method, paths) => { for (const request of requestsFromFileManagerCall(method, paths)) showFolder(request); });
      app.on('will-quit', stop);
    }, 1500);
    app.on('will-quit', () => clearTimeout(dbusTimer));
    for (const filePath of queuedOpenFiles.splice(0)) {
      if (state) void documents.open(state, filePath).catch(openError);
    }
  });
  app.on('will-quit', () => { void browsers.flush(); windows.disposeWatchers(); void projects.dispose(); });
  app.on('will-quit', () => { browsers.dispose(); try { browsers.flushOnExit(); } catch (error) { console.error('Could not save browser tabs', error); } });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) windows.create(); });
}
