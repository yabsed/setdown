import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';

const exec = promisify(execFile);

test('Explorer renders upstream Git states, ignores and collapsed ancestors, and follows external staging and commits', async () => {
  test.setTimeout(120_000);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'setdown-explorer-decorations-'));
  const root = path.join(temporary, 'workspace'); await mkdir(root);
  const git = (...args: string[]) => exec('git', args, { cwd: root });
  const write = (name: string, text: string) => writeFile(path.join(root, name), text);
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await git('init', '-b', 'main'); await git('config', 'user.email', 'test@example.test'); await git('config', 'user.name', 'Setdown Test');
    for (const dir of ['src', 'removed', 'build', 'cache']) await mkdir(path.join(root, dir));
    for (const name of ['changed.md', 'staged.md', 'partial.md', 'conflict.md', 'tracked.log', 'src/old.md', 'src/keep.md', 'removed/gone.md', 'removed/keep.md']) await write(name, '# Base\n');
    await write('.gitignore', 'build/\ncache/*.log\n!cache/keep.log\ntracked.log\n');
    await git('add', '.'); await git('add', '-f', 'tracked.log'); await git('commit', '-m', 'base');
    await git('checkout', '-b', 'other'); await write('conflict.md', '# Other\n'); await git('commit', '-am', 'other');
    await git('checkout', 'main'); await write('conflict.md', '# Ours\n'); await git('commit', '-am', 'ours');
    await expect(git('merge', 'other')).rejects.toThrow();
    for (const name of ['changed.md', 'staged.md', 'partial.md']) await write(name, '# Modified\n');
    await write('added.md', '# Added\n'); await write('added-partial.md', '# Added\n');
    await git('add', 'staged.md', 'partial.md', 'added.md', 'added-partial.md');
    await write('added-partial.md', '# Edited after adding\n');
    await write('partial.md', '# Modified after staging\n');
    await git('mv', 'src/old.md', 'renamed.md'); await rm(path.join(root, 'removed/gone.md'));
    await write('new.md', '# New\n'); await write('build/output.md', '# Ignored\n');
    await write('cache/ignored.log', 'ignored'); await write('cache/keep.log', 'included');
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: path.join(temporary, 'config') } });
    await focusApplication(app); const page = await app.firstWindow();
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), root); await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    const row = (name: string) => page.locator('.explorer-row').filter({ has: page.locator('.explorer-entry-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
    const status = async (name: string, value: string) => { await expect(row(name)).toHaveAttribute('data-git-status', value); };
    for (const [name, state, badge] of [
      ['changed.md', 'Modified', 'M'], ['staged.md', 'Index Modified', 'M'], ['partial.md', 'Modified', 'M'],
      ['added.md', 'Index Added', 'A'], ['renamed.md', 'Index Renamed', 'R'], ['new.md', 'Untracked', 'U'],
      ['conflict.md', 'Conflict: Both Modified', '!'],
    ]) {
      await status(name, state); await expect(row(name).locator('.explorer-git-badge')).toHaveText(badge);
      await expect(row(name)).toHaveAccessibleName(`${name} • ${state}`);
    }
    await status('src', 'contains-changes'); await expect(row('src')).toHaveAttribute('aria-expanded', 'false');
    await expect(row('src').locator('.explorer-git-badge')).toHaveText('●');
    await expect(row('removed')).not.toHaveAttribute('data-git-status');
    await status('build', 'Ignored'); await expect(row('build').locator('.explorer-git-badge')).toHaveCount(0);
    await row('build').click(); await status('output.md', 'Ignored');
    await row('cache').click(); await status('ignored.log', 'Ignored'); await status('keep.log', 'Untracked');
    await expect(row('tracked.log')).not.toHaveAttribute('data-git-status');
    await expect(row('changed.md').locator('.explorer-entry-name')).toHaveCSS('color', 'rgb(137, 85, 3)');
    await expect(row('build').locator('.explorer-entry-name')).toHaveCSS('color', 'rgb(142, 142, 144)');
    await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath('git-decorations-light.png') });
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const group = (title: string) => page.locator('.scm-group').filter({ has: page.locator('.scm-heading strong', { hasText: new RegExp(`^${title}$`) }) });
    const scmRow = (title: string, name: string) => group(title).locator('.git-change').filter({ has: page.locator('.git-change-open > span', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) });
    const stagedAddition = scmRow('STAGED CHANGES', 'added-partial.md');
    const unstagedAddition = scmRow('CHANGES', 'added-partial.md');
    await expect(stagedAddition.locator('b')).toHaveText('A');
    await expect(stagedAddition.locator('.git-change-open > span')).toHaveCSS('color', 'rgb(88, 124, 12)');
    await expect(stagedAddition.locator('b')).toHaveCSS('color', 'rgb(88, 124, 12)');
    await expect(unstagedAddition.locator('b')).toHaveText('M');
    await expect(unstagedAddition.locator('.git-change-open > span')).toHaveCSS('color', 'rgb(137, 85, 3)');
    await expect(scmRow('MERGE CHANGES', 'conflict.md').locator('.git-change-open > span')).toHaveCSS('color', 'rgb(173, 7, 7)');
    const deletion = scmRow('CHANGES', 'gone.md');
    await expect(deletion.locator('.git-change-open > span')).toHaveCSS('color', 'rgb(173, 7, 7)');
    expect(await deletion.locator('small').evaluate(element => getComputedStyle(element).color)).not.toBe('rgb(173, 7, 7)');
    await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath('source-control-colors-light.png') });
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.locator('[data-menu-item-id="menu-theme"]').hover();
    await page.locator('[data-menu-item-id="preview-theme-vscode-dark-2026"]').click();
    // This imported theme overrides the extension's generic dark defaults.
    await expect(stagedAddition.locator('.git-change-open > span')).toHaveCSS('color', 'rgb(115, 201, 145)');
    await expect(unstagedAddition.locator('.git-change-open > span')).toHaveCSS('color', 'rgb(229, 186, 125)');
    await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath('source-control-colors-dark.png') });
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await expect(row('changed.md').locator('.explorer-entry-name')).toHaveCSS('color', 'rgb(229, 186, 125)');
    await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath('git-decorations-dark.png') });
    // Selection, focus and keyed row identity survive a metadata-only refresh.
    await row('partial.md').focus();
    await row('partial.md').evaluate(element => { (window as any).__decoratedRow = element; });
    await git('add', 'partial.md'); await status('partial.md', 'Index Modified');
    await expect(row('partial.md')).toBeFocused();
    expect(await row('partial.md').evaluate(element => element === (window as any).__decoratedRow)).toBe(true);
    await git('reset', 'HEAD', '--', 'partial.md'); await status('partial.md', 'Modified');
    await write('.gitignore', 'tracked.log\n');
    await status('output.md', 'Untracked'); await status('ignored.log', 'Untracked');
    await write('conflict.md', '# Resolved\n'); await git('add', '.'); await git('commit', '-m', 'resolved');
    await expect(page.locator('.explorer-row[data-git-status]')).toHaveCount(0);
  } finally { if (app) await disposeApplication(app); await rm(temporary, { recursive: true, force: true }); }
});

