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

