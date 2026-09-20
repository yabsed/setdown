import { readReviewPresentation, type ReviewPresentationRequest } from '../../core/preview/review-presentation';
import type { PreviewViewState } from './preview-manager';
import type { WindowState } from '../windows/window-state';
import { nativeZoomBounds } from '../windows/workspace-zoom';
import { ReviewPresentationCoordinator } from './review-presentation-coordinator';

type Options = {
  views: Map<string, PreviewViewState>;
  owner(id: number): WindowState | null;
  navigating(view: PreviewViewState): boolean;
  applyBounds(view: PreviewViewState, bounds: ReviewPresentationRequest['bounds']): void;
  show(owner: number, id: string, bounds: ReviewPresentationRequest['bounds']): void;
};
type Pending = {
  target: string; request: ReviewPresentationRequest; observation: Record<string, unknown> | null;
  generation: number; resolve(): void; settled: Promise<void>;
};

/** Main-process half of the final display transaction. Existing front stays
 * visible until the exact requested page has positioned itself. Native GPU paint
 * completion is not inferred from this layout acknowledgment.
 */
export class ReviewNativePresentation {
  private readonly revisions = new Map<string, number>();
  private readonly pending = new Map<number, Pending>();
  private readonly coordinator = new ReviewPresentationCoordinator((ticket, reason) => {
    this.release(ticket.owner);
    this.options.owner(ticket.owner)?.window.webContents.send('preview:message', {
      tabId: ticket.view, message: { type: 'marktex:review-presentation-error', error: reason },
    });
  });
  constructor(private readonly options: Options) {}

  installed(tabId: string, revision: number): void { this.revisions.set(tabId, revision); }
  private geometry(owner: number, preview: PreviewViewState): string {
    const window = this.options.owner(owner)?.window;
    return JSON.stringify([window?.getContentSize(), window?.webContents.getZoomFactor(),
      preview.view.webContents.getZoomFactor(), preview.view.getBounds()]);
  }
  private page(tabId: string, preview: PreviewViewState): string {
    return `${preview.view.webContents.id}:${preview.view.webContents.getURL()}:${this.revisions.get(tabId)}`;
  }
  private presented(owner: number, tabId: string, presentationId: number): void {
    this.options.owner(owner)?.window.webContents.send('preview:message', {
      tabId, message: { type: 'marktex:review-presented', presentationId },
    });
  }
  private release(owner: number): void {
    const pending = this.pending.get(owner);
    this.pending.delete(owner);
    pending?.resolve();
  }
  cancel(owner: number): void {
    const pending = this.pending.get(owner);
    const preview = pending && this.options.views.get(pending.target);
    if (preview && !preview.view.webContents.isDestroyed()) {
      preview.view.webContents.send('preview:command', { command: 'marktex:cancel-presentation' });
    }
    this.coordinator.cancel(owner);
    this.release(owner);
  }
  forget(tabId: string): void {
    for (const [owner, pending] of this.pending) if (pending.target === tabId) this.cancel(owner);
    this.revisions.delete(tabId);
  }
  /** An A/B follow-up may target the previous front. Do not mutate it while a
   * newer presentation is still positioning. This wait is background-only.
   */
  async beforeRender(owner: number, tabId: string): Promise<void> {
    const pending = this.pending.get(owner);
    const preview = this.options.views.get(tabId);
    if (pending && pending.target !== tabId && preview?.view.getVisible()) await pending.settled;
    if (this.pending.get(owner)?.target === tabId) this.cancel(owner);
    this.revisions.delete(tabId);
  }

  command(owner: number, tabId: string, message: Record<string, unknown>): boolean {
    if (message.command !== 'marktex:present-review') return false;
    const request = readReviewPresentation(message);
    const preview = this.options.views.get(tabId);
    const window = this.options.owner(owner)?.window;
    const revision = this.revisions.get(tabId);
    if (!request || !preview || preview.ownerWebContentsId !== owner || !window
      || window.isDestroyed() || preview.view.webContents.isDestroyed()
      || this.options.navigating(preview) || revision === undefined) return true;
    this.cancel(owner);
    const bounds = nativeZoomBounds(request.bounds, window.webContents.getZoomFactor());
    const [width, height] = window.getContentSize();
    bounds.width = Math.max(1, Math.min(bounds.width, width - bounds.x));
    bounds.height = Math.max(1, Math.min(bounds.height, height - bounds.y));
    const previous = preview.view.getBounds();
    const sameSize = previous.width === bounds.width && previous.height === bounds.height;
    this.options.applyBounds(preview, bounds);
    const observation = message.observation as Record<string, unknown> | null;
    const safeObservation = observation?.command === 'marktex:observe-viewport'
      && (observation.observationId === null || (typeof observation.observationId === 'number'
        && Number.isSafeInteger(observation.observationId) && observation.observationId > 0))
      ? { command: 'marktex:observe-viewport', observationId: observation.observationId } : null;
    // Resuming the identical live page never needs an artificial navigation.
    if (!request.position && sameSize) {
      this.options.show(owner, tabId, request.bounds);
      if (safeObservation) preview.view.webContents.send('preview:command', safeObservation);
      this.presented(owner, tabId, request.presentationId);
      return true;
    }
    const geometry = this.geometry(owner, preview);
    const generation = this.coordinator.begin({ owner, view: tabId, id: request.presentationId,
      revision, geometry, page: this.page(tabId, preview) });
    let resolve!: () => void;
    const settled = new Promise<void>(done => { resolve = done; });
    this.pending.set(owner, { target: tabId, request, observation: safeObservation,
      generation, resolve, settled });
    preview.view.webContents.send('preview:command', { ...request,
      command: 'marktex:present-review-page', presentationId: generation, revision, geometry });
    return true;
  }

  receive(tabId: string, message: Record<string, unknown>): void {
    if (message.type !== 'marktex:review-presentation-ready') return;
    const preview = this.options.views.get(tabId);
    if (!preview || preview.view.webContents.isDestroyed()) return;
    const owner = preview.ownerWebContentsId;
    const pending = this.pending.get(owner);
    if (!pending || pending.target !== tabId || message.presentationId !== pending.generation) return;
    if (typeof message.error === 'string') {
      this.cancel(owner);
      this.options.owner(owner)?.window.webContents.send('preview:message', {
        tabId, message: { type: 'marktex:review-presentation-error', error: message.error },
      });
      return;
    }
    const ticket = this.coordinator.finish(owner, tabId, pending.generation, Number(message.revision),
      this.geometry(owner, preview), this.page(tabId, preview));
    if (!ticket) return;
    // Retire only after the incoming view is visible. show() preserves IME rules.
    this.options.show(owner, tabId, pending.request.bounds);
    if (pending.observation) preview.view.webContents.send('preview:command', pending.observation);
    this.presented(owner, tabId, pending.request.presentationId);
    this.release(owner);
  }
}
