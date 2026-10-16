import type { NotebookApi, NotebookKernelEvent, NotebookExecutionCell } from '../../protocol/notebook';
import type { NotebookCell, NotebookDocument } from '../../core/notebook/notebook-document';

type Output = Record<string, unknown>;
type Run = NotebookExecutionCell & { cell: NotebookCell; outputs: Output[]; count: number | null;
  clear: boolean; displays: Map<string, number[]> };
/** Owns execution independently of virtual cell views. No code runs at construction. */
export class NotebookExecution {
  state = 'stopped'; message = ''; python = ''; selectedPython?: string;
  readonly cells = new Map<string, 'queued' | 'running' | 'error'>();
  private generation = crypto.randomUUID();
  private runs = new Map<string, Run>();
  private pending = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();
  private release: () => void;
  private disposed = false;
  constructor(private port: NotebookApi, private document: NotebookDocument, private id: string, private path: string) {
    this.release = port.onEvent(event => this.event(event));
  }
  get busy(): boolean { return this.state === 'starting' || this.state === 'busy'; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(): void { for (const listener of this.listeners) listener(); }
  setPath(path: string): void { if (path !== this.path) { this.shutdown(); this.path = path; } }
  async run(ids?: string[]): Promise<void> {
    if (this.busy || this.disposed || this.document.error || this.document.language !== 'python') return;
    const cells = this.document.cells.filter(cell => cell.kind === 'code' && (!ids || ids.includes(cell.id)));
    if (!cells.length) return;
    this.message = ''; this.state = 'starting'; this.cells.clear();
    for (const cell of cells) {
      this.cells.set(cell.id, 'queued');
      this.runs.set(cell.id, { id: cell.id, version: cell.version, source: cell.source, cell, outputs: [], count: null, clear: false, displays: new Map() });
    }
    this.changed(); const generation = this.generation;
    try {
      await this.port.run({ id: this.id, generation, path: this.path, python: this.selectedPython,
        cells: cells.map(cell => ({ id: cell.id, version: cell.version, source: cell.source })) });
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.state = 'failed'; this.message = String(error); this.cells.clear(); this.changed();
    }
  }
  private event(event: NotebookKernelEvent): void {
    if (this.disposed || event.id !== this.id || event.generation !== this.generation) return;
    if (event.type === 'state') {
      this.state = event.state; this.message = event.message ?? this.message; this.python = event.python ?? this.python;
      if (!this.busy) { this.flush(); for (const [id, state] of this.cells) if (state !== 'error') this.cells.delete(id); }
      this.changed(); return;
    }
    const run = this.runs.get(event.cell);
    if (!run || run.version !== event.version || !this.document.cells.includes(run.cell) || run.cell.kind !== 'code') return;
    if (event.type === 'cell-start') {
      this.cells.set(run.id, 'running'); this.pending.add(run.id); this.flush(); this.changed(); return;
    }
    if (event.type === 'cell-done') {
      run.count = event.count; this.pending.add(run.id); this.flush();
      if (event.ok) this.cells.delete(run.id); else this.cells.set(run.id, 'error');
      this.changed(); return;
    }
    const { kind, content } = event;
    if (kind === 'execute_input') { run.count = typeof content.execution_count === 'number' ? content.execution_count : null; }
    else if (kind === 'clear_output') {
      if (content.wait) run.clear = true;
      else { run.outputs = []; run.displays.clear(); run.clear = false; }
    } else if (kind === 'update_display_data') {
      const displayId = (content.transient as { display_id?: string } | undefined)?.display_id;
      if (displayId) for (const target of this.runs.values()) for (const index of target.displays.get(displayId) ?? []) {
        target.outputs = target.outputs.map((output, i) => i === index ? { ...output, data: content.data, metadata: content.metadata ?? {} } : output);
        this.pending.add(target.id);
      }
    } else if (['stream', 'display_data', 'execute_result', 'error'].includes(kind)) {
      if (run.clear) { run.outputs = []; run.displays.clear(); run.clear = false; }
      if (kind === 'stream') {
        const previous = run.outputs.at(-1);
        if (previous?.output_type === 'stream' && previous.name === content.name)
          run.outputs = [...run.outputs.slice(0, -1), { ...previous, text: String(previous.text) + String(content.text) }];
        else run.outputs = [...run.outputs, { output_type: 'stream', name: content.name, text: content.text }];
      } else {
        const output: Output = kind === 'error' ? { output_type: 'error', ename: content.ename, evalue: content.evalue, traceback: content.traceback }
          : { output_type: kind, data: content.data, metadata: content.metadata ?? {}, ...(kind === 'execute_result' ? { execution_count: content.execution_count } : {}) };
        const displayId = (content.transient as { display_id?: string } | undefined)?.display_id;
        if (displayId) run.displays.set(displayId, [...run.displays.get(displayId) ?? [], run.outputs.length]);
        run.outputs = [...run.outputs, output];
      }
    }
    this.pending.add(run.id);
    this.timer ??= setTimeout(() => this.flush(), 50);
  }
  private flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    for (const id of this.pending) {
      const run = this.runs.get(id);
      if (run && this.document.cells.includes(run.cell) && run.cell.kind === 'code')
        this.document.setExecution(id, run.outputs, run.count, run.source);
    }
    this.pending.clear();
  }
  async interrupt(): Promise<void> {
    if (!this.busy) return;
    // Stop a discovery still awaiting shell environment as well as a live kernel.
    if (this.state === 'starting') { this.shutdown(); return; }
    try { await this.port.interrupt(this.id, this.generation); }
    catch (error) { this.message = String(error); this.changed(); }
  }
  shutdown(): void {
    this.flush(); this.port.shutdown(this.id, this.generation); this.generation = crypto.randomUUID();
    this.state = 'stopped'; this.cells.clear(); this.runs.clear(); this.message = ''; this.changed();
  }
  async choosePython(): Promise<void> {
    const python = await this.port.choosePython();
    if (python && !this.disposed) { this.shutdown(); this.selectedPython = python; this.python = python; this.changed(); }
  }
  dispose(): void { this.shutdown(); this.disposed = true; this.release(); this.listeners.clear(); }
}
