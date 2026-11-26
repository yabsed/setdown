import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WebContentsView } from 'electron';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../../support/electron/electron-app';
import { chooseNativeMenu } from '../../support/browser/browser-fixture';

/** A file two folders below a temporary HOME, opened as the only tab. */
async function launch(): Promise<{ root: string; home: string; alpha: string; file: string; app: TestApplication; page: Page }> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'setdown-location-links-')));
  const home = path.join(root, 'home'), alpha = path.join(home, 'Projects', 'alpha'), file = path.join(alpha, 'build.txt');
  await mkdir(path.join(alpha, 'notes'), { recursive: true });
  await writeFile(file, 'build notes\n');
  await writeFile(path.join(alpha, 'data.csv'), 'a,b\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, HOME: home, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'), SETDOWN_NATIVE_DIALOGS: '0' } });
  const page = await app.firstWindow();
  await focusApplication(app);
  await expect(page.getByRole('tab', { name: /build\.txt/ })).toHaveAttribute('aria-selected', 'true');
  return { root, home, alpha, file, app, page };
}
const bar = (page: Page) => page.locator('.editor-group.focused .location-bar');
const address = (page: Page) => bar(page).locator('input');
const links = (page: Page) => bar(page).locator('.location-links a');
const link = (page: Page, name: string) => links(page).filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
const list = (page: Page) => page.locator('.folder-content:not(.inactive) [data-folder-list]');
const labels = (page: Page) => list(page).locator('.folder-row .folder-label').allTextContents();
const selected = (page: Page) => list(page).locator('[role="option"][aria-selected="true"] .folder-label').allTextContents();
const tabs = (page: Page) => page.locator('.tab-strip .tab-name');
/** Where the last run of text in the address is: the name of the file or folder itself, which is not a link. */
const ownName = (page: Page) => bar(page).locator('.location-links').evaluate(element => {
  const range = document.createRange(); range.selectNodeContents([...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent).at(-1)!);
  const rect = range.getBoundingClientRect(); return { x: rect.right - 8, y: rect.top + rect.height / 2 };
});
/** The largest difference in any colour channel between two screenshots of one size. */
const difference = (app: TestApplication, first: Buffer, second: Buffer) => app.evaluate(({ nativeImage }, images) => {
  const [a, b] = images.map(image => nativeImage.createFromBuffer(Buffer.from(image, 'base64')).toBitmap());
  let worst = a.length === b.length ? 0 : 255;
  for (let index = 0; index < Math.min(a.length, b.length); index++) worst = Math.max(worst, Math.abs(a[index] - b[index]));
  return worst;
}, [first.toString('base64'), second.toString('base64')]);
const menuViews = (app: TestApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
  .filter(view => view.getVisible() && (view as WebContentsView).webContents.getURL().includes('menu-overlay=1')).length);

