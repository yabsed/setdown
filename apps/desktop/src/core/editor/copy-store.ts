export type CopyKind = 'characters' | 'lines' | 'block';
export type CopyEntry = { id: string; fragments: string[]; kind: CopyKind; path: string; created: number; name?: string; pinned: boolean; cut: boolean };
/** Explicit copy/cut only. Ordinary Delete never changes the last copy. */
export class CopyStore {
  private entries: CopyEntry[] = [];
  lastCopy: string | null = null;
  constructor(readonly capacity = 40, readonly maxCharacters = 1024 * 1024) {}
  list(query = ''): CopyEntry[] {
    const needle = query.toLocaleLowerCase();
    return this.entries.filter(entry => `${entry.name ?? ''}\n${entry.fragments.join('\n')}`.toLocaleLowerCase().includes(needle));
  }
  add(fragments: string[], kind: CopyKind, path: string, cut = false): CopyEntry | null {
    if (!fragments.length || fragments.every(text => !text) || fragments.reduce((n, text) => n + text.length, 0) > this.maxCharacters) return null;
    if (this.entries.length >= this.capacity) {
      const candidate = [...this.entries].reverse().find(entry => !entry.pinned && (!cut || entry.id !== this.lastCopy));
      const index = candidate ? this.entries.indexOf(candidate) : -1;
      if (index < 0) throw Error(`All ${this.capacity} copy slots are retained. Unpin or delete an entry first.`);
      this.entries.splice(index, 1);
    }
    const entry: CopyEntry = { id: crypto.randomUUID(), fragments: [...fragments], kind, path, created: Date.now(), pinned: false, cut };
    this.entries.unshift(entry);
    if (!cut) this.lastCopy = entry.id;
    return entry;
  }
  name(id: string, name: string): void {
    const entry = this.get(id); const trimmed = name.trim().slice(0, 80);
    if (trimmed && this.entries.some(other => other.id !== id && other.name === trimmed)) throw Error('A copy with this name already exists.');
    entry.name = trimmed || undefined;
    entry.pinned = !!trimmed;
  }
  pin(id: string, pinned: boolean): void { this.get(id).pinned = pinned; }
  remove(id: string): void { this.entries = this.entries.filter(entry => entry.id !== id); if (this.lastCopy === id) this.lastCopy = null; }
  append(id: string, fragments: string[], kind: CopyKind): void {
    const entry = this.get(id);
    if (entry.kind !== kind || entry.fragments.length !== fragments.length) throw Error('Append requires the same selection shape and cursor count.');
    const next = entry.fragments.map((text, index) => text + fragments[index]);
    if (next.reduce((n, text) => n + text.length, 0) > this.maxCharacters) throw Error('The combined copy exceeds 1 MiB.');
    entry.fragments = next;
  }
  paste(id: string, cursors: number, broadcast = false): string[] {
    const entry = this.get(id);
    if (broadcast) return Array.from({ length: cursors }, () => entry.fragments.join(entry.kind === 'lines' ? '' : '\n'));
    if (entry.fragments.length === cursors) return [...entry.fragments];
    if (entry.fragments.length === 1) return Array.from({ length: cursors }, () => entry.fragments[0]);
    throw Error(`This copy has ${entry.fragments.length} fragments; the target has ${cursors} cursors. Choose “Paste combined” to use one combined value.`);
  }
  get(id: string): CopyEntry { const entry = this.entries.find(entry => entry.id === id); if (!entry) throw Error('This copy is no longer available.'); return entry; }
}
