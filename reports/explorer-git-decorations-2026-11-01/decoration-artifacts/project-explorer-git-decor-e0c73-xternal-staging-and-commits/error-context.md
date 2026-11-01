# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: project/explorer-git-decorations.spec.ts >> Explorer renders upstream Git states, ignores and collapsed ancestors, and follows external staging and commits
- Location: test/e2e/project/explorer-git-decorations.spec.ts:11:1

# Error details

```
Error: expect(locator).toHaveCSS(expected) failed

Locator:  locator('.scm-group').filter({ has: locator('.scm-heading strong').filter({ hasText: /^STAGED CHANGES$/ }) }).locator('.git-change').filter({ has: locator('.git-change-open > span').filter({ hasText: /^added-partial\.md$/ }) }).locator('.git-change-open > span')
Expected: "rgb(129, 184, 139)"
Received: "rgb(115, 201, 145)"
Timeout:  5000ms

Call log:
  - Expect "toHaveCSS" locator('.scm-group').filter({ has: locator('.scm-heading strong').filter({ hasText: /^STAGED CHANGES$/ }) }).locator('.git-change').filter({ has: locator('.git-change-open > span').filter({ hasText: /^added-partial\.md$/ }) }).locator('.git-change-open > span') with timeout 5000ms
  - waiting for locator('.scm-group').filter({ has: locator('.scm-heading strong').filter({ hasText: /^STAGED CHANGES$/ }) }).locator('.git-change').filter({ has: locator('.git-change-open > span').filter({ hasText: /^added-partial\.md$/ }) }).locator('.git-change-open > span')
    14 × locator resolved to <span>added-partial.md</span>
       - unexpected value "rgb(115, 201, 145)"

```

