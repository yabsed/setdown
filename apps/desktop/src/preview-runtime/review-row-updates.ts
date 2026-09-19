import type { ReviewRowsPatch } from '../core/preview/review-row-patch';
import { applyReviewRowsPatch } from './review-row-patcher';

type Options = {
  config: { revision: number; totalLineCount: number };
  root(): HTMLElement | null;
  afterPatch(inserted: Element[], baseHref: unknown): void;
  send(message: Record<string, unknown>): void;
};
/** Only sanitized Git output uses this path. Ordinary Markdown is unchanged. */
export function installReviewRowUpdates(options: Options): void {
  window.addEventListener('message', (event) => {
    if (event.source !== window && event.source !== window.parent) return;
    const command = event.data as { command?: string; patch?: ReviewRowsPatch;
      revision?: number; totalLineCount?: number; baseHref?: unknown } | null;
    if (command?.command !== 'marktex:patch-review-rows') return;
    try {
      const root = options.root();
      if (!root || !command.patch || command.revision !== command.patch.revision
        || !Number.isSafeInteger(command.totalLineCount) || command.totalLineCount! < 1) {
        throw new Error('Invalid review patch envelope.');
      }
      const result = applyReviewRowsPatch(root, command.patch, options.config.revision);
      options.config.revision = command.patch.revision;
      options.config.totalLineCount = command.totalLineCount!;
      options.afterPatch(result.inserted, command.baseHref);
      document.body.dataset.lastReviewPatchRevision = String(command.patch.revision);
      document.body.dataset.lastReviewPatchRetainedRows = String(result.retainedRows);
      document.body.dataset.lastReviewPatchReplacedRows = String(result.replacedRows);
      options.send({ type: 'marktex:html-updated', revision: command.patch.revision });
    } catch (error) {
      // Reject immediately; never acknowledge uninstalled content as ready.
      options.send({ type: 'marktex:html-updated', revision: command.revision,
        error: `Review patch rejected: ${error instanceof Error ? error.message : String(error)}` });
    }
  });
}
