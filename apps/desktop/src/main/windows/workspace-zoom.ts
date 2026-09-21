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

/** App zoom is shared by every window; native text previews additionally inherit
 * the common text factor. Shell geometry always uses app zoom alone. New, spare
 * and transferred views inherit both factors without navigation or focus changes.
 */
export class WorkspaceZoom {
  private percent = 100;
  private textPercent = 100;
  private revision = 0;
  onChange?: () => void;
  private readonly targets = new Map<number, { target: ZoomTarget; afterApply?: () => void; text: boolean }>();
  get factor(): number { return this.percent / 100; }
  get textFactor(): number { return this.textPercent / 100; }
  get snapshot() { return { app: this.percent, text: this.textPercent, revision: this.revision }; }

  restore(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const saved = value as { app?: unknown; text?: unknown };
    const valid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 50 && v <= 300;
    if (valid(saved.app)) this.percent = saved.app;
    if (valid(saved.text)) this.textPercent = saved.text;
  }

  track(target: ZoomTarget, afterApply?: () => void, text = false): void {
    if (target.isDestroyed() || this.targets.has(target.id)) return;
    const entry = { target, afterApply, text };
    this.targets.set(target.id, entry);
    const apply = () => this.apply(entry);
    target.on('did-finish-load', apply);
    target.once('destroyed', () => this.targets.delete(target.id));
    apply();
  }

  /** Only bounded integer steps from a validated window/visible preview sender. */
  change(steps: unknown, scope: 'app' | 'text' = 'app'): boolean {
    if (typeof steps !== 'number' || !Number.isInteger(steps) || Math.abs(steps) > 4) return false;
    const previous = scope === 'app' ? this.percent : this.textPercent;
    const next = steps === 0 ? 100 : Math.max(50, Math.min(300, previous + steps * 10));
    if (next === previous) return false;
    if (scope === 'app') this.percent = next;
    else this.textPercent = next;
    this.revision++;
    for (const entry of this.targets.values()) this.apply(entry);
    this.onChange?.();
    return true;
  }

  private apply({ target, afterApply, text }: { target: ZoomTarget; afterApply?: () => void; text: boolean }): void {
    if (target.isDestroyed()) return;
    try {
      target.setZoomFactor(this.factor * (text ? this.textFactor : 1));
      afterApply?.();
    } catch {
      // Closing/navigating targets can reject an update. The next load inherits
      // the latest factor; one unavailable target must not block the others.
    }
  }
}
