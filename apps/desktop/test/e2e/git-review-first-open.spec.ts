import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication, focusApplication } from './electron-app';
import { previews } from './preview-view';

const exec = promisify(execFile);

test('first Working Tree opens directly in Monaco without an ordinary Viewer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-first-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-first-config-'));
  const documentPath = path.join(root, 'review.md');
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await writeFile(documentPath, '# Original\n\n$$x^2 + y^2 = z^2$$\n');
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(documentPath, '# Working tree\n\n$$x^2 + y^2 = z^2$$\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({ args: ['.'], env: { ...environment, XDG_CONFIG_HOME: configRoot } });
  try {
    const window = await application.firstWindow();
    await window.evaluate(async (folder) => {
      await (window as typeof window & {
        marktex: { restoreProjectFolder(path: string): Promise<unknown> };
      }).marktex.restoreProjectFolder(folder);
    }, root);
    await Promise.all([window.waitForEvent('load'), window.reload()]);
    await focusApplication(application);
    await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await window.getByRole('button', { name: 'Source Control', exact: true }).click();
    await application.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { reviewOpeningShows: string[] };
      state.reviewOpeningShows = [];
      ipcMain.on('preview:show', (_event, request: { tabId: string | null }) => {
        if (request.tabId) state.reviewOpeningShows.push(request.tabId);
      });
    });
    await window.locator('.git-change-open').click();
    const modified = window.locator('.modified-in-monaco-diff-editor');
    await expect(modified.locator('.view-lines')).toContainText('Working tree');
    await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
    const shown = () => application.evaluate(() =>
      (globalThis as typeof globalThis & { reviewOpeningShows: string[] }).reviewOpeningShows);
    expect(await shown()).toEqual([]);

    const source = modified.getByRole('textbox');
    await source.press('Control+End');
    await source.pressSequentially('\nShared edit');
    await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);
    // The ordinary editor must borrow the exact same model/history on first use.
    await window.locator('.git-diff-tab .tab-close').click();
    await expect.poll(previews(application).hasVisible).toBe(true);
    await window.getByRole('button', { name: 'Switch to Editor' }).click();
    const ordinary = window.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await expect(window.locator('.editor-surface .view-lines')).toContainText('Shared edit');
    await ordinary.press('Control+z');
    await expect(window.locator('.editor-surface .view-lines')).not.toContainText('Shared edit');
    await ordinary.press('Control+Shift+z');
    await ordinary.press('Control+s');
    await expect.poll(() => readFile(documentPath, 'utf8')).toContain('Shared edit');

    await window.locator('.git-change-open').click();
    await expect(modified.locator('.view-lines')).toContainText('Shared edit');
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});
