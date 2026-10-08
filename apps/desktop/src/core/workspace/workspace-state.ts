import { EditorGroups } from './editor-groups';
import type { DocumentSnapshot } from '../document/document';
import { documentSurface } from '../document/document-profile';
import type { PreviewHeading } from '../preview/preview-state';
import type { PreviewThemeId } from '../preview/preview-preferences';
import type { ViewportAnchor } from '../preview/viewport-anchor';

export type DocumentTab = {
  navigation?: import('./tab-navigation').TabNavigation;
  kind?: 'document';
  id: string;
  document: DocumentSnapshot;
  text: string;
  revision: number;
  surface: 'viewer' | 'editor' | 'pdf' | 'image' | 'video';
  readingPosition?: import('../reading/reading-position').ReadingPosition;
  restoringPosition?: boolean;
  anchor: ViewportAnchor;
  previewUrl: string | null;
  previewRevision: number | null;
  previewTheme: PreviewThemeId | null;
  tocOpen: boolean;
  viewerScrollRatio: number | null;
  headings: PreviewHeading[];
  activeHeadingId: string | null;
  find: { open: boolean; query: string; activeMatch: number; matches: number };
};

export type BrowserTab = { kind: 'web'; id: string; surface: 'web'; page: import('../browser/browser-state').BrowserPage;
  navigation?: import('./tab-navigation').TabNavigation };
export type WorkspaceTab = DocumentTab | BrowserTab;
export const isDocumentTab = (tab: WorkspaceTab): tab is DocumentTab => tab.kind !== 'web';
export const tabTitle = (tab: WorkspaceTab): string => tab.kind === 'web' ? tab.page.title || 'New web tab' : tab.document.name;
export const tabLocation = (tab: WorkspaceTab): string => tab.kind === 'web' ? tab.page.url : tab.document.path;

export function createWorkspaceTab(
  id: string,
  document: DocumentSnapshot,
  surface: DocumentTab['surface'],
  anchor: ViewportAnchor,
): DocumentTab {
  return {
    id,
    document,
    text: document.text,
    readingPosition: document.readingPosition,
    revision: document.revision,
    surface: documentSurface(document.path, surface),
    anchor,
    previewUrl: null,
    previewRevision: null,
    previewTheme: null,
    tocOpen: false,
    viewerScrollRatio: null,
    headings: [],
    activeHeadingId: null,
    find: { open: false, query: '', activeMatch: 0, matches: 0 },
  };
}

export class WorkspaceState {
  readonly tabs: WorkspaceTab[] = [];
  readonly groups = new EditorGroups();
  private activeTabId: string | null = null;
  get activeId() { return this.activeTabId; }
  set activeId(id: string | null) { this.activeTabId = id; if (id) this.groups.activate(id); }
  get documents(): DocumentTab[] { return this.tabs.filter(isDocumentTab); }
  get activeDocument(): DocumentTab | null { const tab = this.active; return tab && isDocumentTab(tab) ? tab : null; }
  get active(): WorkspaceTab | null { return this.tabs.find((tab) => tab.id === this.activeId) ?? null; }
  find(id: string): WorkspaceTab | null { return this.tabs.find((tab) => tab.id === id) ?? null; }
  add(tab: WorkspaceTab, pinned = true): WorkspaceTab | null {
    const previousId = this.groups.add(tab.id, pinned);
    const previous = previousId ? this.find(previousId) : null;
    if (previous) {
      this.tabs.splice(this.tabs.indexOf(previous), 1, tab);
      if (this.activeTabId === previous.id) this.activeTabId = null;
    } else this.tabs.push(tab);
    return previous;
  }
  remove(id: string): { tab: WorkspaceTab; index: number; wasActive: boolean } | null {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return null;
    const [tab] = this.tabs.splice(index, 1);
    this.groups.remove(id);
    const wasActive = id === this.activeId;
    if (wasActive) this.activeId = null;
    return { tab, index, wasActive };
  }
  replacement(index: number): WorkspaceTab | null { return this.find(this.groups.focused.activeId ?? '') ?? this.tabs[Math.min(index, this.tabs.length - 1)] ?? null; }
  cycle(direction: -1 | 1): WorkspaceTab | null {
    if (this.tabs.length < 2 || !this.activeId) return null;
    const current = this.tabs.findIndex((tab) => tab.id === this.activeId);
    return this.tabs[(current + direction + this.tabs.length) % this.tabs.length];
  }
}

export function createTabSession(active: () => WorkspaceTab | null, emptyAnchor: ViewportAnchor) {
  const documentTab = () => { const tab = active(); return tab && isDocumentTab(tab) ? tab : null; };
  return {
    get document() { return documentTab()?.document ?? null; },
    set document(value: DocumentSnapshot | null) {
      const tab = documentTab();
      if (tab && value) tab.document = value;
    },
    get revision() { return documentTab()?.revision ?? 0; },
    set revision(value: number) {
      const tab = documentTab();
      if (tab) tab.revision = value;
    },
    get surface(): 'empty' | 'viewer' | 'editor' | 'pdf' | 'image' | 'video' | 'web' { return active()?.surface ?? 'empty'; },
    set surface(value: 'empty' | 'viewer' | 'editor' | 'pdf' | 'image' | 'video' | 'web') {
      const tab = documentTab();
      if (tab && value !== 'empty' && value !== 'web') tab.surface = documentSurface(tab.document.path, value);
    },
    get anchor() { return documentTab()?.anchor ?? emptyAnchor; },
    set anchor(value: ViewportAnchor) {
      const tab = documentTab();
      if (tab) tab.anchor = value;
    },
  };
}
export type TabSession = ReturnType<typeof createTabSession>;
