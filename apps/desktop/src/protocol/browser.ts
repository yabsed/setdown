import type { PreviewBounds } from './preview-preparation';

import type { BrowserPage } from '../core/browser/browser-state';
import type { WebHistory } from '../core/workspace/tab-navigation';
export type { BrowserPage } from '../core/browser/browser-state';
export type BrowserPlace = { url: string; title: string; bookmarked: boolean; lastVisit: number; visits: number };
export type BrowserPlaceScope = 'all' | 'bookmarks' | 'history';
export type BrowserDownload = {
  id: string; url: string; name: string; path: string; received: number; total: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  paused: boolean; resumable: boolean; startedAt: number;
};
export type DownloadCommand = 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'remove';
export type BrowserCommand = 'back' | 'forward' | 'reload' | 'stop' | 'focus' | 'mute' | 'external' | 'save' | 'protection'
  | 'zoom-in' | 'zoom-out' | 'zoom-reset';
export type BrowserEvent =
  | { type: 'page'; page: BrowserPage }
  | { type: 'open'; page: BrowserPage; background: boolean }
  | { type: 'focus'; id: string }
  | { type: 'close'; id: string }
  | { type: 'navigation'; id: string }
  | { type: 'history'; id: string; direction: -1 | 1 }
  | { type: 'places' }
  | { type: 'download'; download: BrowserDownload }
  | { type: 'download-removed'; id: string }
  | { type: 'find'; id: string; active: number; matches: number };
export type BrowserApi = {
  create(id: string, input: string, history?: WebHistory): Promise<BrowserPage>;
  history(id: string): Promise<WebHistory>;
  navigate(id: string, input: string): Promise<void>;
  command(id: string, command: BrowserCommand): Promise<boolean | void>;
  close(id: string): Promise<boolean>;
  layout(entries: Array<{ id: string; bounds: PreviewBounds; canGoBack?: boolean; canGoForward?: boolean }>): void;
  capture(id: string): Promise<string | null>;
  find(id: string, text: string, forward?: boolean, next?: boolean): void;
  places(query: string, scope?: BrowserPlaceScope): Promise<BrowserPlace[]>;
  bookmark(url: string, title: string, bookmarked: boolean): Promise<void>;
  deleteHistory(url?: string): Promise<void>;
  downloads(): Promise<BrowserDownload[]>;
  downloadCommand(id: string, command: DownloadCommand): Promise<void>;
  restore(): Promise<BrowserPage[]>;
  onEvent(listener: (event: BrowserEvent) => void): () => void;
};
