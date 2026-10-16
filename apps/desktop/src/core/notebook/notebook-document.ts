import { findNodeAtLocation, getNodeValue, parseTree, type Node, type ParseError } from 'jsonc-parser';

export type CellKind = 'code' | 'markdown' | 'raw';
export type NotebookCell = {
  id: string; kind: CellKind; source: string; version: number;
  outputRevision: number; executedSource?: string; outputs: unknown[]; executionCount: number | null; attachments: Record<string, unknown>;
  original?: Node; originalKind: CellKind; originalSource: string; clearOutputs: boolean;
};
const field = (node: Node, key: string) => findNodeAtLocation(node, [key]);
const value = (node: Node, key: string): unknown => { const child = field(node, key); return child && getNodeValue(child); };
export function notebookText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every(part => typeof part === 'string')) return value.join('');
  throw Error('A notebook source must be a string or an array of strings.');
}
function uniqueKeys(node: Node): void {
  if (node.type === 'object') {
    const keys = new Set<string>();
    for (const property of node.children ?? []) {
      const key = property.children![0].value as string;
      if (keys.has(key)) throw Error(`Duplicate notebook property: ${key}`);
      keys.add(key);
    }
  }
  for (const child of node.children ?? []) uniqueKeys(child);
}

/** Owns notebook data, independently of mounted cell editors. Unchanged JSON spans
 * are never round-tripped through JS numbers or reserialized metadata objects. */
