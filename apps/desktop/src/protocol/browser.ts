import type { PreviewBounds } from './preview-preparation';

import type { BrowserPage } from '../core/browser/browser-state';
import type { WebHistory } from '../core/workspace/tab-navigation';
export type { BrowserPage } from '../core/browser/browser-state';
export type BrowserPlace = { url: string; title: string; bookmarked: boolean; lastVisit: number; visits: number };
export type BrowserCommand = 'back' | 'forward' | 'reload' | 'stop' | 'focus' | 'mute' | 'external' | 'save' | 'protection';
export type BrowserEvent =
  | { type: 'page'; page: BrowserPage }
  | { type: 'open'; page: BrowserPage; background: boolean }
  | { type: 'focus'; id: string }
  | { type: 'close'; id: string }
  | { type: 'navigation'; id: string }
  | { type: 'history'; id: string; direction: -1 | 1 }
  | { type: 'places' }
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
  places(query: string, bookmarksOnly?: boolean): Promise<BrowserPlace[]>;
  bookmark(url: string, title: string, bookmarked: boolean): Promise<void>;
  restore(): Promise<BrowserPage[]>;
  onEvent(listener: (event: BrowserEvent) => void): () => void;
};
