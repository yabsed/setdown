import { expect, test } from '@playwright/test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
const execFile = promisify(execFileCallback);

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
import { nativeInput } from '../../support/electron/native-input';
import { waylandInput } from '../../support/electron/wayland-input';

test('fast right-edge drops split two live websites instead of tearing off a window', async () => {
  test.setTimeout(90_000);
  const compositor = process.env.SETDOWN_TEST_DISPLAY === 'xwayland' ? await waylandInput() : null;
  const input = compositor ? compositor.send : nativeInput;
  const f = await fixture(false).catch(async error => { await compositor?.close(); throw error; });
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/second`);
    const tab = f.page.getByRole('tab', { name: /Second page/ });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const owner = await f.app.browserWindow(f.page);
    await owner.evaluate(window => window.setBounds({ x: 0, y: 0, width: 1920, height: 1030 }));
    if (process.env.SETDOWN_TEST_DISPLAY === 'xwayland') {
      await owner.evaluate(window => window.maximize());
      await expect.poll(() => owner.evaluate(window => window.isMaximized())).toBe(true);
    }
    await f.app.evaluate(({ ipcMain, webContents, app }) => {
      (globalThis as any).rightDropTrace = [];
      const watch = (contents: Electron.WebContents) => contents.on('before-input-event', (_event, value) => {
        if (value.key === 'Escape') (globalThis as any).rightDropTrace.push({ at: Date.now(), contents: contents.id, key: value });
      });
      for (const contents of webContents.getAllWebContents()) watch(contents);
      app.on('web-contents-created', (_event, contents) => watch(contents));
      for (const channel of ['tab-drag-surface:event', 'tabs:drag-target', 'tabs:detach-to-window', 'browser:tab-drag-guide']) {
        ipcMain.on(channel, (_event, ...args) => (globalThis as any).rightDropTrace.push({ at: Date.now(), channel, args }));
      }
    });
    const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
    }, point);
    for (let round = 0; round < 12; round++) {
      if (round === 6) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
      const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
      const from = await toScreen({ x: box.x + 35 + round % 2 * 30, y: box.y + box.height / 2 });
      const center = await toScreen({ x: body.x + body.width / 2, y: body.y + body.height / 2 });
      const right = await toScreen({ x: body.x + body.width - (round % 2 ? 1 : 20), y: body.y + body.height / 2 });
      const windowBounds = await owner.evaluate(window => window.getBounds());
      await input({ pointer: [from], button: 'down' });
      await input({ pointer: [{ x: from.x + 20, y: from.y + 15 }, center] });
      expect(await owner.evaluate(window => window.getBounds())).toEqual(windowBounds);
      expect(await owner.evaluate(window => window.isResizable())).toBe(process.env.SETDOWN_TEST_DISPLAY === 'xwayland');
      if (process.env.SETDOWN_TEST_DISPLAY === 'xwayland') expect(await owner.evaluate(window => window.isMaximized())).toBe(true);
      // Release at the right edge immediately: waiting for the guide first
      // masks stale center/tear-off ownership in native event delivery.
      await input({ pointer: [right], pointerIntervalMs: 0, button: 'up' });
      await expect(f.page.locator('.editor-group'), `right-edge split, round ${round}`).toHaveCount(2);
      await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      expect(await owner.evaluate(window => window.isResizable())).toBe(true);
      expect((await tab.boundingBox())!.x).toBeGreaterThan(body.x + body.width * .45);
      // Return the tab for the next independent OS gesture.
      const data = await f.page.evaluateHandle(() => new DataTransfer());
      await tab.dispatchEvent('dragstart', { dataTransfer: data });
      const target = f.page.locator('.tab-strip').first(), strip = (await target.boundingBox())!;
      const point = { dataTransfer: data, clientX: strip.x + 10, clientY: strip.y + strip.height / 2 };
      await target.dispatchEvent('dragover', point); await target.dispatchEvent('drop', point);
      await data.dispose();
      await expect(f.page.locator('.editor-group')).toHaveCount(1);
    }
    for (const resizable of [true, false]) {
      await owner.evaluate((window, value) => window.setResizable(value), resizable);
      await f.app.evaluate(({ webContents }, resizable) => (globalThis as any).rightDropTrace.push({
        cancellation: resizable, focused: webContents.getFocusedWebContents()?.id,
      }), resizable);
      const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
      const from = await toScreen({ x: box.x + (resizable ? 40 : 95), y: box.y + box.height / 2 });
      await input({ pointer: [from], button: 'down' });
      await input({ pointer: [{ x: from.x + 20, y: from.y + 15 },
        await toScreen({ x: body.x + body.width - 1, y: body.y + body.height / 2 })] });
      await expect(f.page.locator('.group-drop-overlay')).toBeVisible();
      await input({ keys: ['Escape'] });
      await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
      await input({ button: 'up' });
      await expect(f.page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
      expect(await owner.evaluate(window => window.isResizable())).toBe(resizable);
      await expect(f.page.locator('.editor-group')).toHaveCount(1);
    }
    await owner.dispose();
  } finally {
    await writeFile(test.info().outputPath('right-drop-trace.json'), JSON.stringify(await f.app.evaluate(() => (globalThis as any).rightDropTrace), null, 2));
    await input({ keys: ['Escape'] }); await input({ button: 'up' });
    await f.dispose(); await compositor?.close();
  }
});

for (const zoomSteps of [0, 2]) test(`native split guide stays painted and accepts all four edges at app zoom step ${zoomSteps}`, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const tab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    for (let step = 0; step < zoomSteps; step++) await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
    const owner = await f.app.browserWindow(f.page);
    const toScreen = (point: { x: number; y: number }) => owner.evaluate((window, point) => {
      const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: bounds.x + point.x * zoom, y: bounds.y + point.y * zoom };
    }, point);
    const box = (await tab.boundingBox())!, body = (await f.page.locator('.group-body').boundingBox())!;
    const from = await toScreen({ x: box.x + 35, y: box.y + box.height / 2 });
    const edge = await toScreen({ x: body.x + body.width * .98, y: body.y + body.height / 2 });
    await nativeInput({ pointer: [from], button: 'down' });
    await nativeInput({ pointer: [{ x: from.x + 20, y: from.y + 15 }, edge] });
    await expect(f.page.locator('.group-drop-overlay')).toBeVisible();
    const receiver = f.app.windows().find(page => page.url().startsWith('data:text/html;charset=utf-8,'))!;
    await expect(receiver.locator('.guide')).toHaveCount(1);
    await receiver.evaluate(() => {
      const root = document.querySelector('#guides')!;
      (window as any).guideGaps = 0;
      const observer = new MutationObserver(() => {
        if (!root.childElementCount) (window as any).guideGaps++;
      });
      observer.observe(root, { childList: true });
      (window as any).guideObserver = observer;
      (window as any).guideFrames = [];
      const sample = () => {
        (window as any).guideFrames.push(root.childElementCount);
        (window as any).guideFrame = requestAnimationFrame(sample);
      };
      sample();
    });
    await nativeInput({ pointer: Array.from({ length: 60 }, (_, i) => ({ x: edge.x - i % 3, y: edge.y + i % 9 })), pointerIntervalMs: 16 });
    const paint = await receiver.evaluate(() => {
      cancelAnimationFrame((window as any).guideFrame);
      (window as any).guideObserver.disconnect();
      return { gaps: (window as any).guideGaps as number, frames: (window as any).guideFrames as number[] };
    });
    await writeFile(test.info().outputPath('guide-paint.json'), JSON.stringify(paint));
    expect(paint.frames.length).toBeGreaterThan(10);
    expect(paint.gaps, 'Repeated dragover must not remove the native guide between updates').toBe(0);
    expect(paint.frames.every(count => count === 1), 'Every sampled Chromium frame must retain the guide').toBe(true);
    const overlay = f.page.locator('.group-drop-overlay');
    for (const direction of ['left', 'up', 'down', 'right'] as const) {
      const center = { x: body.x + body.width / 2, y: body.y + body.height / 2 };
      await nativeInput({ pointer: [await toScreen(center)] });
      await expect(overlay).toBeHidden();
      await expect(receiver.locator('.guide')).toHaveCount(0);
      const horizontal = direction === 'left' || direction === 'right';
      const start = direction === 'left' || direction === 'up';
      const point = { ...center, ...(horizontal ? { x: body.x + body.width * (start ? .2 : .8) }
        : { y: body.y + body.height * (start ? .2 : .8) }) };
      await nativeInput({ pointer: [await toScreen(point)] });
      await expect(overlay).toBeVisible();
      await expect(receiver.locator('.guide')).toHaveCount(1);
      const guide = (await overlay.boundingBox())!;
      expect(guide.x).toBeCloseTo(body.x + (direction === 'right' ? body.width / 2 : 0), 0);
      expect(guide.y).toBeCloseTo(body.y + (direction === 'down' ? body.height / 2 : 0), 0);
      expect(guide.width).toBeCloseTo(body.width / (horizontal ? 2 : 1), 0);
      expect(guide.height).toBeCloseTo(body.height / (horizontal ? 1 : 2), 0);
      // Small movements around the activation boundary must retain the same
      // placement; the center above must still clear it before the next edge.
      for (const offset of [-2, 2, -1, 1]) {
        const jitter = { ...center, ...(horizontal ? { x: body.x + body.width * (start ? .25 : .75) + offset }
          : { y: body.y + body.height * (start ? .25 : .75) + offset }) };
        await nativeInput({ pointer: [await toScreen(jitter)] });
        await expect(overlay).toBeVisible();
        expect(await overlay.boundingBox()).toEqual(guide);
        await expect(receiver.locator('.guide')).toHaveCount(1);
      }
    }
    await receiver.screenshot({ path: test.info().outputPath('continuous-right-guide.png'), omitBackground: true });
    await nativeInput({ button: 'up' });
    await expect(f.page.locator('.editor-group')).toHaveCount(2);
    const moved = (await tab.boundingBox())!;
    expect(moved.x).toBeGreaterThan(body.x + body.width * .45);
    await expect(f.page.locator('.group-drop-overlay')).toBeHidden();
    expect(f.errors).toEqual([]);
    await owner.dispose();
  } finally { await nativeInput({ keys: ['Escape'], button: 'up' }); await f.dispose(); }
});

for (const right of ['markdown', 'reader', 'web'] as const) test(`address suggestions preserve live video beside ${right}`, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const tab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(tab).toBeVisible();
    const data = await f.page.evaluateHandle(() => new DataTransfer());
    await tab.dispatchEvent('dragstart', { dataTransfer: data });
    const body = f.page.locator('.group-body').first(), bounds = (await body.boundingBox())!;
    const point = { clientX: bounds.x + bounds.width * .02, clientY: bounds.y + bounds.height / 2, dataTransfer: data };
    await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
    await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
    await expect(f.page.locator('.location-bar')).toHaveCount(2);
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).last();
    if (right !== 'markdown') {
      await address.fill(`${f.origin}/article`); await address.press('Enter');
      await expect(f.page.getByRole('tab', { name: /Long article/ })).toBeVisible();
      if (right === 'reader') await f.page.getByRole('button', { name: 'Enter reader mode', exact: true }).last().click();
    }
    await f.page.evaluate(url => window.marktex.browser.bookmark(url, 'Chosen destination', true), `${f.origin}/second`);
    await evaluatePage(f.app, `${f.origin}/first`, `(() => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d'); let frame = 0;
      setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 640, 480); }, 50);
      const video = document.createElement('video'); video.muted = true;
      video.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:fill';
      video.srcObject = canvas.captureStream(20); document.body.append(video);
      window.presentedFrames = 0;
      const count = () => { window.presentedFrames++; video.requestVideoFrameCallback(count); };
      video.requestVideoFrameCallback(count); return video.play();
    })()`);
    await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(3);
    const nativePages = () => f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().startsWith(origin))
      .map(view => ({ id: (view as Electron.WebContentsView).webContents.id, bounds: view.getBounds(), visible: view.getVisible() })), f.origin);
    if (right === 'web') {
      await f.page.evaluate(() => window.marktex.changeZoom(1, 'app'));
      await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeGreaterThan(1);
      await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const factor = await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
      const tops = await f.page.locator('.group-body').evaluateAll((nodes, factor) => nodes.map(node => Math.round(node.getBoundingClientRect().top * factor)), factor);
      await expect.poll(async () => (await nativePages()).map(page => page.bounds.y)).toEqual(tops);
    }
    const initialPages = await nativePages();
    // CDP fill does not transfer native WebContents focus. Establish the same
    // shell focus as an actual address click before testing popup attachment.
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.focus());
    await address.click(); await address.fill(f.origin);
    await expect.poll(() => f.app.windows().some(page => page.url().includes('location-overlay=1'))).toBe(true);
    const popup = f.app.windows().find(page => page.url().includes('location-overlay=1'))!;
    await expect(popup.getByRole('option', { name: /Chosen destination/ })).toBeVisible();
    // Give the real dropdown its normal presentation cycle before observing
    // frames; a paused video can still deliver its last queued callback.
    const before = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(before + 10);
    await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
    await expect(address).toBeFocused();
    expect(await nativePages()).toEqual(initialPages);
    // A trusted native popup must not steal the composing input or resize any
    // live web page. Exercise both composition and real native mouse routing.
    expect(await f.app.evaluate(({ BrowserWindow, webContents }) => webContents.getFocusedWebContents()?.id
      === BrowserWindow.getAllWindows()[0].webContents.id)).toBe(true);
    await address.evaluate(input => {
      (window as any).__addressIme = { starts: 0, ends: 0, blur: 0 };
      input.addEventListener('compositionstart', () => { (window as any).__addressIme.starts++; });
      input.addEventListener('compositionend', () => { (window as any).__addressIme.ends++; });
      input.addEventListener('blur', () => { (window as any).__addressIme.blur++; });
      window.addEventListener('blur', () => { (window as any).__addressIme.blur++; });
    });
    const cdp = await f.app.context().newCDPSession(f.page);
    await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
    await expect(address).toBeFocused();
    const composingFrame = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(composingFrame + 5);
    expect(await f.page.evaluate(() => (window as any).__addressIme)).toEqual({ starts: 1, ends: 0, blur: 0 });
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await cdp.detach();
    await address.fill(f.origin);
    const row = popup.getByRole('option', { name: /Chosen destination/ });
    await expect(row).toBeVisible();
    const rowBounds = (await row.boundingBox())!;
    const click = await f.app.evaluate(({ BrowserWindow }, point) => {
      const owner = BrowserWindow.getAllWindows()[0];
      const view = owner.contentView.children.find(view => 'webContents' in view
        && (view as Electron.WebContentsView).webContents.getURL().includes('location-overlay=1')) as Electron.WebContentsView;
      if (!view?.getVisible()) throw Error('Address dropdown is not natively visible');
      const root = owner.getContentBounds(), bounds = view.getBounds(), zoom = view.webContents.getZoomFactor();
      return { x: Math.round(root.x + bounds.x + (point.x + point.width / 2) * zoom),
        y: Math.round(root.y + bounds.y + (point.y + point.height / 2) * zoom) };
    }, rowBounds);
    if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native pointer input requires isolated Xvfb.');
    await execFile('python3', ['-c', `
