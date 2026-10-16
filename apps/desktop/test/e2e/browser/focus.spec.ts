import { expect, test } from '@playwright/test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { nativeInput } from '../../support/electron/native-input';
const execFile = promisify(execFileCallback);

import { fixture } from '../../support/browser/browser-fixture';

for (const split of [false, true]) test(`native address click owns keyboard focus with inactive split=${split}`, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const webTab = f.page.getByRole('tab', { name: /Research page/ });
    await expect(webTab).toBeVisible();
    if (split) {
      const data = await f.page.evaluateHandle(() => new DataTransfer());
      await webTab.dispatchEvent('dragstart', { dataTransfer: data });
      const body = f.page.locator('.group-body').first(), box = (await body.boundingBox())!;
      const point = { clientX: box.x + box.width * .98, clientY: box.y + box.height / 2, dataTransfer: data };
      await body.dispatchEvent('dragover', point); await body.dispatchEvent('drop', point);
      await webTab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
      await expect(f.page.locator('.location-bar')).toHaveCount(2);
      await f.page.getByRole('tab', { name: /notes.md/ }).click();
    } else {
      await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.focus(), f.origin);
    }
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true }).last();
    const box = (await address.boundingBox())!;
    const point = await f.app.evaluate(({ BrowserWindow }, box) => {
      const window = BrowserWindow.getAllWindows()[0], bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor();
      return { x: bounds.x + (box.x + box.width / 2) * zoom, y: bounds.y + (box.y + box.height / 2) * zoom };
    }, box);
    await nativeInput({ click: point });
    await expect(address).toBeFocused();
    // Let activation, Places results, and native overlay visibility settle.
    await f.page.waitForTimeout(500);
    await f.page.screenshot({ path: test.info().outputPath('address-native-focus.png') });
    expect(await f.page.evaluate(() => document.hasFocus())).toBe(true);
    const nativeFocus = await f.app.evaluate(({ BrowserWindow, webContents }) => ({
      focused: webContents.getFocusedWebContents()?.getURL(),
      windows: BrowserWindow.getAllWindows().map(window => ({ id: window.webContents.id, url: window.webContents.getURL(), visible: window.isVisible() })),
      owner: webContents.getFocusedWebContents()?.id === BrowserWindow.getAllWindows()[0].webContents.id,
    }));
    await test.info().attach('native-focus.json', { body: JSON.stringify(nativeFocus), contentType: 'application/json' });
    await nativeInput({ text: 'keyboardworks' });
    await expect(address).toHaveValue('keyboardworks');
    expect(nativeFocus.owner).toBe(true);
    expect(await f.page.evaluate(() => document.hasFocus())).toBe(true);
  } finally { await f.dispose(); }
});

