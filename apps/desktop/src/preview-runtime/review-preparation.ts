import type { SourceAtlas } from './source-atlas';

type Options = {
  sourceAtlas: SourceAtlas;
  revision(): number;
  hydrate(): void;
  send(message: Record<string, unknown>): void;
};

/** Hidden preparation does not authorize skipping a later Esc navigation.
 * The same SourceAtlas validates its page-local proof on the final command.
 */
export function installReviewPreparation(options: Options): void {
  let generation = 0;
  const invalidate = () => options.sourceAtlas.invalidate();
  const root = document.querySelector('.markdown-preview[data-for="preview"]');
  if (root) {
    const observer = new ResizeObserver(invalidate);
    observer.observe(root);
    new MutationObserver(invalidate).observe(root, { subtree: true, attributes: true,
      attributeFilter: ['width', 'height', 'open', 'hidden', 'src', 'data-source-start', 'data-source-end', 'data-source-lines', 'data-change'] });
  }
  document.fonts?.addEventListener('loadingdone', invalidate);
  document.addEventListener('scroll', (event) => {
    if (event.target instanceof Element && event.target !== document.documentElement) invalidate();
  }, { capture: true, passive: true });
  window.addEventListener('message', (event) => {
    if (event.source !== window && event.source !== window.parent) return;
    const command = event.data as Record<string, unknown> | null;
    if (!command) return;
    if (['marktex:position-preview', 'marktex:update-html', 'marktex:patch-blocks',
      'marktex:patch-review-rows', 'marktex:apply-theme'].includes(String(command.command))) {
      generation += 1;
      return;
    }
    if (command.command !== 'marktex:prepare-review' && command.command !== 'marktex:prime-position') return;
    const current = ++generation;
    const revision = options.revision();
    const prepare = command.command === 'marktex:prepare-review';
    const reply = (error?: string) => {
      if (prepare) options.send({ type: 'marktex:review-prepared', requestId: command.requestId,
        revision: command.revision, ...(error ? { error } : {}) });
    };
    if (prepare && command.revision !== revision) { reply('Obsolete preview preparation.'); return; }
    // Capture immutable input before awaiting fonts. Never relabel old work with
    // a newer cursor or geometry, and never publish a positional success ACK.
    options.hydrate();
    const side = command.sourceSide === 'before' ? 'before' : 'after';
    const line = Math.min(options.sourceAtlas.lineCount(side), Math.max(1, Number(command.sourceLine) || 1));
    const ratio = Number.isFinite(command.topRatio) ? Number(command.topRatio) : .372;
    const band = options.sourceAtlas.readBand(command.band, side);
    const offset = Number.isFinite(command.blockOffset) ? Number(command.blockOffset) : 0;
    const position = () => options.sourceAtlas.position(line, ratio, band, side, offset, revision);
    void (async () => {
      position();
      if (!prepare) return;
      if (document.fonts?.status === 'loading') {
        await document.fonts.ready;
        if (revision !== options.revision()) return reply('Preview changed while fonts were loading.');
        if (generation === current) { invalidate(); position(); }
      }
      // This ACK means install/layout finished, not that this old target owns
      // the current viewport. A newer navigation must never be overwritten.
      reply();
    })().catch((error) => reply(error instanceof Error ? error.message : String(error)));
  });
}
