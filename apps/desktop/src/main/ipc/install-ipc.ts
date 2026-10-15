import type { BrowserManager } from '../browser/browser-manager';
import { GitHistoryService } from '../project/git-history-service';
import type { GitGraphRequest, GitHistorySelection } from '../../protocol/git-history';
import { ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePreviewTheme } from '../../core/preview/preview-preferences';
import { isMarkdownDocument, isOpenableDocument, isReadOnlyDocument } from '../../core/document/document-profile';
import { retainUnsavedRevision } from '../../core/document/document-save';
import type { ApplicationMenuEntry, CloseDecision, DocumentSnapshot, GitRemoteAction, GitReviewState,
  ProjectEntryKind, ProjectSearchRequest, SaveResult, TabStateSummary, ThemeSnapshot } from '../../protocol/desktop-api';
import { canonicalPath } from '../documents/file-system';
import type { DocumentManager } from '../documents/document-manager';
import { applicationMenuEntries, executeApplicationMenu } from '../menu/application-menu';
import { LocationOverlay } from '../browser/location-overlay';
import { showReadingMenu } from '../menu/reading-menu';
import { MenuOverlay } from '../menu/menu-overlay';
import type { WindowState } from '../windows/window-state';
import { exportPdf } from '../preview/pdf-exporter';
import type { PreviewManager } from '../preview/preview-manager';
import type { PreviewRenderer } from '../preview/preview-renderer';
import type { ProjectService } from '../project/project-service';
import { pathFromResourceUrl } from '../preview/resource-url';
import type { TabTransferManager } from '../tabs/tab-transfer-manager';
import type { AutoSaveStore } from '../settings/auto-save-store';
import type { ThemeManager } from '../theme/theme-manager';
import type { WindowIpc } from './window-ipc';
import type { ExplorerOperationResult, ExplorerTransfer } from '../../protocol/explorer';

