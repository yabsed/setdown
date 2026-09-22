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
  sync(tabs: readonly WorkspaceTab[], activeId: string | null, visibleIds: string[] = []): MediaTab[] {
    const previous = this.entries;
    const current = new Map(tabs.filter((tab) => tab.document.kind).map((tab) => [tab.id, tab]));
    this.entries = this.entries.filter((entry) => {
      const tab = current.get(entry.id);
      return tab && mediaKey(tab) === entry.key;
    });
    for (const id of new Set([...visibleIds, ...(activeId ? [activeId] : [])])) {
      const active = current.get(id);
      if (!active) continue;
      const entry = this.entries.find((entry) => entry.id === active.id)
        ?? { id: active.id, key: mediaKey(active), document: active.document, position: active.readingPosition };
      this.entries = [...this.entries.filter((entry) => entry.id !== active.id), entry];
    }
    const protectedIds = new Set(visibleIds.filter(id => current.has(id)));
    const hidden = this.entries.filter(entry => !protectedIds.has(entry.id));
    const keep = new Set(hidden.slice(-Math.max(0, this.capacity - protectedIds.size)).map(entry => entry.id));
    if (protectedIds.size >= this.capacity) keep.clear();
    this.entries = this.entries.filter(entry => protectedIds.has(entry.id) || keep.has(entry.id));
    if (previous.length === this.entries.length && previous.every((entry, index) => entry === this.entries[index]))
      this.entries = previous;
    return this.entries;
  }
}
