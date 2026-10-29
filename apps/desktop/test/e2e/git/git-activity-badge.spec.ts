import { electron } from '../../support/electron/electron-app';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { disposeApplication } from '../../support/electron/electron-app';

const exec = promisify(execFile);

test('Git activity badge counts pending resources and refreshes without opening Source Control', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-badge-'));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-badge-config-'));
  const documentPath = path.join(root, 'note.md');
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await exec('git', ['init'], { cwd: root });
    await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
    await writeFile(documentPath, '# Base\n');
    await exec('git', ['add', '.'], { cwd: root });
    await exec('git', ['commit', '-m', 'base'], { cwd: root });
    const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
    application = await electron.launch({ args: ['.', documentPath], env: { ...environment, XDG_CONFIG_HOME: configRoot } });
    const window = await application.firstWindow();
    await window.evaluate(async (folderPath) => {
      await (window as typeof window & { marktex: { restoreProjectFolder(path: string): Promise<unknown> } })
        .marktex.restoreProjectFolder(folderPath);
    }, root);
    await Promise.all([window.waitForEvent('load'), window.reload()]);
    await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    const icon = window.getByRole('button', { name: 'Source Control', exact: true });
    const badge = icon.locator('.scm-activity-badge');
    await expect(badge).toHaveCount(0);
    // External document writes must update the icon while Explorer is selected.
    await writeFile(documentPath, '# Changed\n');
    await writeFile(path.join(root, 'second.md'), '# New document\n');
    await expect(badge).toHaveText('2');
    await expect(icon).toHaveAccessibleDescription('2 pending changes');
    await icon.click();
    const changed = window.locator('.scm-group').filter({ has: window.getByText('CHANGES', { exact: true }) });
    const staged = window.locator('.scm-group').filter({ has: window.getByText('STAGED CHANGES', { exact: true }) });
    await changed.getByRole('button', { name: 'Stage All', exact: true }).click();
    await expect(staged.locator('.git-change-open')).toHaveCount(2);
    await expect(badge).toHaveText('2');
    await writeFile(documentPath, '# Changed again\n');
    await expect(badge).toHaveText('3'); // note.md appears in both index and working tree.
    await changed.getByRole('button', { name: 'Collapse CHANGES' }).click();
    await expect(badge).toHaveText('3');
    await changed.getByRole('button', { name: 'Expand CHANGES' }).click();
    await changed.getByRole('button', { name: 'Stage All', exact: true }).click();
    await expect(changed.locator('.git-change-open')).toHaveCount(0);
    await expect(badge).toHaveText('2');
    await window.getByRole('textbox', { name: 'Commit message' }).fill('both documents');
    await window.getByRole('button', { name: 'Commit', exact: true }).click();
    await expect(badge).toHaveCount(0);
  } finally {
    if (application) await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('long repository paths fit the sidebar and the badge includes other repositories', async () => {
  test.setTimeout(60_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-scm-layout-'));
  const workspace = path.join(root, 'workspace');
  const repositories = ['first', 'second'].map(name => path.join(workspace,
    `${name}-repository-with-a-very-long-name-that-must-not-widen-the-source-control-sidebar`));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    for (const cwd of repositories) {
      await mkdir(cwd, { recursive: true });
      await exec('git', ['init', '-b', 'feature/long-branch-name-that-also-needs-to-fit-within-the-sidebar'], { cwd });
      await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd });
      await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd });
      await writeFile(path.join(cwd, 'note.md'), '# Base\n');
      await exec('git', ['add', '.'], { cwd });
      await exec('git', ['commit', '-m', 'base'], { cwd });
    }
    const [first, second] = repositories;
    await writeFile(path.join(second, 'note.md'), '# Modified\n');
    await Promise.all(Array.from({ length: 71 }, (_, index) => writeFile(path.join(second, `new-${index}.txt`), 'new')));
    await mkdir(path.join(root, 'config/Setdown'), { recursive: true });
    await writeFile(path.join(root, 'config/Setdown/reader-settings.json'), JSON.stringify({ previewTheme: 'solarized-light' }));
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    application = await electron.launch({ args: ['.', path.join(first, 'note.md')], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
    const page = await application.firstWindow();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), workspace);
    await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    const icon = page.getByRole('button', { name: 'Source Control', exact: true });
    const badge = icon.locator('.scm-activity-badge');
    await expect(badge).toHaveText('72');
    await expect(icon).toHaveAccessibleDescription('72 pending changes across 2 repositories');
    await icon.click();
    const picker = page.getByRole('combobox', { name: 'Git repository' });
    await picker.selectOption(first);
    await expect(page.getByText('No changes.', { exact: true })).toBeVisible();
    await expect(badge).toHaveText('72');
    for (const width of [220, 400]) {
      await page.evaluate(width => document.documentElement.style.setProperty('--project-sidebar-width', `${width}px`), width);
      await picker.focus();
      await expect(picker).toBeFocused();
      await expect(picker).toHaveAttribute('title', first);
      const layout = await page.locator('.scm-changes-pane').evaluate(pane => {
        const select = pane.querySelector('select')!;
        const bounds = pane.getBoundingClientRect(), selected = select.getBoundingClientRect();
        return { overflow: pane.scrollWidth - pane.clientWidth, inside: selected.left >= bounds.left && selected.right <= bounds.right,
          ellipsis: getComputedStyle(select).textOverflow, minWidth: selected.width };
      });
      expect(layout).toMatchObject({ inside: true, ellipsis: 'ellipsis' });
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.minWidth).toBeGreaterThan(50);
      await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath(`scm-${width}.png`) });
    }
    // A metadata-only update in the unselected repository must refresh the badge.
    await exec('git', ['add', 'note.md'], { cwd: second });
    await writeFile(path.join(second, 'note.md'), '# Edited after staging\n');
    await expect(badge).toHaveText('73');
    await exec('git', ['reset', 'HEAD', '--', 'note.md'], { cwd: second });
    await expect(badge).toHaveText('72');
    await picker.selectOption(second);
    await expect(picker).toHaveValue(second);
    await expect(picker).toHaveAttribute('title', second);
    await expect(page.locator('.git-change-open')).toHaveCount(72);
    await expect(badge).toHaveText('72');
  } finally {
    if (application) await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});
