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
 * Browser targets supply their own content factor for website zoom. Terminals
 * are shell-rendered and keep a third, independent persisted factor that never
 * touches native targets, the editor/preview text factor, or native bounds.
 */
export class WorkspaceZoom {
  private percent = 100;
  private textPercent = 100;
  private terminalPercent = 100;
  private revision = 0;
  onChange?: () => void;
  private readonly targets = new Map<number, { target: ZoomTarget; afterApply?: () => void; contentFactor: () => number }>();
  get factor(): number { return this.percent / 100; }
  get textFactor(): number { return this.textPercent / 100; }
  get terminalFactor(): number { return this.terminalPercent / 100; }
  get snapshot() { return { app: this.percent, text: this.textPercent, terminal: this.terminalPercent, revision: this.revision }; }

  restore(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const saved = value as { app?: unknown; text?: unknown; terminal?: unknown };
    const valid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 50 && v <= 300;
    if (valid(saved.app)) this.percent = saved.app;
    if (valid(saved.text)) this.textPercent = saved.text;
    // Settings written before the split have no terminal factor; terminals
    // followed the text factor then, so inherit it once instead of resetting.
    this.terminalPercent = valid(saved.terminal) ? saved.terminal : this.textPercent;
  }

  track(target: ZoomTarget, afterApply?: () => void, content: boolean | (() => number) = false): void {
    if (target.isDestroyed() || this.targets.has(target.id)) return;
    const entry = { target, afterApply,
      contentFactor: typeof content === 'function' ? content : () => content ? this.textFactor : 1 };
    this.targets.set(target.id, entry);
    const apply = () => this.apply(entry);
    target.on('did-finish-load', apply);
    target.once('destroyed', () => this.targets.delete(target.id));
    apply();
  }

  /** Only bounded integer steps from a validated window/visible preview sender. */
  change(steps: unknown, scope: 'app' | 'text' | 'terminal' = 'app'): boolean {
    if (typeof steps !== 'number' || !Number.isInteger(steps) || Math.abs(steps) > 4) return false;
    const previous = scope === 'app' ? this.percent : scope === 'text' ? this.textPercent : this.terminalPercent;
    const next = steps === 0 ? 100 : Math.max(50, Math.min(300, previous + steps * 10));
    if (next === previous) return false;
    if (scope === 'app') this.percent = next;
    else if (scope === 'text') this.textPercent = next;
    else this.terminalPercent = next;
    this.revision++;
    // Terminals render in the shell; their factor must not re-apply (or focus)
    // any native target. Shells still receive the snapshot through onChange.
    if (scope !== 'terminal') for (const entry of this.targets.values()) this.apply(entry);
    this.onChange?.();
    return true;
  }

  private apply({ target, afterApply, contentFactor }: { target: ZoomTarget; afterApply?: () => void; contentFactor: () => number }): void {
    if (target.isDestroyed()) return;
    try {
      target.setZoomFactor(this.factor * contentFactor());
      afterApply?.();
    } catch {
      // Closing/navigating targets can reject an update. The next load inherits
      // the latest factor; one unavailable target must not block the others.
    }
  }
}
