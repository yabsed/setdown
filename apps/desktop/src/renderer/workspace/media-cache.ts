import type { DocumentSnapshot } from '../../core/document/document';
import type { ReadingPosition } from '../../core/reading/reading-position';
import type { WorkspaceTab } from '../../core/workspace/workspace-state';

export type MediaTab = { id: string; key: string; document: DocumentSnapshot; position?: ReadingPosition };
export const mediaKey = (tab: Pick<WorkspaceTab, 'id' | 'document'>): string =>
  JSON.stringify([tab.id, tab.document.kind, tab.document.path, tab.document.diskVersion]);

/** Keep only visited, current-version surfaces. Eviction unmounts their resources. */
export class MediaCache {
  private entries: MediaTab[] = [];
  constructor(private readonly capacity = 3) {}
  sync(tabs: readonly WorkspaceTab[], activeId: string | null): MediaTab[] {
    const previous = this.entries;
    const current = new Map(tabs.filter((tab) => tab.document.kind).map((tab) => [tab.id, tab]));
    this.entries = this.entries.filter((entry) => {
      const tab = current.get(entry.id);
      return tab && mediaKey(tab) === entry.key;
    });
    const active = activeId ? current.get(activeId) : undefined;
    if (active) {
      const entry = this.entries.find((entry) => entry.id === active.id)
        ?? { id: active.id, key: mediaKey(active), document: active.document, position: active.readingPosition };
      this.entries = [...this.entries.filter((entry) => entry.id !== active.id), entry].slice(-this.capacity);
    }
    if (previous.length === this.entries.length && previous.every((entry, index) => entry === this.entries[index]))
      this.entries = previous;
    return this.entries;
  }
}
