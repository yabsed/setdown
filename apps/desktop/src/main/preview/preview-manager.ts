import { ipcMain, WebContentsView } from 'electron';
import type { Rectangle, WebContents } from 'electron';
import type { AppCommand, PreviewBounds } from '../../protocol/desktop-api';
import {
  previewThemeBackground,
  type PreviewThemeAssets,
  type PreviewThemeId,
} from '../../core/preview/preview-preferences';
import { DEFERRED_HTML_SCRIPT_ID, INITIAL_HTML_TEMPLATE_ID } from '../../core/preview/preview-install';
import type { WindowState } from '../windows/window-state';

export type PreviewViewState = {
  view: WebContentsView;
  ownerWebContentsId: number;
  pendingScrollPosition: { x: number; y: number } | null;
  pendingScrollRatio: number | null;
  appliedBounds: Rectangle | null;
};

type Options = {
  preload: string;
  stateFor: (id: number) => WindowState | null;
  theme: () => PreviewThemeId;
  themeAssets: (theme: unknown) => PreviewThemeAssets;
  forgetTab: (tabId: string) => void;
};

const INITIAL_HTML = new RegExp(
  `(<template id="${INITIAL_HTML_TEMPLATE_ID}">)[\\s\\S]*?(</template>)`, 'i',
);
const DEFERRED_HTML = new RegExp(
  `(<script type="application/json" id="${DEFERRED_HTML_SCRIPT_ID}">)[\\s\\S]*?(</script>)`, 'i',
);

export class PreviewManager {
  readonly views = new Map<string, PreviewViewState>();
  private readonly documents = new Map<string, string>();
  private readonly waiters = new Map<string, () => void>();
  private readonly spares = new Map<number, { view: WebContentsView; ready: boolean }>();
  private readonly navigating = new Map<WebContentsView, symbol>();
  private readonly themes = new Map<number, PreviewThemeId>();
  private warmup: { url: string; themeId: PreviewThemeId } | null = null;

  constructor(private readonly options: Options) {}

  html(token: string) {
    return this.documents.get(token) ?? null;
  }

  storeDocument(template: string, themeId?: PreviewThemeId) {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.documents.set(token, template);
    while (this.documents.size > 64) this.documents.delete(this.documents.keys().next().value!);
    if (themeId) this.rememberWarmup(template, themeId);
    return `marktex-preview://document/${token}`;
  }

