export type TerminalSize = { cols: number; rows: number };
export type TerminalEvent = { id: string } & (
  | { type: 'data'; data: string }
  | { type: 'resize'; size: TerminalSize }
  | { type: 'exit'; exitCode: number }
);
export type TerminalInfo = { title: string; cwd: string; size: TerminalSize; snapshot: string; exitCode?: number };
export type TerminalApi = {
  /** `cwd`: the folder a new shell starts in. Without one, or when it is gone, the window's project folder is used. */
  create(id: string, size: TerminalSize, cwd?: string): Promise<TerminalInfo>;
  write(id: string, data: string): void;
  resize(id: string, size: TerminalSize): void;
  acknowledge(id: string, length: number): void;
  close(id: string): void;
  focus(focused: boolean): void;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
};