test('each folder in a file address is a link that takes the tab to that folder', async () => {
  const { root, home, alpha, file, app, page } = await launch();
  try {
    // The address reads as it always did; the folders above the file are links and the file is not.
    await expect(address(page)).toHaveValue(`file://${file}`);
    await expect(bar(page).locator('.location-links')).toHaveText(`file://${file}`, { useInnerText: true });
    await expect(links(page)).toHaveText(['/', ...alpha.split('/').filter(Boolean)]);
    // The links are drawn where the field draws its text: nothing moves when the address is edited. A glyph may
    // land on the neighbouring quarter pixel; text one pixel off would differ by its whole contrast.
    await page.mouse.move(5, 300);
    const field = bar(page).locator('.location-field');
    const linked = await field.screenshot();
    await field.evaluate(element => { element.classList.remove('linked'); element.querySelector<HTMLElement>('.location-links')!.style.visibility = 'hidden'; });
    const plain = await field.screenshot();
    await field.evaluate(element => { element.classList.add('linked'); element.querySelector<HTMLElement>('.location-links')!.style.visibility = ''; });
    expect(await difference(app, linked, plain)).toBeLessThan(96);
    await link(page, 'alpha').hover();
    await expect(link(page, 'alpha')).toHaveCSS('text-decoration-line', 'underline');
    await expect(link(page, 'alpha')).toHaveCSS('cursor', 'pointer');
    await bar(page).screenshot({ path: test.info().outputPath('hovered-link.png') });

    // The file's folder opens in the same tab with the file selected, and the file is one step Back.
    await link(page, 'alpha').click();
    await expect(page.getByRole('tab', { name: /alpha/ })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs(page)).toHaveCount(1);
    await expect.poll(() => labels(page)).toEqual(['notes', 'build.txt', 'data.csv']);
    await expect.poll(() => selected(page)).toEqual(['build.txt']);
    await expect(list(page)).toBeFocused();
    await expect(address(page)).toHaveValue(`file://${alpha}`);
    // A folder tab's address has the same links; its own folder is where it already is.
    await expect(links(page)).toHaveText(['/', ...path.dirname(alpha).split('/').filter(Boolean)]);
    await bar(page).getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('tab', { name: /build\.txt/ })).toHaveAttribute('aria-selected', 'true');
    await expect(address(page)).toHaveValue(`file://${file}`);

    // A folder further up selects the folder the way led through.
    await link(page, 'home').click();
    await expect.poll(() => labels(page)).toEqual(['Projects']);
    await expect.poll(() => selected(page)).toEqual(['Projects']);
    await expect(address(page)).toHaveValue(`file://${home}`);
    await page.keyboard.press('Enter');
    await expect.poll(() => labels(page)).toEqual(['alpha']);
    // The slash after the scheme is the filesystem root.
    await links(page).first().click();
    await expect(address(page)).toHaveValue('file:///');
    await expect.poll(() => selected(page)).toEqual([root.split('/').filter(Boolean)[0]]);
    await expect(links(page)).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(1);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('a folder link opens a new tab from a middle click, a Ctrl click or its menu', async () => {
  const { root, home, file, app, page } = await launch();
  try {
    await expect(links(page)).not.toHaveCount(0);
    await link(page, 'alpha').click({ button: 'middle' });
    await expect(tabs(page)).toHaveText(['build.txt', 'alpha']);
    await expect(page.getByRole('tab', { name: /alpha/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => selected(page)).toEqual(['build.txt']);
    await page.getByRole('tab', { name: /build\.txt/ }).click();
    await link(page, 'Projects').click({ modifiers: ['Control'] });
    await expect(tabs(page)).toHaveText(['build.txt', 'Projects', 'alpha']);
    await expect.poll(() => labels(page)).toEqual(['alpha']);
    await page.getByRole('tab', { name: /build\.txt/ }).click();
    await expect(address(page)).toHaveValue(`file://${file}`);

    // The menu opens at the link, in the native menu layer, and leaves the file's tab as it is.
    const open = async (name: string) => { await link(page, name).click({ button: 'right' }); await expect.poll(() => menuViews(app)).toBe(1); };
    await open('home');
    const menu = app.windows().find(window => window.url().includes('menu-overlay=1'))!;
    await expect(menu.getByRole('menuitem')).toHaveText(['Open in New Tab', 'Open to the Side', 'Copy Path']);
    await menu.screenshot({ path: test.info().outputPath('link-menu.png') });
    await chooseNativeMenu(app, ['Copy Path']);
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(home);
    await expect.poll(() => menuViews(app)).toBe(0);
    await expect(page.getByRole('tab', { name: /build\.txt/ })).toHaveAttribute('aria-selected', 'true');
    await open('home'); await chooseNativeMenu(app, ['Open in New Tab']);
    await expect(tabs(page)).toHaveText(['build.txt', 'home', 'Projects', 'alpha']);
    await expect.poll(() => labels(page)).toEqual(['Projects']);
    await expect.poll(() => selected(page)).toEqual(['Projects']);
    await page.getByRole('tab', { name: /build\.txt/ }).click();
    await open('alpha'); await chooseNativeMenu(app, ['Open to the Side']);
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect(page.locator('.editor-group.focused .tab-name')).toHaveText(['alpha']);
    await expect.poll(() => labels(page)).toEqual(['notes', 'build.txt', 'data.csv']);
    await expect(page.locator('.editor-group').first().locator('.tab-name')).toHaveText(['build.txt', 'home', 'Projects', 'alpha']);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('the address is still edited by clicking it anywhere but on a link', async () => {
  const { root, alpha, file, app, page } = await launch();
  try {
    await expect(links(page)).not.toHaveCount(0);
    // The file's own name is text, as is everything after the address.
    const name = await ownName(page);
    await page.mouse.click(name.x, name.y);
    await expect(address(page)).toBeFocused();
    expect(await address(page).evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, `file://${file}`.length]);
    await expect(bar(page).locator('.location-links')).toHaveCount(0);
    await expect(address(page)).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
    // An edited address still goes where it says, and Escape brings the links back.
    await address(page).fill(alpha); await address(page).press('Enter');
    await expect(page.getByRole('tab', { name: /alpha/ })).toHaveAttribute('aria-selected', 'true');
    await expect(links(page)).not.toHaveCount(0);
    const box = (await address(page).boundingBox())!;
    await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2);
    await expect(address(page)).toBeFocused();
    await expect(links(page)).toHaveCount(0);
    await address(page).press('Escape');
    await expect(address(page)).not.toBeFocused();
    await expect(links(page)).not.toHaveCount(0);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-location')!.click());
    await expect(address(page)).toBeFocused();
    await expect(links(page)).toHaveCount(0);
    await address(page).press('Escape');

    // The button at the end of the field empties it and leaves the caret there, ready for another address.
    const clear = bar(page).getByRole('button', { name: 'Clear address', exact: true });
    await clear.click();
    await expect(address(page)).toBeFocused();
    await expect(address(page)).toHaveValue('');
    await expect(clear).toBeHidden();
    await page.keyboard.type(file); await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: /build\.txt/ })).toHaveAttribute('aria-selected', 'true');
    await expect(address(page)).toHaveValue(`file://${file}`);
    // While the address is edited it clears what was typed and the field keeps the keyboard.
    await address(page).click(); await address(page).fill('~/Proj');
    await clear.click();
    await expect(address(page)).toBeFocused();
    await expect(address(page)).toHaveValue('');
    await address(page).press('Escape');
    await expect(address(page)).toHaveValue(`file://${file}`);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('an address longer than its field shows its end and scrolls under the wheel', async () => {
  const { root, alpha, file, app, page } = await launch();
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 600));
    const strip = bar(page).locator('.location-links');
    await expect.poll(() => strip.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    /** Whether a part of the address is inside what the field shows. */
    const shown = (index: 'first' | 'last') => strip.evaluate((element, index) => {
      const texts = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent);
      const range = document.createRange(); range.selectNodeContents(index === 'first' ? texts[0] : texts.at(-1)!);
      const part = range.getBoundingClientRect(), box = element.getBoundingClientRect();
      return part.left >= box.left - 0.5 && part.right <= box.right + 0.5;
    }, index);
    // The file's name and the folders nearest to it are what a narrow field shows; the start is cut off and fades.
    await expect.poll(() => shown('last')).toBe(true);
    expect(await shown('first')).toBe(false);
    await expect(strip).toHaveClass(/cut-start/); await expect(strip).not.toHaveClass(/cut-end/);
    await expect(link(page, 'alpha')).toBeVisible();
    await bar(page).screenshot({ path: test.info().outputPath('long-address.png') });
    // The wheel brings the start back, and the links scrolled into view work.
    const box = (await strip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let turn = 0; turn < 12 && !await shown('first'); turn++) await page.mouse.wheel(0, -200);
    expect(await shown('first')).toBe(true);
    expect(await shown('last')).toBe(false);
    await expect(strip).toHaveClass(/cut-end/); await expect(strip).not.toHaveClass(/cut-start/);
    await bar(page).screenshot({ path: test.info().outputPath('long-address-start.png') });
    await page.mouse.wheel(0, 100000);
    await expect.poll(() => shown('last')).toBe(true);
    // Text is still there to click for editing, and so is the button, however little room there is.
    const name = await ownName(page);
    await page.mouse.click(name.x, name.y);
    await expect(address(page)).toBeFocused();
    await address(page).press('Escape');
    await bar(page).getByRole('button', { name: 'Clear address', exact: true }).click();
    await expect(address(page)).toBeFocused();
    await expect(address(page)).toHaveValue('');
    await page.keyboard.type(alpha); await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: /alpha/ })).toHaveAttribute('aria-selected', 'true');
    expect(file.startsWith(alpha)).toBe(true);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
