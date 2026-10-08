import { app, ipcMain, webContents, type Session, type WebContents, type WebFrameMain } from 'electron';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class BrowserExtensions {
  host?: ElectronChromeExtensions;
  extensionId?: string;
  private pending = new Map<string, { frame: WebFrameMain; done(error?: string): void }>();
  constructor(private readonly session: Session, private readonly tab: (id: number) => WebContents | undefined,
    private readonly callbacks: ConstructorParameters<typeof ElectronChromeExtensions>[0]) {}

  async start(): Promise<void> {
    if (!this.host) this.installHost();
    if (this.extensionId) this.session.extensions.removeExtension(this.extensionId);
    let extensionPath = path.join(__dirname, 'ublock');
    if (app.isPackaged) extensionPath = extensionPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    const extension = await this.session.extensions.loadExtension(extensionPath);
    this.extensionId = extension.id;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const background = webContents.getAllWebContents().find(wc => wc.session === this.session
        && wc.getType() === 'backgroundPage' && wc.getURL().startsWith(`chrome-extension://${extension.id}/`));
      if (background && !background.isLoading()) {
        // uBO restarts its background page on first install/version changes.
        // Electron may leave executeJavaScript pending when that context dies.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const ready = await Promise.race([
          background.mainFrame.executeJavaScript("import('./js/background.js').then(m => m.default.readyToFilter)").catch(() => false),
          new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 250); }),
        ]);
        clearTimeout(timer);
        if (ready) return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('uBlock Origin could not start. Reload this tab to try again.');
  }
  private installHost(): void {
    this.host = new ElectronChromeExtensions({ ...this.callbacks, session: this.session, license: 'GPL-3.0' });
    // Replace the library's registration by its actual returned ID, keeping
    // one preload and using our packaged header/CSS compatibility adapter.
    for (const script of this.session.getPreloadScripts()) {
      if (script.type === 'frame' && path.basename(script.filePath) === 'chrome-extension-api.preload.js') {
        this.session.unregisterPreloadScript(script.id);
      }
    }
    this.session.registerPreloadScript({ id: 'setdown-ubo-preload', type: 'frame', filePath: path.join(__dirname, 'chrome-extension-api.preload.cjs') });
    ipcMain.handle('browser:extension-css', async (event, id: unknown, raw: unknown, remove: unknown) => {
      if (event.sender.session !== this.session || !this.extensionId
        || !event.senderFrame?.url.startsWith(`chrome-extension://${this.extensionId}/`)) throw Error('Unknown extension sender.');
      const target = typeof id === 'number' ? this.tab(id) : undefined;
      const details = raw as { code?: unknown; frameId?: unknown; allFrames?: unknown } | null;
      if (!target || !details || typeof details.code !== 'string' || details.code.length > 4_000_000) return;
      const frames = target.mainFrame.framesInSubtree.filter(frame => details.allFrames === true
        || (details.frameId === undefined || details.frameId === 0 ? frame === target.mainFrame : frame.frameTreeNodeId === details.frameId));
      await Promise.all(frames.map(frame => this.applyCSS(frame, details.code as string, remove === true)));
    });
    ipcMain.on('browser:css-result', (event, id: unknown, error: unknown) => {
      if (typeof id !== 'string') return;
      const pending = this.pending.get(id);
      if (pending && event.senderFrame === pending.frame) pending.done(typeof error === 'string' ? error : undefined);
    });
  }
  private applyCSS(frame: WebFrameMain, code: string, remove: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => done('The page frame did not accept its styles.'), 5000);
      const done = (error?: string) => {
        clearTimeout(timer); this.pending.delete(id);
        if (error) reject(new Error(error)); else resolve();
      };
      this.pending.set(id, { frame, done });
      try { frame.send('browser:css', { id, code, remove }); } catch { done(); }
    });
  }
}
