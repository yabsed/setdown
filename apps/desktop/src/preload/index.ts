import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { installAppZoom, installWheelZoom } from './wheel-zoom';
import type {
  AppCommand,
  CloseDecision,
  ClaimedTabTransfer,
  DocumentSnapshot,
  ExternalChange,
  MarkTexApi,
  PreviewMessage,
  ProjectFilesChanged,
  TabStateSummary,
  ThemeSnapshot,
  TransferableTab,
} from '../protocol/desktop-api';
import { normalizePreviewTheme } from '../core/preview/preview-preferences';
import { resourceUrl } from '../core/preview/media-url';

installAppZoom((steps) => ipcRenderer.send('workspace:zoom', steps));
installWheelZoom((steps, scope, tabId) => ipcRenderer.send(scope === 'terminal' ? 'workspace:terminal-zoom' : 'workspace:text-zoom', steps, tabId));

function subscribe<T>(channel: string, listener: (value: T) => void) {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function initialThemeSnapshot(): ThemeSnapshot {
  const idArgument = process.argv.find((value) => value.startsWith('--setdown-theme='));
  const revisionArgument = process.argv.find((value) => value.startsWith('--setdown-theme-revision='));
  return {
    id: normalizePreviewTheme(idArgument?.slice('--setdown-theme='.length)),
    revision: Math.max(0, Number(revisionArgument?.slice('--setdown-theme-revision='.length)) || 0),
  };
}

const api: MarkTexApi = {
  language: {
    open: document => ipcRenderer.invoke('language:open', document),
    change: (id, version, changes) => ipcRenderer.invoke('language:change', id, version, changes),
    close: id => ipcRenderer.send('language:close', id),
    saved: id => ipcRenderer.send('language:saved', id),
    request: (id, version, requestId, method, params) => ipcRenderer.invoke('language:request', id, version, requestId, method, params),
    cancel: id => ipcRenderer.send('language:cancel', id),
    restart: () => ipcRenderer.invoke('language:restart'),
    chooseClangd: () => ipcRenderer.invoke('language:choose-clangd'),
    onEvent: listener => subscribe('language:event', listener),
  },
  browser: {
    create: (id, input, history) => ipcRenderer.invoke('browser:create', id, input, history),
    history: (id) => ipcRenderer.invoke('browser:history', id),
    navigate: (id, input) => ipcRenderer.invoke('browser:navigate', id, input),
    command: (id, command) => ipcRenderer.invoke('browser:command', id, command),
    close: (id, remember) => ipcRenderer.invoke('browser:close', id, remember),
    reopen: () => ipcRenderer.invoke('browser:reopen'),
    authenticate: (id, token, credentials) => ipcRenderer.invoke('browser:authenticate', id, token, credentials),
    layout: (entries) => ipcRenderer.send('browser:layout', entries),
    capture: (id) => ipcRenderer.invoke('browser:capture', id),
    readerExtract: (id) => ipcRenderer.invoke('browser:reader-extract', id),
    readerMenu: (id, context) => ipcRenderer.invoke('browser:reader-menu', id, context),
    readerExport: (id, format) => ipcRenderer.invoke('browser:reader-export', id, format),
    readerRestore: (id, anchor) => ipcRenderer.invoke('browser:reader-restore', id, anchor),
    find: (id, text, forward, next) => ipcRenderer.send('browser:find', id, text, forward, next),
    places: (query, scope) => ipcRenderer.invoke('browser:places', query, scope),
    bookmark: (url, title, bookmarked) => ipcRenderer.invoke('browser:bookmark', url, title, bookmarked),
    deleteHistory: (url) => ipcRenderer.invoke('browser:delete-history', url),
    downloads: () => ipcRenderer.invoke('browser:downloads'),
    downloadCommand: (id, command) => ipcRenderer.invoke('browser:download-command', id, command),
    restore: () => ipcRenderer.invoke('browser:restore'),
    extensions: () => ipcRenderer.invoke('browser:extensions'),
    installExtension: (kind, input) => ipcRenderer.invoke('browser:extension-install', kind, input),
    setExtensionEnabled: (id, enabled) => ipcRenderer.invoke('browser:extension-set-enabled', id, enabled),
    removeExtension: (id) => ipcRenderer.invoke('browser:extension-remove', id),
    openExtension: (id, page, tabId) => ipcRenderer.invoke('browser:extension-open', id, page, tabId),
    onEvent: (listener) => subscribe('browser:event', listener),
  },
  getZoom: () => ipcRenderer.invoke('workspace:zoom-state'),
  changeZoom: (steps, scope, tabId) => ipcRenderer.send(scope === 'terminal' ? 'workspace:terminal-zoom' : scope === 'text' ? 'workspace:text-zoom' : 'workspace:zoom', steps, tabId),
  setZoomTabs: (ids, active) => ipcRenderer.send('workspace:zoom-tabs', ids, active),
  onZoomChanged: (listener) => subscribe('workspace:zoom-changed', listener),
  saveReadingPosition: (record) => ipcRenderer.send('reading:save', record),
  flushReadingPositions: () => ipcRenderer.sendSync('reading:flush'),
  readPdfRange: (path, begin, end, version) => ipcRenderer.invoke('pdf:range', path, begin, end, version),
  showPdfSelectionMenu: (path, selection) => ipcRenderer.invoke('pdf:selection-menu', path, selection),
  readImageBytes: (path, version) => ipcRenderer.invoke('image:read', path, version),
  mediaUrl: (path) => resourceUrl(path),
  terminal: {
    create: (id, size) => ipcRenderer.invoke('terminal:create', id, size),
    write: (id, data) => ipcRenderer.send('terminal:write', id, data),
    resize: (id, size) => ipcRenderer.send('terminal:resize', id, size),
    acknowledge: (id, length) => ipcRenderer.send('terminal:ack', id, length),
    close: (id) => ipcRenderer.send('terminal:close', id),
    focus: (focused) => ipcRenderer.send('terminal:focus', focused),
    onEvent: (listener) => subscribe('terminal:event', listener),
  },
  initialTheme: initialThemeSnapshot(),
  getDocument: () => ipcRenderer.invoke('document:get'),
  newDocument: () => ipcRenderer.invoke('document:new'),
  openDocument: () => ipcRenderer.invoke('document:open'),
  readDocumentLocation: (location) => ipcRenderer.invoke('document:read-location', location),
  activateDocument: (document, text, revision) =>
    ipcRenderer.invoke('document:activate', { document, text, revision }),
  updateTabState: (tabs: TabStateSummary[]) =>
    ipcRenderer.send('tabs:update-state', tabs),
  requestGitGraph: (request) => ipcRenderer.invoke('project:git-graph', request),
  cancelGitGraph: (id) => ipcRenderer.send('project:git-graph-cancel', id),
  getGitHistoryDiff: (selection) => ipcRenderer.invoke('project:git-history-diff', selection),
  getGitReviewState: () => ipcRenderer.invoke('git-review:get-state'),
  updateGitReviewState: (review) => ipcRenderer.send('git-review:update-state', review),
  registerTabTransfer: (transferId: string, tab: TransferableTab) =>
    ipcRenderer.send('tabs:register-transfer', { transferId, tab }),
  claimTabTransfer: (transferId) => ipcRenderer.invoke('tabs:claim-transfer', transferId),
  completeTabTransfer: (transferId: string) => ipcRenderer.send('tabs:complete-transfer', transferId),
  cancelTabTransfer: (transferId: string) => ipcRenderer.send('tabs:cancel-transfer', transferId),
  detachTabToWindow: (transferId, x, y) => ipcRenderer.send('tabs:detach-to-window', { transferId, x, y }),
  adoptTabTransfer: (transferId) => ipcRenderer.invoke('tabs:adopt-transfer', transferId),
  releaseTabTransferSource: (transferId) => ipcRenderer.send('tabs:release-source', transferId),
  createPreview: (tabId) => ipcRenderer.send('preview:create', tabId),
  setBackgroundPreviews: (previews) => ipcRenderer.send('preview:backgrounds', previews),
  showPreview: (tabId, bounds, backgrounds, layout) =>
    ipcRenderer.send('preview:show', { tabId, bounds, backgrounds, layout }),
  capturePreview: (tabId) => ipcRenderer.invoke('preview:capture', tabId),
  sendPreviewCommand: (tabId, message) => ipcRenderer.send('preview:command', { tabId, message }),
  destroyPreview: (tabId) => ipcRenderer.send('preview:destroy', tabId),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  getApplicationMenu: (menuId) => ipcRenderer.invoke('menu:get', menuId),
  locationSuggestions: {
    show: request => ipcRenderer.invoke('location-overlay:show', request),
    hide: token => ipcRenderer.send('location-overlay:hide', token),
    context: () => ipcRenderer.invoke('location-overlay:context'),
    choose: (token, index) => ipcRenderer.send('location-overlay:choose', token, index),
    onShow: listener => subscribe('location-overlay:show', listener),
    onChoice: listener => subscribe('location-overlay:choice', listener),
    onHidden: listener => subscribe('location-overlay:hidden', listener),
  },
  menuOverlay: {
    open: (menuId, position) => ipcRenderer.invoke('menu-overlay:open', menuId, position),
    context: () => ipcRenderer.invoke('menu-overlay:context'),
    entries: menuId => ipcRenderer.invoke('menu-overlay:entries', menuId),
    execute: itemId => ipcRenderer.send('menu-overlay:execute', itemId),
    close: () => ipcRenderer.send('menu-overlay:close'),
    onShow: listener => subscribe('menu-overlay:show', listener),
    onClosed: listener => subscribe('menu-overlay:closed', listener),
  },
  executeApplicationMenuItem: (itemId) => ipcRenderer.send('menu:execute', itemId),
  getPreviewThemeAssets: (themeId) => ipcRenderer.invoke('preview:theme-assets', themeId),
  closeEmptyWindow: () => ipcRenderer.send('app:close-empty-window'),
  updateText: (text, revision) => ipcRenderer.send('document:update-text', { text, revision }),
  getAutoSave: () => ipcRenderer.invoke('settings:get-auto-save'),
  onAutoSaveChanged: (listener) => subscribe<boolean>('auto-save:changed', listener),
  saveDocument: (text, revision, auto) => ipcRenderer.invoke('document:save', { text, revision, auto }),
  saveDocumentAs: (text, revision) => ipcRenderer.invoke('document:save-as', { text, revision }),
  saveTabDocument: (document, text, revision, auto) => ipcRenderer.invoke('document:save-tab', { document, text, revision, auto }),
  discardDocument: (document) => ipcRenderer.invoke('document:discard', document),
  resolveWindowClose: (decision: CloseDecision) => ipcRenderer.send('app:resolve-window-close', decision),
  finishWindowClose: (saved) => ipcRenderer.send('app:finish-window-close', saved),
  reloadDocument: () => ipcRenderer.invoke('document:reload'),
  preparePreview: (tabId, text, revision, documentPath, themeId) =>
    ipcRenderer.invoke('preview:prepare', { tabId, text, revision, documentPath, themeId }),
  exportPdf: (text, revision, documentPath) => ipcRenderer.invoke('document:export-pdf', { text, revision, documentPath }),
  pasteClipboardImage: () => ipcRenderer.invoke('document:paste-clipboard-image'),
  pickLinkTarget: (documentPath) => ipcRenderer.invoke('document:pick-link-target', documentPath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  chooseProjectFolder: () => ipcRenderer.invoke('project:choose-folder'),
  getProjectFolder: () => ipcRenderer.invoke('project:get-folder'),
  restoreProjectFolder: (folderPath) => ipcRenderer.invoke('project:restore-folder', folderPath),
  readProjectDirectory: (directoryPath) => ipcRenderer.invoke('project:read-directory', directoryPath),
  createProjectEntry: (parentPath, name, kind) => ipcRenderer.invoke('project:create-entry', { parentPath, name, kind }),
  renameProjectEntry: (entryPath, name) => ipcRenderer.invoke('project:rename-entry', { entryPath, name }),
  moveProjectEntry: (entryPath, targetDirectory) => ipcRenderer.invoke('project:move-entry', { entryPath, targetDirectory }),
  moveProjectEntries: (entryPaths, targetDirectory) => ipcRenderer.invoke('project:move-entries', { entryPaths, targetDirectory }),
  trashProjectEntry: (entryPath) => ipcRenderer.invoke('project:trash-entry', entryPath),
  openProjectFile: (filePath) => ipcRenderer.invoke('project:open-file', filePath),
  searchProject: (request) => ipcRenderer.invoke('project:search', request),
  getGitStatus: () => ipcRenderer.invoke('project:git-status'),
  getGitDiff: (filePath, staged) => ipcRenderer.invoke('project:git-diff', { filePath, staged }),
  prepareGitDiffPreview: (tabId, diff, themeId) => ipcRenderer.invoke('project:git-diff-preview', { tabId, diff, themeId }),
  initializeGit: () => ipcRenderer.invoke('project:git-init'),
  stageGit: (paths) => ipcRenderer.invoke('project:git-stage', paths),
  unstageGit: (paths) => ipcRenderer.invoke('project:git-unstage', paths),
  discardGit: (paths) => ipcRenderer.invoke('project:git-discard', paths),
  commitGit: (message) => ipcRenderer.invoke('project:git-commit', message),
  runGitRemote: (action) => ipcRenderer.invoke('project:git-remote', action),
  openLink: (href) => ipcRenderer.invoke('document:open-link', href),
  onDocumentOpened: (listener) => subscribe<DocumentSnapshot>('document:opened', listener),
  onExternalChange: (listener) => subscribe<ExternalChange>('document:external-change', listener),
  onProjectFilesChanged: (listener) => subscribe<ProjectFilesChanged>('project:files-changed', listener),
  onCommand: (listener) => subscribe<AppCommand>('app:command', listener),
  onThemeChanged: (listener) => subscribe<ThemeSnapshot>('theme:changed', listener),
  onWindowCloseRequested: (listener) => subscribe<string[]>('app:request-window-close', listener),
  onSaveBeforeClose: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('app:save-before-close', handler);
    return () => ipcRenderer.removeListener('app:save-before-close', handler);
  },
  onTabTransferIncoming: (listener) => subscribe<ClaimedTabTransfer>('tabs:transfer-incoming', listener),
  onTabTransferCompleted: (listener) => subscribe<{ transferId: string; tabId: string }>('tabs:transfer-completed', listener),
  onPreviewMessage: (listener) => subscribe<PreviewMessage>('preview:message', listener),
  onPreviewFindRequested: (listener) => subscribe<string>('preview:open-find', listener),
};

contextBridge.exposeInMainWorld('marktex', api);
