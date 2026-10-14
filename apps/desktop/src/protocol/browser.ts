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
};
export type ExtensionInstallKind = 'folder' | 'archive';
export type ExtensionPage = 'popup' | 'options';
export type BrowserPermissionRequest = { token: string; origin: string; permissions: string[]; label: string };
export type BrowserAuthRequest = { token: string; origin: string; realm: string };
export type BrowserCommand = 'back' | 'forward' | 'reload' | 'stop' | 'focus' | 'mute' | 'external' | 'save' | 'protection'
  | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'reload-no-cache' | 'permissions' | 'site-info';
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
  | { type: 'download'; download: BrowserDownload }
  | { type: 'download-removed'; id: string }
  | { type: 'permissions'; id: string; requests: BrowserPermissionRequest[] }
  | { type: 'auth'; id: string; request: BrowserAuthRequest | null }
  | { type: 'find'; id: string; query: string; active: number; matches: number };
export type BrowserApi = {
  create(id: string, input: string, history?: WebHistory): Promise<BrowserPage>;
  history(id: string): Promise<WebHistory>;
  navigate(id: string, input: string): Promise<void>;
  command(id: string, command: BrowserCommand): Promise<boolean | void>;
  close(id: string, remember?: boolean): Promise<boolean>;
  reopen(): Promise<void>;
  authenticate(id: string, token: string, credentials: { username: string; password: string } | null): Promise<void>;
  layout(entries: Array<{ id: string; bounds: PreviewBounds; canGoBack?: boolean; canGoForward?: boolean }>): void;
  capture(id: string): Promise<string | null>;
  readerExtract(id: string): Promise<ReaderSnapshot | null>;
  readerRestore(id: string, anchor: ReaderAnchor): Promise<boolean>;
  find(id: string, text: string, forward?: boolean, next?: boolean): void;
  places(query: string, scope?: BrowserPlaceScope): Promise<BrowserPlace[]>;
  bookmark(url: string, title: string, bookmarked: boolean): Promise<void>;
  deleteHistory(url?: string): Promise<void>;
  downloads(): Promise<BrowserDownload[]>;
  downloadCommand(id: string, command: DownloadCommand): Promise<void>;
  restore(): Promise<BrowserPage[]>;
  extensions(): Promise<BrowserExtensionInfo[]>;
  installExtension(kind: ExtensionInstallKind): Promise<BrowserExtensionInfo[]>;
  setExtensionEnabled(id: string, enabled: boolean): Promise<BrowserExtensionInfo[]>;
  removeExtension(id: string): Promise<BrowserExtensionInfo[]>;
  openExtension(id: string, page: ExtensionPage, tabId?: string): Promise<void>;
  onEvent(listener: (event: BrowserEvent) => void): () => void;
};
