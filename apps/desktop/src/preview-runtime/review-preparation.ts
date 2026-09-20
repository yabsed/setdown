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
  // A hidden WebContentsView can still have a zero/previous viewport. Preserve
  // the final source request, not the scroll offset computed at that size.
  let reveal: {
    requestId: string; revision: number; generation: number;
    armed: boolean; visible: boolean; position(): void;
  } | null = null;
  const cancelReveal = () => { reveal = null; };
  const verifyReveal = () => {
    const target = reveal;
    if (!target || !target.armed) return;
    if (target.revision !== options.revision() || target.generation !== generation) {
      cancelReveal();
      return;
    }
    if (document.visibilityState === 'hidden' || window.innerWidth <= 0 || window.innerHeight <= 0) return;
    // SourceAtlas already skips work when its revision/layout/scroll proof is
    // unchanged. Resize invalidates that proof; no fixed frame delay is needed.
    target.position();
    target.visible = true;
  };
  window.addEventListener('resize', verifyReveal);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && reveal?.visible) cancelReveal();
    else verifyReveal();
  });
  // Once the reader deliberately navigates, a late resize/font event must not
  // pull them back to the Escape target. Programmatic positioning is not input.
  for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) {
    document.addEventListener(type, cancelReveal, { capture: true, passive: true });
  }
  const invalidate = () => options.sourceAtlas.invalidate();
  const root = document.querySelector('.markdown-preview[data-for="preview"]');
  if (root) {
    const observer = new ResizeObserver(invalidate);
    observer.observe(root);
    new MutationObserver(invalidate).observe(root, { subtree: true, attributes: true,
      attributeFilter: ['width', 'height', 'open', 'hidden', 'src', 'data-source-start', 'data-source-end', 'data-source-lines', 'data-change'] });
  }
  document.fonts?.addEventListener('loadingdone', () => { invalidate(); verifyReveal(); });
  document.addEventListener('scroll', (event) => {
    if (event.target instanceof Element && event.target !== document.documentElement) invalidate();
  }, { capture: true, passive: true });
  window.addEventListener('message', (event) => {
    if (event.source !== window && event.source !== window.parent) return;
    const command = event.data as Record<string, unknown> | null;
    if (!command) return;
    if (command.command === 'marktex:verify-review-position') {
      if (!reveal || command.requestId !== reveal.requestId || command.revision !== reveal.revision) return;
      reveal.armed = true;
      verifyReveal();
      return;
    }
    if (['marktex:find', 'marktex:scroll-to-heading', 'marktex:restore-scroll-ratio'].includes(String(command.command))) {
      cancelReveal();
    }
    if (['marktex:position-preview', 'marktex:update-html', 'marktex:patch-blocks',
      'marktex:patch-review-rows', 'marktex:apply-theme'].includes(String(command.command))) {
      generation += 1;
      cancelReveal();
      return;
    }
    if (command.command !== 'marktex:prepare-review' && command.command !== 'marktex:prime-position') return;
    cancelReveal();
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
    const requestedLine = Math.max(1, Number(command.sourceLine) || 1);
    // Do not permanently clamp a before-side target to line 1 while its hidden
    // DOM has no measurable anchors yet. Re-resolve against the actual viewport.
    const requestedBand = Array.isArray(command.band) ? command.band.slice(0, 2048).map((sample) => {
      const value = sample as { sourceLine?: unknown; yRatio?: unknown } | null;
      return { sourceLine: Number(value?.sourceLine), yRatio: Number(value?.yRatio) };
    }) : [];
    const ratio = Number.isFinite(command.topRatio) ? Number(command.topRatio) : .372;
    const offset = Number.isFinite(command.blockOffset) ? Number(command.blockOffset) : 0;
    const position = () => {
      const line = Math.min(options.sourceAtlas.lineCount(side), requestedLine);
      const band = options.sourceAtlas.readBand(requestedBand, side);
      options.sourceAtlas.position(line, ratio, band, side, offset, revision);
    };
    if (prepare && typeof command.requestId === 'string' && command.requestId.startsWith('present:')) {
      reveal = { requestId: command.requestId, revision, generation: current,
        armed: false, visible: false, position };
    }
    void (async () => {
      position();
      if (!prepare) return;
      if (document.fonts?.status === 'loading') {
        await document.fonts.ready;
        if (revision !== options.revision()) return reply('Preview changed while fonts were loading.');
        if (generation === current) { invalidate(); position(); }
      }
      // Hidden layout is provisional: the final presenter verifies this same
      // request again after native show, including delayed resize/visibility.
      // A newer navigation must never be overwritten.
      reply();
    })().catch((error) => reply(error instanceof Error ? error.message : String(error)));
  });
}