  private rememberWarmup(template: string, themeId: PreviewThemeId) {
    const blank = template
      .replace(INITIAL_HTML, '$1$2')
      .replace(DEFERRED_HTML, '$1[]$2')
      .replace(/(<body\b[^>]*\bdata-html=")[^"]*(")/i, '$1$2');
    if (blank === template) return;
    const token = `warmup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.documents.set(token, blank);
    this.warmup = { url: `marktex-preview://document/${token}`, themeId };
  }

  private createView() {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor(previewThemeBackground(this.options.theme()));
    view.setVisible(false);
    view.webContents.on('focus', () => this.returnFocusFromHiddenView(view));
    return view;
  }

  private returnFocusFromHiddenView(view: WebContentsView) {
    if (view.getVisible()) return;
    const preview = Array.from(this.views.values()).find((candidate) => candidate.view === view);
    const spareOwnerId = Array.from(this.spares.entries())
      .find(([, candidate]) => candidate.view === view)?.[0];
    const ownerId = preview?.ownerWebContentsId ?? spareOwnerId;
    const owner = ownerId === undefined ? null : this.options.stateFor(ownerId)?.window;
    if (!owner || owner.isDestroyed() || !owner.isFocused()
      || owner.webContents.isDestroyed() || owner.webContents.isFocused()) return;
    owner.webContents.focus();
    setImmediate(() => {
      if (!view.webContents.isDestroyed() && !view.getVisible()
        && view.webContents.isFocused() && owner.isFocused()
        && !owner.webContents.isDestroyed()) owner.webContents.focus();
    });
  }

  ensureSpare(ownerId: number) {
    const warmup = this.warmup;
    if (!warmup || this.spares.has(ownerId)) return;
    const owner = this.options.stateFor(ownerId)?.window;
    if (!owner || owner.isDestroyed()) return;
    const view = this.createView();
    const spare = { view, ready: false };
    this.spares.set(ownerId, spare);
    this.loadURL(view, warmup.url, ownerId).then(() => {
      this.markTheme(view.webContents, warmup.themeId);
      if (this.spares.get(ownerId) === spare) spare.ready = true;
    }).catch(() => {
      if (this.spares.get(ownerId) === spare) this.spares.delete(ownerId);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    });
  }

  discardSpare(ownerId: number) {
    const spare = this.spares.get(ownerId);
    if (!spare) return;
    this.spares.delete(ownerId);
    if (!spare.view.webContents.isDestroyed()) spare.view.webContents.close();
  }

  private takeSpare(ownerId: number) {
    const spare = this.spares.get(ownerId);
    if (!spare?.ready || spare.view.webContents.isDestroyed()) return null;
    this.spares.delete(ownerId);
    return spare.view;
  }

  create(ownerId: number, tabId: unknown) {
    if (typeof tabId !== 'string' || this.views.has(tabId)) return;
    const owner = this.options.stateFor(ownerId);
    if (!owner) return;
    const view = this.takeSpare(ownerId) ?? this.createView();
    view.setBackgroundColor(previewThemeBackground(this.options.theme()));
    view.setVisible(false);
    // A fresh view is attached only after its initial navigation has completed.
    setImmediate(() => this.ensureSpare(ownerId));
    this.views.set(tabId, {
      view,
      ownerWebContentsId: ownerId,
      pendingScrollPosition: null,
      pendingScrollRatio: null,
      appliedBounds: null,
    });
    view.webContents.on('before-input-event', (event, input) => {
      const preview = this.views.get(tabId);
      const state = preview && this.options.stateFor(preview.ownerWebContentsId);
      if (!state || input.type !== 'keyDown' || input.isComposing) return;
      if (input.key === 'Escape') {
        event.preventDefault();
        state.window.webContents.focus();
        state.window.webContents.send('app:command', 'escape' satisfies AppCommand);
      } else if (input.key.toLowerCase() === 'f' && (input.control || input.meta) && !input.alt) {
        event.preventDefault();
        state.window.webContents.focus();
        state.window.webContents.send('preview:open-find', tabId);
      }
    });
  }

  /**
   * Electron 38 focuses a WebContents at navigation commit, even if its view is
   * hidden. Restoring focus afterwards is too late for an IME composition.
   * Keep hidden views out of the native input tree for the entire navigation,
   * including loads already in flight when the user starts a new syllable.
   * Reattach the completed, still-hidden view without navigating it again.
   */
  async loadURL(view: WebContentsView, url: string, ownerId: number): Promise<void> {
    const owner = this.options.stateFor(ownerId)?.window;
    if (!owner || owner.isDestroyed() || view.webContents.isDestroyed()) {
      throw new Error('The preview owner was closed.');
    }
    const token = Symbol('preview-navigation');
    this.navigating.set(view, token);
    const hidden = !view.getVisible();
    if (hidden && owner.contentView.children.includes(view)) {
      owner.contentView.removeChildView(view);
    }
    try {
      await view.webContents.loadURL(url);
      const stillOwned = this.spares.get(ownerId)?.view === view
        || Array.from(this.views.values()).some((preview) =>
          preview.view === view && preview.ownerWebContentsId === ownerId);
      if (this.navigating.get(view) !== token || !stillOwned
        || view.webContents.isDestroyed() || owner.isDestroyed()
        || this.options.stateFor(ownerId)?.window !== owner) return;
      if (hidden && !owner.contentView.children.includes(view)) {
        // setVisible(false) was retained while detached: attaching a completed
        // hidden view must not focus it or steal an in-progress composition.
        owner.contentView.addChildView(view);
      }
    } finally {
      if (this.navigating.get(view) === token) this.navigating.delete(view);
    }
  }

  show(ownerId: number, tabId: unknown, bounds: PreviewBounds | null) {
    const owner = this.options.stateFor(ownerId)?.window;
    if (!owner) return;
    const target = typeof tabId === 'string' ? this.views.get(tabId) : undefined;
    const shown = target?.ownerWebContentsId === ownerId ? target : undefined;
    let hiddenFocusedView = false;
    for (const preview of this.views.values()) {
      if (preview.ownerWebContentsId === ownerId && preview !== shown && preview.view.getVisible()) {
        hiddenFocusedView ||= preview.view.webContents.isFocused();
        preview.view.setVisible(false);
      }
    }
    if (hiddenFocusedView && owner.isFocused() && !owner.webContents.isDestroyed()) {
      owner.webContents.focus();
    }
    if (!shown || !bounds || this.navigating.has(shown.view)) return;
    const [width, height] = owner.getContentSize();
    const x = Math.max(0, Math.round(Number(bounds.x) || 0));
    const y = Math.max(0, Math.round(Number(bounds.y) || 0));
    this.applyBounds(shown, {
      x,
      y,
      width: Math.max(1, Math.min(Math.round(Number(bounds.width) || 1), width - x)),
      height: Math.max(1, Math.min(Math.round(Number(bounds.height) || 1), height - y)),
    });
    if (!shown.view.getVisible()) {
      shown.view.setBackgroundColor(previewThemeBackground(this.options.theme()));
      owner.contentView.addChildView(shown.view);
      shown.view.setVisible(true);
    }
    this.restoreScroll(shown);
    shown.view.webContents.send('preview:command', { command: 'marktex:resume-hydration' });
  }

  applyBounds(preview: PreviewViewState, bounds: Rectangle) {
    const previous = preview.appliedBounds;
    if (previous && previous.x === bounds.x && previous.y === bounds.y
      && previous.width === bounds.width && previous.height === bounds.height) return;
    preview.appliedBounds = bounds;
    preview.view.setBounds(bounds);
  }

  restoreScroll(preview: PreviewViewState) {
    const owner = this.options.stateFor(preview.ownerWebContentsId)?.window;
    const scroll = preview.pendingScrollPosition;
    if (!owner?.isVisible() || !scroll || !preview.view.getVisible()) return;
    preview.pendingScrollPosition = null;
    const ratio = preview.pendingScrollRatio;
    preview.pendingScrollRatio = null;
    void preview.view.webContents.executeJavaScript(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
        const ratioY = Number.isFinite(${JSON.stringify(ratio)}) ? maximum * ${JSON.stringify(ratio)} : 0;
        window.scrollTo(${JSON.stringify(scroll.x)}, Math.max(${JSON.stringify(scroll.y)}, ratioY));
        window.__setdownTransferScroll = { ...(window.__setdownTransferScroll || {}), restoredX: window.scrollX, restoredY: window.scrollY };
        resolve();
      }));
    })`);
  }

  async capture(ownerId: number, tabId: unknown) {
    const preview = this.views.get(String(tabId));
    if (!preview || preview.ownerWebContentsId !== ownerId
      || !preview.view.getVisible() || preview.view.webContents.isCrashed()) return null;
    const image = await preview.view.webContents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  }

  command(ownerId: number, tabId: unknown, message: Record<string, unknown>) {
    const preview = this.views.get(String(tabId));
    if (!preview || preview.ownerWebContentsId !== ownerId) return;
    if (message?.command === 'marktex:apply-theme') {
      const assets = this.options.themeAssets(message.themeId);
      preview.view.setBackgroundColor(assets.backgroundColor);
      preview.view.webContents.send('preview:command', { command: 'marktex:apply-theme', ...assets });
      this.markTheme(preview.view.webContents, assets.themeId);
    } else preview.view.webContents.send('preview:command', message);
  }

  destroy(ownerId: number, tabId: unknown) {
    if (typeof tabId !== 'string') return;
    const preview = this.views.get(tabId);
    if (!preview || preview.ownerWebContentsId !== ownerId) return;
    const owner = this.options.stateFor(ownerId)?.window;
    if (owner && !owner.isDestroyed() && owner.contentView.children.includes(preview.view)) {
      owner.contentView.removeChildView(preview.view);
    }
    this.navigating.delete(preview.view);
    if (!preview.view.webContents.isDestroyed()) preview.view.webContents.close();
    this.views.delete(tabId);
    this.options.forgetTab(tabId);
  }

  receive(senderId: number, message: Record<string, unknown>) {
    const found = Array.from(this.views.entries()).find(([, preview]) =>
      preview.view.webContents.id === senderId);
    if (!found) return;
    const [tabId, preview] = found;
    if (message.type === 'marktex:html-updated') {
      this.waiters.get(`${tabId}:${Math.max(0, Number(message.revision) || 0)}`)?.();
    }
    this.options.stateFor(preview.ownerWebContentsId)?.window.webContents.send(
      'preview:message', { tabId, message },
    );
  }

  waitForUpdate(tabId: string, revision: number) {
    const key = `${tabId}:${revision}`;
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(key);
        resolve();
      }, 5000);
      this.waiters.set(key, () => {
        clearTimeout(timeout);
        this.waiters.delete(key);
        resolve();
      });
    });
  }

  markTheme(contents: WebContents, themeId: PreviewThemeId) {
    if (contents.isDestroyed()) return;
    if (!this.themes.has(contents.id)) {
      contents.once('destroyed', () => this.themes.delete(contents.id));
    }
    this.themes.set(contents.id, themeId);
  }

  syncTheme(view: WebContentsView, themeId: PreviewThemeId) {
    const contents = view.webContents;
    if (contents.isDestroyed() || this.themes.get(contents.id) === themeId) return;
    const assets = this.options.themeAssets(themeId);
    view.setBackgroundColor(assets.backgroundColor);
    contents.send('preview:command', { command: 'marktex:apply-theme', ...assets });
    this.markTheme(contents, assets.themeId);
  }

  setTheme(themeId: PreviewThemeId) {
    for (const spare of this.spares.values()) this.syncTheme(spare.view, themeId);
  }

  resizeOwner(ownerId: number, contentWidth: number, contentHeight: number) {
    for (const preview of this.views.values()) {
      if (preview.ownerWebContentsId !== ownerId || !preview.view.getVisible()) continue;
      const bounds = preview.view.getBounds();
      this.applyBounds(preview, {
        ...bounds,
        width: Math.max(1, contentWidth - bounds.x),
        height: Math.max(1, contentHeight - bounds.y),
      });
    }
  }

  closeOwner(ownerId: number) {
    this.discardSpare(ownerId);
    for (const [tabId, preview] of this.views) {
      if (preview.ownerWebContentsId !== ownerId) continue;
      preview.view.webContents.close();
      this.views.delete(tabId);
      this.options.forgetTab(tabId);
    }
  }

  registerIpc() {
    ipcMain.on('preview:create', (event, tabId) => this.create(event.sender.id, tabId));
    ipcMain.on('preview:show', (event, { tabId, bounds }) => this.show(event.sender.id, tabId, bounds));
    ipcMain.handle('preview:capture', (event, tabId) => this.capture(event.sender.id, tabId));
    ipcMain.on('preview:command', (event, { tabId, message }) =>
      this.command(event.sender.id, tabId, message));
    ipcMain.on('preview:destroy', (event, tabId) => this.destroy(event.sender.id, tabId));
    ipcMain.on('preview:message', (event, message) => this.receive(event.sender.id, message));
  }
}
