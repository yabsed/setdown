import type { PreviewBounds } from './preview-preparation';

import type { BrowserPage } from '../core/browser/browser-state';
import type { ReaderAnchor, ReaderSnapshot } from '../core/browser/reader-article';
import type { WebHistory } from '../core/workspace/tab-navigation';
export type { BrowserPage } from '../core/browser/browser-state';
export type { ReaderAnchor, ReaderArticle, ReaderSnapshot } from '../core/browser/reader-article';
export type BrowserPlace = { url: string; title: string; bookmarked: boolean; lastVisit: number; visits: number };
export type BrowserPlaceScope = 'all' | 'bookmarks' | 'history';
export type BrowserDownload = {
  id: string; url: string; name: string; path: string; received: number; total: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  paused: boolean; resumable: boolean; startedAt: number;
};
export type DownloadCommand = 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'remove';
export type BrowserExtensionInfo = {
  id: string; name: string; version: string; description: string; manifestVersion: number;
  enabled: boolean; builtin: boolean; hasPopup: boolean; hasOptions: boolean;
  permissions: string[]; hostPermissions: string[]; error: string | null;
  webStoreId?: string; icon?: string;
};
export type BrowserExtensionAction = { id: string; title: string; badge: string; color: string; icon: string | null; enabled: boolean };
export type ExtensionInstallKind = 'folder' | 'archive' | 'web-store';
export type ExtensionPage = 'popup' | 'options';
export type BrowserPermissionRequest = { token: string; origin: string; permissions: string[]; label: string };
export type BrowserAuthRequest = { token: string; origin: string; realm: string };
export type BrowserCommand = 'back' | 'forward' | 'reload' | 'stop' | 'activate' | 'focus' | 'mute' | 'external' | 'save' | 'protection'
  | 'pdf-original' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'reload-no-cache' | 'permissions' | 'site-info';
export type BrowserEvent =
  | { type: 'page'; page: BrowserPage }
  | { type: 'open'; page: BrowserPage; background: boolean }
  | { type: 'focus'; id: string }
  | { type: 'close'; id: string }
  | { type: 'navigation'; id: string }
  | { type: 'document'; id: string }
  | { type: 'reader'; id: string }
  | { type: 'history'; id: string; direction: -1 | 1 }
  | { type: 'places' }
  | { type: 'extensions' }
  | { type: 'theme-settings' }
  | { type: 'download'; download: BrowserDownload }
  | { type: 'download-removed'; id: string }
  | { type: 'permissions'; id: string; requests: BrowserPermissionRequest[] }
  | { type: 'auth'; id: string; request: BrowserAuthRequest | null }
  | { type: 'find'; id: string; query: string; active: number; matches: number };
export type BrowserApi = {
  themeSettings(): Promise<import('./browser-theme').BrowserThemeSettings>;
  updateThemeSettings(update: import('./browser-theme').BrowserThemeUpdate): Promise<import('./browser-theme').BrowserThemeSettings>;
  ready(): void;
  create(id: string, input: string, history?: WebHistory): Promise<BrowserPage>;
  history(id: string): Promise<WebHistory>;
  navigate(id: string, input: string): Promise<void>;
  command(id: string, command: BrowserCommand): Promise<boolean | void>;
  close(id: string, remember?: boolean): Promise<boolean>;
  reopen(): Promise<void>;
  authenticate(id: string, token: string, credentials: { username: string; password: string } | null): Promise<void>;
  layout(entries: Array<{ id: string; bounds: PreviewBounds; canGoBack?: boolean; canGoForward?: boolean }>): void;
  capture(id: string): Promise<string | null>;
  pdfRange(id: string, token: string, begin: number, end: number): Promise<Uint8Array>;
  pdfMenu(id: string, token: string, selection: string): Promise<void>;
  readerExtract(id: string): Promise<ReaderSnapshot | null>;
  readerMenu(id: string, context: { selection: string; link: string }): Promise<import('../core/reading/reading-menu').ReadingMenuCommand | null>;
  readerExport(id: string, format: 'markdown' | 'pdf'): Promise<{ canceled: boolean; path?: string }>;
  readerRestore(id: string, anchor: ReaderAnchor): Promise<boolean>;
  find(id: string, text: string, forward?: boolean, next?: boolean): void;
  places(query: string, scope?: BrowserPlaceScope): Promise<BrowserPlace[]>;
  bookmark(url: string, title: string, bookmarked: boolean): Promise<void>;
  deleteHistory(url?: string): Promise<void>;
  downloads(): Promise<BrowserDownload[]>;
  downloadCommand(id: string, command: DownloadCommand): Promise<void>;
  restore(): Promise<BrowserPage[]>;
  extensions(): Promise<BrowserExtensionInfo[]>;
  installExtension(kind: ExtensionInstallKind, input?: string): Promise<BrowserExtensionInfo[]>;
  setExtensionEnabled(id: string, enabled: boolean): Promise<BrowserExtensionInfo[]>;
  removeExtension(id: string): Promise<BrowserExtensionInfo[]>;
  extensionActions(tabId: string): Promise<BrowserExtensionAction[]>;
  activateExtension(id: string, tabId: string, bounds: PreviewBounds): Promise<void>;
  extensionMenu(tabId: string, bounds: PreviewBounds): Promise<void>;
  openExtension(id: string, page: ExtensionPage, tabId?: string): Promise<void>;
  onEvent(listener: (event: BrowserEvent) => void): () => void;
};
