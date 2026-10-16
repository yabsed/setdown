import type { NotebookDocument, CellKind } from '../../core/notebook/notebook-document';

/** Selection outlives DOM focus. All structural commands share document history. */
export class NotebookController {
  active?: string;
  selected = new Set<string>();
  anchor?: string;
  readonly collapsedInputs = new Set<string>();
  readonly collapsedOutputs = new Set<string>();
  scrollTop = 0;
  private listeners = new Set<() => void>();
  constructor(readonly document: NotebookDocument) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed(): void { for (const listener of this.listeners) listener(); }
  select(id: string, range = false, toggle = false): void {
    if (!this.document.cells.some(cell => cell.id === id)) return;
    const order = this.document.cells.map(cell => cell.id);
    if (range && this.anchor && order.includes(this.anchor)) {
      const a = order.indexOf(this.anchor), b = order.indexOf(id); this.selected = new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (toggle) { if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id); this.anchor = id; }
    else { this.selected = new Set([id]); this.anchor = id; }
    this.active = id; this.changed();
  }
  reconcile(): void {
    const ids = new Set(this.document.cells.map(cell => cell.id));
    this.selected = new Set([...this.selected].filter(id => ids.has(id)));
    if (!this.active || !ids.has(this.active)) this.active = this.document.cells[0]?.id;
    if (!this.selected.size && this.active) this.selected.add(this.active);
    this.changed();
  }
  insert(kind: CellKind, after = this.active): string { const id = this.document.add(kind, after); this.select(id); return id; }
  remove(): void {
    const index = this.document.cells.findIndex(cell => cell.id === this.active);
    this.document.removeMany([...this.selected]);
    const next = this.document.cells[Math.min(index, this.document.cells.length - 1)];
    if (next) this.select(next.id); else { this.active = undefined; this.selected.clear(); this.changed(); }
  }
  move(before?: string): void { this.document.moveManyBefore([...this.selected], before); this.reconcile(); }
  copy(): string { return this.document.copyCells([...this.selected]); }
  paste(text: string): string[] {
    const ids = this.document.pasteCells(text, this.active); this.selected = new Set(ids); this.active = ids.at(-1); this.anchor = ids[0]; this.changed(); return ids;
  }
  toggleOutput(id: string): void { if (this.collapsedOutputs.has(id)) this.collapsedOutputs.delete(id); else this.collapsedOutputs.add(id); this.changed(); }
  toggleInput(id: string): void { if (this.collapsedInputs.has(id)) this.collapsedInputs.delete(id); else this.collapsedInputs.add(id); this.changed(); }
}
