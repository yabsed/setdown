import type { SourceAtlas } from './source-atlas';

type Options = {
  sourceAtlas: SourceAtlas;
  revision(): number;
  hydrate(): void;
  send(message: Record<string, unknown>): void;
};

/** Prepare the hidden document; no animation-frame/settle timer gates Esc. */
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
    if (['marktex:position-preview', 'marktex:update-html', 'marktex:patch-blocks'].includes(String(command.command))) {
      generation += 1;
      return;
    }
    if (command.command !== 'marktex:prepare-review' && command.command !== 'marktex:prime-position') return;
    const current = ++generation;
    const revision = command.revision;
    const reply = (error?: string) => options.send({
      type: 'marktex:review-prepared', requestId: command.requestId, revision, ...(error ? { error } : {}),
    });
    const position = () => {
      const side = command.sourceSide === 'before' ? 'before' : 'after';
      const line = Math.min(options.sourceAtlas.lineCount(side), Math.max(1, Number(command.sourceLine) || 1));
      options.sourceAtlas.position(line, Number(command.topRatio) || 0,
        options.sourceAtlas.readBand(command.band, side), side, Number(command.blockOffset) || 0);
    };
    if (command.command === 'marktex:prime-position') {
      options.hydrate();
      position();
      return; // No rAF acknowledgments for continuous source prewarming.
    }
    void (async () => {
      if (revision !== options.revision()) return reply('Obsolete preview preparation.');
      options.hydrate();
      position(); // Force layout so document.fonts.ready includes fonts used here.
      if (document.fonts?.status === 'loading') {
        await document.fonts.ready;
        if (revision !== options.revision()) return reply('Preview changed while fonts were loading.');
        if (generation === current) { invalidate(); position(); }
      }
      // A more recent position request owns the viewport; never overwrite it
      // after an asynchronous font load. This acknowledgment only covers layout.
      reply();
    })().catch((error) => reply(error instanceof Error ? error.message : String(error)));
  });
}
