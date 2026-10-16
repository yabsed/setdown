import { tick } from 'svelte';
import type { BrowserApi } from '../../protocol/browser';
import type { WorkspaceTab } from '../../core/workspace/workspace-state';
import { browser } from './browser-state.svelte';

export type BrowserActions = {
  browserCommand(id: string, command: import('../../protocol/browser').BrowserCommand): void;
  browserPlaces(query: string, scope?: import('../../protocol/browser').BrowserPlaceScope): Promise<import('../../protocol/browser').BrowserPlace[]>;
  browserBookmark(url: string, title: string, bookmarked: boolean): Promise<void>;
  browserDeleteHistory(url?: string): Promise<void>;
  browserDownloadCommand(id: string, command: import('../../protocol/browser').DownloadCommand): Promise<void>;
  browserFind(id: string, query: string, forward?: boolean, next?: boolean): void;
  browserReaderExport(id: string, format: 'markdown' | 'pdf'): Promise<void>;
  browserReaderMenu(id: string, context: { selection: string; link: string }): Promise<import('../../core/reading/reading-menu').ReadingMenuCommand | null>;
  browserReaderEnter(id: string): void;
  browserReaderExit(id: string, anchor?: import('../../protocol/browser').ReaderAnchor): void;
  browserExtensions(): Promise<import('../../protocol/browser').BrowserExtensionInfo[]>;
  browserInstallExtension(kind: import('../../protocol/browser').ExtensionInstallKind, input?: string): Promise<import('../../protocol/browser').BrowserExtensionInfo[]>;
  browserSetExtensionEnabled(id: string, enabled: boolean): Promise<import('../../protocol/browser').BrowserExtensionInfo[]>;
  browserRemoveExtension(id: string): Promise<import('../../protocol/browser').BrowserExtensionInfo[]>;
  browserExtensionActions: BrowserApi['extensionActions'];
  browserActivateExtension: BrowserApi['activateExtension'];
  browserExtensionMenu: BrowserApi['extensionMenu'];
  browserOpenExtension(id: string, page: import('../../protocol/browser').ExtensionPage): Promise<void>;
};

type Options = {
  api: BrowserApi;
  tab(id: string): WorkspaceTab | null;
  activeId(): string | null;
  navigateHistory(id: string, direction: -1 | 1): void;
  sync(): void;
};

/** Browser UI commands and reader transitions; native view ownership stays in main. */
export function createBrowserActions(options: Options): BrowserActions {
  const { api } = options;
  const actions: BrowserActions = {
    browserCommand: (id, command) => {
      if (command === 'back' || command === 'forward') { options.navigateHistory(id, command === 'back' ? -1 : 1); return; }
      void api.command(id, command).catch(error => { browser.error = String(error); });
    },
    browserPlaces: (query, scope) => api.places(query, scope),
    browserDeleteHistory: (url) => api.deleteHistory(url),
    browserDownloadCommand: (id, command) => api.downloadCommand(id, command),
    browserBookmark: async (url, title, bookmarked) => {
      try { await api.bookmark(url, title, bookmarked); browser.revision++; }
      catch (error) { browser.error = String(error); }
    },
    browserFind: (id, query, forward = true, next = false) => {
      if (!next) { browser.active = 0; browser.matches = 0; }
      if (browser.readers[id]) browser.readerFind[id] = { query, forward, next, request: (browser.readerFind[id]?.request ?? 0) + 1 };
      else api.find(id, query, forward, next);
    },
    browserReaderMenu: (id, context) => api.readerMenu(id, context),
    browserReaderExport: async (id, format) => {
      try { await api.readerExport(id, format); } catch (error) { browser.error = String(error); }
    },
    browserReaderEnter: (id) => { void enterWebReader(id); },
    browserReaderExit: (id, anchor) => { void exitWebReader(id, anchor); },
    browserExtensions: () => api.extensions(),
    browserInstallExtension: (kind, input) => api.installExtension(kind, input),
    browserSetExtensionEnabled: (id, enabled) => api.setExtensionEnabled(id, enabled),
    browserRemoveExtension: (id) => api.removeExtension(id),
    browserExtensionActions: tabId => api.extensionActions(tabId),
    browserActivateExtension: (id, tabId, bounds) => api.activateExtension(id, tabId, bounds),
    browserExtensionMenu: (tabId, bounds) => api.extensionMenu(tabId, bounds),
    browserOpenExtension: (id, page) => api.openExtension(id, page, options.activeId() ?? undefined),
  };
  /** Esc on a web page, mirroring the Markdown editor: extract a reader
   * snapshot first, then hide the live view behind it (page state kept). */
  const readerRequests = new Set<string>();
  async function enterWebReader(id: string) {
    if (browser.readers[id] || readerRequests.has(id) || options.tab(id)?.kind !== 'web') return;
    readerRequests.add(id);
    const snapshot = await api.readerExtract(id).catch(() => null).finally(() => readerRequests.delete(id));
    const tab = options.tab(id);
    if (!snapshot || tab?.kind !== 'web' || tab.page.url !== snapshot.article.url) {
      // Not readerable (or navigated mid-extraction): stay on the live page
      // and give it back the focus Esc moved to the shell.
      if (tab?.kind === 'web') actions.browserCommand(id, 'focus');
      return;
    }
    // Retire native find highlights; the same query belongs to the visible
    // reading surface and is replayed there after mount.
    api.find(id, '');
    browser.readers[id] = snapshot;
    if (browser.findId === id) actions.browserFind(id, browser.query);
    options.sync();
  }
  /** Double-click in the reader, mirroring the Markdown viewer: position the
   * hidden page at the clicked block first, then show and focus it. */
  async function exitWebReader(id: string, anchor?: import('../../protocol/browser').ReaderAnchor) {
    if (!browser.readers[id]) return;
    // Published anchors live in $state (a proxy structured clone cannot
    // serialize); send a plain copy, and never let a failed restore keep
    // the reader open.
    if (anchor) { try { await api.readerRestore(id, { ...anchor }); } catch { /* exit anyway */ } }
    delete browser.readers[id]; delete browser.readerPositions[id]; delete browser.readerFind[id];
    if (browser.findId === id) api.find(id, browser.query);
    options.sync();
    await tick();
    actions.browserCommand(id, 'focus');
  }
  return actions;
}
