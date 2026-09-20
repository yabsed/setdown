import type { SourceAtlas } from './source-atlas';
import { readReviewPresentation } from '../core/preview/review-presentation';

type Options = { atlas: SourceAtlas; hydrate(): void; revision(): number;
  send(message: Record<string, unknown>): void };
/** Position while hidden, then release the native swap. The ACK certifies this
 * transaction only; it is never cached as permission to skip a later navigation.
 */
export function installReviewPresentation(options: Options): void {
  let generation = 0;
  window.addEventListener('message', (event) => {
    if (event.source !== window && event.source !== window.parent) return;
    const message = event.data as Record<string, unknown> | null;
    if (!message) return;
    if (['marktex:update-html', 'marktex:patch-blocks', 'marktex:patch-review-rows',
      'marktex:apply-theme', 'marktex:position-preview', 'marktex:cancel-presentation'].includes(String(message.command))) {
      generation++;
      return;
    }
    if (message.command !== 'marktex:present-review-page') return;
    const request = readReviewPresentation(message);
    if (!request) return;
    const current = ++generation;
    const revision = options.revision();
    const reply = (error?: string) => options.send({ type: 'marktex:review-presentation-ready',
      presentationId: request.presentationId, revision, geometry: message.geometry,
      ...(error ? { error } : {}) });
    const valid = () => generation === current && options.revision() === revision;
    const position = () => {
      const target = request.position;
      if (!target) return;
      const side = target.sourceSide;
      options.atlas.position(Math.min(options.atlas.lineCount(side), target.sourceLine), target.topRatio,
        options.atlas.readBand(target.band, side), side, target.blockOffset ?? 0, revision);
    };
    void (async () => {
      if (message.revision !== revision) return reply('The installed review revision changed.');
      options.hydrate();
      position();
      if (document.fonts?.status === 'loading') {
        await document.fonts.ready;
        if (!valid()) return;
        options.atlas.invalidate();
        position();
      }
      // No arbitrary settle/rAF delay, no focus call and no global position ACK.
      // Main still checks view identity, epoch, geometry, zoom and navigation.
      if (valid()) reply();
    })().catch(error => { if (valid()) reply(error instanceof Error ? error.message : String(error)); });
  });
}
