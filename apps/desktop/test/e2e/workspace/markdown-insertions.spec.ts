import { electron } from '../../support/electron/electron-app';
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from '../../support/electron/electron-app';
import { fixture, evaluatePage } from '../../support/browser/browser-fixture';
import { nativeInput } from '../../support/electron/native-input';

async function expectAnchored(page: Page, kind: 'table' | 'link') {
  const popup = page.locator(`.${kind}-popover`);
  await expect(popup).toBeVisible();
  await expect.poll(() => popup.evaluate((node, kind) => {
    const group = document.querySelector('.editor-group.focused')!.getBoundingClientRect();
    const anchor = document.querySelector(`.editor-group.focused .insert-${kind}-button`)!;
    const button = (anchor.getBoundingClientRect().width ? anchor : document.querySelector('.editor-group.focused .location-more')!).getBoundingClientRect();
    const bounds = node.getBoundingClientRect();
    const left = Math.max(0, group.left) + 8, right = Math.min(innerWidth, group.right) - 8;
    return Math.abs(bounds.top - button.bottom - 4) < 1
      && Math.abs(bounds.left - Math.max(left, Math.min(button.right - bounds.width, right - bounds.width))) < 1
      && bounds.left >= left - 1 && bounds.right <= right + 1
      && bounds.bottom <= Math.min(innerHeight, group.bottom) - 7;
  }, kind)).toBe(true);
}

for (const placement of ['left', 'right', 'below'] as const) {
  test(`insertion popovers follow the ${placement} Markdown pane beside a live website`, async () => {
    const f = await fixture();
    const { app, page } = f;
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1000));
      const documentTab = page.locator('.document-tab').first();
      const documentName = await documentTab.locator('.tab-name').innerText();
      await page.evaluate(url => window.marktex.openLink(url), `${f.origin}/first`);
      await expect(page.getByRole('tab', { name: /Research page/ })).toBeVisible();
      const identity = await evaluatePage(app, f.origin, 'window.__insertionIdentity = crypto.randomUUID(); document.querySelector("#draft").value = "Unsaved browser draft"; window.__insertionIdentity');
      const tab = placement === 'left' ? page.getByRole('tab', { name: /Research page/ })
        : page.locator('.document-tab').filter({ hasText: documentName });
      const data = await page.evaluateHandle(() => new DataTransfer());
      await tab.dispatchEvent('dragstart', { dataTransfer: data });
      const body = page.locator('.group-body').first(), box = (await body.boundingBox())!;
      const point = { dataTransfer: data, clientX: box.x + box.width * (placement === 'below' ? .5 : .98),
        clientY: box.y + box.height * (placement === 'below' ? .98 : .5) };
      await body.dispatchEvent('dragover', point);
      await body.dispatchEvent('drop', point);
      await tab.dispatchEvent('dragend', { dataTransfer: data });
      await data.dispose();
      await expect(page.locator('.editor-group')).toHaveCount(2);
      await page.locator('.document-tab').filter({ hasText: documentName }).click();
      await page.locator('.mode-toggle:visible').click();
      const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content', exact: true });
      await expect(editor).toBeEditable();
      await editor.press('Control+End');
      await page.locator('.insert-table-button').click();
      await expectAnchored(page, 'table');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 900));
      await expectAnchored(page, 'table');
      await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-zoom-in'));
      await expectAnchored(page, 'table');
      // Keyboard resizing keeps the popup open while changing its pane's origin/size.
      await page.locator('.group-sash').focus();
      await page.keyboard.press(placement === 'below' ? 'ArrowUp' : 'ArrowLeft');
      await expectAnchored(page, 'table');
      await page.screenshot({ path: test.info().outputPath(`table-${placement}.png`) });

      // Real OS input also proves an adjacent WebContentsView cannot cover the grid.
      const cell = (await page.locator('.table-size-cell[data-columns="2"][data-rows="2"]').boundingBox())!;
      const click = await app.evaluate(({ BrowserWindow }, cell) => {
        const owner = BrowserWindow.getAllWindows()[0], bounds = owner.getContentBounds(), zoom = owner.webContents.getZoomFactor();
        return { x: bounds.x + (cell.x + cell.width / 2) * zoom, y: bounds.y + (cell.y + cell.height / 2) * zoom };
      }, cell);
      await nativeInput({ click });
      await expect(page.locator('.table-popover')).toBeHidden();
      await expect(editor).toBeFocused();
      await expect(page.locator('.editor-surface .view-lines')).toContainText('Column 1');
      await editor.press('Control+z');
      await expect(page.locator('.editor-surface .view-lines')).not.toContainText('Column 1');

      await editor.press('Control+k');
      await expectAnchored(page, 'link');
      await expect(page.locator('.link-destination')).toBeFocused();
      await page.locator('.link-destination').fill('https://example.com/split');
      // Focus the adjacent real native website between the two clipboard pastes.
      const webPoint = await app.evaluate(({ BrowserWindow }, origin) => {
        const owner = BrowserWindow.getAllWindows()[0];
        const native = owner.contentView.children.find(view => 'webContents' in view
          && (view as Electron.WebContentsView).webContents.getURL().startsWith(origin))!;
        const bounds = native.getBounds(), frame = owner.getContentBounds();
        return { x: frame.x + bounds.x + 40, y: frame.y + bounds.y + 12 };
      }, f.origin);
      await nativeInput({ click: webPoint });
      await expect(page.locator('.link-popover')).toBeVisible();
      await expect(page.locator('.link-destination')).toHaveValue('https://example.com/split');
      await page.locator('.link-label').fill('Split link');
      await page.locator('.link-submit').click();
      await expect(page.locator('.link-popover')).toBeHidden();
      await expect(editor).toBeFocused();
      await expect(page.locator('.editor-surface .view-lines')).toContainText('Split link');
      await editor.press('Control+k');
      await expectAnchored(page, 'link');
      await page.keyboard.press('Escape');
      await expect(page.locator('.link-popover')).toBeVisible();
      await page.locator('.link-popover').getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.locator('.link-popover')).toBeHidden();
      await expect(editor).toBeFocused();
      expect(await evaluatePage(app, f.origin, '({ identity: window.__insertionIdentity, draft: document.querySelector("#draft").value })'))
        .toEqual({ identity, draft: 'Unsaved browser draft' });
      expect(f.errors).toEqual([]);
    } finally {
      await writeFile(test.info().outputPath('insertion-state.json'), JSON.stringify(await page.evaluate(() => ({
        active: document.activeElement?.outerHTML,
        link: document.querySelector('.link-popover')?.outerHTML,
        groups: [...document.querySelectorAll('.editor-group')].map(group => ({ id: group.getAttribute('data-group-id'), focused: group.classList.contains('focused') })),
      })).catch(() => null)));
      await f.dispose();
    }
  });
}