type Options = {
  channels: WindowIpc; documents: DocumentManager; previews: PreviewManager;
  renderer: PreviewRenderer; projects: ProjectService; themes: ThemeManager; transfers: TabTransferManager;
  autoSave: AutoSaveStore; browsers: BrowserManager;
};
function assertMarkdown(filePath: string): void {
  if (!isMarkdownDocument(filePath)) throw new Error('This text document has no Markdown preview.');
}
function documentMenus(items: ApplicationMenuEntry[], markdown: boolean, review: boolean): ApplicationMenuEntry[] {
  return items.map((item) => ({ ...item,
    enabled: item.enabled && (item.id === 'menu-export-pdf' ? markdown && !review
      : item.id === 'menu-toggle-surface' ? markdown : true),
    label: item.id === 'preview-find' && !markdown ? 'Find' : item.label,
    ...(item.submenu ? { submenu: documentMenus(item.submenu, markdown, review) } : {}),
  }));
}
export function installIpc(options: Options): void {
  const { channels, documents, previews, projects, renderer, themes, transfers, autoSave } = options;
  channels.handle('browser:reader-export', (state, id: string, format: unknown) => {
    if (format !== 'markdown' && format !== 'pdf') throw Error('Unsupported reader export format.');
    return options.browsers.exportReader(state.webContentsId, id, format, themes.id);
  });
  const history = new GitHistoryService();
  channels.handle('project:git-graph', (state, request: GitGraphRequest) => history.request(state, request));
  channels.on('project:git-graph-cancel', (state, id: unknown) => history.cancel(state, id));
  channels.handle('project:git-history-diff', (state, selection: GitHistorySelection) => history.diff(state, selection));
  previews.registerIpc(); transfers.registerIpc();
  previews.setReadingMenu((tabId, contents, params, state, valid) => {
    state.window.webContents.send('preview:message', { tabId, message: { type: 'marktex:focus' } });
    void showReadingMenu(state.window, { selection: String(params.selectionText ?? ''), link: String(params.linkURL ?? ''), pdf: !tabId.startsWith('git-diff:') }, valid,
      url => { void options.browsers.openLink(state.webContentsId, url); }, command => {
        if (command === 'select-all') contents.selectAll();
        else if (command === 'find') { state.window.webContents.focus(); state.window.webContents.send('preview:open-find', tabId); }
        else if (command === 'export-pdf') state.window.webContents.send('preview:message', { tabId, message: { type: 'marktex:reader-export' } });
      });
  });
  const menuEntries = (state: WindowState, menuId: unknown) => {
    const review = state.rendererGitReview?.active === true;
    const filePath = review ? state.rendererGitReview!.path : state.currentDocument?.path ?? '';
    const webId = previews.zoom.activeTab(state.webContentsId);
    const webReader = !!webId && options.browsers.readerReady(state.webContentsId, webId) && !options.browsers.views.get(webId)?.view.getVisible();
    return documentMenus(applicationMenuEntries(menuId), isMarkdownDocument(filePath), review).map((item) =>
      item.id === 'menu-export-pdf' && webReader ? { ...item, enabled: true }
        : (state.explorerEditTarget && ['menu-undo', 'menu-redo'].includes(item.id)) || (isReadOnlyDocument(filePath) && ['save', 'menu-save-as'].includes(item.id)) ? { ...item, enabled: false } : item);
  };
  channels.handle('menu:get', menuEntries);
  const locationOverlay = new LocationOverlay();
  channels.handle('location-overlay:show', (state, request) => locationOverlay.show(state, request, themes.id));
  channels.on('location-overlay:hide', (state, token) => { if (typeof token === 'string') locationOverlay.hide(state.webContentsId, token, false); });
  const menuOverlay = new MenuOverlay(menuEntries);
  channels.handle('menu-overlay:open', (state, menuId: string, position: { x: number; y: number }) => {
    if (![...options.browsers.views.values()].some(entry => entry.owner === state.webContentsId && entry.view.getVisible())) return false;
    return menuOverlay.open(state, { menuId, x: position?.x, y: position?.y, theme: themes.id });
  });
  channels.on('menu:execute', (state, itemId: unknown) => executeApplicationMenu(itemId, state.window));
  channels.handle('theme:get', (): ThemeSnapshot => themes.snapshot);
  channels.handle('settings:get-auto-save', () => autoSave.enabled);
  channels.handle('preview:theme-assets', (_state, themeId: unknown) => themes.assets(themeId));
  channels.handle('document:get', (state) => state.currentDocument);
  channels.handle('document:new', (state) => documents.newDocument(state));
  channels.handle('document:activate', (state, { document, text, revision }: {
    document: DocumentSnapshot; text: string; revision: number;
  }) => documents.activate(state, document, text, revision));
  channels.on('tabs:update-state', (state, tabs: TabStateSummary[]) => {
    state.rendererTabs = Array.isArray(tabs) ? tabs.map((tab) => ({ name: String(tab.name), path: String(tab.path),
      dirty: Boolean(tab.dirty), isUntitled: Boolean(tab.isUntitled) })) : [];
  });
  channels.handle('git-review:get-state', (state) => state.rendererGitReview);
  channels.on('git-review:update-state', (state, review: GitReviewState | null) => {
    state.rendererGitReview = review ? { name: String(review.name), path: String(review.path),
      history: review.history, dirty: Boolean(review.dirty), isUntitled: false, staged: Boolean(review.staged), active: Boolean(review.active),
      mode: review.mode === 'source' || !isMarkdownDocument(review.path) ? 'source' : 'rendered',
      line: Math.max(1, Number(review.line) || 1) } : null;
  });
  channels.on('app:close-empty-window', (state) => {
    if (state.rendererTabs.length > 0 || state.rendererGitReview) return;
    state.closeAfterConfirmation = true; state.window.close();
  });
  channels.handle('document:open', (state) => documents.chooseAndOpen(state, false));
  channels.handle('document:read-location', (_state, location: unknown) => {
    if (typeof location !== 'string' || location.length > 16384) throw new Error('Invalid file location.');
    const value = location.trim();
    const filePath = /^file:/i.test(value) ? fileURLToPath(value) : value;
    if (!path.isAbsolute(filePath)) throw new Error('Enter an absolute file path or file URL.');
    return documents.read(filePath);
  });
  channels.on('document:update-text', (state, { text, revision }: { text: string; revision: number }) =>
    documents.updateText(state, text, revision));
  channels.handle('preview:prepare', (state, request: {
    tabId: unknown; text: string; revision: number; documentPath: string; themeId: unknown;
  }) => {
    assertMarkdown(request.documentPath);
    return renderer.prepare(state, String(request.tabId), request.text, request.revision,
      request.documentPath, normalizePreviewTheme(request.themeId), state.window.webContents.id);
  });
  channels.handle('document:save', (state, { text, revision, auto }: { text: string; revision: number; auto?: boolean }): Promise<SaveResult> =>
    documents.saveCurrent(state, text, revision, auto === true));
  channels.handle('document:save-as', (state, { text, revision }: { text: string; revision: number }): Promise<SaveResult> =>
    documents.saveAs(state, text, revision));
  channels.handle('document:save-tab', async (state, { document, text, revision, auto }: {
    document: DocumentSnapshot; text: string; revision: number; auto?: boolean;
  }): Promise<SaveResult> => {
    const result = await documents.saveSnapshot(state, document, text, revision, auto === true);
    const current = state.currentDocument;
    // Recheck after IO/dialogs; a background save must never select another tab.
    if (current?.path === document.path && !result.canceled && result.document) {
      state.currentDocument = retainUnsavedRevision(result.document, current.text, current.revision);
      state.activeRoot = path.dirname(result.document.path); documents.watch(state);
    }
    return result;
  });
  ipcMain.handle('document:discard', async (_event, document: DocumentSnapshot) => { await documents.discard(document); });
  channels.on('app:resolve-window-close', (state, decision: CloseDecision) => {
    if (!['cancel', 'discard', 'save'].includes(decision)) return;
    state.closePromptOpen = false;
    if (decision === 'cancel') return;
    if (decision === 'save') { state.window.webContents.send('app:save-before-close'); return; }
    const drafts = state.rendererTabs.filter((tab) => tab.isUntitled).map((tab) => tab.path);
    if (drafts.length === 0 && state.currentDocument?.isUntitled) drafts.push(state.currentDocument.path);
    void Promise.all(drafts.map((draft) => documents.discardDraft(draft))).then(() => {
      if (state.window.isDestroyed()) return;
      state.closeAfterConfirmation = true; state.window.close();
    });
  });
  channels.on('app:finish-window-close', (state, saved: boolean) => {
    state.closePromptOpen = false;
    if (!saved) return;
    state.closeAfterConfirmation = true; state.window.close();
  });
  channels.handle('document:export-pdf', (state, { text, revision, documentPath }: {
    text: string; revision: number; documentPath: string;
  }) => {
    assertMarkdown(documentPath);
    return exportPdf(renderer, state, text, revision, documentPath);
  });
  channels.handle('document:paste-clipboard-image', (state) => documents.pasteImage(state));
  channels.handle('document:pick-link-target', (state, documentPath: string) => documents.pickLink(state, documentPath));
  channels.handle('project:choose-folder', (state) => projects.choose(state));
  channels.handle('project:get-folder', (state) => projects.current(state));
  channels.handle('project:restore-folder', (state, folderPath: string) => projects.restore(state, folderPath));
  channels.handle('project:read-directory', (state, directoryPath: string) => projects.readDirectory(state, directoryPath));
  const transferred = (result: ExplorerOperationResult) => {
    if (result.kind === 'move') for (const item of result.items) {
      if (item.status === 'completed') documents.positions?.move(item.from, item.to);
    }
    return result;
  };
  channels.handle('explorer:transfer', async (state, request: ExplorerTransfer) => transferred(await projects.transfer(state, request)));
  channels.handle('explorer:clipboard', () => projects.clipboard.read());
  channels.handle('explorer:copy', (state, paths: string[], cut: boolean) => projects.copySelection(state, paths, cut));
  channels.handle('explorer:clear-clipboard', async () => {
    if ((await projects.clipboard.read())?.cut) await projects.clipboard.clear();
  });
  channels.handle('explorer:paste', async (state, target: string, conflict?: ExplorerTransfer['conflict']) => transferred(await projects.paste(state, target, conflict)));
  channels.handle('explorer:reveal', (state, candidate: string) => shell.showItemInFolder(projects.assertProjectFile(state, candidate)));
  channels.on('explorer:edit-target', (state, active: boolean) => { state.explorerEditTarget = active === true; });
  channels.handle('project:create-entry', (state, request: { parentPath: string; name: string; kind: ProjectEntryKind }) =>
    projects.createEntry(state, request.parentPath, request.name, request.kind));
  channels.handle('project:rename-entry', async (state, request: { entryPath: string; name: string }) => {
    const moved = await projects.renameEntry(state, request.entryPath, request.name);
    documents.positions?.move(moved.from, moved.to); return moved;
  });
  channels.handle('project:move-entry', async (state, request: { entryPath: string; targetDirectory: string }) => {
    const moved = await projects.moveEntry(state, request.entryPath, request.targetDirectory);
    documents.positions?.move(moved.from, moved.to); return moved;
  });
  channels.handle('project:move-entries', async (state, request: { entryPaths: string[]; targetDirectory: string }) => {
    const result = await projects.moveEntries(state, request.entryPaths, request.targetDirectory);
    for (const move of result.moves) documents.positions?.move(move.from, move.to);
    return result;
  });
  channels.handle('project:trash-entry', (state, entryPath: string) => projects.trashEntry(state, entryPath));
  channels.handle('project:open-file', (state, filePath: string) => documents.open(state, projects.assertDocument(state, filePath), false));
  channels.handle('project:search', (state, request: ProjectSearchRequest) => projects.search(state, request));
  channels.handle('project:git-status', (state) => projects.gitStatus(state));
  channels.handle('project:git-diff', (state, request: { filePath: string; staged: boolean }) => projects.gitDiff(state, request.filePath, Boolean(request.staged)));
  channels.handle('project:git-diff-preview', (state, request: {
    tabId: string; diff: Awaited<ReturnType<ProjectService['gitDiff']>>; themeId: unknown;
  }) => {
    const themeId = normalizePreviewTheme(request.themeId);
    // Reject before native view creation, worker requests or preview preparation.
    if (!isMarkdownDocument(request.diff.filePath)) return { revision: 0, url: null, themeId, supported: false };
    previews.create(state.window.webContents.id, request.tabId);
    return renderer.prepareDiff(state, request.tabId, request.diff, themeId, state.window.webContents.id);
  });
  channels.handle('project:git-init', (state) => projects.initializeGit(state));
  channels.handle('project:git-stage', (state, paths: string[]) => projects.stageGit(state, paths));
  channels.handle('project:git-unstage', (state, paths: string[]) => projects.unstageGit(state, paths));
  channels.handle('project:git-discard', (state, paths: string[]) => projects.discardGit(state, paths));
  channels.handle('project:git-commit', (state, message: string) => projects.commitGit(state, message));
  channels.handle('project:git-remote', (state, action: GitRemoteAction) => projects.runGitRemote(state, action));
  channels.handle('document:reload', (state) => documents.reload(state));
  channels.handle('document:open-link', (state, href: string) => openLink(documents, state, href, options.browsers));
}
async function openLink(documents: DocumentManager, state: Parameters<DocumentManager['open']>[0], href: string, browsers: BrowserManager): Promise<void> {
  let decodedHref: string;
  try { decodedHref = decodeURIComponent(String(href)); } catch { return; }
  const localPath = pathFromResourceUrl(decodedHref);
  if (localPath) {
    const checked = canonicalPath(localPath);
    try { if (!(await fs.stat(checked)).isFile()) return; } catch { return; }
    if (isOpenableDocument(checked)) {
      if (state.currentDocument && canonicalPath(state.currentDocument.path) === checked
        && state.rendererTabs.some((tab) => canonicalPath(tab.path) === checked)) return;
      const document = await documents.open(state, checked, false);
      state.window.webContents.send('document:opened', document);
    } else await shell.openPath(checked);
    return;
  }
  try {
    const url = new URL(decodedHref);
    if (['http:', 'https:'].includes(url.protocol)) await browsers.openLink(state.webContentsId, url.href);
    else if (['mailto:', 'tel:'].includes(url.protocol)) await shell.openExternal(url.href);
  } catch { /* Unrecognised protocols are not opened. */ }
}
