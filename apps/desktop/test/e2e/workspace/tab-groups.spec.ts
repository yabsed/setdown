import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WebContentsView } from 'electron';
import type { MarkTexApi } from '../../../src/protocol/desktop-api';
import { disposeApplication, electron, focusApplication, type TestApplication } from '../../support/electron/electron-app';
import { chooseNativeMenu } from '../../support/browser/browser-fixture';

async function open(page: Page, file: string) {
  await page.evaluate(file => (window as unknown as { marktex: MarkTexApi }).marktex.openLink(`marktex-resource://file${file}`), file);
  await expect(page.getByRole('tab', { name: new RegExp(path.basename(file).replaceAll('.', '\\.')) })).toHaveAttribute('aria-selected', 'true');
}
/** Native views of the first window that show, apart from the menu layer: the Markdown reader is one. */
const nativeContent = (app: TestApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
  .filter(view => view.getVisible() && !(view as WebContentsView).webContents.getURL().includes('menu-overlay=1')).length);
const tab = (page: Page, name: string, strip = 0) => page.locator('.tab-strip').nth(strip).locator('.document-tab').filter({ hasText: name });
async function tabMenu(app: TestApplication, page: Page, name: string) {
  await tab(page, name).click({ button: 'right' });
  await expect.poll(() => app.windows().some(window => window.url().includes('menu-overlay=1'))).toBe(true);
  const menu = app.windows().find(window => window.url().includes('menu-overlay=1'))!;
  await expect(menu.getByRole('menuitem', { name: 'Close Others', exact: true })).toBeVisible();
  return menu;
}
/** The strip as it reads: `[Name]` an unfolded tab group's label, `(Name)` a folded one, `name*` a tab in a tab group, `+N` hidden tabs. */
const strip = (page: Page, index = 0) => page.locator('.tab-strip').nth(index).locator('.tab-list > *').evaluateAll(pieces => pieces.map(piece => {
  const data = (piece as HTMLElement).dataset, text = piece.textContent!.trim();
  if (data.clusterLabel) return piece.getAttribute('aria-expanded') === 'true' ? `[${text}]` : `(${text})`;
  if (data.clusterMore) return text;
  return `${piece.querySelector('.tab-name')!.textContent}${data.clusterId ? '*' : ''}`;
}));
const selected = (page: Page, name: string) => expect(page.locator('.tab-strip').first().locator('.document-tab[aria-selected="true"] .tab-name')).toHaveText(name);
const label = (page: Page, name?: string) => name === undefined ? page.locator('.tab-cluster-label') : page.locator('.tab-cluster-label').filter({ hasText: name });

