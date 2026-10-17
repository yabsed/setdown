import type { ElectronApplication, Locator } from '@playwright/test';

/** Chromium's mouse source synthesizes touchpad pinch gestures, including its
 * trusted Ctrl+wheel conversion. No Control key or DOM WheelEvent is injected. */
export async function pinch(application: ElectronApplication, scaleFactor: number, target?: Locator, urlPrefix = 'marktex-preview://document/') {
  const box = target ? await target.boundingBox() : null;
  if (target && !box) throw new Error('Pinch target is not visible');
  await application.evaluate(async ({ BrowserWindow }, { scaleFactor, point, urlPrefix }) => {
    const owner = BrowserWindow.getAllWindows().find(window => window.isVisible());
    if (!owner) throw new Error('No visible workspace');
    const view = point ? undefined : owner.contentView.children.find(view => view.getVisible() && 'webContents' in view
      && (view as Electron.WebContentsView).webContents.getURL().startsWith(urlPrefix));
    const contents = point ? owner.webContents : (view as Electron.WebContentsView | undefined)?.webContents;
    if (!contents) throw new Error('No visible pinch contents');
    contents.debugger.attach('1.3');
    try {
      await contents.debugger.sendCommand('Input.synthesizePinchGesture', {
        ...(point ?? { x: 180, y: 100 }), scaleFactor, relativeSpeed: 400, gestureSourceType: 'mouse',
      });
    } finally { contents.debugger.detach(); }
  }, { scaleFactor, point: box ? { x: box.x + box.width / 2, y: box.y + Math.min(100, box.height / 2) } : null, urlPrefix });
}
