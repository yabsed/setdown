type WheelSample = Pick<WheelEvent, 'deltaY' | 'deltaMode'>;

/** Accumulate high-resolution trackpad deltas; one wheel notch is not 100 zooms. */
export class WheelZoomAccumulator {
  private pending = 0;
  private lastTime = -Infinity;
  consume(event: WheelSample, now: number): number {
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return 0;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1);
    if (now - this.lastTime > 250 || Math.sign(pixels) !== Math.sign(this.pending)) this.pending = 0;
    this.lastTime = now;
    this.pending += Math.max(-320, Math.min(320, pixels));
    const notches = Math.trunc(this.pending / 80);
    this.pending -= notches * 80;
    return -notches;
  }
}

/** Installed in BOTH sandbox preloads, before Monaco or document handlers.
 * Do not expose ipcRenderer to page scripts. Synthetic wheel events are ignored.
 */
export function installWheelZoom(send: (steps: number) => void): () => void {
  const accumulator = new WheelZoomAccumulator();
  const wheel = (event: WheelEvent) => {
    if (!event.isTrusted || !event.ctrlKey || event.altKey || event.metaKey) return;
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const steps = accumulator.consume(event, performance.now());
    if (steps) send(steps);
  };
  // Ctrl+0 restores the same scale in the shell and all previews.
  const reset = (event: KeyboardEvent) => {
    if (!event.isTrusted || !event.ctrlKey || event.altKey || event.metaKey
      || event.shiftKey || event.isComposing || event.key !== '0') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send(0);
  };
  window.addEventListener('wheel', wheel, { capture: true, passive: false });
  window.addEventListener('keydown', reset, { capture: true });
  return () => {
    window.removeEventListener('wheel', wheel, true);
    window.removeEventListener('keydown', reset, true);
  };
}
