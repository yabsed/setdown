export type TerminalSize = { cols: number; rows: number };
export type TerminalEvent = { id: string } & (
  | { type: 'data'; data: string }
  | { type: 'resize'; size: TerminalSize }
  | { type: 'exit'; exitCode: number }
);
export type TerminalInfo = { title: string; cwd: string; size: TerminalSize; snapshot: string; exitCode?: number };
export type TerminalApi = {
  create(id: string, size: TerminalSize): Promise<TerminalInfo>;
  write(id: string, data: string): void;
  resize(id: string, size: TerminalSize): void;
  acknowledge(id: string, length: number): void;
  close(id: string): void;
  focus(focused: boolean): void;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
};
