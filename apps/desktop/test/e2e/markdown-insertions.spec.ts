import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';

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

    await window.keyboard.press('Control+End');
    await window.locator('.insert-link-button').click();
    await expect(window.locator('.link-popover')).toBeVisible();
    await expect(window.locator('dialog.link-dialog')).toHaveCount(0);
    await window.locator('.link-destination').fill('www.example.com/docs');
    await window.locator('.link-label').fill('Documentation');
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
