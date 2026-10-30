import { WebContentsView, type BrowserWindow, type Rectangle, type Session, type WebContents } from 'electron';

/** A child View uses owner-local DIP coordinates, including on Wayland where
 * the compositor can center a separate child window despite setBounds(). */
export class ExtensionSurface {
  readonly view: WebContentsView;
  readonly contents: WebContents;
  private destroyed = false;
  private cleanup: Array<() => void> = [];
  constructor(readonly extensionId: string, readonly parent: BrowserWindow, readonly target: WebContents,
    readonly anchor: Rectangle, options: { session?: Session; preload?: string; zoom?: number; width?: number; height?: number; radius?: number },
    private readonly closed: () => void) {
    this.view = new WebContentsView({ webPreferences: { session: options.session, preload: options.preload,
      sandbox: true, contextIsolation: true, nodeIntegration: false, enablePreferredSizeMode: !!extensionId } });
    this.contents = this.view.webContents;
    this.view.setBorderRadius(options.radius ?? 12); this.view.setVisible(false);
    this.contents.setZoomMode('isolated'); this.contents.setZoomFactor(options.zoom ?? 1);
    this.resize(options.width ?? 360, options.height ?? 420);
    parent.contentView.addChildView(this.view);
    const close = () => this.destroy();
    const navigate = (_event: unknown, _url: string, _inPlace: boolean, main: boolean) => { if (main) close(); };
    parent.on('blur', close); parent.on('resize', close); parent.on('move', close); parent.on('closed', close);
    this.cleanup.push(() => { parent.removeListener('blur', close); parent.removeListener('resize', close);
      parent.removeListener('move', close); parent.removeListener('closed', close); });
    target.on('destroyed', close); target.on('did-start-navigation', navigate);
    this.cleanup.push(() => { target.removeListener('destroyed', close); target.removeListener('did-start-navigation', navigate); });
    this.contents.on('blur', () => {
      if (extensionId || parent.isDestroyed()) { close(); return; }
      // Clicking the shell's extension button blurs this native child before
      // the button's click reaches main. Keep it until that click can toggle
      // the existing strip; otherwise menu() would create a second strip.
      void parent.webContents.executeJavaScript(`!!document.activeElement?.closest('[data-extension-tab]')`)
        .then(onButton => {
          if (!this.destroyed && !this.contents.isFocused()
            && !(onButton && parent.webContents.isFocused())) close();
        }).catch(close);
    });
    this.contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !input.isComposing) {
        event.preventDefault(); this.destroy(true);
      }
    });
    if (extensionId) this.contents.on('preferred-size-changed', (_event, size) => this.resize(size.width, size.height));
    this.contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
  resize(width: number, height: number): void {
    if (this.destroyed || this.parent.isDestroyed()) return;
    const [ownerWidth, ownerHeight] = this.parent.getContentSize();
    const y = Math.min(Math.round(this.anchor.y + this.anchor.height + 6), ownerHeight - 25);
    width = Math.max(25, Math.min(Math.ceil(width), 800, ownerWidth - 16));
    height = Math.max(25, Math.min(Math.ceil(height), 600, ownerHeight - y - 8));
    const x = Math.max(8, Math.min(Math.round(this.anchor.x + this.anchor.width - width), ownerWidth - width - 8));
    this.view.setBounds({ x, y, width, height });
  }
  async load(url: string): Promise<void> {
    try {
      await this.contents.loadURL(url);
      if (this.destroyed || this.parent.isDestroyed()) return;
      this.view.setVisible(true); this.contents.focus();
    } catch (error) { if (!this.destroyed) { this.destroy(); throw error; } }
  }
  isDestroyed(): boolean { return this.destroyed; }
  destroy(focus = false): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const cleanup of this.cleanup) cleanup();
    this.cleanup = [];
    if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view);
    if (!this.contents.isDestroyed()) this.contents.close();
    this.closed();
    if (focus && !this.target.isDestroyed() && !this.parent.isDestroyed() && this.parent.isFocused()) {
      const visible = this.parent.contentView.children.some(view => view instanceof WebContentsView
        && view.webContents === this.target && view.getVisible());
      (visible ? this.target : this.parent.webContents).focus();
    }
  }
}
