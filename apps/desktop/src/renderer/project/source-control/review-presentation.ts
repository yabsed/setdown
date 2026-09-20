import type { PreparationPosition, PrimeReviewCommand, RuntimePreparationCommand } from '../../../protocol/preview-preparation';
import type { PreviewBounds } from '../../../protocol/desktop-api';

type Port = { sendPreviewCommand(id: string, message: Record<string, unknown>): void };
type Target = {
  id: string;
  revision: number;
  bounds: PreviewBounds;
  position: PreparationPosition;
};

/** Final hidden layout acknowledgment, NOT a Chromium pixel-presentation fence. */
export class ReviewPresentation {
  private sequence = 0;
  private pending: {
    id: string; requestId: string; revision: number; key: string;
    timeout: ReturnType<typeof setTimeout>;
    accept(): boolean; commit(): void; fail(error: string): void;
  } | null = null;

  constructor(private readonly port: Port) {}
  get waiting(): boolean { return this.pending !== null; }

  present(target: Target, accept: () => boolean, commit: () => void, fail: (error: string) => void): void {
    const key = JSON.stringify(target);
    if (this.pending?.key === key) return;
    this.cancel();
    // String IDs cannot collide with PreviewManager's numeric preparation IDs.
    const requestId = `present:${++this.sequence}` as const;
    const timeout = setTimeout(() => {
      if (this.pending?.requestId !== requestId) return;
      this.cancel();
      if (accept()) fail('The latest review position did not acknowledge.');
    }, 5000);
    this.pending = { id: target.id, requestId, revision: target.revision, key, timeout, accept, commit, fail };
    try {
      // The prime command applies native bounds while the view is still hidden.
      this.port.sendPreviewCommand(target.id, {
        command: 'marktex:prime-review', bounds: target.bounds, position: target.position,
      } satisfies PrimeReviewCommand);
      this.port.sendPreviewCommand(target.id, {
        ...target.position, command: 'marktex:prepare-review', revision: target.revision, requestId,
      } satisfies RuntimePreparationCommand);
    } catch (error) {
      this.cancel();
      if (accept()) fail(error instanceof Error ? error.message : String(error));
    }
  }

  receive(id: string, message: Record<string, unknown>): boolean {
    if (message.type !== 'marktex:review-prepared'
      || typeof message.requestId !== 'string' || !message.requestId.startsWith('present:')) return false;
    const request = this.pending;
    if (!request || id !== request.id || message.requestId !== request.requestId
      || message.revision !== request.revision) return true;
    this.cancel();
    if (!request.accept()) return true;
    if (typeof message.error === 'string') request.fail(message.error);
    else {
      request.commit();
      // Native bounds may reach Blink only when this cold view is shown. The
      // runtime retains the exact source target and revalidates it at that size.
      // This is fire-and-forget, only for a new presentation; warm Esc is intact.
      if (request.accept()) this.port.sendPreviewCommand(request.id, {
        command: 'marktex:verify-review-position', revision: request.revision, requestId: request.requestId,
      });
    }
    return true;
  }

  cancel(): void {
    if (this.pending) clearTimeout(this.pending.timeout);
    this.pending = null;
  }
}
