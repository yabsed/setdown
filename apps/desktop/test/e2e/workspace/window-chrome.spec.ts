import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, electron, type TestApplication } from '../../support/electron/electron-app';
import { applicationMenuButton, openApplicationMenu } from '../../support/electron/application-menu';
import { chooseNativeMenu } from '../../support/browser/browser-fixture';
import type { MarkTexApi } from '../../../src/protocol/desktop-api';

// The window has no title bar. The tab strips on its top edge carry the parts a title bar had.
const region = (page: Page, selector: string) => page.locator(selector).first()
  .evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-app-region'));
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

async function launch(names: string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-window-chrome-'));
  for (const name of names) await writeFile(path.join(root, name), `${name}\n`);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', ...names.slice(0, 1).map(name => path.join(root, name))],
    env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  const page = await app.firstWindow();
  // The first file comes with the launch; the others open after it, each in a tab of its own.
  for (const name of names) {
    if (name !== names[0]) await page.evaluate(file => (window as unknown as { marktex: MarkTexApi }).marktex.openLink(`marktex-resource://file${file}`), path.join(root, name));
    await expect(page.getByRole('tab', { name: new RegExp(name.replaceAll('.', '\\.')) })).toHaveAttribute('aria-selected', 'true');
  }
  return { root, app, page };
}
const dispose = async (app: TestApplication, root: string) => { await disposeApplication(app); await rm(root, { recursive: true, force: true }); };

/** Right-click a tab (its newest copy, after a split) and choose from its menu, which paints in the native menu layer. */
async function tabMenu(app: TestApplication, page: Page, name: string, labels: string[]) {
  await page.locator('.document-tab').filter({ hasText: name }).last().click({ button: 'right' });
  await chooseNativeMenu(app, labels);
}