test('tab groups as in Firefox: made from the tab menu or by holding one tab over another, named and coloured in a panel, folded, joined, left and dissolved', async () => {
  test.setTimeout(180_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tab-groups-'));
  const file = (name: string) => path.join(root, name);
  await writeFile(file('one.md'), '# One\n\nReader content.\n');
  for (const name of ['two.txt', 'three.txt', 'four.txt', 'five.txt']) await writeFile(file(name), `${name}\n`);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file('one.md')], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow(); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await focusApplication(app);
    // The web tab this test opens stays on this computer: every page of the browser session is answered here.
    await app.evaluate(({ session }) => {
      session.fromPartition('persist:setdown-browser').protocol.handle('https', () =>
        new Response('<!doctype html><title>Start page</title><p>Local.</p>', { headers: { 'content-type': 'text/html' } }));
    });
    // A fresh profile's first web tab waits for the browser's extensions; that start is not what the steps below measure.
    await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.browser.extensions());
    for (const name of ['two.txt', 'three.txt', 'four.txt', 'five.txt']) await open(page, file(name));
    expect(await strip(page)).toEqual(['one.md', 'two.txt', 'three.txt', 'four.txt', 'five.txt']);

    // The tab menu offers one item while the strip has no other tab group. The new group is made around
    // the tab, unfolded, unnamed and blue, and its panel opens under the label with the name field focused.
    const menu = await tabMenu(app, page, 'two.txt');
    await expect(menu.getByRole('menuitem', { name: 'Remove from Group', exact: true })).toHaveCount(0);
    await chooseNativeMenu(app, ['Add Tab to New Group']);
    const creating = page.getByRole('dialog', { name: 'Create tab group' });
    await expect(creating).toBeVisible();
    await expect(creating.getByPlaceholder('Example: Shopping')).toBeFocused();
    await selected(page, 'two.txt');
    expect(await strip(page)).toEqual(['one.md', '[]', 'two.txt*', 'three.txt', 'four.txt', 'five.txt']);
    await expect(label(page)).toHaveAttribute('data-cluster-color', 'blue');
    await expect(creating.getByRole('radio', { name: 'Blue' })).toBeChecked();
    const anchor = (await label(page).boundingBox())!, panelBox = (await creating.boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
    expect(Math.abs(panelBox.x - anchor.x)).toBeLessThan(2);
    // A group without a name still shows: a small blob of its colour, with a line under its tab.
    const blob = (await label(page).locator('.tab-cluster-name').boundingBox())!;
    expect(blob.width).toBeGreaterThanOrEqual(20); expect(blob.height).toBe(20);

    // The name and the colour change the strip as they are chosen.
    await page.keyboard.type('Reading');
    await expect(label(page)).toHaveText('Reading');
    await creating.getByRole('radio', { name: 'Green' }).click();
    await expect(label(page)).toHaveAttribute('data-cluster-color', 'green');
    const painted = await page.evaluate(() => {
      const name = document.querySelector<HTMLElement>('.tab-cluster-name')!, member = document.querySelector<HTMLElement>('.document-tab[data-cluster-id]')!;
      return { label: getComputedStyle(name).backgroundColor, line: getComputedStyle(member, '::after').backgroundColor, height: getComputedStyle(member, '::after').height };
    });
    expect(painted.label).toBe(painted.line); expect(painted.height).toBe('2px');
    expect(painted.label).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: test.info().outputPath('create-panel.png') });
    // Enter keeps the group and closes the panel; the keys typed in it did not reach the editor.
    await page.keyboard.press('Enter');
    await expect(creating).toHaveCount(0);
    expect(await strip(page)).toEqual(['one.md', '[Reading]', 'two.txt*', 'three.txt', 'four.txt', 'five.txt']);
    await expect(page.locator('.focused-content .view-lines')).toHaveText('two.txt');

    // With a tab group in the strip the item is a submenu: a new group, or one of the others. Escape undoes a new group.
    await tabMenu(app, page, 'four.txt'); await chooseNativeMenu(app, ['Add Tab to Group', 'New Group']);
    await expect(creating).toBeVisible();
    await expect(label(page)).toHaveCount(2);
    // The second group takes the next colour no group has. (Blue is free again: the first group is green now.)
    await expect(label(page).nth(1)).toHaveAttribute('data-cluster-color', 'blue');
    await page.keyboard.press('Escape');
    await expect(creating).toHaveCount(0);
    expect(await strip(page)).toEqual(['one.md', '[Reading]', 'two.txt*', 'three.txt', 'four.txt', 'five.txt']);
    // Cancel does the same; Done and a click elsewhere keep the group.
    await tabMenu(app, page, 'five.txt'); await chooseNativeMenu(app, ['Add Tab to Group', 'New Group']);
    await creating.getByRole('button', { name: 'Cancel' }).click();
    await expect(label(page)).toHaveCount(1);

    // "Add Tab to Group" puts the tab at the end of that group, without selecting it.
    await page.getByRole('tab', { name: /two\.txt/ }).click();
    await tabMenu(app, page, 'four.txt'); await chooseNativeMenu(app, ['Add Tab to Group', 'Reading']);
    expect(await strip(page)).toEqual(['one.md', '[Reading]', 'two.txt*', 'four.txt*', 'three.txt', 'five.txt']);
    await selected(page, 'two.txt');

    // A click on the label folds the group: only its selected tab shows, with the count of the others.
    await label(page, 'Reading').click();
    expect(await strip(page)).toEqual(['one.md', '(Reading)', 'two.txt*', '+1', 'three.txt', 'five.txt']);
    await expect(label(page, 'Reading')).toHaveAttribute('title', 'Reading — Collapsed');
    await page.locator('.tab-strip').first().screenshot({ path: test.info().outputPath('folded-with-selected.png') });
    // Selecting a tab outside leaves the label alone, without a line under it.
    await page.getByRole('tab', { name: /five\.txt/ }).click();
    expect(await strip(page)).toEqual(['one.md', '(Reading)', 'three.txt', 'five.txt']);
    await expect(label(page, 'Reading')).not.toHaveAttribute('data-lined');
    // The shown tabs keep the common width: a folded group gives its room back.
    const widths = await page.locator('.tab-strip').first().locator('.document-tab').evaluateAll(tabs => tabs.map(each => Math.round(each.getBoundingClientRect().width)));
    expect(new Set(widths).size).toBe(1);

    // Next Tab steps over the tabs hidden in the folded group.
    const next = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('menu-next-tab')!.click());
    await next(); await selected(page, 'one.md');
    await next(); await selected(page, 'three.txt');
    // Closing the selected tab selects the next tab that shows, not one hidden in the group.
    await tab(page, 'three.txt').locator('[title="Close tab"]').click();
    await selected(page, 'five.txt');
    expect(await strip(page)).toEqual(['one.md', '(Reading)', 'five.txt']);
    // A tab opened beside a folded group stays outside it.
    await open(page, file('three.txt'));
    expect(await strip(page)).toEqual(['one.md', '(Reading)', 'five.txt', 'three.txt']);

    // The count unfolds the group as the label does.
    await page.getByRole('tab', { name: /one\.md/ }).click();
    await label(page, 'Reading').click();
    expect(await strip(page)).toEqual(['one.md', '[Reading]', 'two.txt*', 'four.txt*', 'five.txt', 'three.txt']);
    await page.getByRole('tab', { name: /four\.txt/ }).click();
    await label(page, 'Reading').click();
    expect(await strip(page)).toEqual(['one.md', '(Reading)', 'four.txt*', '+1', 'five.txt', 'three.txt']);
    await page.locator('.tab-cluster-more').click();
    expect(await strip(page)).toEqual(['one.md', '[Reading]', 'two.txt*', 'four.txt*', 'five.txt', 'three.txt']);

    // A member is offered "Remove from Group": it comes to stand right after its group.
    await tabMenu(app, page, 'two.txt'); await chooseNativeMenu(app, ['Remove from Group']);
    expect(await strip(page)).toEqual(['one.md', '[Reading]', 'four.txt*', 'two.txt', 'five.txt', 'three.txt']);

    // Dragging: the near part of a member puts the tab before it, in its group; the far half of the label makes it the first.
    await tab(page, 'five.txt').dragTo(tab(page, 'four.txt'), { targetPosition: { x: 6, y: 12 } });
    expect(await strip(page)).toEqual(['one.md', '[Reading]', 'five.txt*', 'four.txt*', 'two.txt', 'three.txt']);
    const labelBox = (await label(page, 'Reading').boundingBox())!;
    await tab(page, 'two.txt').dragTo(label(page, 'Reading'), { targetPosition: { x: labelBox.width - 4, y: 12 } });
    expect(await strip(page)).toEqual(['one.md', '[Reading]', 'two.txt*', 'five.txt*', 'four.txt*', 'three.txt']);
    // The near half of the label is before the whole group.
    await tab(page, 'five.txt').dragTo(label(page, 'Reading'), { targetPosition: { x: 3, y: 12 } });
    expect(await strip(page)).toEqual(['one.md', 'five.txt', '[Reading]', 'two.txt*', 'four.txt*', 'three.txt']);
    // While a tab is dragged the strip keeps its layout: the tabs stay the width they were, so
    // the place the tab is aimed at does not move. (The window loses its maximize button for the
    // drag, and the room the strip leaves for the window's buttons would shrink with it.)
    const tabWidths = () => page.locator('.tab-strip').first().locator('.document-tab').evaluateAll(tabs => tabs.map(each => Math.round(each.getBoundingClientRect().width * 10) / 10));
    /** The width the window leaves beside its own buttons, as the strip's CSS reads it. */
    const besideButtons = () => page.evaluate(() => {
      const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;visibility:hidden;width:env(titlebar-area-width, 0px)';
      document.body.append(probe); const width = probe.offsetWidth; probe.remove(); return width;
    });
    const resting = await tabWidths(), restingRoom = await besideButtons(), aim = (await tab(page, 'three.txt').boundingBox())!;
    await tab(page, 'two.txt').hover(); await page.mouse.down();
    await page.mouse.move(aim.x + 6, aim.y + 12, { steps: 4 });
    await expect(page.locator('.tab-drop-indicator')).toBeVisible();
    await expect.poll(besideButtons).toBeGreaterThan(restingRoom);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await tabWidths()).toEqual(resting);
    // The near part of a tab outside the group is outside it.
    await page.mouse.up();
    expect(await strip(page)).toEqual(['one.md', 'five.txt', '[Reading]', 'four.txt*', 'two.txt', 'three.txt']);
    // After the drag the buttons are back and the strip follows them again, at the same widths.
    await expect.poll(besideButtons).toBe(restingRoom);
    await expect.poll(() => page.locator('.tab-strip').first().locator('.window-drag-space').evaluate(space => (space as HTMLElement).style.flexBasis)).toBe('');
    expect(await tabWidths()).toEqual(resting);
    // A pinned tab is in no group: pinning a member takes it out, and the group that empties is gone.
    await tabMenu(app, page, 'four.txt'); await chooseNativeMenu(app, ['Pin']);
    expect(await strip(page)).toEqual(['four.txt', 'one.md', 'five.txt', 'two.txt', 'three.txt']);
    await tab(page, 'four.txt').getByRole('button', { name: 'Unpin tab' }).click();

    // Firefox's own gesture: a tab held over the middle of another, then released, makes a group of the two.
    const held = (await tab(page, 'two.txt').boundingBox())!;
    await tab(page, 'three.txt').hover();
    await page.mouse.down();
    await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2, { steps: 6 });
    await expect(tab(page, 'two.txt')).toHaveClass(/is-group-target/);
    await expect(page.locator('.tab-drop-indicator')).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('held-over-tab.png') });
    await page.mouse.up();
    await expect(creating).toBeVisible();
    await expect(creating.getByPlaceholder('Example: Shopping')).toBeFocused();
    expect(await strip(page)).toEqual(['four.txt', 'one.md', 'five.txt', '[]', 'two.txt*', 'three.txt*']);
    await expect(page.locator('.document-tab.is-group-target')).toHaveCount(0);
    await page.keyboard.type('Notes');
    await creating.getByRole('button', { name: 'Done' }).click();
    await expect(creating).toHaveCount(0);
    expect(await strip(page)).toEqual(['four.txt', 'one.md', 'five.txt', '[Notes]', 'two.txt*', 'three.txt*']);

    // A group made around the Markdown reader: the panel hangs over the reader's own native view,
    // which gives way while the panel is open and returns when it closes.
    await page.getByRole('tab', { name: /one\.md/ }).click();
    await expect.poll(() => nativeContent(app)).toBe(1);
    await tabMenu(app, page, 'one.md'); await chooseNativeMenu(app, ['Add Tab to Group', 'New Group']);
    await expect(creating).toBeVisible();
    await expect.poll(() => nativeContent(app)).toBe(0);
    await expect(label(page).first()).toHaveAttribute('data-cluster-color', 'purple');
    await page.keyboard.type('Docs');
    // A click elsewhere keeps the group.
    await page.mouse.click(600, 400);
    await expect(creating).toHaveCount(0);
    await expect.poll(() => nativeContent(app)).toBe(1);
    expect(await strip(page)).toEqual(['four.txt', '[Docs]', 'one.md*', 'five.txt', '[Notes]', 'two.txt*', 'three.txt*']);

    // The secondary button on a label opens the same panel for an existing group: its name and colour,
    // and what can be done with the group.
    await label(page, 'Notes').click({ button: 'right' });
    const managing = page.getByRole('dialog', { name: 'Manage tab group' });
    await expect(managing.getByPlaceholder('Example: Shopping')).toHaveValue('Notes');
    await expect(managing.getByPlaceholder('Example: Shopping')).toBeFocused();
    await managing.getByRole('radio', { name: 'Red' }).click();
    await expect(label(page, 'Notes')).toHaveAttribute('data-cluster-color', 'red');
    await page.screenshot({ path: test.info().outputPath('manage-panel.png') });
    // Escape closes the panel of an existing group without undoing anything.
    await page.keyboard.press('Escape');
    await expect(managing).toHaveCount(0);
    await expect(label(page, 'Notes')).toHaveAttribute('data-cluster-color', 'red');

    // "New tab in group": a new web tab at the end of the group.
    await label(page, 'Notes').click();
    expect(await strip(page)).toEqual(['four.txt', '[Docs]', 'one.md*', 'five.txt', '(Notes)']);
    await label(page, 'Notes').click({ button: 'right' });
    await managing.getByRole('button', { name: 'New tab in group' }).click();
    await expect.poll(async () => (await strip(page)).length, { timeout: 20_000 }).toBe(8);
    const withWeb = await strip(page);
    expect(withWeb.slice(0, 6)).toEqual(['four.txt', '[Docs]', 'one.md*', 'five.txt', '[Notes]', 'two.txt*']);
    expect(withWeb[6]).toBe('three.txt*'); expect(withWeb[7]).toMatch(/\*$/);
    await expect(page.locator('.tab-strip').first().locator('.document-tab[aria-selected="true"]')).toHaveAttribute('data-cluster-id', /^cluster-/);

    // "Ungroup tabs" leaves the tabs where they are; "Delete group" closes them.
    await label(page, 'Docs').click({ button: 'right' });
    await managing.getByRole('button', { name: 'Ungroup tabs' }).click();
    expect((await strip(page)).slice(0, 4)).toEqual(['four.txt', 'one.md', 'five.txt', '[Notes]']);
    await label(page, 'Notes').click({ button: 'right' });
    await managing.getByRole('button', { name: 'Delete group' }).click();
    await expect.poll(() => strip(page)).toEqual(['four.txt', 'one.md', 'five.txt']);
    await expect(label(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
  }
});
