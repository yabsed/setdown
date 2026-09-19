import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';

test('restores the open folder, side panels, and their widths after Reload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-reload-layout-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-reload-layout-config-'));
  const documentPath = path.join(root, 'reload.md');
  await writeFile(documentPath, '# Reload layout\n\nBody', 'utf8');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', documentPath],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const window = await application.firstWindow();
    await window.locator('.product-identity').click();
    await window.evaluate(async (folderPath) => {
      await (window as typeof window & {
        marktex: { restoreProjectFolder(path: string): Promise<unknown> };
      }).marktex.restoreProjectFolder(folderPath);
    }, root);
    await window.locator('.toc-toggle').click();
    await window.locator('.panel-resize-right').press('ArrowRight');
    await window.locator('.panel-resize-left').press('ArrowLeft');
    const before = await window.locator('.shell').evaluate((shell) => ({
      project: getComputedStyle(shell).getPropertyValue('--project-sidebar-width'),
      outline: getComputedStyle(shell).getPropertyValue('--toc-panel-width'),
    }));

    await window.locator('.application-menu button', { hasText: 'View' }).click();
    await Promise.all([
      window.waitForEvent('load'),
      window.locator('.application-menu-popup button', { hasText: 'Reload' }).click(),
    ]);

    await expect(window.locator('.project-sidebar')).toBeVisible();
    await window.getByRole('button', { name: 'Explorer' }).click();
    const explorerRoot = window.locator('.explorer-root');
    await expect(explorerRoot).toContainText(path.basename(root).toUpperCase());
    await expect(explorerRoot).toHaveAttribute('aria-expanded', 'true');
    await explorerRoot.click();
    await expect(explorerRoot).toHaveAttribute('aria-expanded', 'false');
    await expect(window.locator('.explorer-tree')).toHaveCount(0);
    await window.getByRole('button', { name: 'Source Control' }).click();
    await window.getByRole('button', { name: 'Explorer' }).click();
    await expect(explorerRoot).toHaveAttribute('aria-expanded', 'false');
    await explorerRoot.press('Enter');
    await expect(explorerRoot).toHaveAttribute('aria-expanded', 'true');
    await expect(window.locator('.explorer-tree')).toBeVisible();
    await expect(window.locator('.toc-panel')).toBeVisible();
    await expect.poll(() => window.locator('.shell').evaluate((shell) => ({
      project: getComputedStyle(shell).getPropertyValue('--project-sidebar-width'),
      outline: getComputedStyle(shell).getPropertyValue('--toc-panel-width'),
    }))).toEqual(before);
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});
