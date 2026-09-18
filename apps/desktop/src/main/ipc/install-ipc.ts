import { ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizePreviewTheme } from '../../core/preview/preview-preferences';
import type {
  CloseDecision,
  DocumentSnapshot,
  SaveResult,
  TabStateSummary,
  ThemeSnapshot,
} from '../../protocol/desktop-api';
import { canonicalPath } from '../documents/file-system';
import type { DocumentManager } from '../documents/document-manager';
import { applicationMenuEntries, executeApplicationMenu } from '../menu/application-menu';
import { exportPdf } from '../preview/pdf-exporter';
import type { PreviewManager } from '../preview/preview-manager';
import type { PreviewRenderer } from '../preview/preview-renderer';
import type { ProjectService } from '../project/project-service';
import { pathFromResourceUrl } from '../preview/resource-url';
import type { TabTransferManager } from '../tabs/tab-transfer-manager';
import type { ThemeManager } from '../theme/theme-manager';
import type { WindowIpc } from './window-ipc';

type Options = {
  channels: WindowIpc;
  documents: DocumentManager;
  previews: PreviewManager;
  renderer: PreviewRenderer;
  projects: ProjectService;
  themes: ThemeManager;
  transfers: TabTransferManager;
};

export function installIpc(options: Options): void {
  const { channels, documents, previews, projects, renderer, themes, transfers } = options;
  previews.registerIpc();
  transfers.registerIpc();

  channels.handle('menu:get', (_state, menuId: unknown) => applicationMenuEntries(menuId));
  channels.on('menu:execute', (state, itemId: unknown) =>
    executeApplicationMenu(itemId, state.window));
  channels.handle('theme:get', (): ThemeSnapshot => themes.snapshot);
  channels.handle('preview:theme-assets', (_state, themeId: unknown) => themes.assets(themeId));
  channels.handle('document:get', (state) => state.currentDocument);
  channels.handle('document:new', (state) => documents.newDocument(state));
  channels.handle(
    'document:activate',
    (state, { document, text, revision }: {
      document: DocumentSnapshot; text: string; revision: number;
    }) => documents.activate(state, document, text, revision),
  );
  channels.on('tabs:update-state', (state, tabs: TabStateSummary[]) => {
    state.rendererTabs = Array.isArray(tabs)
      ? tabs.map((tab) => ({
        name: String(tab.name),
        path: String(tab.path),
        dirty: Boolean(tab.dirty),
        isUntitled: Boolean(tab.isUntitled),
      }))
      : [];
  });
  channels.on('app:close-empty-window', (state) => {
    if (state.rendererTabs.length > 0) return;
    state.closeAfterConfirmation = true;
    state.window.close();
  });
  channels.handle('document:open', (state) => documents.chooseAndOpen(state, false));
  channels.on(
    'document:update-text',
    (state, { text, revision }: { text: string; revision: number }) =>
      documents.updateText(state, text, revision),
  );
  channels.handle(
    'preview:prepare',
    (state, request: {
      tabId: unknown; text: string; revision: number; documentPath: string; themeId: unknown;
    }) => renderer.prepare(
      state,
      String(request.tabId),
      request.text,
      request.revision,
      request.documentPath,
      normalizePreviewTheme(request.themeId),
      state.window.webContents.id,
    ),
  );
  channels.handle(
    'document:save',
    (state, { text, revision }: { text: string; revision: number }): Promise<SaveResult> =>
      documents.saveCurrent(state, text, revision),
  );
  channels.handle(
    'document:save-as',
    (state, { text, revision }: { text: string; revision: number }): Promise<SaveResult> =>
      documents.saveAs(state, text, revision),
  );
  channels.handle(
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
  ipcMain.handle('document:discard', async (_event, document: DocumentSnapshot) => {
    await documents.discard(document);
  });
  channels.on('app:resolve-window-close', (state, decision: CloseDecision) => {
    if (!['cancel', 'discard', 'save'].includes(decision)) return;
    state.closePromptOpen = false;
    if (decision === 'cancel') return;
    if (decision === 'save') {
      state.window.webContents.send('app:save-before-close');
      return;
    }
    const drafts = state.rendererTabs
      .filter((tab) => tab.isUntitled)
      .map((tab) => tab.path);
    if (drafts.length === 0 && state.currentDocument?.isUntitled) {
      drafts.push(state.currentDocument.path);
    }
    void Promise.all(drafts.map((draft) => documents.discardDraft(draft))).then(() => {
      if (state.window.isDestroyed()) return;
      state.closeAfterConfirmation = true;
      state.window.close();
    });
  });
  channels.on('app:finish-window-close', (state, saved: boolean) => {
    state.closePromptOpen = false;
    if (!saved) return;
    state.closeAfterConfirmation = true;
    state.window.close();
  });
  channels.handle(
    'document:export-pdf',
    (state, { text, revision, documentPath }: {
      text: string; revision: number; documentPath: string;
    }) => exportPdf(renderer, state, text, revision, documentPath),
  );
  channels.handle('document:paste-clipboard-image', (state) => documents.pasteImage(state));
  channels.handle('document:pick-link-target', (state, documentPath: string) =>
    documents.pickLink(state, documentPath));
  channels.handle('project:choose-folder', (state) => projects.choose(state));
  channels.handle('project:read-directory', (state, directoryPath: string) =>
    projects.readDirectory(state, directoryPath));
  channels.handle('project:open-file', (state, filePath: string) =>
    documents.open(state, projects.assertDocument(state, filePath), false));
  channels.handle('project:search', (state, query: string) => projects.search(state, query));
  channels.handle('project:git-status', (state) => projects.gitStatus(state));
  channels.handle('document:reload', (state) => documents.reload(state));
  channels.handle('document:open-link', (state, href: string) => openLink(documents, state, href));
}

async function openLink(
  documents: DocumentManager,
  state: Parameters<DocumentManager['open']>[0],
  href: string,
): Promise<void> {
  let decodedHref: string;
  try {
    decodedHref = decodeURIComponent(String(href));
  } catch {
    return;
  }
  const localPath = pathFromResourceUrl(decodedHref);
  if (localPath) {
    const checked = canonicalPath(localPath);
    try {
      if (!(await fs.stat(checked)).isFile()) return;
    } catch {
      return;
    }
    if (/\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(checked)) {
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
    // Preview가 해석하지 못한 주소는 조용히 거부한다.
  }
}