import ctypes, ctypes.util, sys
x=ctypes.CDLL(ctypes.util.find_library('X11')); t=ctypes.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.restype=ctypes.c_void_p
x.XFlush.argtypes=[ctypes.c_void_p]; x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
d=x.XOpenDisplay(None)
if not d: raise RuntimeError('No isolated X display')
t.XTestFakeMotionEvent(d,-1,int(sys.argv[1]),int(sys.argv[2]),0)
t.XTestFakeButtonEvent(d,1,1,0); t.XTestFakeButtonEvent(d,1,0,0); x.XFlush(d); x.XCloseDisplay(d)
`, String(click.x), String(click.y)]);
    await expect(address).toHaveValue(`${f.origin}/second`);
    await expect(f.page.getByRole('tab', { name: /Second page/ })).toBeVisible();
    const afterChoice = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(afterChoice + 5);
    await address.click(); await address.fill(`${f.origin}/second`);
    const destination = popup.getByRole('option', { name: /Second page/ });
    await expect(destination).toBeVisible();
    await address.press('ArrowDown');
    await expect(destination).toHaveAttribute('aria-selected', 'true');
    await address.press('Escape');
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().includes('location-overlay=1')))).toBe(false);
    const leftAddress = f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).first();
    await leftAddress.fill(f.origin);
    await expect(popup.getByRole('option').first()).toBeVisible();
    const samePaneFrame = await evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, `${f.origin}/first`, 'window.presentedFrames')).toBeGreaterThan(samePaneFrame + 5);
    await expect(leftAddress).toBeFocused();
    await leftAddress.press('Escape');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('application menus preserve live video frames, playback and web view visibility', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
    await evaluatePage(f.app, f.origin, `(() => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d'); let frame = 0;
      setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#ff0000' : '#0000ff'; ctx.fillRect(0, 0, 640, 480); }, 50);
      const video = document.createElement('video'); video.id = 'live-video'; video.muted = true;
      video.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:fill';
      video.srcObject = canvas.captureStream(20); document.body.append(video);
      window.presentedFrames = 0;
      const count = () => { window.presentedFrames++; video.requestVideoFrameCallback(count); };
      video.requestVideoFrameCallback(count); return video.play();
    })()`);
    await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(3);
    await f.page.getByRole('button', { name: 'View', exact: true }).click();
    await expect.poll(() => f.app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
    const menu = f.app.windows().find(page => page.url().includes('menu-overlay=1'))!;
    await expect(menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true })).toBeVisible();
    const before = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(before + 5);
    expect(await evaluatePage(f.app, f.origin, 'document.querySelector("video").paused')).toBe(false);
    expect(await f.app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows()[0].contentView.children
      .some(view => view.getVisible() && 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === `${origin}/first`), f.origin)).toBe(true);
    await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
    await menu.getByRole('menuitem', { name: /^Theme/ }).hover();
    await expect(menu.getByRole('menuitemradio').first()).toBeVisible();
    const duringSubmenu = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(duringSubmenu + 5);
    await menu.screenshot({ path: test.info().outputPath('menu-layer.png'), omitBackground: true });
    await menu.keyboard.press('Escape');
    await expect(f.page.getByRole('button', { name: 'View', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await f.page.getByRole('button', { name: 'View', exact: true }).click();
    await expect(menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true }).click();
    await expect(f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await f.page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await f.page.getByRole('button', { name: 'Workspace folder', exact: true }).click();
    const folders = f.page.getByRole('menu', { name: 'Choose workspace folder' });
    await expect(folders).toBeVisible();
    const folderFrames = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
    await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(folderFrames + 5);
    await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
    await folders.press('Escape');
    await expect(folders).toBeHidden();

    // Real native toolbar input is essential: the icon strip loses native focus
    // before this click reaches the shell. CDP click alone misses that race.
    const owner = await f.app.browserWindow(f.page);
    const extensionButton = f.page.getByRole('button', { name: 'Extensions menu', exact: true });
    await f.app.evaluate(({ app }) => {
      (globalThis as any).__createdIconStrips = 0;
      app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
        if (contents.getURL().endsWith('/extension-panel.html')) (globalThis as any).__createdIconStrips++;
      }));
    });
    for (let cycle = 1; cycle <= 3; cycle++) {
      const button = (await extensionButton.boundingBox())!;
      const point = await owner.evaluate((window, button) => { const bounds = window.getContentBounds(), z = window.webContents.getZoomFactor();
        return { x: bounds.x + (button.x + button.width / 2) * z, y: bounds.y + (button.y + button.height / 2) * z }; }, button);
      await nativeInput({ click: point });
      const stripExists = () => f.app.evaluate(({ webContents }) => webContents.getAllWebContents().some(wc => wc.getURL().endsWith('/extension-panel.html')));
      await expect.poll(stripExists).toBe(true);
      const start = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
      await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(start + 5);
      await nativeInput({ click: point });
      await expect.poll(stripExists).toBe(false);
      expect(await f.app.evaluate(() => (globalThis as any).__createdIconStrips)).toBe(cycle);
    }
    for (const cancel of [true, false]) {
      const tab = (await f.page.getByRole('tab', { name: /Research page/ }).boundingBox())!;
      const body = (await f.page.locator('.group-body').boundingBox())!;
      const points = await owner.evaluate((window, { tab, body }) => {
        const bounds = window.getContentBounds(), z = window.webContents.getZoomFactor();
        return [{ x: bounds.x + (tab.x + 35) * z, y: bounds.y + (tab.y + 15) * z },
          { x: bounds.x + (body.x + body.width * .98) * z, y: bounds.y + (body.y + body.height / 2) * z }];
      }, { tab, body });
      await nativeInput({ pointer: [points[0]], button: 'down' });
      await nativeInput({ pointer: [{ x: points[0].x + 20, y: points[0].y + 15 }, points[1]] });
      await expect(f.page.locator('.group-drop-overlay')).toBeVisible();
      const draggingFrames = await evaluatePage<number>(f.app, f.origin, 'window.presentedFrames');
      await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.presentedFrames')).toBeGreaterThan(draggingFrames + 8);
      await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
      expect(await owner.evaluate((window, origin) => window.contentView.children.some((view: Electron.View) => view.getVisible()
        && 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL() === `${origin}/first`), f.origin)).toBe(true);
      if (cancel) await nativeInput({ keys: ['Escape'] });
      await nativeInput({ button: 'up' });
      await expect(f.page.locator('.editor-group')).toHaveCount(cancel ? 1 : 2);
      await expect(f.page.locator('.group-drop-overlay')).toBeHidden();
    }
    await owner.dispose();
    expect(await evaluatePage(f.app, f.origin, 'document.querySelector("video").paused')).toBe(false);
    expect(f.errors).toEqual([]);
  } finally { await nativeInput({ keys: ['Escape'], button: 'up' }); await f.dispose(); }
});

test('language sidebar leaves the native web page live and Escape belongs to its search', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toHaveAttribute('aria-selected', 'true');
    const identity = await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(c => c.getURL() === `${origin}/first`)!.id, f.origin);
    await evaluatePage(f.app, f.origin, `(() => {
      document.querySelector('#draft').value = 'Keep this draft'; window.sidebarFrames = 0; window.sidebarVisibilityChanges = 0;
      document.addEventListener('visibilitychange', () => window.sidebarVisibilityChanges++);
      const frame = () => { window.sidebarFrames++; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    })()`);
    await f.page.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await f.page.getByRole('button', { name: 'Language Support', exact: true }).click();
    const panel = f.page.getByRole('region', { name: 'Language Support', exact: true });
    await expect(panel.getByRole('searchbox')).toBeFocused();
    await panel.getByRole('searchbox').fill('anything');
    const before = await evaluatePage<number>(f.app, f.origin, 'window.sidebarFrames');
    await expect.poll(() => evaluatePage<number>(f.app, f.origin, 'window.sidebarFrames')).toBeGreaterThan(before + 5);
    await expect(f.page.locator('[data-browser-frozen]')).toHaveCount(0);
    await panel.getByRole('searchbox').press('Escape');
    await expect(panel.getByRole('searchbox')).toHaveValue('');
    await panel.getByRole('searchbox').press('Escape');
    await expect(panel).toHaveCount(0);
    expect(await f.app.evaluate(({ BrowserWindow }, id) => {
      const child = BrowserWindow.getAllWindows()[0].contentView.children.find(v => 'webContents' in v && (v as Electron.WebContentsView).webContents.id === id);
      return child?.getVisible();
    }, identity)).toBe(true);
    expect(await evaluatePage(f.app, f.origin, 'document.querySelector("#draft").value')).toBe('Keep this draft');
    expect(await evaluatePage(f.app, f.origin, 'window.sidebarVisibilityChanges')).toBe(0);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('website draggable CSS cannot consume home navigation input in web tab frames', async () => {
  const f = await fixture(false);
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/draggable`);
    await expect(f.page.getByRole('tab', { name: /Website draggable regions/ })).toHaveAttribute('aria-selected', 'true');
    const inspect = () => evaluatePage<{ width: number; rail: string; button: string; pseudo: string; frame: string }>(f.app, f.origin, `({
      width: innerWidth,
      rail: getComputedStyle(document.querySelector('.rail')).getPropertyValue('-webkit-app-region'),
      button: getComputedStyle(document.querySelector('#home')).getPropertyValue('-webkit-app-region'),
      pseudo: getComputedStyle(document.querySelector('.rail'), '::before').getPropertyValue('-webkit-app-region'),
      frame: getComputedStyle(document.querySelector('iframe').contentDocument.querySelector('#home')).getPropertyValue('-webkit-app-region')
    })`);
    await expect.poll(inspect).toEqual({ width: expect.any(Number), rail: 'no-drag', button: 'no-drag', pseudo: 'no-drag', frame: 'no-drag' });
    expect((await inspect()).width).toBeGreaterThan(800);
    const contents = await f.app.evaluateHandle(({ webContents }, origin) => webContents.getAllWebContents()
      .find(wc => wc.getURL().startsWith(origin))!, f.origin);
    await contents.evaluate(wc => {
      wc.focus();
      wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 32, y: 32 });
      wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 32, y: 32 });
    });
    await expect.poll(() => evaluatePage(f.app, f.origin, '({clicks:homeClicks,hash:location.hash})'))
      .toEqual({ clicks: 1, hash: '#home' });
    const point = await evaluatePage<{ x: number; y: number }>(f.app, f.origin, `(() => {
      const frame = document.querySelector('iframe'), region = frame.getBoundingClientRect();
      const button = frame.contentDocument.querySelector('#home').getBoundingClientRect();
      return { x: region.left + frame.clientLeft + button.left + button.width / 2,
        y: region.top + frame.clientTop + button.top + button.height / 2 };
    })()`);
    await contents.evaluate((wc, point) => {
      wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    }, point);
    await expect.poll(() => evaluatePage(f.app, f.origin, 'document.querySelector("iframe").contentWindow.homeClicks')).toBe(1);
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => evaluatePage(f.app, f.origin, 'homeClicks')).toBe(0);
    await expect.poll(inspect).toEqual({ width: expect.any(Number), rail: 'no-drag', button: 'no-drag', pseudo: 'no-drag', frame: 'no-drag' });
    await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(650, 820));
    await expect.poll(async () => (await inspect()).width).toBeLessThan(800);
    expect((await inspect()).button).toBe('no-drag');
    // A child navigation and a dynamically replaced frame must receive the
    // policy in their committed documents, including nested frame creation.
    const framePolicies = () => evaluatePage<string[]>(f.app, f.origin, `(() => {
      const read = doc => {
        const button = doc.querySelector('#home');
        return [button ? doc.defaultView.getComputedStyle(button).getPropertyValue('-webkit-app-region') : 'loading',
          ...Array.from(doc.querySelectorAll('iframe')).flatMap(frame => frame.contentDocument ? read(frame.contentDocument) : ['loading'])];
      };
      return read(document);
    })()`);
    await evaluatePage(f.app, f.origin, `document.querySelector('iframe').src = '/draggable'; true`);
    await expect.poll(framePolicies).toEqual(['no-drag', 'no-drag', 'no-drag']);
    await evaluatePage(f.app, f.origin, `(() => {
      const frame = document.createElement('iframe'); frame.src = '/draggable-frame';
      document.querySelector('iframe').replaceWith(frame); return true;
    })()`);
    await expect.poll(framePolicies).toEqual(['no-drag', 'no-drag']);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('tab widths stay stable when adding tabs and updating web page titles', async () => {
  const f = await fixture();
  try {
    const notes = f.page.getByRole('tab', { name: /notes.md/ });
    await expect(notes).toBeVisible();
    const originalWidth = (await notes.boundingBox())!.width;
    await f.page.getByRole('button', { name: 'New web tab', exact: true }).click();
    const web = f.page.locator('.document-tab[aria-selected="true"]');
    // New renderer process + navigation + title can exceed the default 5s
    // expect budget on a loaded headless machine; widths are asserted after.
    await expect(web).toContainText('Google', { timeout: 15_000 });
    const widths = () => f.page.locator('.document-tab').evaluateAll(tabs => tabs.map(tab => tab.getBoundingClientRect().width));
    const settled = await widths();
    expect(settled[0]).toBe(originalWidth);
    await evaluatePage(f.app, 'https://www.google.com/', 'document.title = "A much longer website title that should only change the text inside its tab"; true');
    await expect(web).toContainText('A much longer website title', { timeout: 15_000 });
    expect(await widths()).toEqual(settled);
    await evaluatePage(f.app, 'https://www.google.com/', 'document.title = "Google"; true');
    await expect(web).toContainText('Google', { timeout: 15_000 });
    expect(await widths()).toEqual(settled);
    await f.page.getByRole('button', { name: 'New document', exact: true }).click();
    await expect(f.page.locator('.document-tab')).toHaveCount(3);
    await expect(f.page.locator('.editor-surface')).toBeVisible();
    expect((await widths()).slice(0, 2)).toEqual(settled);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

