import type { Terminal } from '@xterm/xterm';

/** xterm 6 consumes a wheel delta but emits only one report/key in application
 * mode. Normalize its input into discrete reports without encoding mouse or
 * cursor protocols ourselves. Keep native scrollback and Ctrl+wheel separate. */
export function installTerminalWheel(terminal: Terminal, host: HTMLElement): () => void {
  let dispatching = false, remainder = 0, mode = '';
  const buffer = terminal.buffer.onBufferChange(() => { remainder = 0; });
  const wheel = (event: WheelEvent) => {
    if (dispatching) return;
    const nextMode = `${terminal.buffer.active.type}:${terminal.modes.mouseTrackingMode}`;
    if (mode !== nextMode) { mode = nextMode; remainder = 0; }
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY
      || (terminal.buffer.active.type === 'normal' && terminal.modes.mouseTrackingMode === 'none')) {
      remainder = 0; return;
    }
    // One standard 120px mouse notch sends three reports. Fine touchpad input
    // accumulates instead of turning every tiny event into a whole line.
    const delta = event.deltaY * (event.deltaMode === 1 ? 1 : event.deltaMode === 2 ? terminal.rows : 1 / 40)
      * (event.altKey ? terminal.options.fastScrollSensitivity ?? 5 : 1);
    if (Math.sign(delta) !== Math.sign(remainder)) remainder = 0;
    remainder += delta;
    const steps = Math.min(100, Math.floor(Math.abs(remainder))), direction = Math.sign(remainder);
    remainder -= Math.trunc(remainder);
    event.preventDefault(); event.stopImmediatePropagation();
    const target = event.target;
    if (!(target instanceof Element)) return;
    dispatching = true;
    try {
      for (let i = 0; i < steps; i++) target.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, composed: true, deltaMode: 1, deltaY: direction,
        clientX: event.clientX, clientY: event.clientY, altKey: event.altKey,
      }));
    } finally { dispatching = false; }
  };
  host.addEventListener('wheel', wheel, { capture: true, passive: false });
  return () => { buffer.dispose(); host.removeEventListener('wheel', wheel, true); };
}
