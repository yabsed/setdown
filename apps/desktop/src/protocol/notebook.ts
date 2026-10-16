export type NotebookExecutionCell = { id: string; version: number; source: string };
export type NotebookRun = { id: string; generation: string; path: string; python?: string; cells: NotebookExecutionCell[] };
export type NotebookKernelEvent = { id: string; generation: string } & (
  | { type: 'state'; state: 'starting' | 'idle' | 'busy' | 'stopped' | 'failed'; message?: string; python?: string }
  | { type: 'cell-start'; cell: string; version: number }
  | { type: 'output'; cell: string; version: number; kind: string; content: Record<string, unknown> }
  | { type: 'cell-done'; cell: string; version: number; ok: boolean; count: number | null }
);
export type NotebookApi = {
  run(request: NotebookRun): Promise<void>;
  interrupt(id: string, generation: string): Promise<void>;
  shutdown(id: string, generation: string): void;
  choosePython(): Promise<string | null>;
  onEvent(listener: (event: NotebookKernelEvent) => void): () => void;
};
