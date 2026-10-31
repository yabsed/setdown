import { expect, test } from '@playwright/test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
import { nativeInput } from '../../support/electron/native-input';
import { writeFile } from 'node:fs/promises';

for (const moving of ['web', 'terminal'] as const)
test(`overlapping windows accept repeated ${moving} body drops and clear a remote cancellation`, async () => {
  test.setTimeout(90_000);
  const f = await fixture();
  const pages = [f.page];
  f.app.on('window', page => page.on('pageerror', error => f.errors.push(error.message)));
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    if (moving === 'web') await f.page.locator('.new-terminal-tab-button').click();
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-new-window')!.click());
    // Native web/preview children also emit Electron's window event. Select the
    // new application shell, not an asynchronously created spare page.
    const shells = async () => (await Promise.all(f.app.windows().filter(page => page.url() === f.page.url()).map(async page =>
      await page.locator('.shell').count().catch(() => 0) ? page : null))).filter(page => page !== null);
    await expect.poll(async () => (await shells()).length).toBe(2);
    const other = (await shells()).find(page => page !== f.page)!; pages.push(other);
    await other.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    await expect(other.getByRole('tab', { name: /Second page/ })).toBeVisible();
    if (moving === 'web') {
      await other.locator('.new-terminal-tab-button').click();
      await other.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
      await expect(other.getByRole('tab', { name: /Research page/ })).toBeVisible();
    } else await other.locator('.new-terminal-tab-button').click();
    const selected = other.locator('.document-tab[aria-selected="true"]');
    const id = (await selected.getAttribute('data-tab-id'))!;
    await other.getByRole('button', { name: moving === 'web' ? 'Zoom website in' : 'Zoom terminal in', exact: true }).click({ clickCount: 2 });
    const nativePage = moving === 'web' ? await f.app.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === `${origin}/first`)!;
      await page.executeJavaScript('window.keptDragDraft = "SAME_LIVE_PAGE"'); return page.id;
    }, f.origin) : null;
    if (moving === 'terminal') await other.locator('.terminal-content:not(.inactive) .xterm-helper-textarea').pressSequentially('keep-this-unsubmitted');
    const windows = await Promise.all(pages.map(page => f.app.browserWindow(page)));
    await f.app.evaluate(({ webContents, ipcMain, WebContentsView }) => {
      const events: unknown[] = []; (globalThis as any).nativeDragTrace = events;
      for (const contents of webContents.getAllWebContents()) {
        contents.on('before-mouse-event', (_event, mouse) => { if (mouse.type !== 'mouseMove') events.push({ at: Date.now(), id: contents.id, mouse }); });
        contents.on('before-input-event', (_event, input) => { if (input.key === 'Escape') events.push({ at: Date.now(), id: contents.id, input }); });
        const send = contents.send.bind(contents);
        contents.send = (channel, ...args) => { if (channel === 'tabs:drag-state') events.push({ at: Date.now(), id: contents.id, channel, value: args[0] }); return send(channel, ...args); };
      }
      for (const channel of ['browser:tab-drag-input', 'tabs:drag-target', 'tabs:register-transfer', 'tabs:detach-to-window', 'tabs:cancel-transfer']) ipcMain.on(channel, (event, value) => events.push({ at: Date.now(), id: event.sender.id, channel, value }));
      const visible = WebContentsView.prototype.setVisible;
      WebContentsView.prototype.setVisible = function(value) { events.push({ at: Date.now(), id: this.webContents.id, visible: value }); return visible.call(this, value); };
    });
    for (let i = 0; i < windows.length; i++) {
      await windows[i].evaluate((window, i) => { window.setBounds({ x: i ? 850 : 100, y: i ? 130 : 100, width: 1000, height: 800 }); window.show(); }, i);
      await pages[i].evaluate(() => {
        const events: unknown[] = []; (globalThis as any).transferDragEvents = events;
        for (const type of ['dragstart', 'dragover', 'dragleave', 'drop', 'dragend']) window.addEventListener(type, event => {
          const e = event as DragEvent;
          events.push({ at: Date.now(), type, target: (e.target as Element | null)?.className, trusted: e.isTrusted, x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY,
            types: Array.from(e.dataTransfer?.types ?? []), effect: e.dataTransfer?.dropEffect, buttons: e.buttons, button: e.button,
            token: type === 'drop' ? e.dataTransfer?.getData('application/x-setdown-tab') : undefined });
        }, true);
      });
    }
    let owner = 1;
    for (let round = 0; round < 7; round++) {
      const destination = 1 - owner, canceled = round === 3;
      await windows[owner].evaluate(window => { window.focus(); window.webContents.focus(); });
      const tab = pages[owner].locator(`[data-tab-id="${id}"]`);
      const box = (await tab.boundingBox())!, body = (await pages[destination].locator('.group-body').boundingBox())!;
      // After Escape the next drag starts in the same tab. Use a distinct grab
      // point so X11 does not interpret the rapid press as a double-click.
      const from = await windows[owner].evaluate((window, { box, round }) => { const b = window.getContentBounds(), z = window.webContents.getZoomFactor();
        return { x: b.x + (box.x + 35 + (round % 2) * 30) * z, y: b.y + (box.y + 15) * z }; }, { box, round });
      const to = await windows[destination].evaluate((window, { body, destination }) => { const b = window.getContentBounds(), z = window.webContents.getZoomFactor();
        return { x: b.x + (body.x + body.width * (destination ? .85 : .2)) * z, y: b.y + (body.y + body.height * .45) * z }; }, { body, destination });
      await nativeInput({ pointer: [from], button: 'down' });
      await nativeInput({ pointer: [{ x: from.x + 20, y: from.y + 15 }, { x: from.x + 20, y: to.y }, to] });
      await expect(pages[destination].locator('.group-drop-overlay')).toBeVisible();
      if (canceled) await nativeInput({ keys: ['Escape'] });
      await nativeInput({ button: 'up' });
      if (!canceled) {
        await expect(pages[destination].locator(`[data-tab-id="${id}"]`)).toBeVisible();
        await expect(tab).toHaveCount(0); owner = destination;
        await expect(pages[owner].getByRole('button', { name: moving === 'web' ? 'Reset website zoom' : 'Reset terminal zoom', exact: true })).toHaveText('120%');
      } else await expect(tab).toBeVisible();
      for (const page of pages) {
        await expect(page.locator('.group-drop-overlay')).toBeHidden();
        await expect(page.locator('.tab-drop-indicator')).toBeHidden();
        await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
      }
      expect(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
    }
    if (nativePage) expect(await f.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.keptDragDraft'), nativePage)).toBe('SAME_LIVE_PAGE');
    if (moving === 'terminal') await expect(pages[owner].locator('.xterm-rows')).toContainText('keep-this-unsubmitted');
    for (const window of windows) await window.dispose();
    expect(f.errors).toEqual([]);
  } finally {
    await writeFile(test.info().outputPath('native-drag-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).nativeDragTrace ?? null), null, 2));
    await writeFile(test.info().outputPath('native-windows.json'), JSON.stringify(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), url: window.webContents.getURL(), loading: window.webContents.isLoadingMainFrame() }))), null, 2));
    await nativeInput({ keys: ['Escape'], button: 'up' });
    for (const [i, page] of pages.entries()) {
      await writeFile(test.info().outputPath(`window-${i}-drag-events.json`), JSON.stringify(await page.evaluate(() => (globalThis as any).transferDragEvents ?? null).catch(() => null), null, 2));
      await page.screenshot({ path: test.info().outputPath(`window-${i}.png`) }).catch(() => {});
    }
    await f.dispose();
  }
});

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

