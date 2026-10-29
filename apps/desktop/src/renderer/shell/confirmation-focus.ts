/** Keep keyboard and pointer input in an existing confirmation without restyling it. */
export function confirmationFocus(node: HTMLElement, cancel: () => void) {
  const previous = document.activeElement;
  const buttons = () => [...node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const focus = () => buttons()[0]?.focus();
  const key = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    if (event.key === 'Tab') {
      const controls = buttons(), index = controls.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault(); event.stopImmediatePropagation();
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    }
  };
  const guardFocus = (event: FocusEvent) => { if (!node.contains(event.target as Node)) focus(); };
  const pointer = (event: PointerEvent) => {
    if (!node.contains(event.target as Node)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  queueMicrotask(() => { if (node.isConnected) focus(); });
  window.addEventListener('keydown', key, true);
  window.addEventListener('focusin', guardFocus, true);
  window.addEventListener('pointerdown', pointer, true);
  return { destroy() {
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('focusin', guardFocus, true);
    window.removeEventListener('pointerdown', pointer, true);
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  } };
}
