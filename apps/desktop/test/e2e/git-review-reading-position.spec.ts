import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from './electron-app';

const exec = promisify(execFile);
type Application = Awaited<ReturnType<typeof electron.launch>>;

async function visibleReview(application: Application, script = 'window.scrollY') {
  return application.evaluate(async ({ BrowserWindow }, script) => {
    const owner = BrowserWindow.getAllWindows().find((window) => window.isVisible());
    for (const view of owner?.contentView.children ?? []) {
      if (!('webContents' in view) || !view.getVisible()) continue;
      if (!await view.webContents.executeJavaScript(
        'Boolean(document.querySelector(".setdown-rendered-diff-split"))',
      ).catch(() => false)) continue;
      return { id: view.webContents.id, url: view.webContents.getURL(),
        value: await view.webContents.executeJavaScript(script) };
    }
    return null;
  }, script);
}

test('Viewer tab resume preserves its last reading position instead of the source cursor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-reading-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-reading-config-'));
  const file = path.join(root, 'reading.md');
  const body = Array.from({ length: 120 }, (_, i) =>
    `## Paragraph ${i + 1}\n\nReading content ${i + 1}.\n\n`).join('');
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  await writeFile(file, '# Base\n\n' + body);
  await exec('git', ['add', 'reading.md'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });
  await writeFile(file, '# Staged\n\n' + body);
  await exec('git', ['add', 'reading.md'], { cwd: root });
  await writeFile(file, '# Working\n\n' + body);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...environment, XDG_CONFIG_HOME: config } });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 900));
    await page.evaluate(async (root) => {
      await (window as typeof window & { marktex: { restoreProjectFolder(path: string): Promise<unknown> } })
        .marktex.restoreProjectFolder(root);
    }, root);
    await Promise.all([page.waitForEvent('load'), page.reload()]);
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control' }).click();
    const changed = page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) });
    const staged = page.locator('.scm-group').filter({ has: page.getByText('STAGED CHANGES', { exact: true }) });
    await changed.locator('.git-change-open').click();
    await page.getByRole('button', { name: 'View Rendered Diff' }).click();
    await expect.poll(() => visibleReview(app), { timeout: 20_000 }).not.toBeNull();
    const initial = (await visibleReview(app))!;
    await visibleReview(app, 'window.scrollTo(0, 2400); window.scrollY');
    await expect.poll(async () => (await visibleReview(app))?.value).toBe(2400);

    // Return from another review tab and from the ordinary document tab.
    await staged.locator('.git-change-open').click();
    await page.locator('.git-diff-tab').filter({ hasText: '(Working Tree)' }).click();
    await expect(page.getByRole('button', { name: 'View Source Diff' })).toBeVisible();
    await expect.poll(() => visibleReview(app)).toMatchObject({ id: initial.id, url: initial.url, value: 2400 });
    await page.locator('.document-tab:not(.git-diff-tab)').click();
    await page.locator('.git-diff-tab').filter({ hasText: '(Working Tree)' }).click();
    await expect.poll(() => visibleReview(app)).toMatchObject({ id: initial.id, url: initial.url, value: 2400 });

    // Explicit Source -> Esc is a different intent: it must follow the source,
    // rather than incorrectly preserving the old Viewer bookmark at 2400px.
    await page.getByRole('button', { name: 'View Source Diff' }).click();
    const input = page.locator('.git-diff-editor').getByRole('textbox').nth(1);
    await input.press('Control+Home');
    await input.press('Escape');
    await expect.poll(async () => (await visibleReview(app))?.value).toBe(0);
    await expect(page.getByRole('button', { name: 'View Source Diff' })).toBeVisible();
  } finally {
    await disposeApplication(app);
    await rm(root, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
