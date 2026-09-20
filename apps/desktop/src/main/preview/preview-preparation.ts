import type { Rectangle, WebContentsView } from 'electron';
import type { RuntimePreparationCommand } from '../../protocol/preview-preparation';

/** Owns hidden native/Blink readiness, never visibility or keyboard focus.
 * See docs/preview-performance-contract.md before changing this lifecycle.
 */
export class PreviewPreparation {
  private readonly kinds = new WeakMap<WebContentsView, 'review' | 'document'>();
  private readonly viewports = new WeakMap<WebContentsView, { width: number; height: number }>();
  private readonly pendingDocuments = new WeakSet<WebContentsView>();

  review(view: WebContentsView): void { this.kinds.set(view, 'review'); }
  primeDocument(view: WebContentsView): boolean {
    if (this.kinds.get(view) === 'review' || view.getVisible() || view.webContents.isDestroyed()) return false;
    this.kinds.set(view, 'document');
    this.pendingDocuments.add(view);
    return true;
  }
  navigationStarted(view: WebContentsView): void {
    this.viewports.delete(view);
    if (this.kinds.get(view) === 'document') this.pendingDocuments.add(view);
  }

  synchronize(view: WebContentsView, bounds: Rectangle, navigating: boolean): void {
    const kind = this.kinds.get(view);
    const contents = view.webContents;
    if (!kind || navigating || contents.isDestroyed()
      || !contents.getURL().startsWith('marktex-preview://document/')) return;
    const previous = this.viewports.get(view);
    if (previous?.width !== bounds.width || previous.height !== bounds.height) {
      // setBounds alone leaves never-shown Blink views at 0x0. Preserve natural
      // DPR and zoom, and keep the override on show to avoid full math relayout.
      contents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: 0, height: 0 },
        viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 0,
        viewSize: { width: bounds.width, height: bounds.height }, scale: 1 });
      // A failed native call must not poison the retry cache.
      this.viewports.set(view, { width: bounds.width, height: bounds.height });
    }
    // The viewport always precedes hydration, including replay after navigation.
    if (this.pendingDocuments.has(view) && !view.getVisible()) {
      contents.send('preview:command', { command: 'marktex:prepare-document' } satisfies RuntimePreparationCommand);
      this.pendingDocuments.delete(view);
    }
  }
}
