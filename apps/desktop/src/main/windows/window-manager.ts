import { BrowserWindow } from 'electron';
import type { Event as ElectronEvent } from 'electron';
import { unwatchFile } from 'node:fs';
import path from 'node:path';
import { isDirty } from '../../core/document/document-state';
import { themeProfile } from '../../core/theme/theme-catalog';
import type { DocumentSnapshot } from '../../core/document/document';
import type { PreviewManager } from '../preview/preview-manager';
import type { ThemeManager } from '../theme/theme-manager';
import type { WindowState } from './window-state';
import type { WindowRegistry } from './window-registry';

type Options = {
  registry: WindowRegistry;
  previews: PreviewManager;
  themes: ThemeManager;
};

export class WindowManager {
  constructor(private readonly options: Options) {}

  create = (
    position: { x: number; y: number } | null = null,
    initialDocument: DocumentSnapshot | null = null,
    showWhenReady = true,
    contentSize: { width: number; height: number } | null = null,
  ): BrowserWindow => {
    const profile = themeProfile(this.options.themes.id);
    const window = new BrowserWindow({
      width: 1080,
      height: 820,
      ...(contentSize
        ? { width: contentSize.width, height: contentSize.height, useContentSize: true }
        : {}),
      ...(position ? { x: position.x, y: position.y } : {}),
      minWidth: 520,
      minHeight: 420,
      backgroundColor: profile.palette.canvas,
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: profile.palette.chrome,
        symbolColor: profile.palette.text,
        height: 36,
      },
      show: false,
      title: 'Setdown',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: [
          `--setdown-theme=${this.options.themes.id}`,
          `--setdown-theme-revision=${this.options.themes.revision}`,
        ],
      },
    });
    const state: WindowState = {
      webContentsId: window.webContents.id,
      window,
      currentDocument: initialDocument,
      activeRoot: initialDocument ? path.dirname(initialDocument.path) : null,
      projectRoot: null,
      watchedPath: null,
      closeAfterConfirmation: false,
      closePromptOpen: false,
      rendererTabs: [],
      rendererGitReview: null,
    };
    const webContentsId = window.webContents.id;
    this.options.registry.add(state, showWhenReady);
    this.options.previews.zoom.track(window.webContents, () => {
      if (!window.isDestroyed()) window.setTitleBarOverlay({
        height: Math.round(36 * this.options.previews.zoom.factor),
      });
    });
    window.setMenuBarVisibility(false);
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && !input.isComposing && input.control
        && !input.alt && !input.meta && !input.shift && input.key === '0') {
        event.preventDefault();
        this.options.previews.zoom.change(0);
        return;
      }
      if (input.type === 'keyDown' && input.key === 'Escape' && !input.isComposing) {
        window.webContents.send('app:command', 'escape');
      }
    });
    if (showWhenReady) window.once('ready-to-show', () => window.show());
    window.on('focus', () => this.options.registry.focus(webContentsId));
    window.on('resize', () => {
      const [width, height] = window.getContentSize();
      this.options.previews.resizeOwner(webContentsId, width, height);
    });
    window.on('close', (event) => this.confirmClose(event, state));
    window.on('closed', () => {
      if (state.watchedPath) unwatchFile(state.watchedPath);
      this.options.previews.closeOwner(webContentsId);
      this.options.registry.remove(webContentsId);
    });
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer) void window.loadURL(devServer);
    else void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    return window;
  };

  disposeWatchers(): void {
    for (const state of this.options.registry.values) {
      if (state.watchedPath) unwatchFile(state.watchedPath);
      state.watchedPath = null;
    }
  }

  private confirmClose(event: ElectronEvent, state: WindowState): void {
    if (state.closeAfterConfirmation) return;
    const dirtyTabs = state.rendererTabs.filter((tab) => tab.dirty);
    if (state.rendererGitReview?.dirty) dirtyTabs.push(state.rendererGitReview);
    if (state.rendererTabs.length === 0 && state.currentDocument && isDirty(state.currentDocument)) {
      dirtyTabs.push({
        name: state.currentDocument.name,
        path: state.currentDocument.path,
        dirty: true,
        isUntitled: state.currentDocument.isUntitled,
      });
    }
    if (dirtyTabs.length === 0) return;
    event.preventDefault();
    if (state.closePromptOpen) return;
    state.closePromptOpen = true;
    state.window.webContents.send(
      'app:request-window-close',
      dirtyTabs.map((tab) => tab.name),
    );
  }
}
