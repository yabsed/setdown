import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('inserts an edited table and a URL into the Monaco document', async () => {
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
    await expect(window.locator('.table-dialog')).toBeVisible();
    await window.locator('.table-columns').fill('2');
    await window.locator('.table-columns').press('Tab');
    await window.locator('.table-rows').fill('1');
    await window.locator('.table-rows').press('Tab');
    await expect(window.locator('[data-table-header]')).toHaveCount(2);
    await expect(window.locator('.table-cell-input')).toHaveCount(2);
    await window.locator('[data-table-header="0"]').fill('이름');
    await window.locator('[data-table-header="1"]').fill('값');
    await window.locator('[data-table-alignment="1"]').selectOption('right');
    await window.locator('[data-table-row="0"][data-table-column="0"]').fill('alpha');
    await window.locator('[data-table-row="0"][data-table-column="1"]').fill('10');
    await window.locator('.table-form .primary-button').click();

    await window.keyboard.press('Control+End');
    await window.locator('.insert-link-button').click();
    await window.locator('.link-destination').fill('https://example.com/docs');
    await window.locator('.link-form .primary-button').click();
    await expect(window.locator('.view-lines')).toContainText('alpha');
    await application.evaluate(({ Menu }) => Menu.getApplicationMenu()
      ?.getMenuItemById('save')?.click());

    await expect.poll(() => readFile(documentPath, 'utf8')).toContain(
      '| 이름 | 값 |\n| --- | ---: |\n| alpha | 10 |',
    );
    await expect.poll(() => readFile(documentPath, 'utf8')).toContain(
      '[https://example.com/docs](<https://example.com/docs>)',
    );
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