test('the top-left tab strip starts with Setdown and the menu, and its free end moves the window', async () => {
  const { root, app, page } = await launch(['one.txt']);
  try {
    await expect(page.locator('.product-titlebar')).toHaveCount(0);
    const strip = await box(page, '.tab-strip');
    expect(strip.y).toBe(0);

    // Setdown, the menu button, the tabs, the new-tab buttons, then the free end, in that order.
    const order = ['.tab-strip > .product-identity', '.tab-strip > .application-menu', '.tab-strip .document-tab',
      '.tab-strip .tab-creation-actions', '.tab-strip > .window-drag-space'];
    const boxes = await Promise.all(order.map(selector => box(page, selector)));
    for (let index = 1; index < boxes.length; index++) expect(boxes[index].x).toBeGreaterThanOrEqual(boxes[index - 1].x + boxes[index - 1].width);
    await expect(page.locator('.product-identity')).toHaveText('Setdown');

    // Only the free end drags the window. The strip and everything on it keep their own pointer input.
    expect(await region(page, '.window-drag-space')).toBe('drag');
    for (const selector of ['.tab-strip', '.product-identity', '.application-menu', '.tab-row', '.document-tab', '.tab-creation-actions'])
      expect(await region(page, selector)).toBe('no-drag');

    // The single strip is also the top-right one. Its free end starts after the new-tab buttons and runs
    // under the window buttons Electron draws there to the window's edge, from the window's top edge down.
    await expect(page.locator('.tab-strip')).toHaveClass(/has-window-controls/);
    const width = await page.evaluate(() => innerWidth);
    expect(boxes[4].x + boxes[4].width).toBeCloseTo(width, 0);
    expect(boxes[4].y).toBe(0);
    const controls = await page.evaluate(() => {
      const overlay = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay;
      const area = overlay?.visible ? overlay.getTitlebarAreaRect() : null;
      return area ? { free: area.x + area.width, height: area.height } : null;
    });
    expect(controls).not.toBeNull();
    expect(controls!.free).toBeLessThan(width);
    expect(Math.abs(controls!.height - strip.height)).toBeLessThanOrEqual(1);
    // The tabs and their buttons stop 24px short of the window buttons, whatever width the platform gives those.
    expect(boxes[3].x + boxes[3].width).toBeLessThanOrEqual(controls!.free - 24 + 1);
    // Right beside the window buttons, on the window's top edge, between and under the buttons: all of it moves the window.
    const moves = (x: number, y: number) => page.evaluate(([x, y]) => {
      const node = document.elementFromPoint(x, y);
      return !!node?.classList.contains('window-drag-space') && getComputedStyle(node).getPropertyValue('-webkit-app-region') === 'drag';
    }, [x, y]);
    for (const [x, y] of [[controls!.free - 2, strip.height / 2], [controls!.free - 2, 1], [controls!.free - 30, 1],
      [controls!.free + 2, strip.height / 2], [width - 2, strip.height / 2], [boxes[3].x + boxes[3].width + 2, strip.height / 2]])
      expect(await moves(x, y), `window moves from ${x},${y}`).toBe(true);

    // While a tab is dragged the free end takes the drop like the rest of the strip.
    await page.locator('.document-tab').first().dispatchEvent('dragstart', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
    await expect(page.locator('.shell')).toHaveClass(/is-tab-dragging/);
    expect(await region(page, '.window-drag-space')).toBe('no-drag');
    await page.locator('.document-tab').first().dispatchEvent('dragend', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
    await expect(page.locator('.shell')).not.toHaveClass(/is-tab-dragging/);
    expect(await region(page, '.window-drag-space')).toBe('drag');

    // Setdown shows and hides the folder tools with their icon column, and stays first in the strip.
    const identity = page.getByRole('button', { name: 'Toggle Folder Tools', exact: true });
    await expect(page.locator('.project-sidebar')).toBeHidden();
    await expect(identity).toHaveAttribute('aria-expanded', 'false');
    expect((await box(page, '.tab-strip')).x).toBe(0);
    await identity.click();
    await expect(page.locator('.project-sidebar')).toBeVisible();
    await expect(identity).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.product-identity')).toHaveCount(1);
    await expect(page.locator('.activity-bar .product-identity')).toHaveCount(0);
    expect((await box(page, '.activity-bar')).width).toBe(48);
    expect((await box(page, '.tab-strip')).x).toBeGreaterThanOrEqual(48);
    expect((await box(page, '.tab-strip > :first-child')).x).toBe((await box(page, '.tab-strip > .product-identity')).x);
    await identity.click();
    await expect(page.locator('.project-sidebar')).toBeHidden();
    await expect(identity).toHaveAttribute('aria-expanded', 'false');

    // One menu button lists the four menus; a row of one of them runs its command.
    await applicationMenuButton(page).click();
    await expect(page.locator('.application-menu-popup .product-menu-label')).toHaveText(['File', 'View', 'Edit', 'Window']);
    await expect(applicationMenuButton(page)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('.application-menu-popup')).toBeHidden();
    await openApplicationMenu(page, 'View');
    await page.getByRole('menuitem', { name: 'Toggle Folder Tools', exact: true }).click();
    await expect(page.locator('.project-sidebar')).toBeVisible();
    await expect(page.locator('.application-menu-popup')).toBeHidden();
    await openApplicationMenu(page, 'File');
    await page.locator('[data-menu-item-id="menu-new-document"]').click();
    await expect(page.locator('.document-tab')).toHaveCount(2);
  } finally { await dispose(app, root); }
});

test('split groups: Setdown and the menu stay top-left, the window buttons top-right, lower strips carry neither', async () => {
  const { root, app, page } = await launch(['one.txt', 'two.txt']);
  try {
    await expect(page.locator('.document-tab')).toHaveCount(2);
    await tabMenu(app, page, 'two.txt', ['Split Right']);
    await expect(page.locator('.editor-group')).toHaveCount(2);
    const strips = page.locator('.tab-strip');
    await expect(page.locator('.product-identity')).toHaveCount(1);
    await expect(page.locator('.application-menu')).toHaveCount(1);
    await expect(strips.nth(0).locator('.product-identity')).toHaveCount(1);
    await expect(strips.nth(0)).not.toHaveClass(/has-window-controls/);
    await expect(strips.nth(1).locator('.product-identity')).toHaveCount(0);
    await expect(strips.nth(1)).toHaveClass(/has-window-controls/);
    // Both strips are on the top edge, so each has a free end that moves the window.
    await expect(page.locator('.window-drag-space')).toHaveCount(2);

    // A group below another one is not on the top edge.
    await tabMenu(app, page, 'two.txt', ['Split & Move', 'Split Down']);
    await expect(page.locator('.editor-group')).toHaveCount(3);
    await expect(page.locator('.product-identity')).toHaveCount(1);
    await expect(page.locator('.tab-strip.has-window-controls')).toHaveCount(1);
    await expect(page.locator('.window-drag-space')).toHaveCount(2);
    const lower = await page.locator('.editor-group').evaluateAll(groups => groups
      .filter(group => group.getBoundingClientRect().top > 1)
      .map(group => ({ lead: !!group.querySelector('.product-identity'), drag: !!group.querySelector('.window-drag-space'),
        controls: !!group.querySelector('.tab-strip.has-window-controls') })));
    expect(lower).toEqual([{ lead: false, drag: false, controls: false }]);
  } finally { await dispose(app, root); }
});

test('without tabs the strip stays: Setdown, the menu and room for the window buttons', async () => {
  const { root, app, page } = await launch([]);
  try {
    await expect(page.locator('.shell')).toHaveAttribute('data-tabs', 'false');
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.tab-strip')).toBeVisible();
    await expect(page.locator('.tab-strip')).toHaveClass(/has-window-controls/);
    await expect(page.locator('.product-identity')).toBeVisible();
    await expect(applicationMenuButton(page)).toBeVisible();
    await expect(page.locator('.location-bar')).toBeHidden();
    expect(await region(page, '.window-drag-space')).toBe('drag');
    const strip = await box(page, '.tab-strip'), empty = await box(page, '.empty-state');
    expect(strip.y).toBe(0);
    expect(empty.y).toBeGreaterThanOrEqual(strip.y + strip.height);
    await openApplicationMenu(page, 'File');
    await page.locator('[data-menu-item-id="menu-new-document"]').click();
    await expect(page.locator('.document-tab')).toHaveCount(1);
    await expect(page.locator('.product-identity')).toHaveCount(1);
  } finally { await dispose(app, root); }
});

test('a strip too narrow for the new-tab buttons beside a tab scrolls them along with the tabs', async () => {
  const names = Array.from({ length: 12 }, (_, index) => `file-${index}.txt`);
  const { root, app, page } = await launch(names);
  try {
    await expect(page.locator('.document-tab')).toHaveCount(12);
    const row = page.locator('.tab-row'), list = page.locator('.tab-list'), creation = page.locator('.tab-creation-actions');
    const overflows = (node: Element) => node.scrollWidth > node.clientWidth;
    const inside = async (inner: string, outer: string) => {
      const a = await box(page, inner), b = await box(page, outer);
      return a.x >= b.x - .5 && a.x + a.width <= b.x + b.width + .5;
    };

    // With room, more tabs than fit scroll in their list at their least width and the buttons stay put beside them.
    await expect(row).not.toHaveClass(/is-cramped/);
    expect(await list.evaluate(overflows)).toBe(true);
    expect(await row.evaluate(overflows)).toBe(false);
    expect((await box(page, '.document-tab')).width).toBe(96);
    await expect(creation.locator('button')).toHaveCount(4);
    expect(await inside('.tab-creation-actions', '.tab-row')).toBe(true);
    const free = await page.evaluate(() => {
      const area = (navigator as Navigator & { windowControlsOverlay: { getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay.getTitlebarAreaRect();
      return area.x + area.width;
    });
    const buttons = await box(page, '.tab-creation-actions');
    expect(buttons.x + buttons.width).toBeLessThanOrEqual(free - 24 + 1);

    // Narrower than the buttons plus one tab, the tabs are not squeezed away: they keep their least width
    // and one row scrolls the tabs and the buttons together.
    await page.evaluate(() => { const style = document.createElement('style'); style.id = 'narrow-group'; style.textContent = '.editor-group{max-width:420px}'; document.head.append(style); });
    await expect(row).toHaveClass(/is-cramped/);
    expect(await row.evaluate(overflows)).toBe(true);
    expect(await list.evaluate(overflows)).toBe(false);
    expect((await box(page, '.document-tab')).width).toBe(96);
    expect(await inside('.tab-row', '.tab-strip')).toBe(true);
    expect((await box(page, '.tab-row')).width).toBeLessThan(buttons.width + 96);
    // The selected tab is still brought into view.
    expect(await inside('.document-tab[aria-selected="true"]', '.tab-row')).toBe(true);
    // The wheel scrolls the row from the first tab to the last new-tab button, without selecting a tab.
    const selected = await page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id');
    await row.evaluate(node => { node.scrollLeft = 0; });
    expect(await inside('.document-tab', '.tab-row')).toBe(true);
    expect(await inside('.new-folder-tab-button', '.tab-row')).toBe(false);
    await row.hover(); await page.mouse.wheel(0, 300);
    await expect.poll(() => row.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await page.mouse.wheel(0, 5000);
    await expect.poll(() => inside('.new-folder-tab-button', '.tab-row')).toBe(true);
    expect(await inside('.tab-creation-actions', '.tab-row')).toBe(true);
    expect(await page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id')).toBe(selected);
    // A button reached that way works, and the tab it opens is shown.
    await page.locator('.new-tab-button').click();
    await expect(page.locator('.document-tab')).toHaveCount(13);
    await expect.poll(() => inside('.document-tab[aria-selected="true"]', '.tab-row')).toBe(true);
    // A dragged tab held at the row's edge scrolls the row, as it scrolls the list when there is room.
    await row.evaluate(node => { node.scrollLeft = 0; });
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page.locator('.document-tab').first().dispatchEvent('dragstart', { dataTransfer: transfer });
    const rowBox = await box(page, '.tab-row');
    await row.dispatchEvent('dragover', { clientX: rowBox.x + rowBox.width - 5, clientY: rowBox.y + 12, dataTransfer: transfer });
    await expect(page.locator('.tab-drop-indicator')).toBeVisible();
    await expect.poll(() => row.evaluate(node => node.scrollLeft)).toBeGreaterThan(100);
    await page.locator('.document-tab').first().dispatchEvent('dragend', { dataTransfer: transfer });
    await transfer.dispose();

    // With room again the buttons return beside the list.
    await page.evaluate(() => document.getElementById('narrow-group')!.remove());
    await expect(row).not.toHaveClass(/is-cramped/);
    expect(await row.evaluate(overflows)).toBe(false);
    expect(await inside('.tab-creation-actions', '.tab-row')).toBe(true);
  } finally { await dispose(app, root); }
});
