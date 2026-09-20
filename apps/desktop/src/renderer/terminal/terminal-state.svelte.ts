export const terminal = $state({ open: false, loaded: false, height: 260 });

export function toggleTerminal(): void {
  terminal.loaded = true;
  terminal.open = !terminal.open;
}

export function terminalOwnsInput(target: EventTarget | null = document.activeElement): boolean {
  return target instanceof Element && !!target.closest('.terminal-panel');
}
