export type TabView = {
  id: string;
  name: string;
  path: string;
  active: boolean;
  dirty: boolean;
};

export type HeadingView = {
  id: string;
  text: string;
  level: number;
};

export type AppActions = {
  loadMenu(id: string): Promise<ApplicationMenuEntry[]>;
  executeMenuItem(id: string): void;
  activateTab(id: string): void;
  closeTab(id: string): void;
  startTabDrag(id: string, event: DragEvent): void;
  endTabDrag(event: DragEvent): void;
  newDocument(): void;
  openDocument(): void;
  toggleSurface(): void;
  openTable(): void;
  openLink(): void;
  submitTable(): void;
  closeTable(): void;
  submitLink(): void;
  closeLink(): void;
  pickLinkFile(): void;
  toggleToc(): void;
  find(query: string, direction?: 'forward' | 'backward', next?: boolean): void;
  closeFind(): void;
  scrollToHeading(id: string): void;
  keepExternalChange(): void;
  reloadExternalChange(): void;
  showRenderError(): void;
};

export const view = $state({
  tabs: [] as TabView[],
  draggedTabId: null as string | null,
  surface: 'empty' as 'empty' | 'viewer' | 'editor',
  notice: false,
  tocOpen: false,
  headings: [] as HeadingView[],
  activeHeadingId: null as string | null,
  findOpen: false,
  findQuery: '',
  findActive: 0,
  findMatches: 0,
  rendering: false,
  renderVariant: 'blocking' as 'blocking' | 'refresh',
  renderError: '',
  renderErrorVariant: 'blocking' as 'blocking' | 'refresh',
});
import type { ApplicationMenuEntry } from '../protocol/desktop-api';