test('a popup moved to another window survives closing its original window', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await evaluatePage(f.app, f.origin, `
      window.child = window.open('about:blank');
      child.document.title = 'Transferred popup';
      child.document.body.innerHTML = '<input id="draft">';
      child.document.querySelector('#draft').value = 'Keep this draft';
      child.keptObject = { value: 42 };
      true;
    `);
    const popup = f.page.getByRole('tab', { name: /Transferred popup/ });
    await expect(popup).toBeVisible();
    const contentsId = await f.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(wc => wc.getTitle() === 'Transferred popup')!.id);
    const destinationReady = f.app.waitForEvent('window');
    await popup.evaluate(element => {
      const dataTransfer = new DataTransfer();
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer, screenX: 600, screenY: 400 }));
      element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer, relatedTarget: null }));
      element.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer, screenX: 600, screenY: 400 }));
    });
    const destination = await destinationReady;
    const transferred = destination.getByRole('tab', { name: /Transferred popup/ });
    await expect(transferred).toBeVisible();
    await expect(popup).toHaveCount(0);
    expect(await evaluatePage(f.app, f.origin, 'child.opener === window')).toBe(true);
    const sourceWindow = await f.app.browserWindow(f.page);
    const closed = f.page.waitForEvent('close');
    await sourceWindow.evaluate(window => window.close());
    await closed;
    await sourceWindow.dispose();
    await expect(transferred).toBeVisible();
    expect(await f.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript(
      '({ draft: document.querySelector("#draft").value, value: keptObject.value, openerDetached: opener === null })'), contentsId))
      .toEqual({ draft: 'Keep this draft', value: 42, openerDetached: true });
    await transferred.locator('.tab-close').click();
    await expect(transferred).toHaveCount(0);
    await expect.poll(() => f.app.evaluate(({ webContents }, id) => !!webContents.fromId(id), contentsId)).toBe(false);
    expect(f.errors).toEqual([]);
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

