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
    // Chromium stores native deltas as floats. A nominal 80 CSS pixels can
    // arrive just below 80 after zoom conversion; retain subpixel accumulation
    // while rounding away that input precision error at a notch boundary.
    const epsilon = 1e-4;
    const notches = Math.trunc((this.pending + Math.sign(this.pending) * epsilon) / 80);
    this.pending -= notches * 80;
    if (Math.abs(this.pending) < epsilon) this.pending = 0;
    return -notches;
  }
}
