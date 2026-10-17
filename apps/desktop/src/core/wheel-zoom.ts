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

export type ContentZoomChange = number | { scale: number };

/** Fine pixel input (including Chromium touchpad pinch) is continuous. Do not
 * rely on deprecated wheelDelta/tick values: backends report them differently.
 * Coarse wheel notches and line/page input retain the existing stepped zoom.
 */
export class ContentZoomInput {
  private wheel = new WheelZoomAccumulator();
  private continuous = false;
  private lastTime = -Infinity;
  consume(event: WheelSample, now: number): ContentZoomChange {
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return 0;
    const continuous = event.deltaMode === 0 && (Math.abs(event.deltaY) < 40
      || (this.continuous && Math.abs(event.deltaY) < 80 && now - this.lastTime <= 250));
    if (continuous !== this.continuous) this.wheel = new WheelZoomAccumulator();
    this.continuous = continuous; this.lastTime = now;
    // Chromium encodes pinch scale as -100 * log(scale). No dead zone or
    // rounding: even a short gesture must change the tab on its first sample.
    return continuous ? { scale: Math.exp(-Math.max(-50, Math.min(50, event.deltaY)) / 100) }
      : this.wheel.consume(event, now);
  }
}
