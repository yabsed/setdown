import { MAX_TAB_ZOOM, MIN_TAB_ZOOM, tabZoomKey, tabZoomPercent } from '../../core/zoom';
/** Native targets only: no document/model changes, navigation or focus transfer. */
export type ZoomTarget = {
  id: number;
  isDestroyed(): boolean;
  setZoomFactor(factor: number): void;
  setZoomMode?(mode: 'isolated'): void;
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

/** App zoom is shared by every window; content targets supply their tab factor.
 * Shell geometry always uses app zoom alone. New, spare and transferred views
 * apply their current factors without navigation or focus changes. Website, reader and file surfaces
 * share the same factor when they occupy the same tab. Shell-rendered terminals use
 * their displaying tab's factor; legacy text/terminal settings remain readable.
 */
export class WorkspaceZoom {
  private percent = 100;
  private textPercent = 100;
  private terminalPercent = 100;
  private revision = 0;
  private readonly tabs = new Map<string, number>();
  private readonly documents = new Map<string, number>();
  private readonly contexts = new Map<number, { ids: Set<string>; active: string | null; documents: Map<string, string> }>();
  onChange?: () => void;
  private readonly targets = new Map<number, { target: ZoomTarget; afterApply?: () => void; contentFactor: () => number; applied?: number }>();
  get factor(): number { return this.percent / 100; }
  get textFactor(): number { return this.textPercent / 100; }
  get terminalFactor(): number { return this.terminalPercent / 100; }
  get snapshot() { return { app: this.percent, text: this.textPercent, terminal: this.terminalPercent, revision: this.revision,
    tabs: Object.fromEntries(this.tabs) }; }
  get settings() { return { ...this.snapshot, documents: Object.fromEntries(this.documents) }; }
  tabFactor(id: string): number { return (this.tabs.get(tabZoomKey(id)) ?? 100) / 100; }
  /** Called before mounting a newly allocated file tab. Existing IDs, including
   * transferred tabs and tabs navigating to another resource, never reinitialize. */
  initializeTab(id: string, file: string): void {
    const key = tabZoomKey(id);
    if (this.tabs.has(key)) return;
    this.tabs.set(key, this.documents.get(file) ?? 100);
    this.revision++;
    this.onChange?.();
  }
  context(owner: number, ids: unknown, active: unknown, files: unknown = {}): void {
    if (!Array.isArray(ids) || ids.length > 1000 || !ids.every(id => typeof id === 'string' && id.length < 256)) return;
    const owned = new Set<string>(ids.map(tabZoomKey));
    const documents = new Map<string, string>();
    if (files && typeof files === 'object' && !Array.isArray(files)) for (const [id, file] of Object.entries(files)) {
      if (owned.has(tabZoomKey(id)) && typeof file === 'string' && file.length > 0 && file.length < 32768)
        documents.set(tabZoomKey(id), file);
    }
    // Main's event order is authoritative, including unchanged values on close
    // or departure. Reading-position timestamps/scroll events cannot overwrite it.
    let changed = false;
    const previous = this.contexts.get(owner);
    for (const [id, file] of previous?.documents ?? []) {
      if (documents.get(id) !== file) { this.remember(id, file); changed = true; }
    }
    // Entering a document in an existing tab also observes that document at the
    // retained tab percentage. A new tab opened immediately afterwards inherits it.
    for (const [id, file] of documents) {
      if (previous?.ids.has(id) && previous.documents.get(id) !== file) { this.remember(id, file); changed = true; }
    }
    for (const id of owned) if (!this.tabs.has(id)) { this.tabs.set(id, 100); changed = true; }
    this.contexts.set(owner, { ids: owned, documents,
      active: typeof active === 'string' && owned.has(tabZoomKey(active)) ? tabZoomKey(active) : null });
    if (changed) { this.revision++; this.onChange?.(); }
  }
  closeOwner(owner: number): void {
    if (!this.contexts.has(owner)) return;
    this.context(owner, [], null);
    this.contexts.delete(owner);
  }
  private remember(id: string, file: string): void {
    this.documents.set(file, this.tabs.get(tabZoomKey(id)) ?? 100);
  }
  activeTab(owner: number): string | null { return this.contexts.get(owner)?.active ?? null; }
  ownsTab(owner: number, id: string): boolean { return this.contexts.get(owner)?.ids.has(tabZoomKey(id)) ?? false; }
  changeTab(id: string, steps: unknown): boolean {
    const key = tabZoomKey(id), previous = this.tabs.get(key) ?? 100;
    const next = tabZoomPercent(previous, steps);
    if (next === undefined || previous === next) return false;
    this.tabs.set(key, next); this.revision++;
    for (const context of this.contexts.values()) {
      const file = context.documents.get(key);
      if (file) this.remember(key, file);
    }
    for (const entry of this.targets.values()) this.apply(entry);
    this.onChange?.(); return true;
  }

  restore(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const saved = value as { app?: unknown; text?: unknown; terminal?: unknown; tabs?: unknown; documents?: unknown };
    const valid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 50 && v <= 300;
    if (valid(saved.app)) this.percent = saved.app;
    if (valid(saved.text)) this.textPercent = saved.text;
    // Settings written before the split have no terminal factor; terminals
    // followed the text factor then, so inherit it once instead of resetting.
    this.terminalPercent = valid(saved.terminal) ? saved.terminal : this.textPercent;
    if (saved.tabs && typeof saved.tabs === 'object') for (const [id, percent] of Object.entries(saved.tabs).slice(-1000)) {
      if (id.length < 256 && typeof percent === 'number' && Number.isFinite(percent) && percent >= MIN_TAB_ZOOM && percent <= MAX_TAB_ZOOM) this.tabs.set(tabZoomKey(id), percent);
    }
    for (const [id, percent] of this.tabs) {
      if (!id.endsWith(':website')) continue;
      const tabId = id.slice(0, -':website'.length);
      if (!this.tabs.has(tabId)) this.tabs.set(tabId, percent);
      this.tabs.delete(id);
    }
    if (saved.documents && typeof saved.documents === 'object' && !Array.isArray(saved.documents)) {
      for (const [file, percent] of Object.entries(saved.documents)) {
        if (file.length > 0 && file.length < 32768 && typeof percent === 'number' && Number.isFinite(percent)
          && percent >= MIN_TAB_ZOOM && percent <= MAX_TAB_ZOOM) this.documents.set(file, percent);
      }
    }
  }

  track(target: ZoomTarget, afterApply?: () => void, content: boolean | (() => number) = false): void {
    if (target.isDestroyed() || this.targets.has(target.id)) return;
    target.setZoomMode?.('isolated');
    const entry: { target: ZoomTarget; afterApply?: () => void; contentFactor: () => number; applied?: number } = { target, afterApply,
      contentFactor: typeof content === 'function' ? content : () => content ? this.textFactor : 1 };
    this.targets.set(target.id, entry);
    const apply = () => { entry.applied = undefined; this.apply(entry); };
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

  private apply(entry: { target: ZoomTarget; afterApply?: () => void; contentFactor: () => number; applied?: number }): void {
    const { target, afterApply, contentFactor } = entry;
    if (target.isDestroyed()) return;
    try {
      const factor = this.factor * contentFactor();
      if (entry.applied === factor) return;
      target.setZoomFactor(factor); entry.applied = factor;
      afterApply?.();
    } catch {
      // Closing/navigating targets can reject an update. The next load inherits
      // the latest factor; one unavailable target must not block the others.
    }
  }
}
