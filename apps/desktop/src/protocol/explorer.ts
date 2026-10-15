export type ExplorerTransfer = {
  kind: 'copy' | 'move' | 'duplicate';
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
  undoable: false;
};

export type ExplorerClipboard = { paths: string[]; cut: boolean };
export type ExplorerEditCommand = 'cut' | 'copy' | 'paste' | 'select-all';

export interface ExplorerApi {
  transfer(request: ExplorerTransfer): Promise<ExplorerOperationResult>;
  clipboard(): Promise<ExplorerClipboard | null>;
  setClipboard(paths: string[], cut: boolean): Promise<ExplorerClipboard>;
  clearClipboard(): Promise<void>;
  paste(target: string, conflict?: ExplorerTransfer['conflict']): Promise<ExplorerOperationResult>;
  reveal(path: string): Promise<void>;
  setEditTarget(active: boolean): void;
}
