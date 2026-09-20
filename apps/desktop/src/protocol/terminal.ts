export type TerminalSize = { cols: number; rows: number };
export type TerminalEvent = { id: string } & (
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number }
);
export type TerminalApi = {
  create(id: string, size: TerminalSize): Promise<{ title: string; cwd: string }>;
  write(id: string, data: string): void;
  resize(id: string, size: TerminalSize): void;
  acknowledge(id: string, length: number): void;
  close(id: string): void;
  focus(focused: boolean): void;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
};
