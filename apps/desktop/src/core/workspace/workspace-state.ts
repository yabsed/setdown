import { EditorGroups } from './editor-groups';
import type { DocumentSnapshot } from '../document/document';
import { documentSurface } from '../document/document-profile';
import type { PreviewHeading } from '../preview/preview-state';
import type { PreviewThemeId } from '../preview/preview-preferences';
import type { ViewportAnchor } from '../preview/viewport-anchor';

export type WorkspaceTab = {
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

export function createWorkspaceTab(
  id: string,
  document: DocumentSnapshot,
  surface: WorkspaceTab['surface'],
  anchor: ViewportAnchor,
): WorkspaceTab {
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
  get active(): WorkspaceTab | null { return this.tabs.find((tab) => tab.id === this.activeId) ?? null; }
  find(id: string): WorkspaceTab | null { return this.tabs.find((tab) => tab.id === id) ?? null; }
  add(tab: WorkspaceTab): void { this.tabs.push(tab); this.groups.add(tab.id); }
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
  return {
    get document() { return active()?.document ?? null; },
    set document(value: DocumentSnapshot | null) {
      const tab = active();
      if (tab && value) tab.document = value;
    },
    get revision() { return active()?.revision ?? 0; },
    set revision(value: number) {
      const tab = active();
      if (tab) tab.revision = value;
    },
    get surface(): 'empty' | 'viewer' | 'editor' | 'pdf' | 'image' | 'video' { return active()?.surface ?? 'empty'; },
    set surface(value: 'empty' | 'viewer' | 'editor' | 'pdf' | 'image' | 'video') {
      const tab = active();
      if (tab && value !== 'empty') tab.surface = documentSurface(tab.document.path, value);
    },
    get anchor() { return active()?.anchor ?? emptyAnchor; },
    set anchor(value: ViewportAnchor) {
      const tab = active();
      if (tab) tab.anchor = value;
    },
  };
}
export type TabSession = ReturnType<typeof createTabSession>;
