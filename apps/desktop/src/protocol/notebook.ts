export type NotebookExecutionCell = { id: string; version: number; source: string; runId?: string };
export type NotebookRun = { id: string; generation: string; path: string; python?: string; cells: NotebookExecutionCell[] };
export type NotebookKernelEvent = { id: string; generation: string } & (
  | { type: 'state'; state: 'starting' | 'idle' | 'busy' | 'stopped' | 'failed'; message?: string; python?: string }
  | { type: 'cell-start'; cell: string; version: number; runId?: string }
  | { type: 'output'; cell: string; version: number; runId?: string; kind: string; content: Record<string, unknown> }
  | { type: 'cell-done'; cell: string; version: number; runId?: string; ok: boolean; count: number | null }
);
export type NotebookEnvironments = { selected?: string; candidates: { path: string; name: string; source: string }[] };
export type NotebookApi = {
  run(request: NotebookRun): Promise<void>;
  interrupt(id: string, generation: string): Promise<void>;
  shutdown(id: string, generation: string): void;
  choosePython(path?: string): Promise<string | null>;
  environments(path: string): Promise<NotebookEnvironments>;
  copyOutput(path: string, text: string): Promise<void>;
  selectPython(path: string, python: string): Promise<void>;
  onEvent(listener: (event: NotebookKernelEvent) => void): () => void;
};
