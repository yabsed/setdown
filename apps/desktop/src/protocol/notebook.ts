export type NotebookExecutionCell = { id: string; version: number; source: string; runId?: string };
export type NotebookRun = { id: string; generation: string; path: string; python?: string; cells: NotebookExecutionCell[] };
export type NotebookKernelEvent = { id: string; generation: string } & (
  | { type: 'state'; state: 'starting' | 'idle' | 'busy' | 'stopped' | 'failed'; message?: string; python?: string }
  | { type: 'cell-start'; cell: string; version: number; runId?: string }
  | { type: 'output'; cell: string; version: number; runId?: string; kind: string; content: Record<string, unknown> }
  | { type: 'cell-done'; cell: string; version: number; runId?: string; ok: boolean; count: number | null }
  | { type: 'input'; cell: string; version: number; runId?: string; request: string; prompt: string; password: boolean }
  | { type: 'inspect'; request: string; result?: NotebookInspection; error?: string }
);
export type NotebookInspection = { variables?: { name: string; type: string; shape: string; preview: string }[];
  columns?: string[]; rows?: string[][]; total?: number };
export type NotebookTool = 'export-html' | 'export-markdown' | 'export-script' | 'export-webpdf' | 'jupyterlab' | 'diff' | 'format' | 'fix-code' | 'install-tools';
export type NotebookEnvironments = { selected?: string; candidates: { path: string; name: string; source: string }[] };
export type NotebookApi = {
  run(request: NotebookRun): Promise<void>;
  interrupt(id: string, generation: string): Promise<void>;
  shutdown(id: string, generation: string): Promise<void>;
  choosePython(path?: string): Promise<string | null>;
  environments(path: string): Promise<NotebookEnvironments>;
  copyOutput(path: string, text: string): Promise<void>;
  selectPython(path: string, python: string): Promise<void>;
  resolveTraceFile(path: string, target: string): Promise<string>;
  cancelTools(path: string): Promise<void>;
  pythonCells(path: string, source: string): Promise<string | null>;
  saveImage(path: string, mime: string, data: string): Promise<string | null>;
  tool(path: string, source: string, action: NotebookTool): Promise<{ path?: string; source?: string; url?: string; message?: string }>;
  input(id: string, generation: string, request: string, value: string): Promise<void>;
  inspect(id: string, generation: string, request: string, name?: string, offset?: number): Promise<void>;
  onEvent(listener: (event: NotebookKernelEvent) => void): () => void;
};
