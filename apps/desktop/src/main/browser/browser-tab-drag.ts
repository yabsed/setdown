import { ipcMain, screen, WebContentsView, type BrowserWindow, type Rectangle, type WebContents } from 'electron';
import path from 'node:path';
import type { NativeTabDrag, TabDragGuide } from '../../protocol/tab-drag';
import { themeProfile } from '../../core/theme/theme-catalog';
import type { PreviewThemeId } from '../../core/preview/preview-preferences';

type Layer = { view: WebContentsView; contents: WebContents; ready: boolean; zoom?: number; state?: string };
const document = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}#guides{pointer-events:none}.guide{position:fixed;box-sizing:border-box;border:2px solid var(--accent);background:var(--fill);pointer-events:none}</style><div id="guides"></div>';

/** A transparent native drag receiver covers the workspace only during a
 * tab drag. The compositor chooses the window: global bounds are unavailable
 * on Wayland. No web page is hidden, captured, reparented or focused here. */
export class BrowserTabDrag {
  private readonly active = new Map<number, string>();
  private readonly layers = new Map<number, Layer>();
  private readonly regions = new Map<number, Rectangle[]>();
  private readonly guides = new Map<number, TabDragGuide>();
  private readonly resizeLocks = new WeakSet<BrowserWindow>();
  private pointerTimer: ReturnType<typeof setInterval> | null = null;
  private pointerKey = '';
  private modifiers = { ctrlKey: false, altKey: false };
  constructor(private readonly window: (id: number) => BrowserWindow | undefined,
    private readonly theme: () => PreviewThemeId, private readonly globalPointer = false) {
    ipcMain.on('tab-drag-surface:event', (event, input: NativeTabDrag) => {
      const owner = [...this.layers].find(([, layer]) => layer.contents === event.sender)?.[0];
      if (owner === undefined || event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame
        || !input || input.transferId !== this.active.get(owner)
        || !['dragenter', 'dragover', 'dragleave', 'drop'].includes(input.type)
        || ![input.clientX, input.clientY, input.screenX, input.screenY].every(Number.isFinite)) return;
      this.pointerKey = input.type === 'dragleave' ? '' : `${owner}:${input.clientX}:${input.clientY}`;
      this.modifiers = { ctrlKey: input.ctrlKey, altKey: input.altKey };
      this.window(owner)?.webContents.send('tabs:native-drag', input);
    });
  }
  private followPointer(): void {
    // X11's drag hit-test cache can keep the pre-maximize window region.
    // Its source still owns the pointer grab, so sample that pointer while a
    // single focused maximized window owns the internal drag. Native events
    // continue to arbitrate all cross-window and Wayland drags.
    if (this.active.size !== 1) return;
    const [owner, transferId] = this.active.entries().next().value!;
    const window = this.window(owner);
    if (!window || window.isDestroyed() || !window.isFocused()
      || (!window.isMaximized() && !window.isFullScreen())) return;
    const point = screen.getCursorScreenPoint(), bounds = window.getContentBounds();
    if (point.x < bounds.x || point.y < bounds.y || point.x >= bounds.x + bounds.width || point.y >= bounds.y + bounds.height) return;
    const zoom = window.webContents.getZoomFactor();
    const clientX = (point.x - bounds.x) / zoom, clientY = (point.y - bounds.y) / zoom;
    const key = `${owner}:${clientX}:${clientY}`;
    if (key === this.pointerKey) return;
    this.pointerKey = key;
    window.webContents.send('tabs:native-drag', { transferId, type: 'dragover', clientX, clientY,
      screenX: point.x, screenY: point.y, ...this.modifiers } satisfies NativeTabDrag);
  }
  state(owner: number, id: string | null): void {
    if (id !== null && (typeof id !== 'string' || id.length > 100)) return;
    if (id !== null && !this.active.size) this.modifiers = { ctrlKey: false, altKey: false };
    const window = this.window(owner);
    // Linux's non-client resize border consumes the last few pixels of an OS
    // drag. At the right edge Chromium then reports leave/none instead of the
    // split drop. Disable that hit target only for the drag's lifetime, keeping
    // already-fixed windows fixed and restoring resizability on every end path.
    // Maximized/fullscreen windows have no resize border; changing their size
    // hints makes Mutter restore them mid-drag, invalidating the drop geometry.
    if (process.platform === 'linux' && window && !window.isDestroyed()) {
      if (id !== null && !this.resizeLocks.has(window) && window.isResizable()
        && !window.isMaximized() && !window.isFullScreen()) {
        this.resizeLocks.add(window);
        window.setResizable(false);
      } else if (id === null && this.resizeLocks.delete(window)) window.setResizable(true);
    }
    if (id === null) { this.active.delete(owner); this.guides.delete(owner); }
    else this.active.set(owner, id);
    this.pointerKey = '';
    if (this.globalPointer && this.active.size && !this.pointerTimer) this.pointerTimer = setInterval(() => this.followPointer(), 16);
    if (!this.active.size && this.pointerTimer) { clearInterval(this.pointerTimer); this.pointerTimer = null; }
    this.layout(owner);
  }
  layout(owner: number, regions?: Rectangle[]): void {
    const window = this.window(owner);
    if (!window || window.isDestroyed()) return;
    if (regions) this.regions.set(owner, regions.slice(0, 32));
    const native = this.regions.get(owner) ?? [];
    let layer = this.layers.get(owner);
    if (!layer) {
      // The shell already receives document/terminal drops. Prepare a native
      // receiver only when a live website needs one, before any drag starts.
      // In particular, a document-only startup must not create another page
      // that races the shell's initialization or spends a renderer process.
      if (!native.length) return;
      const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'tab-drag-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'setdown-tab-drag' } });
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      const contents = view.webContents;
      layer = { view, contents, ready: false }; this.layers.set(owner, layer);
      const created = layer;
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', event => event.preventDefault());
      window.once('closed', () => {
        this.layers.delete(owner); this.regions.delete(owner); this.active.delete(owner); this.guides.delete(owner);
        if (!this.active.size && this.pointerTimer) { clearInterval(this.pointerTimer); this.pointerTimer = null; }
        if (!contents.isDestroyed()) contents.close();
      });
      // Prepare with the first live website, never on a drag input path. Keep one
      // receiver across shell/web boundaries regardless of the active tab type.
      void contents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(document)).then(() => {
        if (this.layers.get(owner) !== created || window.isDestroyed()) return;
        created.ready = true; this.layout(owner);
      }).catch(error => console.error('Could not prepare tab drop surface:', error));
    }
    if (!layer?.ready) return;
    const contents = layer.contents;
    if (contents.isDestroyed()) return;
    const transferId = this.active.get(owner);
    if (!transferId) {
      if (layer.state !== '') contents.send('tab-drag-surface:state', { transferId: null, guides: [] });
      layer.state = '';
      if (layer.view.getVisible()) layer.view.setVisible(false);
      if (window.contentView.children.includes(layer.view)) window.contentView.removeChildView(layer.view);
      return;
    }
    const zoom = window.webContents.getZoomFactor();
    const [width, height] = window.getContentSize();
    const previous = layer.view.getBounds();
    if (previous.width !== width || previous.height !== height) layer.view.setBounds({ x: 0, y: 0, width, height });
    if (layer.zoom !== zoom) { contents.setZoomMode('isolated'); contents.setZoomFactor(zoom); layer.zoom = zoom; }
    const guide = this.guides.get(owner)?.bounds;
    const guides = guide ? native.flatMap(region => {
      const left = Math.max(region.x / zoom, guide.x), top = Math.max(region.y / zoom, guide.y);
      const right = Math.min((region.x + region.width) / zoom, guide.x + guide.width);
      const bottom = Math.min((region.y + region.height) / zoom, guide.y + guide.height);
      return right > left && bottom > top ? [{ x: left, y: top, width: right - left, height: bottom - top }] : [];
    }) : [];
    const state = { transferId, guides, accent: themeProfile(this.theme()).palette.accent };
    const key = JSON.stringify(state);
    if (layer.state !== key) { contents.send('tab-drag-surface:state', state); layer.state = key; }
    // Reattaching an already-topmost receiver can interrupt its native drag.
    if (window.contentView.children.at(-1) !== layer.view) window.contentView.addChildView(layer.view);
    if (!layer.view.getVisible()) layer.view.setVisible(true);
  }
  guide(owner: number, value: TabDragGuide): void {
    if (!this.active.has(owner)) return;
    const rect = value?.bounds;
    if (rect && ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return;
    this.guides.set(owner, value); this.layout(owner);
  }
}
