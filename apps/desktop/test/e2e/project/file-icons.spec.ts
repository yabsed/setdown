import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';

const exec = promisify(execFile);
test('Seti icons follow file types in Explorer, both Git groups and history, in light and dark themes', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'setdown-file-icons-'));
  const root = path.join(temporary, 'repo');
  const files = { 'guide.md': '_markdown', 'README.md': '_info', 'index.ts': '_typescript', 'App.svelte': '_svelte', 'package.json': '_json', 'image.png': '_image', 'report.csv': '_csv', 'unknown.custom': '_default' };
  const git = (...args: string[]) => exec('git', args, { cwd: root });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await exec('git', ['init', '-b', 'main', root]);
    await git('config', 'user.name', 'Icon Test'); await git('config', 'user.email', 'icons@example.test');
    for (const file of Object.keys(files)) await writeFile(path.join(root, file), 'original\n');
    await git('add', '.'); await git('commit', '-m', 'Files with icons');
    await mkdir(path.join(root, 'docs')); await writeFile(path.join(root, 'docs', 'note.md'), 'note\n');
    for (const file of Object.keys(files)) await writeFile(path.join(root, file), 'changed\n');
    await git('add', 'index.ts', 'App.svelte');
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: path.join(temporary, 'config') } });
    const page = await app.firstWindow();
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), root); await page.reload(); await focusApplication(app);
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    for (const theme of ['github-light', 'night']) {
      await app.evaluate(({ Menu }, theme) => { Menu.getApplicationMenu()?.getMenuItemById(`preview-theme-${theme}`)?.click(); }, theme);
      await page.getByRole('button', { name: 'Explorer', exact: true }).click();
      for (const [file, icon] of Object.entries(files)) {
        const row = page.locator('.explorer-row').filter({ has: page.locator('.explorer-entry-name', { hasText: file }) });
        await expect(row.locator('.file-type-icon')).toHaveAttribute('data-file-icon', icon);
        await expect(row.locator('.file-type-icon')).toHaveCSS('font-family', '"Setdown Seti"');
      }
      await page.evaluate(() => document.fonts.load('24px "Setdown Seti"'));
      expect(await page.evaluate(() => document.fonts.check('24px "Setdown Seti"'))).toBe(true);
      await expect(page.locator('.explorer-row [data-file-icon="_markdown"]')).toHaveCSS('color', theme === 'night' ? 'rgb(81, 154, 186)' : 'rgb(73, 139, 167)');
      await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath(`explorer-icons-${theme}.png`) });
      await page.getByRole('button', { name: 'Source Control', exact: true }).click();
      for (const [file, icon] of Object.entries(files)) {
        const row = page.locator('.git-change-open').filter({ has: page.locator('.git-change-name', { hasText: file }) });
        await expect(row.locator('.file-type-icon')).toHaveAttribute('data-file-icon', icon);
        expect((await row.locator('.file-type-icon').boundingBox())!.width).toBe(16);
      }
      const graph = page.locator('web-git-graph');
      if (!(await graph.locator('.tree-file').count())) await graph.locator('.row').first().click();
      await expect(graph.locator('.tree-file [data-file-icon="_typescript"]')).toBeVisible();
      await expect(graph.locator('.tree-file [data-file-icon="_markdown"]')).toHaveCSS('color', theme === 'night' ? 'rgb(81, 154, 186)' : 'rgb(73, 139, 167)');
      await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath(`git-icons-${theme}.png`) });
    }
  } finally { if (app) await disposeApplication(app); await rm(temporary, { recursive: true, force: true }); }
});
