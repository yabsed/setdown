export type TerminalActions = {
  newTerminal(groupId?: string): void;
  openTerminalSession(id: string): void;
  closeTerminalSession(id: string): void;
  terminalChanged(id: string, info: { title?: string; cwd?: string; exited?: boolean }): void;
};