test('mouse-focused address edits survive empty suggestions and keep typing, caret and composition', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await f.page.evaluate(url => window.marktex.browser.bookmark(url, 'Address editing fixture', true), `${f.origin}/first`);
    await f.app.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!.focus(), f.origin);
    const address = f.page.getByRole('textbox', { name: 'Address or file path', exact: true });
    const input = (await address.boundingBox())!;
    const point = await f.app.evaluate(({ BrowserWindow }, rect) => {
      const owner = BrowserWindow.getAllWindows()[0], bounds = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
      return { x: Math.round(bounds.x + (rect.x + rect.width / 2) * zoom), y: Math.round(bounds.y + (rect.y + rect.height / 2) * zoom) };
    }, input);
    if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1' || !process.env.DISPLAY) throw Error('Native address click requires isolated Xvfb.');
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
`, String(point.x), String(point.y)]);
    await expect(address).toBeFocused();
    expect(await address.evaluate((input: HTMLInputElement) => input.selectionStart === 0 && input.selectionEnd === input.value.length)).toBe(true);
    await expect.poll(() => f.app.windows().some(page => page.url().includes('location-overlay=1'))).toBe(true);
    const popup = f.app.windows().find(page => page.url().includes('location-overlay=1'))!;
    // Native title updates can replace a bookmark's label; its URL is the
    // stable identity of the matching row needed for this input regression.
    const suggestion = popup.getByRole('option').filter({ hasText: `${f.origin}/first` });
    await expect(suggestion).toBeVisible();
    // Each character spans the actual Places debounce: the first unmatched
    // character closes an already-open popup while the same edit continues.
    const query = 'no-history-match-928471';
    await address.pressSequentially(query, { delay: 140 });
    await expect(address).toHaveValue(query); await expect(address).toBeFocused();
    expect(await address.evaluate((input: HTMLInputElement) => ({ start: input.selectionStart, end: input.selectionEnd }))).toEqual({ start: query.length, end: query.length });
    await expect.poll(() => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.some(view =>
      'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().includes('location-overlay=1') && view.getVisible()))).toBe(false);
    await address.press('Home'); await address.pressSequentially('kept-', { delay: 140 });
    await expect(address).toHaveValue(`kept-${query}`);
    await address.press('Control+a'); await address.pressSequentially(f.origin, { delay: 140 });
    await expect(address).toHaveValue(f.origin);
    await expect(suggestion).toBeVisible();
    const cdp = await f.app.context().newCDPSession(f.page);
    await address.press('Control+a');
    await cdp.send('Input.imeSetComposition', { text: '한글', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '한글' }); await cdp.detach();
    await expect(address).toHaveValue('한글'); await expect(address).toBeFocused();
    await address.press('Escape'); await expect(address).toHaveValue(`${f.origin}/first`);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('new web tabs take selection without selecting the address, including after a stale native focus event', async () => {
  const f = await fixture();
  try {
    await expect(f.page.getByRole('tab', { name: /notes.md/ })).toBeVisible();
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const previous = f.page.getByRole('tab', { name: /Research page/ });
    await expect(previous).toHaveAttribute('aria-selected', 'true');
    const previousId = (await previous.getAttribute('data-tab-id'))!;
    await f.page.getByRole('button', { name: 'New web tab', exact: true }).click();
    const blank = f.page.getByRole('tab', { name: /Google/ });
    await expect(blank).toHaveAttribute('aria-selected', 'true');
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    await expect(address).not.toBeFocused();
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
    const blankId = (await blank.getAttribute('data-tab-id'))!;
    // Native focus can already be in flight when a visible page is hidden.
    const received = await f.page.evaluateHandle(id => {
      const state = { received: false };
      const unsubscribe = window.marktex.browser.onEvent(event => {
        if (event.type !== 'focus' || event.id !== id) return;
        unsubscribe(); requestAnimationFrame(() => { state.received = true; });
      });
      return state;
    }, previousId);
    await f.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0].webContents.send('browser:event', { type: 'focus', id }), previousId);
    await expect.poll(() => received.evaluate(state => state.received)).toBe(true);
    await received.dispose();
    await expect(blank).toHaveAttribute('aria-selected', 'true');
    await previous.click();
    await f.page.keyboard.press('Control+t');
    // Each new tab spawns a renderer process and navigates; on a loaded
    // headless machine that exceeds Playwright's default 5s expect budget.
    await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveCount(2, { timeout: 15_000 });
    const selected = f.page.locator('.document-tab[aria-selected="true"]');
    await expect(selected).toContainText('Google', { timeout: 15_000 });
    expect(await selected.getAttribute('data-tab-id')).not.toBe(blankId);
    await expect(address).not.toBeFocused();
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
    await f.page.keyboard.press('Control+l');
    await expect(address).toBeFocused();
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === 0
      && (input as HTMLInputElement).selectionEnd === (input as HTMLInputElement).value.length)).toBe(true);
    await f.page.keyboard.press('Control+t');
    await expect(f.page.getByRole('tab', { name: /Google/ })).toHaveCount(3, { timeout: 15_000 });
    await expect(address).not.toBeFocused();
    expect(await address.evaluate(input => (input as HTMLInputElement).selectionStart === (input as HTMLInputElement).selectionEnd)).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('address focus selects the whole URL for mouse, keyboard, and native page shortcuts', async () => {
  const f = await fixture();
  try {
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    const selected = () => address.evaluate(input => {
      const value = input as HTMLInputElement;
      return value.selectionStart === 0 && value.selectionEnd === value.value.length;
    });
    await expect(address).not.toBeFocused();
    await address.click();
    expect(await selected()).toBe(true);
    await f.page.keyboard.type('replacement');
    await expect(address).toHaveValue('replacement');
    await address.fill(`${f.origin}/first`); await address.press('Enter');
    await expect(f.page.locator('.document-tab[aria-selected="true"]')).toContainText('Research page');
    await f.app.evaluate(({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/first`)!;
      page.focus(); page.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: ['control'] });
      page.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: ['control'] });
    }, f.origin);
    await expect(address).toBeFocused();
    expect(await selected()).toBe(true);
    await f.page.keyboard.type('fresh input');
    await expect(address).toHaveValue('fresh input');
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

