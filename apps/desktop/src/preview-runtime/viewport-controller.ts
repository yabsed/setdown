import { GOLDEN_TOP_RATIO } from '../core/preview/viewport-anchor';
import type { SourceAtlas } from './source-atlas';

type Options = {
  sourceAtlas: SourceAtlas;
  revision: () => number;
  send: (message: Record<string, unknown>) => void;
};

export class ViewportController {
  private frame: number | null = null;
  private layoutReady = false;
  private observationId: number | null = null;
  private sequence = 0;

  observe(observationId: number | null): void {
    // Flush before parking so a final scroll frame can still reach its own tab.
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.observationId !== null) this.publish();
    this.observationId = observationId;
    this.sequence = 0;
    if (observationId !== null) this.schedule();
  }

  constructor(private readonly options: Options) {}

  start(): void {
    const settle = () => {
      if (document.fonts) void document.fonts.ready.then(this.markReady, this.markReady);
      else this.markReady();
    };
    if (document.readyState === 'complete') settle();
    else window.addEventListener('load', settle, { once: true });
  }

  schedule = (): void => {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(this.publish);
  };

  restoreRatio(scrollRatio: number): void {
    const ratio = Math.min(1, Math.max(0, scrollRatio));
    const maximum = Math.max(
      0,
      (document.documentElement.scrollHeight || 0) - (window.innerHeight || 1),
    );
    document.documentElement.scrollTop = document.body.scrollTop = maximum * ratio;
  }

  private markReady = (): void => {
    if (this.layoutReady) return;
    this.layoutReady = true;
    this.options.sourceAtlas.invalidate();
    this.schedule();
  };

  private publish = (): void => {
    this.frame = null;
    if (!this.layoutReady) return;
    // Git only consumes bookmarks for an active observation. A hidden A/B page
    // must not scan the math tree to report a viewport the shell will discard.
    // Ordinary documents still publish their unscoped reading position.
    if (this.observationId === null && document.querySelector('.setdown-rendered-diff-split')) return;
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;
    const maximum = Math.max(
      0,
      (document.documentElement.scrollHeight || 0) - (window.innerHeight || 1),
    );
    this.options.send({
      type: 'marktex:viewport-state',
      revision: this.options.revision(),
      anchor: this.observationId === null
        ? this.options.sourceAtlas.viewportAnchorAt(GOLDEN_TOP_RATIO)
        : this.options.sourceAtlas.bookmarkAt(GOLDEN_TOP_RATIO),
      observationId: this.observationId,
      sequence: ++this.sequence,
      scrollRatio: maximum > 0 ? scrollTop / maximum : 0,
    });
  };
}
