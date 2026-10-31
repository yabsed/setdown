import { tabZoomKey, tabZoomPercent, type TabZoomChange } from '../../core/zoom';
import type { DesktopPort } from '../ports/desktop-port';
import { onTextZoom, textZoomFactor } from './text-zoom';

/** Cursor-anchored surfaces commit geometry synchronously. An older IPC reply
 * must not rewind a newer wheel sample; main still owns the persisted value. */
export class TabZoom<Anchor = never> {
  private value: number;
  private request = 0;
  private pending = false;
  private dead = false;
  private observed?: number;
  private readonly unsubscribe: () => void;
  constructor(private readonly id: string, private readonly desktop: Pick<DesktopPort, 'setTabZoom'>,
    private readonly changed: (factor: number, anchor?: Anchor) => void) {
    this.value = textZoomFactor(id);
    this.unsubscribe = onTextZoom(changedId => {
      if (changedId && changedId !== tabZoomKey(id)) return;
      if (this.pending) this.observed = textZoomFactor(id);
      else this.apply(textZoomFactor(id));
    });
  }
  get factor(): number { return this.value; }
  change(change: TabZoomChange, anchor?: Anchor): void {
    if (this.dead) return;
    const percent = tabZoomPercent(this.value * 100, change);
    if (percent === undefined || percent / 100 === this.value) return;
    const request = ++this.request;
    this.pending = true; this.observed = undefined;
    this.apply(percent / 100, anchor);
    void this.desktop.setTabZoom(percent, this.id).then(accepted => {
      if (this.dead || request !== this.request) return;
      this.pending = false;
      this.apply(this.observed ?? (accepted === undefined ? textZoomFactor(this.id) : accepted / 100));
    }).catch(() => {
      if (this.dead || request !== this.request) return;
      this.pending = false;
      this.apply(textZoomFactor(this.id));
    });
  }
  private apply(factor: number, anchor?: Anchor): void {
    if (factor === this.value) return;
    this.value = factor;
    this.changed(factor, anchor);
  }
  dispose(): void { this.dead = true; this.unsubscribe(); }
}
