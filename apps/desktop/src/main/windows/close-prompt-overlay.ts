import { ipcMain, webContents, WebContentsView, type WebContents } from 'electron';
import path from 'node:path';
import type { WindowState } from './window-state';
import type { CloseDecision, ClosePromptContext, ClosePromptRequest } from '../../protocol/desktop-api';
import type { PreviewThemeId } from '../../core/preview/preview-preferences';

type Entry = { state: WindowState; view: WebContentsView; contents: WebContents; ready: Promise<void>; generation: number;
  context?: ClosePromptContext; settle?: (decision: CloseDecision | null) => void; focused?: WebContents };
const decisions: readonly unknown[] = ['cancel', 'discard', 'save'];

/** The "Save Changes" prompt above a live web page. The shell's own dialog cannot cover a
 * native page, and hiding the page behind a captured image stops its video for as long as the
 * question stands. A transparent layer over the whole window shows the same prompt instead:
 * the page keeps its bounds, its visibility and its frames, as under a menu (`MenuOverlay`). */
export class ClosePromptOverlay {
  private readonly owners = new Map<number, Entry>();
  constructor() {
    const owned = (contents: WebContents) => [...this.owners.values()].find(entry => entry.contents === contents);
    ipcMain.handle('close-prompt-overlay:context', event => owned(event.sender)?.context);
    ipcMain.on('close-prompt-overlay:decide', (event, decision: unknown) => {
      const entry = owned(event.sender);
      if (entry?.settle && entry.view.getVisible() && decisions.includes(decision)) this.finish(entry, decision as CloseDecision);
    });
  }
  /** Resolves with the person's choice, or with null when the layer could not be shown and the
   * shell has to ask in its own dialog. */
  async ask(state: WindowState, request: ClosePromptRequest, theme: PreviewThemeId): Promise<CloseDecision | null> {
    const names = Array.isArray(request?.names) ? request.names.filter((name): name is string => typeof name === 'string' && !!name.trim()).slice(0, 200).map(name => name.slice(0, 400)) : [];
    if (!names.length || state.window.isDestroyed()) return null;
    const owner = state.webContentsId;
    let entry = this.owners.get(owner);
    // The shell asks one question at a time. A second one replaces a question nobody can answer any more.
    if (entry?.settle) this.finish(entry, 'cancel');
    if (!entry) {
      const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const contents = view.webContents;
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      const url = new URL(state.window.webContents.getURL()); url.searchParams.set('close-prompt-overlay', '1');
      const created: Entry = entry = { state, view, contents, generation: 0, ready: contents.loadURL(url.href) };
      this.owners.set(owner, created);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', event => event.preventDefault());
      state.window.on('resize', () => { if (created.settle && view.getVisible()) this.place(created); });
      // A shell that loads again has forgotten its question.
      state.window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace && created.settle) this.finish(created, 'cancel'); });
      state.window.once('closed', () => {
        this.owners.delete(owner);
        const settle = created.settle; created.settle = undefined; settle?.('cancel');
        if (!contents.isDestroyed()) contents.close();
      });
    }
    const generation = ++entry.generation;
    entry.context = { scope: request.scope === 'window' ? 'window' : 'tab', names, theme };
    const focused = webContents.getFocusedWebContents();
    entry.focused = focused && focused !== entry.contents ? focused : undefined;
    try { await entry.ready; } catch { return null; }
    if (entry.generation !== generation || state.window.isDestroyed() || entry.contents.isDestroyed()) return null;
    await entry.contents.insertCSS('html,body,#app{background:transparent!important}').catch(() => {});
    if (entry.generation !== generation || state.window.isDestroyed() || entry.contents.isDestroyed()) return null;
    const shown = entry;
    const decision = new Promise<CloseDecision | null>(resolve => { shown.settle = resolve; });
    this.place(shown);
    shown.contents.setZoomMode('isolated');
    shown.contents.setZoomFactor(state.window.webContents.getZoomFactor());
    state.window.contentView.addChildView(shown.view);
    shown.contents.send('close-prompt-overlay:show', shown.context);
    shown.view.setVisible(true); shown.contents.focus();
    return decision;
  }
  private place(entry: Entry): void {
    if (entry.state.window.isDestroyed()) return;
    const [width, height] = entry.state.window.getContentSize();
    entry.view.setBounds({ x: 0, y: 0, width, height });
  }
  private finish(entry: Entry, decision: CloseDecision | null): void {
    const settle = entry.settle, focused = entry.focused;
    entry.settle = undefined; entry.context = undefined; entry.focused = undefined; entry.generation++;
    const visible = !entry.contents.isDestroyed() && entry.view.getVisible();
    if (!entry.contents.isDestroyed()) entry.view.setVisible(false);
    if (!entry.state.window.isDestroyed()) {
      entry.state.window.contentView.removeChildView(entry.view);
      // The keyboard goes back to where it was: the page that was playing, or the shell.
      if (visible && entry.state.window.isFocused()) {
        if (focused && !focused.isDestroyed()) focused.focus(); else if (!entry.state.window.webContents.isDestroyed()) entry.state.window.webContents.focus();
      }
    }
    settle?.(decision);
  }
}
