import type { PreviewBounds } from '../../protocol/desktop-api';
import { PreviewManager } from './preview-manager';
import { ReviewNativePresentation } from './review-native-presentation';
import { nativeZoomBounds } from '../windows/workspace-zoom';
import { previewThemeBackground } from '../../core/preview/preview-preferences';

type Options = ConstructorParameters<typeof PreviewManager>[0];
/** Adds transaction presentation without changing ordinary document lifecycles. */
export class ReviewPreviewManager extends PreviewManager {
  private readonly loadingViews = new Set<Electron.WebContentsView>();
  private readonly presentation: ReviewNativePresentation;
  constructor(private readonly presentationOptions: Options) {
    super(presentationOptions);
    this.presentation = new ReviewNativePresentation({ views: this.views,
      owner: presentationOptions.stateFor,
      navigating: preview => this.loadingViews.has(preview.view),
      applyBounds: (preview, bounds) => this.applyBounds(preview, bounds),
      show: (owner, id, bounds) => this.reveal(owner, id, bounds),
    });
  }
  override command(owner: number, tabId: unknown, message: Record<string, unknown>) {
    if (typeof tabId === 'string' && this.presentation.command(owner, tabId, message)) return;
    if (message.command === 'marktex:apply-theme') this.presentation.cancel(owner);
    super.command(owner, tabId, message);
  }
  override show(owner: number, tabId: unknown, bounds: PreviewBounds | null) {
    this.presentation.cancel(owner);
    // Keep ordinary Markdown's established show path unchanged.
    if (typeof tabId === 'string' && /^git-diff:.*:[ab]$/.test(tabId) && bounds) {
      this.reveal(owner, tabId, bounds);
    } else super.show(owner, tabId, bounds);
  }
  private reveal(ownerId: number, id: string, bounds: PreviewBounds): void {
    const owner = this.presentationOptions.stateFor(ownerId)?.window;
    const incoming = this.views.get(id);
    if (!owner || owner.isDestroyed() || !incoming || incoming.ownerWebContentsId !== ownerId
      || incoming.view.webContents.isDestroyed() || this.loadingViews.has(incoming.view)) return;
    const [width, height] = owner.getContentSize();
    const box = nativeZoomBounds(bounds, owner.webContents.getZoomFactor());
    box.width = Math.max(1, Math.min(box.width, width - box.x));
    box.height = Math.max(1, Math.min(box.height, height - box.y));
    this.applyBounds(incoming, box);
    if (!incoming.view.getVisible()) {
      incoming.view.setBackgroundColor(previewThemeBackground(this.presentationOptions.theme()));
      if (!owner.contentView.children.includes(incoming.view)) owner.contentView.addChildView(incoming.view);
      incoming.view.setVisible(true);
    }
    // Never leave a deliberate blank gap by hiding the outgoing front first.
    let hiddenFocused = false;
    for (const preview of this.views.values()) {
      if (preview.ownerWebContentsId !== ownerId || preview === incoming || !preview.view.getVisible()) continue;
      hiddenFocused ||= preview.view.webContents.isFocused();
      preview.view.setVisible(false);
    }
    if (hiddenFocused && owner.isFocused() && !owner.webContents.isDestroyed()) owner.webContents.focus();
    this.restoreScroll(incoming);
    incoming.view.webContents.send('preview:command', { command: 'marktex:resume-hydration' });
  }
  override receive(sender: number, message: Record<string, unknown>) {
    const found = [...this.views.entries()].find(([, preview]) => preview.view.webContents.id === sender);
    if (found) this.presentation.receive(found[0], message);
    super.receive(sender, message);
  }
  override async prepareReviewViewport(owner: number, tabId: string, revision: number): Promise<void> {
    await super.prepareReviewViewport(owner, tabId, revision);
    if (this.views.get(tabId)?.ownerWebContentsId === owner) this.presentation.installed(tabId, revision);
  }
  beforeReviewRender(owner: number, tabId: string): Promise<void> {
    return this.presentation.beforeRender(owner, tabId);
  }
  override async loadURL(view: Electron.WebContentsView, url: string, owner: number): Promise<void> {
    const found = [...this.views.entries()].find(([, candidate]) => candidate.view === view);
    if (found) this.presentation.forget(found[0]);
    this.loadingViews.add(view);
    try { await super.loadURL(view, url, owner); }
    finally { this.loadingViews.delete(view); }
  }
  override destroy(owner: number, tabId: unknown) {
    if (typeof tabId === 'string' && this.views.get(tabId)?.ownerWebContentsId === owner) this.presentation.forget(tabId);
    super.destroy(owner, tabId);
  }
  override closeOwner(owner: number) {
    this.presentation.cancel(owner);
    for (const [id, preview] of this.views) if (preview.ownerWebContentsId === owner) this.presentation.forget(id);
    super.closeOwner(owner);
  }
}
