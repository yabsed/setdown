import { BrowserWindow, dialog } from 'electron';
import type { Event as ElectronEvent } from 'electron';
import { unwatchFile } from 'node:fs';
import path from 'node:path';
import { isDirty } from '../../core/document/document-state';
import { themeProfile } from '../../core/theme/theme-catalog';
import type { DocumentSnapshot } from '../../core/document/document';
import type { DocumentManager } from '../documents/document-manager';
import type { PreviewManager } from '../preview/preview-manager';
import type { ThemeManager } from '../theme/theme-manager';
import type { WindowState } from './window-state';
import type { WindowRegistry } from './window-registry';

type Options = {
  registry: WindowRegistry;
  documents: DocumentManager;
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
      window,
      currentDocument: initialDocument,
      activeRoot: initialDocument ? path.dirname(initialDocument.path) : null,
      watchedPath: null,
      closeAfterConfirmation: false,
      rendererTabs: [],
    };
    const webContentsId = window.webContents.id;
    this.options.registry.add(state, showWhenReady);
    window.setMenuBarVisibility(false);
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        window.webContents.send('app:command', 'escape');
      }
    });
    if (showWhenReady) window.once('ready-to-show', () => window.show());
    window.on('focus', () => this.options.registry.focus(window));
    window.on('resize', () => {
      const [width, height] = window.getContentSize();
      this.options.previews.resizeOwner(webContentsId, width, height);
    });
    window.on('close', (event) => this.confirmClose(event, state));
    window.on('closed', () => {
      if (state.watchedPath) unwatchFile(state.watchedPath);
      this.options.previews.closeOwner(webContentsId);
      this.options.registry.remove(window);
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
    void dialog.showMessageBox(state.window, {
      type: 'warning',
      message: '바뀐 내용을 저장하시겠습니까?',
      detail: dirtyTabs.map((tab) => tab.name).join('\n'),
      buttons: ['취소', '저장 안 함', '저장'],
      defaultId: 2,
      cancelId: 0,
    }).then(async ({ response }) => {
      if (response === 0) return;
      if (response === 1) {
        await Promise.all(state.rendererTabs
          .filter((tab) => tab.isUntitled)
          .map((tab) => this.options.documents.discardDraft(tab.path)));
        state.closeAfterConfirmation = true;
        state.window.close();
        return;
      }
      state.window.webContents.send('app:save-before-close');
    }).catch((error) => dialog.showErrorBox('창을 닫지 못했습니다', String(error)));
  }
}