```yaml
- text: added-partial.md
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { execFile } from 'node:child_process';
  3   | import { promisify } from 'node:util';
  4   | import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
  5   | import os from 'node:os';
  6   | import path from 'node:path';
  7   | import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
  8   | 
  9   | const exec = promisify(execFile);
  10  | 
  11  | test('Explorer renders upstream Git states, ignores and collapsed ancestors, and follows external staging and commits', async () => {
  12  |   test.setTimeout(120_000);
  13  |   const temporary = await mkdtemp(path.join(os.tmpdir(), 'setdown-explorer-decorations-'));
  14  |   const root = path.join(temporary, 'workspace'); await mkdir(root);
  15  |   const git = (...args: string[]) => exec('git', args, { cwd: root });
  16  |   const write = (name: string, text: string) => writeFile(path.join(root, name), text);
  17  |   let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  18  |   try {
  19  |     await git('init', '-b', 'main'); await git('config', 'user.email', 'test@example.test'); await git('config', 'user.name', 'Setdown Test');
  20  |     for (const dir of ['src', 'removed', 'build', 'cache']) await mkdir(path.join(root, dir));
  21  |     for (const name of ['changed.md', 'staged.md', 'partial.md', 'conflict.md', 'tracked.log', 'src/old.md', 'src/keep.md', 'removed/gone.md', 'removed/keep.md']) await write(name, '# Base\n');
  22  |     await write('.gitignore', 'build/\ncache/*.log\n!cache/keep.log\ntracked.log\n');
  23  |     await git('add', '.'); await git('add', '-f', 'tracked.log'); await git('commit', '-m', 'base');
  24  |     await git('checkout', '-b', 'other'); await write('conflict.md', '# Other\n'); await git('commit', '-am', 'other');
  25  |     await git('checkout', 'main'); await write('conflict.md', '# Ours\n'); await git('commit', '-am', 'ours');
  26  |     await expect(git('merge', 'other')).rejects.toThrow();
  27  |     for (const name of ['changed.md', 'staged.md', 'partial.md']) await write(name, '# Modified\n');
  28  |     await write('added.md', '# Added\n'); await write('added-partial.md', '# Added\n');
  29  |     await git('add', 'staged.md', 'partial.md', 'added.md', 'added-partial.md');
  30  |     await write('added-partial.md', '# Edited after adding\n');
  31  |     await write('partial.md', '# Modified after staging\n');
  32  |     await git('mv', 'src/old.md', 'renamed.md'); await rm(path.join(root, 'removed/gone.md'));
  33  |     await write('new.md', '# New\n'); await write('build/output.md', '# Ignored\n');
  34  |     await write('cache/ignored.log', 'ignored'); await write('cache/keep.log', 'included');
  35  |     const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  36  |     app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: path.join(temporary, 'config') } });
  37  |     await focusApplication(app); const page = await app.firstWindow();
  38  |     await page.evaluate(root => window.marktex.restoreProjectFolder(root), root); await page.reload();
  39  |     await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  40  |     await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  41  |     const row = (name: string) => page.locator('.explorer-row').filter({ has: page.locator('.explorer-entry-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
  42  |     const status = async (name: string, value: string) => { await expect(row(name)).toHaveAttribute('data-git-status', value); };
  43  |     for (const [name, state, badge] of [
  44  |       ['changed.md', 'Modified', 'M'], ['staged.md', 'Index Modified', 'M'], ['partial.md', 'Modified', 'M'],
  45  |       ['added.md', 'Index Added', 'A'], ['renamed.md', 'Index Renamed', 'R'], ['new.md', 'Untracked', 'U'],
  46  |       ['conflict.md', 'Conflict: Both Modified', '!'],
  47  |     ]) {
  48  |       await status(name, state); await expect(row(name).locator('.explorer-git-badge')).toHaveText(badge);
  49  |       await expect(row(name)).toHaveAccessibleName(`${name} • ${state}`);
  50  |     }
  51  |     await status('src', 'contains-changes'); await expect(row('src')).toHaveAttribute('aria-expanded', 'false');
  52  |     await expect(row('src').locator('.explorer-git-badge')).toHaveText('●');
  53  |     await expect(row('removed')).not.toHaveAttribute('data-git-status');
  54  |     await status('build', 'Ignored'); await expect(row('build').locator('.explorer-git-badge')).toHaveCount(0);
  55  |     await row('build').click(); await status('output.md', 'Ignored');
  56  |     await row('cache').click(); await status('ignored.log', 'Ignored'); await status('keep.log', 'Untracked');
  57  |     await expect(row('tracked.log')).not.toHaveAttribute('data-git-status');
  58  |     await expect(row('changed.md').locator('.explorer-entry-name')).toHaveCSS('color', 'rgb(137, 85, 3)');
  59  |     await expect(row('build').locator('.explorer-entry-name')).toHaveCSS('color', 'rgb(142, 142, 144)');
  60  |     await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath('git-decorations-light.png') });
  61  |     await page.getByRole('button', { name: 'Source Control', exact: true }).click();
  62  |     const group = (title: string) => page.locator('.scm-group').filter({ has: page.locator('.scm-heading strong', { hasText: new RegExp(`^${title}$`) }) });
  63  |     const scmRow = (title: string, name: string) => group(title).locator('.git-change').filter({ has: page.locator('.git-change-open > span', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) });
  64  |     const stagedAddition = scmRow('STAGED CHANGES', 'added-partial.md');
  65  |     const unstagedAddition = scmRow('CHANGES', 'added-partial.md');
  66  |     await expect(stagedAddition.locator('b')).toHaveText('A');
  67  |     await expect(stagedAddition.locator('.git-change-open > span')).toHaveCSS('color', 'rgb(88, 124, 12)');
  68  |     await expect(stagedAddition.locator('b')).toHaveCSS('color', 'rgb(88, 124, 12)');
  69  |     await expect(unstagedAddition.locator('b')).toHaveText('M');
  70  |     await expect(unstagedAddition.locator('.git-change-open > span')).toHaveCSS('color', 'rgb(137, 85, 3)');
  71  |     await expect(scmRow('MERGE CHANGES', 'conflict.md').locator('.git-change-open > span')).toHaveCSS('color', 'rgb(173, 7, 7)');
  72  |     const deletion = scmRow('CHANGES', 'gone.md');
  73  |     await expect(deletion.locator('.git-change-open > span')).toHaveCSS('color', 'rgb(173, 7, 7)');
  74  |     expect(await deletion.locator('small').evaluate(element => getComputedStyle(element).color)).not.toBe('rgb(173, 7, 7)');
  75  |     await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath('source-control-colors-light.png') });
  76  |     await page.getByRole('button', { name: 'View', exact: true }).click();
  77  |     await page.locator('[data-menu-item-id="menu-theme"]').hover();
  78  |     await page.locator('[data-menu-item-id="preview-theme-vscode-dark-2026"]').click();
> 79  |     await expect(stagedAddition.locator('.git-change-open > span')).toHaveCSS('color', 'rgb(129, 184, 139)');
      |                                                                     ^ Error: expect(locator).toHaveCSS(expected) failed
  80  |     await expect(unstagedAddition.locator('.git-change-open > span')).toHaveCSS('color', 'rgb(226, 192, 141)');
  81  |     await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath('source-control-colors-dark.png') });
  82  |     await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  83  |     await expect(row('changed.md').locator('.explorer-entry-name')).toHaveCSS('color', 'rgb(226, 192, 141)');
  84  |     await page.locator('.project-sidebar').screenshot({ path: test.info().outputPath('git-decorations-dark.png') });
  85  |     // Selection, focus and keyed row identity survive a metadata-only refresh.
  86  |     await row('partial.md').focus();
  87  |     await row('partial.md').evaluate(element => { (window as any).__decoratedRow = element; });
  88  |     await git('add', 'partial.md'); await status('partial.md', 'Index Modified');
  89  |     await expect(row('partial.md')).toBeFocused();
  90  |     expect(await row('partial.md').evaluate(element => element === (window as any).__decoratedRow)).toBe(true);
  91  |     await git('reset', 'HEAD', '--', 'partial.md'); await status('partial.md', 'Modified');
  92  |     await write('.gitignore', 'tracked.log\n');
  93  |     await status('output.md', 'Untracked'); await status('ignored.log', 'Untracked');
  94  |     await write('conflict.md', '# Resolved\n'); await git('add', '.'); await git('commit', '-m', 'resolved');
  95  |     await expect(page.locator('.explorer-row[data-git-status]')).toHaveCount(0);
  96  |   } finally { if (app) await disposeApplication(app); await rm(temporary, { recursive: true, force: true }); }
  97  | });
  98  | 
  99  | test('Explorer decorates all visible repositories and clears status when the folder changes', async () => {
  100 |   const temporary = await mkdtemp(path.join(os.tmpdir(), 'setdown-explorer-multiple-'));
  101 |   const root = path.join(temporary, 'workspace'); await mkdir(root);
  102 |   let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  103 |   try {
  104 |     for (const name of ['one', 'two']) {
  105 |       const cwd = path.join(root, name); await mkdir(cwd); await exec('git', ['init'], { cwd });
  106 |       await writeFile(path.join(cwd, 'new.md'), '# New\n');
  107 |     }
  108 |     const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  109 |     app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: path.join(temporary, 'config') } });
  110 |     await focusApplication(app); const page = await app.firstWindow();
  111 |     await page.evaluate(root => window.marktex.restoreProjectFolder(root), root); await page.reload();
  112 |     await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  113 |     await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  114 |     await expect(page.locator('.explorer-row[data-git-status="contains-changes"]')).toHaveCount(2);
  115 |     for (const name of ['one', 'two']) await page.getByRole('treeitem', { name: `${name} • Contains emphasized items`, exact: true }).click();
  116 |     await expect(page.locator('.explorer-row[data-git-status="Untracked"]')).toHaveCount(2);
  117 |     await page.getByRole('button', { name: 'Source Control', exact: true }).click();
  118 |     await page.getByRole('combobox', { name: 'Git repository' }).selectOption(path.join(root, 'two'));
  119 |     await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  120 |     await expect(page.locator('.explorer-row[data-git-status="Untracked"]')).toHaveCount(2);
  121 |     const clean = path.join(temporary, 'plain'); await mkdir(clean); await writeFile(path.join(clean, 'new.md'), '# Plain\n');
  122 |     await page.evaluate(root => window.marktex.restoreProjectFolder(root), clean); await page.reload();
  123 |     await expect(page.locator('.explorer-row')).toHaveCount(1);
  124 |     await expect(page.locator('.explorer-row[data-git-status]')).toHaveCount(0);
  125 |   } finally { if (app) await disposeApplication(app); await rm(temporary, { recursive: true, force: true }); }
  126 | });
  127 | 
```