test('inserts a table and a URL from compact editor popovers', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-insertions-e2e-'));
  const configRoot = path.join(temporaryRoot, 'config');
  const documentPath = path.join(temporaryRoot, 'document.md');
  await writeFile(documentPath, '# Insertions\n', 'utf8');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', documentPath],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const window = await application.firstWindow();
    await expect(window.locator('.document-tab')).toHaveCount(1);
    await window.locator('.mode-toggle').click();
    await expect(window.locator('.insert-table-button')).toBeVisible();

    await window.locator('.insert-table-button').click();
    const tablePopover = window.locator('.table-popover');
    await expect(tablePopover).toBeVisible();
    await expect(window.locator('dialog.table-dialog')).toHaveCount(0);
    await expect(tablePopover.locator('.table-size-cell')).toHaveCount(100);
    await expect(tablePopover.locator('.table-size-cell.is-selected')).toHaveCount(0);
    await expect(tablePopover.locator('header span')).toBeEmpty();
    await window.locator('.table-size-cell[data-columns="5"][data-rows="9"]').hover();
    await expect(tablePopover.locator('header span')).toHaveText('5 × 9');
    await expect(tablePopover.locator('.table-size-cell.is-selected')).toHaveCount(45);
    await tablePopover.locator('header').hover();
    await expect(tablePopover.locator('.table-size-cell.is-selected')).toHaveCount(0);
    await expect(tablePopover.locator('header span')).toBeEmpty();
    await window.locator('.table-size-cell[data-columns="2"][data-rows="2"]').click();
    await expect(tablePopover).toBeHidden();

    await window.locator('.insert-table-button').click();
    await expect(tablePopover).toBeVisible();
    await window.locator('.tab-name').first().click();
    await expect(tablePopover).toBeHidden();
    await window.getByRole('textbox', { name: 'Editor content', exact: true }).press('Control+End');
    await window.locator('.insert-link-button').click();
    await expect(window.locator('.link-popover')).toBeVisible();
    await expect(window.locator('dialog.link-dialog')).toHaveCount(0);
    await window.locator('.link-destination').fill('www.example.com/docs');
    await application.evaluate(({ clipboard }) => clipboard.writeText('www.example.com/docs'));
    await window.locator('.link-destination').press('Control+a');
    await window.locator('.link-destination').press('Control+v');
    await window.locator('.tab-name').first().click();
    await expect(window.locator('.link-popover')).toBeVisible();
    await expect(window.locator('.link-destination')).toHaveValue('www.example.com/docs');
    await application.evaluate(({ clipboard }) => clipboard.writeText('Documentation'));
    await window.locator('.link-label').click();
    await window.locator('.link-label').press('Control+a');
    await window.locator('.link-label').press('Control+v');
    await window.keyboard.press('Escape');
    await expect(window.locator('.link-popover')).toBeVisible();
    await expect(window.locator('.link-label')).toHaveValue('Documentation');
    await window.locator('.link-submit').click();
    await expect(window.locator('.view-lines')).toContainText('Column 1');
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu()
      ?.getMenuItemById('save')?.click());

    await expect.poll(() => readFile(documentPath, 'utf8')).toContain(
      '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |',
    );
    await expect.poll(() => readFile(documentPath, 'utf8')).toContain(
      '[Documentation](<https://www.example.com/docs>)',
    );
  } finally {
    await disposeApplication(application);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
