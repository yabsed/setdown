import { expect, test } from '@playwright/test';
import { fixture, evaluatePage, findOverlay, findOverlayVisible } from '../../support/browser/browser-fixture';
import { nativeInput } from '../../support/electron/native-input';

async function openFromPage(f: Awaited<ReturnType<typeof fixture>>) {
  await f.app.evaluate(({ webContents }, origin) => {
    const wc = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(origin))!;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'f', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'f', modifiers: ['control'] });
  }, f.origin);
  const panel = await findOverlay(f.app);
  await expect(panel.getByRole('textbox', { name: 'Find in web page' })).toBeFocused();
  await expect.poll(() => findOverlayVisible(f.app)).toBe(true);
  return panel;
}

// CDP locator.press bypasses Electron's before-input-event. Use the native
// focused target for shortcuts owned by main, as real keyboard input does.
async function panelShortcut(f: Awaited<ReturnType<typeof fixture>>, key: string) {
  await f.app.evaluate(({ webContents }, key) => {
    const wc = webContents.getFocusedWebContents();
    if (!wc?.getURL().includes('browser-find-overlay=1')) throw Error('Search panel lost native focus');
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['control'] });
  }, key);
}

test('browser page find floats above the unchanged live page with counts, native controls and IME-safe Escape', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await expect(f.page.getByRole('button', { name: 'Reload page', exact: true })).toBeVisible();
    await evaluatePage(f.app, f.origin, `document.body.insertAdjacentHTML('beforeend','<p>needle needle 검색 검색</p>');document.querySelector('#draft').value='unsaved';document.querySelector('#draft').focus();true`);
    await f.app.evaluate(({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(origin))!; wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    }, f.origin);
    await expect(f.page.getByRole('button', { name: 'Enter reader mode', exact: true })).toBeVisible();
    expect(await evaluatePage(f.app, f.origin, 'document.activeElement.id')).toBe('draft');
    const geometry = () => f.app.evaluate(({ BrowserWindow }, origin) => {
      const owner = BrowserWindow.getAllWindows()[0];
      const page = owner.contentView.children.find(view => 'webContents' in view
        && (view as Electron.WebContentsView).webContents.getURL().startsWith(origin)) as Electron.WebContentsView;
      return { id: page.webContents.id, bounds: page.getBounds(), visible: page.getVisible() };
    }, f.origin);
    const before = await geometry();
    const address = f.page.getByRole('textbox', { name: 'Address or file path' });
    const addressBefore = await address.boundingBox();
    const panel = await openFromPage(f);
    panel.on('pageerror', error => f.errors.push(String(error)));
    const finder = panel.getByRole('textbox', { name: 'Find in web page' }), count = panel.locator('.find-count');
    await nativeInput({ text: 'needle' });
    await expect(count).toHaveText('1 / 2');
    await panelShortcut(f, 'f');
    await expect.poll(() => finder.evaluate(element => { const input = element as HTMLInputElement; return [input.selectionStart, input.selectionEnd]; })).toEqual([0, 6]);
    await expect(address).toHaveValue(`${f.origin}/first`);
    expect(await address.boundingBox()).toEqual(addressBefore);
    expect(await geometry()).toEqual(before);
    const next = panel.getByRole('button', { name: 'Next match', exact: true });
    const point = await f.app.evaluate(({ BrowserWindow }, rect) => {
      const owner = BrowserWindow.getAllWindows()[0], root = owner.getContentBounds();
      const overlay = owner.contentView.children.find(view => 'webContents' in view
        && (view as Electron.WebContentsView).webContents.getURL().includes('browser-find-overlay=1')) as Electron.WebContentsView;
      const bounds = overlay.getBounds(), zoom = overlay.webContents.getZoomFactor();
      return { x: root.x + bounds.x + (rect!.x + rect!.width / 2) * zoom, y: root.y + bounds.y + (rect!.y + rect!.height / 2) * zoom };
    }, await next.boundingBox());
    await nativeInput({ click: point }); await expect(count).toHaveText('2 / 2');
    await panel.getByRole('button', { name: 'Previous match', exact: true }).click(); await expect(count).toHaveText('1 / 2');
    await finder.press('Shift+Enter'); await expect(count).toHaveText('2 / 2');
    await finder.press('Enter'); await expect(count).toHaveText('1 / 2');
    await finder.fill('absent'); await expect(count).toHaveText('0 / 0');
    await finder.fill('needle'); await finder.fill(''); await expect(count).toHaveText('0 / 0');
    await finder.dispatchEvent('compositionstart'); await finder.fill('검색');
    await finder.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
    expect(await findOverlayVisible(f.app)).toBe(true);
    await expect(count).toHaveText('0 / 0');
    await finder.dispatchEvent('compositionend', { data: '검색' }); await expect(count).toHaveText('1 / 2');
    await panel.screenshot({ path: test.info().outputPath('web-find-light.png'), omitBackground: true });
    await f.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('preview-theme-one-dark')!.click());
    await expect(panel.locator('html')).toHaveAttribute('data-theme', 'one-dark');
    await expect(finder).toHaveValue('검색'); await expect(count).toHaveText('1 / 2');
    await panel.screenshot({ path: test.info().outputPath('web-find-dark.png'), omitBackground: true });
    await finder.press('Escape'); await expect.poll(() => findOverlayVisible(f.app)).toBe(false);
    await expect(f.page.getByRole('button', { name: 'Enter reader mode', exact: true })).toBeVisible();
    expect(await geometry()).toEqual(before);
    expect(await evaluatePage(f.app, f.origin, `document.querySelector('#draft').value`)).toBe('unsaved');
    await expect.poll(() => f.app.evaluate(({ webContents }, origin) =>
      webContents.getAllWebContents().find(wc => wc.getURL().startsWith(origin))!.isFocused(), f.origin)).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('web find follows tab lifetime and app zoom without changing page bounds', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
    const tab = f.page.getByRole('tab', { name: /Research page/ }); await expect(tab).toBeVisible();
    const panel = await openFromPage(f);
    const finder = panel.getByRole('textbox', { name: 'Find in web page' });
    await finder.fill('Next page'); await expect(panel.locator('.find-count')).toHaveText('1 / 1');
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    await expect.poll(() => findOverlayVisible(f.app)).toBe(false);
    await tab.click(); await expect.poll(() => findOverlayVisible(f.app)).toBe(true);
    const data = await f.page.evaluateHandle(() => new DataTransfer());
    await tab.dispatchEvent('dragstart', { dataTransfer: data });
    const body = (await f.page.locator('.group-body').first().boundingBox())!;
    const drop = { clientX: body.x + body.width * .98, clientY: body.y + body.height / 2, dataTransfer: data };
    await f.page.locator('.group-body').first().dispatchEvent('dragover', drop);
    await f.page.locator('.group-body').first().dispatchEvent('drop', drop);
    await tab.dispatchEvent('dragend', { dataTransfer: data }); await data.dispose();
    await expect(f.page.locator('.location-bar')).toHaveCount(2);
    await openFromPage(f);
    for (let step = 0; step < 3; step++) await panelShortcut(f, '=');
    await expect.poll(() => f.app.evaluate(({ webContents }) => webContents.getAllWebContents()
      .find(wc => wc.getURL().includes('browser-find-overlay=1'))!.getZoomFactor())).toBe(1.3);
    const bar = (await f.page.locator('.location-bar').last().boundingBox())!;
    const bounds = await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().includes('browser-find-overlay=1'))!.getBounds());
    expect(bounds.y).toBe(Math.round((bar.y + bar.height + 2) * 1.3));
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(Math.round((bar.x + bar.width) * 1.3));
    await panel.getByRole('button', { name: 'Close web search' }).click();
    await expect.poll(() => findOverlayVisible(f.app)).toBe(false);
    await openFromPage(f);
    await f.page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => findOverlayVisible(f.app)).toBe(false);
    await expect(f.page.getByRole('button', { name: 'Reload page', exact: true })).toBeVisible();
    await openFromPage(f);
    await panelShortcut(f, 'w');
    await expect.poll(() => findOverlayVisible(f.app)).toBe(false);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
