import { expect, test } from '@playwright/test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);

import { fixture, evaluatePage } from '../../support/browser/browser-fixture';

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
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
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

