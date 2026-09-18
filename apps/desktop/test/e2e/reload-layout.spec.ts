import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';

test('restores side panels and their widths after Reload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-reload-layout-'));
  const documentPath = path.join(root, 'reload.md');
  await writeFile(documentPath, '# Reload layout\n\nBody', 'utf8');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({ args: ['.', documentPath], env: environment });

  try {
    const window = await application.firstWindow();
    await window.locator('.product-identity').click();
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
    await expect(window.locator('.toc-panel')).toBeVisible();
    await expect.poll(() => window.locator('.shell').evaluate((shell) => ({
      project: getComputedStyle(shell).getPropertyValue('--project-sidebar-width'),
      outline: getComputedStyle(shell).getPropertyValue('--toc-panel-width'),
    }))).toEqual(before);
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});