export class NotebookDocument {
  readonly cells: NotebookCell[] = [];
  readonly language: string;
  readonly minor: number;
  readonly error?: string;
  revision = 0;
  private root?: Node;
  private cellsNode?: Node;
  private initial: NotebookCell[] = [];
  private checkpoint = new Map<string, { source: string; kind: CellKind; clear: boolean; output: number }>();
  private savedOrder: string[] = [];
  private serialized?: { revision: number; text: string };
  private serializations = new Map<string, { order: string[]; cells: Map<string, { source: string; kind: CellKind; clear: boolean; output: number }> }>();
  private listeners = new Set<() => void>();
  private undoStack: { undo(): void; redo(): void }[] = [];
  private redoStack: { undo(): void; redo(): void }[] = [];
  constructor(readonly original: string) {
    let language = 'python', minor = 5;
    try {
      const errors: ParseError[] = [];
      const root = parseTree(original, errors, { allowTrailingComma: false, disallowComments: true });
      if (!root || errors.length || root.type !== 'object') throw Error('This file is not valid notebook JSON.');
      uniqueKeys(root);
      if (value(root, 'nbformat') !== 4) throw Error('Only nbformat 4 notebooks can be edited. The original file is preserved.');
      const version = value(root, 'nbformat_minor');
      if (!Number.isInteger(version) || (version as number) < 0) throw Error('Invalid notebook format version.');
      minor = version as number;
      const cells = field(root, 'cells');
      if (cells?.type !== 'array' || field(root, 'metadata')?.type !== 'object') throw Error('Notebook cells or metadata are missing.');
      const ids = new Set<string>();
      for (const node of cells.children ?? []) {
        const kind = value(node, 'cell_type');
        if (!['code', 'markdown', 'raw'].includes(String(kind)) || field(node, 'metadata')?.type !== 'object')
          throw Error('This notebook contains an unsupported or invalid cell.');
        const source = notebookText(value(node, 'source'));
        const diskId = value(node, 'id');
        if (diskId !== undefined && (typeof diskId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(diskId) || ids.has(diskId)))
          throw Error('Notebook cell IDs must be unique valid strings.');
        if (minor >= 5 && diskId === undefined) throw Error('An nbformat 4.5 cell is missing its ID.');
        const id = typeof diskId === 'string' ? diskId : crypto.randomUUID();
        ids.add(id);
        const outputs = value(node, 'outputs'), count = value(node, 'execution_count');
        if (kind === 'code' && (!Array.isArray(outputs) || (count !== null && (!Number.isInteger(count) || (count as number) < 0))))
          throw Error('A code cell has invalid outputs or execution count.');
        this.cells.push({ id, kind: kind as CellKind, source, version: 1, outputRevision: 0, outputs: Array.isArray(outputs) ? outputs : [],
          executionCount: typeof count === 'number' ? count : null, attachments: (value(node, 'attachments') ?? {}) as Record<string, unknown>,
          original: node, originalSource: source, originalKind: kind as CellKind, clearOutputs: false });
      }
      language = String(findNodeAtLocation(root, ['metadata', 'language_info', 'name'])?.value
        ?? findNodeAtLocation(root, ['metadata', 'kernelspec', 'language'])?.value ?? 'python').toLowerCase();
      this.root = root; this.cellsNode = cells; this.initial = [...this.cells];
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); this.cells.length = 0; }
    this.language = language; this.minor = minor; this.markSaved(original);
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(): void { this.revision++; this.serialized = undefined; for (const listener of this.listeners) listener(); }
  get dirty(): boolean {
    return this.cells.length !== this.savedOrder.length || this.cells.some((cell, i) => {
      const saved = this.checkpoint.get(cell.id);
      return this.savedOrder[i] !== cell.id || !saved || saved.source !== cell.source || saved.kind !== cell.kind || saved.clear !== cell.clearOutputs || saved.output !== cell.outputRevision;
    });
  }
  setSource(id: string, source: string): void {
    const cell = this.cells.find(cell => cell.id === id);
    if (!cell || this.error || cell.source === source) return;
    cell.source = source; cell.version++; this.changed();
  }
  private perform(redo: () => void, undo: () => void): void {
    if (this.error) return;
    redo(); this.undoStack.push({ redo, undo }); this.redoStack = []; this.changed();
  }
  add(kind: CellKind, after?: string): string {
    const id = crypto.randomUUID();
    const cell: NotebookCell = { id, kind, source: '', version: 1, outputRevision: 0, outputs: [], executionCount: null,
      attachments: {}, originalKind: kind, originalSource: '', clearOutputs: false };
    const index = after ? this.cells.findIndex(cell => cell.id === after) + 1 : this.cells.length;
    this.perform(() => this.cells.splice(index, 0, cell), () => this.cells.splice(this.cells.indexOf(cell), 1));
    return id;
  }
  remove(id: string): void {
    const index = this.cells.findIndex(cell => cell.id === id), cell = this.cells[index];
    if (cell) this.perform(() => this.cells.splice(this.cells.indexOf(cell), 1), () => this.cells.splice(index, 0, cell));
  }
  duplicate(id: string): string | undefined {
    const index = this.cells.findIndex(cell => cell.id === id), original = this.cells[index]; if (!original) return;
    const copy = { ...original, id: crypto.randomUUID(), version: 1 };
    this.perform(() => this.cells.splice(index + 1, 0, copy), () => this.cells.splice(this.cells.indexOf(copy), 1));
    return copy.id;
  }
  move(id: string, delta: number): void {
    const from = this.cells.findIndex(cell => cell.id === id), to = from + delta;
    if (from < 0 || to === from || to < 0 || to >= this.cells.length) return;
    const move = (a: number, b: number) => this.cells.splice(b, 0, this.cells.splice(a, 1)[0]);
    this.perform(() => move(from, to), () => move(to, from));
  }
  /** A drag is one structural transaction; destination is a stable cell ID. */
  moveBefore(id: string, before?: string): void {
    const from = this.cells.findIndex(cell => cell.id === id);
    const index = before === undefined ? this.cells.length : this.cells.findIndex(cell => cell.id === before);
    if (from < 0 || index < 0 || id === before) return;
    this.move(id, (index > from ? index - 1 : index) - from);
  }
  /** Executing explicitly replaces outputs. Other cells retain their raw JSON spans. */
  setExecution(id: string, outputs: unknown[], count: number | null, source: string): void {
    const cell = this.cells.find(cell => cell.id === id);
    if (!cell || cell.kind !== 'code' || this.error) return;
    cell.outputs = outputs; cell.executionCount = count; cell.executedSource = source;
    cell.outputRevision++; cell.clearOutputs = false; this.changed();
  }
  convert(id: string, kind: CellKind): void {
    const cell = this.cells.find(cell => cell.id === id); if (!cell || cell.kind === kind) return;
    const previous = cell.kind;
    this.perform(() => { cell.kind = kind; }, () => { cell.kind = previous; });
  }
  clear(id: string): void {
    const cell = this.cells.find(cell => cell.id === id); if (!cell || cell.clearOutputs) return;
    this.perform(() => { cell.clearOutputs = true; }, () => { cell.clearOutputs = false; });
  }
  undo(): void { const action = this.undoStack.pop(); if (action) { action.undo(); this.redoStack.push(action); this.changed(); } }
  redo(): void { const action = this.redoStack.pop(); if (action) { action.redo(); this.undoStack.push(action); this.changed(); } }
  get canUndo(): boolean { return !!this.undoStack.length; }
  get canRedo(): boolean { return !!this.redoStack.length; }
  /** Checkpoint only the revision actually written; a later edit remains dirty. */
  markSaved(text: string): void {
    this.serialize();
    const snapshot = this.serializations.get(text);
    if (snapshot) {
      this.savedOrder = [...snapshot.order]; this.checkpoint = new Map(snapshot.cells);
    } else if (this.error) {
      this.savedOrder = []; this.checkpoint.clear();
    } else {
      const written = new NotebookDocument(text);
      this.savedOrder = written.cells.map((cell, i) => cell.original && value(cell.original, 'id') === undefined
        ? this.initial[i]?.id ?? cell.id : cell.id);
      this.checkpoint = new Map(written.cells.map((cell, i) => [this.savedOrder[i], { source: cell.source, kind: cell.kind,
        clear: this.cells.find(current => current.id === this.savedOrder[i])?.clearOutputs === true && cell.outputs.length === 0,
        // Older id-less cells cannot be matched safely across a transferred reorder.
        // Keep a conservative dirty checkpoint until an explicit save.
        output: this.minor < 5 && cell.original && value(cell.original, 'id') === undefined && text !== this.original ? -1
          : JSON.stringify(cell.outputs) === JSON.stringify(this.cells.find(current => current.id === this.savedOrder[i])?.outputs)
          && cell.executionCount === this.cells.find(current => current.id === this.savedOrder[i])?.executionCount
          ? this.cells.find(current => current.id === this.savedOrder[i])!.outputRevision : -1 }]));
    }
  }
  serialize(): string {
    if (this.error || !this.cellsNode || !this.root) return this.original;
    if (this.serialized?.revision === this.revision) return this.serialized.text;
    const unchanged = this.cells.length === this.initial.length && this.cells.every((cell, i) => cell === this.initial[i]
      && cell.source === cell.originalSource && cell.kind === cell.originalKind && !cell.clearOutputs && !cell.outputRevision);
    if (unchanged) return this.rememberSerialization(this.original);
    const cells = this.cells.map(cell => this.serializeCell(cell));
    let text = this.original;
    if (this.cells.length === this.initial.length && this.cells.every((cell, i) => cell === this.initial[i])) {
      const fragments: string[] = []; let offset = 0;
      for (let i = 0; i < this.cells.length; i++) {
        const node = this.cells[i].original!;
        if (cells[i] === this.original.slice(node.offset, node.offset + node.length)) continue;
        fragments.push(this.original.slice(offset, node.offset), cells[i]); offset = node.offset + node.length;
      }
      fragments.push(this.original.slice(offset)); text = fragments.join('');
    } else {
      const eol = this.original.includes('\r\n') ? '\r\n' : '\n';
      text = this.original.slice(0, this.cellsNode.offset) + '[' + eol + cells.map(text => '  ' + text).join(',' + eol)
        + eol + ' ]' + this.original.slice(this.cellsNode.offset + this.cellsNode.length);
    }
    return this.rememberSerialization(text);
  }
  private rememberSerialization(text: string): string {
    this.serialized = { revision: this.revision, text };
    this.serializations.set(text, { order: this.cells.map(cell => cell.id), cells: new Map(this.cells.map(cell =>
      [cell.id, { source: cell.source, kind: cell.kind, clear: cell.clearOutputs, output: cell.outputRevision }])) });
    // Saves are serialized by the workspace. Retain a few in-flight checkpoints,
    // without keeping an unbounded sequence of large output JSON strings.
    while (this.serializations.size > 4) this.serializations.delete(this.serializations.keys().next().value!);
    return text;
  }
  private serializeCell(cell: NotebookCell): string {
    const node = cell.original;
    const copied = !!node && value(node, 'id') !== undefined && value(node, 'id') !== cell.id;
    if (!node) return JSON.stringify({ cell_type: cell.kind, ...(this.minor >= 5 ? { id: cell.id } : {}), metadata: {}, source: cell.source,
      ...(cell.kind === 'code' ? { execution_count: cell.clearOutputs ? null : cell.executionCount, outputs: cell.clearOutputs ? [] : cell.outputs } : {}) }, null, 1).replace(/\n/g, this.original.includes('\r\n') ? '\r\n' : '\n');
    if (!copied && cell.source === cell.originalSource && cell.kind === cell.originalKind && !cell.clearOutputs && !cell.outputRevision)
      return this.original.slice(node.offset, node.offset + node.length);
    if (!copied && cell.kind === cell.originalKind && !cell.clearOutputs && !cell.outputRevision) {
      const source = field(node, 'source')!;
      return this.original.slice(node.offset, source.offset) + JSON.stringify(cell.source)
        + this.original.slice(source.offset + source.length, node.offset + node.length);
    }
    // Copy raw property spans (including unknown fields and numeric lexemes).
    const replace = new Map<string, string>([['cell_type', JSON.stringify(cell.kind)]]);
    if (copied) replace.set('id', JSON.stringify(cell.id));
    if (cell.source !== cell.originalSource) replace.set('source', JSON.stringify(cell.source));
    if (cell.kind === 'code' && (cell.originalKind !== 'code' || cell.clearOutputs || cell.outputRevision)) {
      replace.set('outputs', JSON.stringify(cell.clearOutputs ? [] : cell.outputs));
      replace.set('execution_count', JSON.stringify(cell.clearOutputs ? null : cell.executionCount));
    }
    const properties: string[] = [];
    for (const property of node.children ?? []) {
      const [key] = property.children!; const name = key.value as string;
      if (cell.kind !== 'code' && ['outputs', 'execution_count'].includes(name)) continue;
      if (replace.has(name)) { properties.push(`${JSON.stringify(name)}: ${replace.get(name)}`); replace.delete(name); }
      else properties.push(this.original.slice(property.offset, property.offset + property.length));
    }
    for (const [key, val] of replace) properties.push(`${JSON.stringify(key)}: ${val}`);
    const eol = this.original.includes('\r\n') ? '\r\n' : '\n';
    return '{' + eol + '   ' + properties.join(',' + eol + '   ') + eol + '  }';
  }
}

export function emptyNotebook(): string {
  return JSON.stringify({ cells: [], metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 5 }, null, 1) + '\n';
}
