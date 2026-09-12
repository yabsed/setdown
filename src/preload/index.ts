import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppCommand,
  CloseDecision,
  ClaimedTabTransfer,
  DocumentSnapshot,
  ExternalChange,
  MarkTexApi,
  PreviewMessage,
  TabStateSummary,
  ThemeSnapshot,
  TransferableTab,
} from '../shared/contracts';
import { normalizePreviewTheme } from '../shared/preview-preferences';

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
  initialTheme: initialThemeSnapshot(),
  getDocument: () => ipcRenderer.invoke('document:get'),
  newDocument: () => ipcRenderer.invoke('document:new'),
  openDocument: () => ipcRenderer.invoke('document:open'),
  activateDocument: (document, text, revision) =>
    ipcRenderer.invoke('document:activate', { document, text, revision }),
  updateTabState: (tabs: TabStateSummary[]) =>
    ipcRenderer.send('tabs:update-state', tabs),
  registerTabTransfer: (transferId: string, tab: TransferableTab) =>
    ipcRenderer.send('tabs:register-transfer', { transferId, tab }),
  claimTabTransfer: (transferId: string) =>
    ipcRenderer.invoke('tabs:claim-transfer', transferId),
  completeTabTransfer: (transferId: string) =>
    ipcRenderer.send('tabs:complete-transfer', transferId),
  cancelTabTransfer: (transferId: string) =>
    ipcRenderer.send('tabs:cancel-transfer', transferId),
  detachTabToWindow: (transferId, x, y) =>
    ipcRenderer.send('tabs:detach-to-window', { transferId, x, y }),
  adoptTabTransfer: (transferId) => ipcRenderer.invoke('tabs:adopt-transfer', transferId),
  releaseTabTransferSource: (transferId) =>
    ipcRenderer.send('tabs:release-source', transferId),
  createPreview: (tabId) => ipcRenderer.send('preview:create', tabId),
  loadPreview: (tabId, result, themeId) =>
    ipcRenderer.invoke('preview:load', { tabId, result, themeId }),
  showPreview: (tabId, bounds) => ipcRenderer.send('preview:show', { tabId, bounds }),
  sendPreviewCommand: (tabId, message) =>
    ipcRenderer.send('preview:command', { tabId, message }),
  destroyPreview: (tabId) => ipcRenderer.send('preview:destroy', tabId),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  getApplicationMenu: (menuId) => ipcRenderer.invoke('menu:get', menuId),
  executeApplicationMenuItem: (itemId) => ipcRenderer.send('menu:execute', itemId),
  getPreviewThemeAssets: (themeId) =>
    ipcRenderer.invoke('preview:theme-assets', themeId),
  closeEmptyWindow: () => ipcRenderer.send('app:close-empty-window'),
  updateText: (text, revision) =>
    ipcRenderer.send('document:update-text', { text, revision }),
  saveDocument: (text, revision) =>
    ipcRenderer.invoke('document:save', { text, revision }),
  saveDocumentAs: (text, revision) =>
    ipcRenderer.invoke('document:save-as', { text, revision }),
  saveTabDocument: (document, text, revision) =>
    ipcRenderer.invoke('document:save-tab', { document, text, revision }),
  confirmCloseDocument: (name) =>
    ipcRenderer.invoke('document:confirm-close', name) as Promise<CloseDecision>,
  discardDocument: (document) => ipcRenderer.invoke('document:discard', document),
  finishWindowClose: (saved) => ipcRenderer.send('app:finish-window-close', saved),
  reloadDocument: () => ipcRenderer.invoke('document:reload'),
  renderDocument: (text, revision, documentPath, themeId) =>
    ipcRenderer.invoke('document:render', { text, revision, documentPath, themeId }),
  exportPdf: (text, revision, documentPath) =>
    ipcRenderer.invoke('document:export-pdf', { text, revision, documentPath }),
  pasteClipboardImage: () => ipcRenderer.invoke('document:paste-clipboard-image'),
  pickLinkTarget: (documentPath) =>
    ipcRenderer.invoke('document:pick-link-target', documentPath),
  openLink: (href) => ipcRenderer.invoke('document:open-link', href),
  onDocumentOpened: (listener) =>
    subscribe<DocumentSnapshot>('document:opened', listener),
  onExternalChange: (listener) =>
    subscribe<ExternalChange>('document:external-change', listener),
  onCommand: (listener) => subscribe<AppCommand>('app:command', listener),
  onThemeChanged: (listener) => subscribe<ThemeSnapshot>('theme:changed', listener),
  onSaveBeforeClose: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('app:save-before-close', handler);
    return () => ipcRenderer.removeListener('app:save-before-close', handler);
  },
  onTabTransferIncoming: (listener) =>
    subscribe<ClaimedTabTransfer>('tabs:transfer-incoming', listener),
  onTabTransferCompleted: (listener) =>
    subscribe<{ transferId: string; tabId: string }>('tabs:transfer-completed', listener),
  onPreviewMessage: (listener) => subscribe<PreviewMessage>('preview:message', listener),
  onPreviewFindRequested: (listener) => subscribe<string>('preview:open-find', listener),
};

contextBridge.exposeInMainWorld('marktex', api);
