import { expect, test } from '@playwright/test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

test('native web tab drag into another window preserves the page and uses the indicated tab strip', async () => {
  const f = await fixture();
  try {
    if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native tab drag requires isolated Xvfb.');
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const sourceTab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(sourceTab).toBeVisible();
    const pageId = await f.app.evaluate(async ({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      await wc.executeJavaScript('document.querySelector("#draft").value = "KEEP_WEB_FORM"');
      return wc.id;
    }, f.origin);
    const created = f.app.waitForEvent('window');
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-window')!.click());
    const destination = await created;
    await expect(destination.locator('.shell')).toBeVisible();
    await destination.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    await expect(destination.getByRole('tab', { name: /Second page/ })).toBeVisible();
    const sourceNative = await f.app.browserWindow(f.page), destinationNative = await f.app.browserWindow(destination);
    await sourceNative.evaluate(window => { window.setBounds({ x: 0, y: 80, width: 800, height: 700 }); window.show(); });
    await destinationNative.evaluate(window => { window.setBounds({ x: 900, y: 80, width: 800, height: 700 }); window.show(); });
    await sourceNative.evaluate(window => { window.focus(); window.webContents.focus(); });
    const tabBox = (await sourceTab.boundingBox())!, stripBox = (await destination.locator('.tab-strip').boundingBox())!;
    const from = await sourceNative.evaluate((window, box) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: Math.round(bounds.x + (box.x + 35) * zoom), y: Math.round(bounds.y + (box.y + 15) * zoom) };
    }, tabBox);
    const to = await destinationNative.evaluate((window, box) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: Math.round(bounds.x + (box.x + box.width - 20) * zoom), y: Math.round(bounds.y + (box.y + 15) * zoom) };
    }, stripBox);
    await execFile('python3', ['-c', `
import ctypes, ctypes.util, sys, time
x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.restype=ctypes.c_void_p
x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
d=x.XOpenDisplay(None)
if not d: raise RuntimeError('No isolated X display')
sx,sy,tx,ty=map(int,sys.argv[1:])
def move(px,py):
 t.XTestFakeMotionEvent(d,-1,px,py,0); x.XFlush(d); time.sleep(.04)
move(sx,sy); t.XTestFakeButtonEvent(d,1,1,0); x.XFlush(d); time.sleep(.1)
for i in range(1,31): move(round(sx+(tx-sx)*i/30),round(sy+(ty-sy)*i/30))
time.sleep(.3); x.XCloseDisplay(d)
`, String(from.x), String(from.y), String(to.x), String(to.y)]);
    await expect(destination.locator('.tab-drop-indicator')).toBeVisible();
    await destination.screenshot({ path: test.info().outputPath('cross-window-drop-target.png') });
    // Release through XTest too: DOM dispatch cannot verify OS drag routing.
    await execFile('python3', ['-c', `
import ctypes, ctypes.util
x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.restype=ctypes.c_void_p; x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
d=x.XOpenDisplay(None); t.XTestFakeButtonEvent(d,1,0,0); x.XFlush(d); x.XCloseDisplay(d)
`]);
    await expect(destination.locator('.tab-name')).toHaveText(['Second page', 'Research page']);
    await expect(sourceTab).toHaveCount(0);
    expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
    expect(await f.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), pageId)).toBe('KEEP_WEB_FORM');
    await expect(destination.locator('.tab-drop-indicator')).toBeHidden();
    await sourceNative.dispose(); await destinationNative.dispose();
  } finally { await f.dispose(); }
});

test('moving a web tab to another window preserves its live page and enforces ownership', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const tab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(tab).toBeVisible();
    const id = (await tab.getAttribute('data-tab-id'))!;
    const contentsId = await f.app.evaluate(({webContents}, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.id, f.origin);
    await evaluatePage(f.app, f.origin, 'window.unsentDraft={value:42};true');
    const destinationReady = f.app.waitForEvent('window');
    await tab.evaluate(element => {
      const dataTransfer = new DataTransfer();
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer, screenX: 600, screenY: 400 }));
      element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer, relatedTarget: null }));
      element.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer, screenX: 600, screenY: 400 }));
    });
    const destination = await destinationReady;
    await expect(destination.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await expect(tab).toHaveCount(0);
    expect(await f.app.evaluate(async ({webContents}, id) => {
      const page = webContents.fromId(id)!;
      return { id: page.id, value: await page.executeJavaScript('window.unsentDraft.value') };
    }, contentsId)).toEqual({ id: contentsId, value: 42 });
    expect(await f.page.evaluate(async id => {
      try { await window.marktex.browser.command(id, 'reload'); return 'allowed'; }
      catch { return 'rejected'; }
    }, id)).toBe('rejected');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

