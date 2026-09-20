import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import type { MarkTexApi } from '../../src/protocol/desktop-api';
import { disposeApplication } from './electron-app';

const exec = promisify(execFile);
const value = (page: Page) => page.evaluate(async () =>
  (await (window as typeof window & { marktex: MarkTexApi }).marktex.getDocument())?.text);

for (const extension of ['md', 'txt']) {
  test(`ordinary and Working Tree share Undo/Redo, including review reopen (${extension})`, async () => {
    test.setTimeout(60_000);
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-shared-undo-'));
    const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-shared-config-'));
    const file = path.join(root, `shared.${extension}`);
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await exec('git', ['init'], { cwd: root });
      await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
      await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
      await writeFile(file, 'base\n');
      await exec('git', ['add', '.'], { cwd: root });
      await exec('git', ['commit', '-m', 'base'], { cwd: root });
      const initial = 'working\n';
      await writeFile(file, initial);
      const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
      app = await electron.launch({ args: ['.', file], env: { ...environment, XDG_CONFIG_HOME: config } });
      const page = await app.firstWindow();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 900));
      await page.evaluate(async (root) => {
        await (window as typeof window & { marktex: MarkTexApi }).marktex.restoreProjectFolder(root);
      }, root);
      await Promise.all([page.waitForEvent('load'), page.reload()]);
      await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
      await page.getByRole('button', { name: 'Source Control', exact: true }).click();
      if (extension === 'md') await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
      const ordinary = page.locator('.editor-host').getByRole('textbox');
      await ordinary.press('Control+End');
      await ordinary.pressSequentially('from-file');
      await expect.poll(() => value(page)).toBe(initial + 'from-file');
      const changes = page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) });
      await changes.locator('.git-change-open').click();
      const working = page.locator('.git-diff-editor').getByRole('textbox').nth(1);
      await working.press('Control+z');
      await expect.poll(() => value(page)).toBe(initial);
      await working.press('Control+Shift+z');
      await expect.poll(() => value(page)).toBe(initial + 'from-file');
      await working.press('Control+End');
      await working.pressSequentially('-from-review');
      await expect.poll(() => value(page)).toBe(initial + 'from-file-from-review');
      await page.locator('.document-tab:not(.git-diff-tab)').click();
      await ordinary.press('Control+z');
      await expect.poll(() => value(page)).toBe(initial + 'from-file');
      await ordinary.press('Control+Shift+z');
      await expect.poll(() => value(page)).toBe(initial + 'from-file-from-review');
      // Saving and replacing the Index snapshot must not replace the live model.
      await ordinary.press('Control+s');
      await expect(page.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(0);
      await page.evaluate(async (file) => {
        await (window as typeof window & { marktex: MarkTexApi }).marktex.stageGit([file]);
      }, file);
      await page.locator('.git-diff-tab .tab-close').click();
      await page.evaluate(async () => {
        // No renderer reload: the document session must remain alive.
        await (window as typeof window & { marktex: MarkTexApi }).marktex.getGitStatus();
      });
      await ordinary.press('Control+z');
      await expect.poll(() => value(page)).toBe(initial + 'from-file');
      await ordinary.press('Control+Shift+z');
      await expect.poll(() => value(page)).toBe(initial + 'from-file-from-review');
      // Reset disk/index through Git so CHANGES remains selectable, without
      // replacing the in-memory model or requiring autosave for review contents.
      await exec('git', ['reset', 'HEAD', '--', path.basename(file)], { cwd: root });
      await page.getByRole('button', { name: 'Refresh Source Control', exact: true }).click();
      await changes.locator('.git-change-open').click();
      await working.press('Control+z');
      await expect.poll(() => value(page)).toBe(initial + 'from-file');
    } finally {
      if (app) await disposeApplication(app);
      await rm(root, { recursive: true, force: true });
      await rm(config, { recursive: true, force: true });
    }
  });
}
