import type { PreviewThemeId } from '../core/preview/preview-preferences';
import type { PreviewBounds } from './preview-preparation';

export type BrowserFindRequest = {
  scope?: 'markdown';
  token: string; id: string; focus: string; bounds: PreviewBounds;
  query: string; active: number; matches: number;
};
export type BrowserFindContext = BrowserFindRequest & { theme: PreviewThemeId };
export type BrowserFindAction = { token: string; id: string; query: string; command: 'search' | 'previous' | 'next' | 'close' };
export type BrowserFindOverlayApi = {
  show(request: BrowserFindRequest): Promise<void>;
  hide(token: string): void;
  context(): Promise<BrowserFindContext | undefined>;
  action(action: BrowserFindAction): void;
  onShow(listener: (context: BrowserFindContext) => void): () => void;
  onAction(listener: (action: BrowserFindAction) => void): () => void;
};
