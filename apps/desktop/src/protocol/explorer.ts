export type ExplorerTransfer = {
  kind: 'copy' | 'move' | 'duplicate' | 'import' | 'undo';
  paths: string[];
  target?: string;
  conflict?: 'error' | 'keep-both' | 'skip';
};

export type ExplorerOperationItem = {
  from: string;
  to: string;
  status: 'completed' | 'skipped' | 'failed' | 'not-started';
  error?: string;
};

/** Receipts describe committed disk changes, including a partially successful batch. */
export type ExplorerOperationResult = {
  kind: ExplorerTransfer['kind'];
  items: ExplorerOperationItem[];
  undoable: boolean;
  warning?: string;
};

export type ExplorerClipboard = { external?: boolean; paths: string[]; cut: boolean };
export type ExplorerEditCommand = 'cut' | 'copy' | 'paste' | 'select-all' | 'undo';

export interface ExplorerApi {
  cancel(): void;
  onProgress(listener: (progress: { completed: number; total: number; path: string }) => void): () => void;
  transfer(request: ExplorerTransfer): Promise<ExplorerOperationResult>;
  clipboard(): Promise<ExplorerClipboard | null>;
  setClipboard(paths: string[], cut: boolean): Promise<ExplorerClipboard>;
  clearClipboard(): Promise<void>;
  paste(target: string, conflict?: ExplorerTransfer['conflict']): Promise<ExplorerOperationResult>;
  reveal(path: string): Promise<void>;
  setEditTarget(active: boolean): void;
}
