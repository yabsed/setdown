export function terminalOwnsInput(target: EventTarget | null = document.activeElement): boolean {
  return target instanceof Element && !!target.closest('.terminal-surface');
}
