import { expect, test } from '@playwright/test';
import { fixture, captureNativeMenus, chooseNativeMenu, pageContextMenu } from '../../support/browser/browser-fixture';
import type { TestApplication } from '../../support/electron/electron-app';

const inspected = (app: TestApplication, url: string) => app.evaluate(({ webContents }, url) =>
  webContents.getAllWebContents().find(wc => wc.getURL() === url)!.isDevToolsOpened(), url);
const shellInspected = (app: TestApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.isDevToolsOpened()));
const key = (app: TestApplication, url: string, keyCode: string, modifiers: Array<'control' | 'shift'> = []) => app.evaluate(({ webContents }, input) => {
  const wc = webContents.getAllWebContents().find(wc => wc.getURL() === input.url)!;
  wc.sendInputEvent({ type: 'keyDown', keyCode: input.keyCode, modifiers: input.modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode: input.keyCode, modifiers: input.modifiers });
}, { url, keyCode, modifiers });

test('a web page has its own developer tools: Inspect, F12, Ctrl+Shift+I and the menu target the page, not the app', async () => {
  const f = await fixture(false);
  try {
    await captureNativeMenus(f.app);
    const url = `${f.origin}/first`;
    await f.page.evaluate(url => window.marktex.openLink(url), url);
    await expect(f.page.getByRole('tab', { name: /Research page/ })).toBeVisible();
    await expect.poll(() => f.page.evaluate(async () => (await window.marktex.browser.restore()).every(page => page.protection === 'ready'))).toBe(true);
    expect(await inspected(f.app, url)).toBe(false);
    const layers = () => f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).length);
    const before = await layers();
    await pageContextMenu(f.app, f.origin, '#draft');
    await chooseNativeMenu(f.app, ['Inspect']);
    await expect.poll(() => inspected(f.app, url)).toBe(true);
    // The tools open in their own window: no native layer is added to the workspace.
    await expect.poll(layers).toBe(before);
    await key(f.app, url, 'F12');
    await expect.poll(() => inspected(f.app, url)).toBe(false);
    await key(f.app, url, 'I', ['control', 'shift']);
    await expect.poll(() => inspected(f.app, url)).toBe(true);
    await key(f.app, url, 'I', ['control', 'shift']);
    await expect.poll(() => inspected(f.app, url)).toBe(false);
    // With a web tab active, the application menu inspects that page as well.
    const menu = await f.app.evaluate(({ Menu }) => ['menu-toggle-devtools', 'menu-toggle-devtools-f12', 'menu-toggle-app-devtools']
      .map(id => { const item = Menu.getApplicationMenu()!.getMenuItemById(id)!; return [item.label, item.accelerator, item.visible]; }));
    expect(menu).toEqual([['Toggle Developer Tools', 'CmdOrCtrl+Shift+I', true], ['Toggle Developer Tools', 'F12', false],
      ['Toggle App Developer Tools', 'CmdOrCtrl+Shift+Alt+I', true]]);
    await f.app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('menu-toggle-devtools')!;
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
    });
    await expect.poll(() => inspected(f.app, url)).toBe(true);
    expect(await shellInspected(f.app)).toBe(false);
    // Closing the tab closes its tools with it.
    const tools = await f.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.devToolsWebContents!.id, url);
    await f.page.getByRole('tab', { name: /Research page/ }).getByTitle('Close tab', { exact: true }).click();
    await expect.poll(() => f.app.evaluate(({ webContents }, id) => !!webContents.fromId(id), tools)).toBe(false);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});

test('a background tab whose developer tools are open is not put to sleep', async () => {
  test.setTimeout(100_000);
  const f = await fixture();
  try {
    const open = async (name: string) => {
      const url = `${f.origin}/memory-${name}`;
      await f.page.evaluate(url => window.marktex.openLink(url), url);
      await expect(f.page.getByRole('tab', { name: new RegExp(`memory-${name}`) })).toBeVisible();
      await expect.poll(() => f.app.context().pages().some(page => page.url() === url)).toBe(true);
      return { url, id: (await f.page.getByRole('tab', { name: new RegExp(`memory-${name}`) }).getAttribute('data-tab-id'))! };
    };
    const plain = await open('plain'), debugged = await open('debugged');
    await key(f.app, debugged.url, 'F12');
    await expect.poll(() => inspected(f.app, debugged.url)).toBe(true);
    await f.page.getByRole('tab', { name: /notes.md/ }).click();
    // The production grace period, as in the memory spec: no faked clock.
    await new Promise(resolve => setTimeout(resolve, 31_000));
    await f.page.evaluate(() => window.marktex.reclaimMemory!());
    await expect(f.page.locator(`[data-tab-id="${plain.id}"]`)).toHaveAttribute('data-sleeping', 'true');
    await expect(f.page.locator(`[data-tab-id="${debugged.id}"]`)).not.toHaveAttribute('data-sleeping', 'true');
    expect(await inspected(f.app, debugged.url)).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
