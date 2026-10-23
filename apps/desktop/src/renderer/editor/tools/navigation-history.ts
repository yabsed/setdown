import type * as Monaco from 'monaco-editor';
import type { ResultLocation } from '../../../core/editor/result-history';
export type EditorLocation = ResultLocation & { viewId?: string | null; groupId?: string; uri: string; text: string; stale?: boolean };
type Anchor = { location: EditorLocation; model?: Monaco.editor.ITextModel; decoration?: string; time: number; dispose?: Monaco.IDisposable; name?: string };
export class NavigationHistory {
  private jumps: Anchor[] = [];
  private cursor = -1;
  private changes: Anchor[] = [];
  private changeCursor = -1;
  private marks = new Map<string, Anchor>();
  private suppress = 0;
  constructor(private readonly api: typeof Monaco, private readonly open: (location: EditorLocation) => Promise<void>) {}
  private anchor(model: Monaco.editor.ITextModel, location: EditorLocation): Anchor {
    const decoration = model.deltaDecorations([], [{ range: new this.api.Range(location.line, location.column, location.line, location.column),
      options: { stickiness: this.api.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } }])[0];
    const anchor: Anchor = { model, decoration, location: { ...location }, time: Date.now() };
    const dispose = model.onWillDispose(() => { anchor.location = this.read(anchor); anchor.model = undefined; anchor.decoration = undefined; dispose.dispose(); });
    anchor.dispose = dispose; return anchor;
  }
  private read(anchor: Anchor): EditorLocation {
    const range = anchor.model && anchor.decoration && !anchor.model.isDisposed() ? anchor.model.getDecorationRange(anchor.decoration) : null;
    if (range) return { ...anchor.location, line: range.startLineNumber, column: range.startColumn,
      text: anchor.model!.getLineContent(range.startLineNumber), version: anchor.model!.getVersionId() };
    return { ...anchor.location, stale: true };
  }
  private drop(anchor: Anchor): void { anchor.dispose?.dispose(); if (anchor.model && !anchor.model.isDisposed() && anchor.decoration) anchor.model.deltaDecorations([anchor.decoration], []); }
  remember(model: Monaco.editor.ITextModel, location: EditorLocation, origin: 'user' | 'internal' = 'user'): void {
    if (origin === 'internal' || this.suppress) return;
    const current = this.jumps[this.cursor] && this.read(this.jumps[this.cursor]);
    if (current?.uri === location.uri && current.line === location.line && current.column === location.column) return;
    for (const discarded of this.jumps.splice(this.cursor + 1)) this.drop(discarded);
    this.jumps.push(this.anchor(model, location)); if (this.jumps.length > 100) this.drop(this.jumps.shift()!);
    this.cursor = this.jumps.length - 1;
  }
  async move(direction: -1 | 1, current?: { model: Monaco.editor.ITextModel; location: EditorLocation }): Promise<void> {
    if (direction < 0 && this.cursor === this.jumps.length - 1 && current) this.remember(current.model, current.location);
    const index = this.cursor + direction; if (index < 0 || index >= this.jumps.length) return;
    this.suppress++; try { await this.open(this.read(this.jumps[index])); this.cursor = index; } finally { this.suppress--; }
  }
  changed(model: Monaco.editor.ITextModel, location: EditorLocation): void {
    const previous = this.changes.at(-1);
    if (previous && previous.location.uri === location.uri && Date.now() - previous.time < 1500
      && Math.abs(this.read(previous).line - location.line) <= 1) this.drop(this.changes.pop()!);
    this.changes.push(this.anchor(model, location)); if (this.changes.length > 100) this.drop(this.changes.shift()!);
    this.changeCursor = this.changes.length;
  }
  async change(direction: -1 | 1): Promise<void> {
    const next = Math.max(0, Math.min(this.changes.length - 1, this.changeCursor + direction));
    const target = this.changes[next]; if (!target) return;
    this.suppress++; try { await this.open(this.read(target)); this.changeCursor = next; } finally { this.suppress--; }
  }
  mark(name: string, model: Monaco.editor.ITextModel, location: EditorLocation): void {
    const old = this.marks.get(name); if (old) this.drop(old);
    this.marks.set(name, { ...this.anchor(model, location), name });
    if (this.marks.size > 100) { const first = this.marks.keys().next().value!; this.drop(this.marks.get(first)!); this.marks.delete(first); }
  }
  marked(): Array<{ name: string; location: EditorLocation }> { return [...this.marks].map(([name, anchor]) => ({ name, location: this.read(anchor) })); }
  retarget(from: string, to: string): void {
    for (const anchor of [...this.jumps, ...this.changes, ...this.marks.values()]) if (anchor.location.path === from) anchor.location.path = to;
  }
}
