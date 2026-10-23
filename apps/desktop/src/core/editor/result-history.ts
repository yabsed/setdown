export type ResultLocation = { path: string; line: number; column: number; endLine?: number; endColumn?: number; cellId?: string; context?: string; version?: number; groupId?: string; viewId?: string | null };
export type ResultEntry = { label: string; detail: string; location?: ResultLocation; open?(): Promise<void> };
export type ResultSnapshot = { id: string; title: string; provider: string; group: string; root: string | null; created: number;
  entries: ResultEntry[]; selected: number; version: number; stale: boolean; truncated: boolean; pinned: boolean; query: string };
export class ResultHistory {
  private snapshots: ResultSnapshot[] = [];
  private selected = new Map<string, string>();
  private listeners = new Set<() => void>();
  private byPath = new Map<string, Set<ResultSnapshot>>();
  constructor(readonly capacity = 30, readonly itemLimit = 1000) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(): void { for (const listener of this.listeners) listener(); }
  list(group?: string): ResultSnapshot[] { return this.snapshots.filter(snapshot => !group || snapshot.group === group); }
  current(group: string): ResultSnapshot | undefined { return this.snapshots.find(snapshot => snapshot.id === this.selected.get(group)); }
  add(input: Omit<ResultSnapshot, 'id' | 'created' | 'selected' | 'version' | 'stale' | 'pinned'>): ResultSnapshot {
    if (this.snapshots.length >= this.capacity) {
      const index = this.snapshots.findIndex(entry => !entry.pinned);
      if (index < 0) throw Error('All result history slots are pinned. Unpin a list first.');
      const [removed] = this.snapshots.splice(index, 1);
      for (const [path, entries] of this.byPath) { entries.delete(removed); if (!entries.size) this.byPath.delete(path); }
    }
    const snapshot: ResultSnapshot = { ...input, entries: input.entries.slice(0, this.itemLimit).map(entry => ({ ...entry, location: entry.location ? { ...entry.location } : undefined })),
      id: crypto.randomUUID(), created: Date.now(), selected: 0, version: 1, stale: false, pinned: false,
      truncated: input.truncated || input.entries.length > this.itemLimit };
    this.snapshots.push(snapshot); this.selected.set(input.group, snapshot.id);
    for (const entry of snapshot.entries) if (entry.location) {
      const entries = this.byPath.get(entry.location.path) ?? new Set<ResultSnapshot>(); entries.add(snapshot); this.byPath.set(entry.location.path, entries);
    }
    this.changed(); return snapshot;
  }
  select(id: string): ResultSnapshot | undefined { const found = this.snapshots.find(snapshot => snapshot.id === id); if (found) { this.selected.set(found.group, id); this.changed(); } return found; }
  move(group: string, direction: -1 | 1): ResultSnapshot | undefined {
    const entries = this.list(group), index = entries.findIndex(entry => entry.id === this.selected.get(group));
    const next = entries[Math.max(0, Math.min(entries.length - 1, index + direction))]; return next && this.select(next.id);
  }
  pin(id: string, pinned: boolean): void { const entry = this.snapshots.find(entry => entry.id === id); if (entry) { entry.pinned = pinned; this.changed(); } }
  markStale(path: string): void {
    let changed = false;
    for (const snapshot of this.byPath.get(path) ?? []) if (!snapshot.stale) { snapshot.stale = true; changed = true; }
    if (changed) this.changed();
  }
  filter(id: string, query: string): ResultSnapshot {
    const source = this.snapshots.find(snapshot => snapshot.id === id); if (!source) throw Error('This result list is no longer available.');
    const needle = query.toLocaleLowerCase();
    const next = this.add({ ...source, title: `${source.title} · ${query}`, query,
      entries: source.entries.filter(entry => `${entry.label}\n${entry.detail}`.toLocaleLowerCase().includes(needle)) });
    next.stale = source.stale; return next;
  }
}
