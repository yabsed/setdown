import type { NotebookApi, NotebookKernelEvent, NotebookExecutionCell, NotebookInspection } from '../../protocol/notebook';
import type { NotebookCell, NotebookDocument } from '../../core/notebook/notebook-document';

export type CellExecutionState = 'queued' | 'running' | 'succeeded' | 'error' | 'canceled' | 'skipped';
type Output = Record<string, unknown>;
type Run = NotebookExecutionCell & { cell: NotebookCell; outputs: Output[]; count: number | null;
  clear: boolean; displays: Map<string, number[]> };
/** Owns execution independently of virtual cell views. No code runs at construction. */
export class NotebookExecution {
  state = 'stopped'; message = ''; python = ''; selectedPython?: string;
  readonly cells = new Map<string, CellExecutionState>();
  readonly durations = new Map<string, number>();
  inputRequest?: Extract<NotebookKernelEvent, { type: 'input' }>;
  private inspections = new Map<string, { resolve(value: NotebookInspection): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  async answerInput(value: string): Promise<void> {
    const request = this.inputRequest; if (!request) return;
    await this.port.input(this.id, this.generation, request.request, value);
    if (this.inputRequest === request) this.inputRequest = undefined;
    this.changed();
  }
  inspect(name?: string, offset = 0): Promise<NotebookInspection> {
    if (this.state !== 'idle') return Promise.reject(Error('Run a cell and wait for the kernel to become idle.'));
    const request = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.inspections.delete(request); reject(Error('Variable inspection timed out.')); }, 20_000);
      this.inspections.set(request, { resolve, reject, timer });
      void this.port.inspect(this.id, this.generation, request, name, offset).catch(error => {
        clearTimeout(timer); this.inspections.delete(request); reject(error);
      });
    });
  }
  private queue = new Map<string, Run>();
  private active?: Run;
  private started = 0;
  private interrupted = false;
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
  setPath(path: string): void { this.path = path; }
  prepareReload(): void {
    if (this.busy) throw Error('Wait for notebook execution to finish, or interrupt it, before reloading. The kernel and your variables are preserved.');
    this.flush(); this.queue.clear(); this.runs.clear(); this.cells.clear(); this.durations.clear(); this.changed();
  }
  async run(ids?: string[]): Promise<void> {
    if (this.disposed || this.document.error || this.document.language !== 'python') return;
    for (const cell of this.document.cells.filter(cell => cell.kind === 'code' && (!ids || ids.includes(cell.id)))) {
      const run: Run = { id: cell.id, runId: crypto.randomUUID(), version: cell.version, source: cell.source, cell, outputs: [], count: null, clear: false, displays: new Map() };
      this.queue.set(cell.id, run);
      if (this.active?.id !== cell.id) this.cells.set(cell.id, 'queued');
    }
    this.changed(); await this.pump();
  }
  private async pump(): Promise<void> {
    if (this.active || this.disposed) return;
    let run: Run | undefined;
    while (this.queue.size) {
      const candidate = this.queue.values().next().value!; this.queue.delete(candidate.id);
      if (this.document.cells.includes(candidate.cell) && candidate.cell.kind === 'code') { run = candidate; break; }
      this.cells.set(candidate.id, 'skipped');
    }
    if (!run) return;
    this.flush(); this.active = run; this.runs.set(run.id, run); this.interrupted = false;
    this.message = ''; this.state = this.state === 'stopped' || this.state === 'failed' ? 'starting' : 'busy';
    this.cells.set(run.id, 'queued'); this.changed(); const generation = this.generation;
    try {
      if (!this.selectedPython) await this.loadEnvironment();
      if (this.disposed || generation !== this.generation) return;
      await this.port.run({ id: this.id, generation, path: this.path, python: this.selectedPython,
        cells: [{ id: run.id, version: run.version, source: run.source, runId: run.runId }] });
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.state = 'failed'; this.message = String(error); this.cells.set(run.id, 'error'); this.active = undefined;
      this.cancelQueue('skipped'); this.changed();
    }
  }
  private cancelQueue(state: CellExecutionState): void {
    for (const id of this.queue.keys()) if (id !== this.active?.id) this.cells.set(id, state);
    this.queue.clear();
  }
  private event(event: NotebookKernelEvent): void {
    if (this.disposed || event.id !== this.id || event.generation !== this.generation) return;
    if (event.type === 'inspect') {
      const pending = this.inspections.get(event.request); if (!pending) return;
      clearTimeout(pending.timer); this.inspections.delete(event.request);
      if (event.error) pending.reject(Error(event.error)); else pending.resolve(event.result ?? {}); return;
    }
    if (event.type === 'input') {
      if (this.active?.id === event.cell && this.active.version === event.version && (!event.runId || event.runId === this.active.runId)) { this.inputRequest = event; this.changed(); } return;
    }
    if (event.type === 'state') {
      this.state = event.state; this.message = event.message ?? this.message; this.python = event.python ?? this.python;
      if (!this.busy) {
        this.inputRequest = undefined;
        this.flush();
        if (event.state === 'failed' || event.state === 'stopped') {
          if (this.active) this.cells.set(this.active.id, event.state === 'failed' ? 'error' : 'canceled');
          this.cancelQueue('skipped');
        }
        this.active = undefined;
      }
      this.changed(); if (event.state === 'idle') void this.pump(); return;
    }
    const run = this.runs.get(event.cell);
    if (!run || (event.runId !== undefined && run.runId !== event.runId) || run.version !== event.version || !this.document.cells.includes(run.cell) || run.cell.kind !== 'code') return;
    if (event.type === 'cell-start') {
      this.started = performance.now(); this.cells.set(run.id, 'running'); this.pending.add(run.id); this.flush(); this.changed(); return;
    }
    if (event.type === 'cell-done') {
      run.count = event.count; this.pending.add(run.id); this.flush();
      this.durations.set(run.id, Math.max(0, performance.now() - this.started));
      this.cells.set(run.id, this.interrupted ? 'canceled' : event.ok ? 'succeeded' : 'error');
      if (!event.ok) this.cancelQueue('skipped');
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
    this.interrupted = true; this.cancelQueue('canceled'); this.changed();
    // Stop a discovery still awaiting shell environment as well as a live kernel.
    if (this.state === 'starting') { this.shutdown(); return; }
    try { await this.port.interrupt(this.id, this.generation); }
    catch (error) { this.message = String(error); this.changed(); }
  }
  shutdown(): Promise<void> {
    this.inputRequest = undefined;
    for (const pending of this.inspections.values()) { clearTimeout(pending.timer); pending.reject(Error('Kernel was reset.')); } this.inspections.clear();
    this.flush(); const stopped = this.port.shutdown(this.id, this.generation).catch(error => { this.message = String(error); this.changed(); }); this.generation = crypto.randomUUID();
    this.active = undefined; this.queue.clear(); this.state = 'stopped'; this.cells.clear(); this.durations.clear(); this.runs.clear(); this.message = ''; this.changed(); return stopped;
  }
  async choosePython(): Promise<void> {
    const python = await this.port.choosePython(this.path);
    if (python && !this.disposed) { this.shutdown(); this.selectedPython = python; this.python = python; this.changed(); }
  }
  async selectPython(python: string): Promise<void> {
    await this.port.selectPython(this.path, python);
    if (!this.disposed) { this.shutdown(); this.selectedPython = python; this.python = python; this.changed(); }
  }
  async loadEnvironment(): Promise<void> {
    const file = this.path; const result = await this.port.environments(file);
    if (!this.disposed && file === this.path && !this.selectedPython) { this.selectedPython = result.selected; this.python = result.selected ?? ''; this.changed(); }
  }
  dispose(): void { this.shutdown(); this.disposed = true; this.release(); this.listeners.clear(); }
}
