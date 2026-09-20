/** Native targets only: no document/model changes, navigation or focus transfer. */
export type ZoomTarget = {
  id: number;
  isDestroyed(): boolean;
  setZoomFactor(factor: number): void;
  on(event: 'did-finish-load', listener: () => void): unknown;
  once(event: 'destroyed', listener: () => void): unknown;
};
export type ZoomBounds = { x: number; y: number; width: number; height: number };

/** getBoundingClientRect is CSS pixels; Electron View bounds are DIP, not CSS pixels.
 * devicePixelRatio must NOT be used: OS display scaling is already handled by Electron.
 */
export function nativeZoomBounds(bounds: ZoomBounds, zoomFactor: number): ZoomBounds {
  const factor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const number = (value: number) => Number.isFinite(value) ? value : 0;
  const x = Math.round(number(bounds.x) * factor);
  const y = Math.round(number(bounds.y) * factor);
  return { x, y,
    width: Math.max(1, Math.round((number(bounds.x) + number(bounds.width)) * factor) - x),
    height: Math.max(1, Math.round((number(bounds.y) + number(bounds.height)) * factor) - y),
  };
}

/** App-wide zoom intentionally shares one factor across windows and preview origins.
 * This avoids Chromium's same-origin zoom policy splitting shell/front/back scales.
 * A newly created/spare/transferred view inherits the same value without reloading.
 */
export class WorkspaceZoom {
  private percent = 100;
  private readonly targets = new Map<number, { target: ZoomTarget; afterApply?: () => void }>();
  get factor(): number { return this.percent / 100; }

  track(target: ZoomTarget, afterApply?: () => void): void {
    if (target.isDestroyed() || this.targets.has(target.id)) return;
    const entry = { target, afterApply };
    this.targets.set(target.id, entry);
    const apply = () => this.apply(entry);
    target.on('did-finish-load', apply);
    target.once('destroyed', () => this.targets.delete(target.id));
    apply();
  }

  /** Only bounded integer steps from a validated window/visible preview sender. */
  change(steps: unknown): boolean {
    if (typeof steps !== 'number' || !Number.isInteger(steps) || Math.abs(steps) > 4) return false;
    const next = steps === 0 ? 100 : Math.max(50, Math.min(300, this.percent + steps * 10));
    if (next === this.percent) return false;
    this.percent = next;
    for (const entry of this.targets.values()) this.apply(entry);
    return true;
  }

  private apply({ target, afterApply }: { target: ZoomTarget; afterApply?: () => void }): void {
    if (target.isDestroyed()) return;
    try {
      target.setZoomFactor(this.factor);
      afterApply?.();
    } catch {
      // Closing/navigating targets can reject an update. The next load inherits
      // the latest factor; one unavailable target must not block the others.
    }
  }
}