test('Explorer decorates all visible repositories and clears status when the folder changes', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'setdown-explorer-multiple-'));
  const root = path.join(temporary, 'workspace'); await mkdir(root);
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    for (const name of ['one', 'two']) {
      const cwd = path.join(root, name); await mkdir(cwd); await exec('git', ['init'], { cwd });
      await writeFile(path.join(cwd, 'new.md'), '# New\n');
    }
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: path.join(temporary, 'config') } });
    await focusApplication(app); const page = await app.firstWindow();
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), root); await page.reload();
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await expect(page.locator('.explorer-row[data-git-status="contains-changes"]')).toHaveCount(2);
    for (const name of ['one', 'two']) await page.getByRole('treeitem', { name: `${name} • Contains emphasized items`, exact: true }).click();
    await expect(page.locator('.explorer-row[data-git-status="Untracked"]')).toHaveCount(2);
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    await page.getByRole('combobox', { name: 'Git repository' }).selectOption(path.join(root, 'two'));
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await expect(page.locator('.explorer-row[data-git-status="Untracked"]')).toHaveCount(2);
    const clean = path.join(temporary, 'plain'); await mkdir(clean); await writeFile(path.join(clean, 'new.md'), '# Plain\n');
    await page.evaluate(root => window.marktex.restoreProjectFolder(root), clean); await page.reload();
    await expect(page.locator('.explorer-row')).toHaveCount(1);
    await expect(page.locator('.explorer-row[data-git-status]')).toHaveCount(0);
  } finally { if (app) await disposeApplication(app); await rm(temporary, { recursive: true, force: true }); }
});
