# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: git/git-history.spec.ts >> unchanged Git refreshes preserve graph rows, scroll and keyboard focus
- Location: test/e2e/git/git-history.spec.ts:12:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 4
+ Received  + 4

  Object {
-   "detailsConnected": true,
-   "focused": true,
+   "detailsConnected": false,
+   "focused": false,
    "removedRows": 0,
-   "rowConnected": true,
-   "scrollDelta": 0,
+   "rowConnected": false,
+   "scrollDelta": -2364,
  }
```

# Test source

```ts
  1   | import { electron } from '../../support/electron/electron-app';
  2   | import { execFile } from 'node:child_process';
  3   | import { promisify } from 'node:util';
  4   | import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
  5   | import os from 'node:os';
  6   | import path from 'node:path';
  7   | import { expect, test } from '@playwright/test';
  8   | import { disposeApplication, focusApplication } from '../../support/electron/electron-app';
  9   | import { previews } from '../../support/preview/preview-view';
  10  | 
  11  | const exec = promisify(execFile);
  12  | test('unchanged Git refreshes preserve graph rows, scroll and keyboard focus', async () => {
  13  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-history-stable-'));
  14  |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-history-stable-config-'));
  15  |   const git = (...args: string[]) => exec('git', args, { cwd: root });
  16  |   let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  17  |   try {
  18  |     await git('init', '-b', 'main');
  19  |     await git('config', 'user.name', 'History Test');
  20  |     await git('config', 'user.email', 'history@example.test');
  21  |     await writeFile(path.join(root, 'note.md'), '# History\n');
  22  |     await git('add', '.'); await git('commit', '-m', 'Initial document');
  23  |     for (let index = 1; index < 110; index++) await git('commit', '--allow-empty', '-m', `History ${index}`);
  24  |     const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  25  |     app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: configRoot } });
  26  |     const window = await app.firstWindow();
  27  |     const errors: string[] = [];
  28  |     window.on('pageerror', error => errors.push(error.message));
  29  |     await window.evaluate(async folder => {
  30  |       await window.marktex.restoreProjectFolder(folder);
  31  |       sessionStorage.setItem('setdown:git-graph-panel', JSON.stringify({ expanded: true, ratio: .8 }));
  32  |     }, root);
  33  |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  34  |     await focusApplication(app);
  35  |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  36  |     await window.getByRole('button', { name: 'Source Control', exact: true }).click();
  37  |     const graph = window.locator('web-git-graph');
  38  |     await expect(graph.locator('.row').first()).toContainText('History 109');
  39  |     await expect(graph).toHaveAttribute('aria-busy', 'false');
  40  |     // Load the next page too: an unchanged refresh must not drop older rows.
  41  |     await graph.locator('.scroller').evaluate(element => { element.scrollTop = element.scrollHeight; });
  42  |     await expect.poll(() => graph.evaluate(element => (element as unknown as { data: { commits: unknown[] } }).data.commits.length)).toBe(110);
  43  |     await graph.locator('.row').last().click();
  44  |     await expect(graph.locator('.inline-details .tree-file')).toBeVisible();
  45  |     await expect(graph).toHaveAttribute('aria-busy', 'false');
  46  |     // Let the selected commit's reveal animation settle before observing it.
  47  |     await window.waitForTimeout(700);
  48  |     const observed = await graph.evaluateHandle(element => {
  49  |       const shadow = element.shadowRoot!;
  50  |       const row = shadow.querySelector<HTMLElement>('.row.selected')!;
  51  |       row.focus();
  52  |       const state = { removedRows: 0, row, scroll: shadow.querySelector('.scroller')!.scrollTop,
  53  |         details: shadow.querySelector('.inline-details')!, shadow };
  54  |       const observer = new MutationObserver(records => {
  55  |         for (const record of records) for (const node of record.removedNodes)
  56  |           if (node instanceof Element && node.matches('.row')) state.removedRows++;
  57  |       });
  58  |       observer.observe(shadow.querySelector('.window')!, { childList: true });
  59  |       return { state, observer };
  60  |     });
  61  |     // These are the same events delivered by disk writes and the 15s fallback.
  62  |     for (let index = 0; index < 3; index++) {
  63  |       await app.evaluate(({ BrowserWindow }, folder) => {
  64  |         BrowserWindow.getAllWindows()[0].webContents.send('project:files-changed', { root: folder, paths: [] });
  65  |       }, root);
  66  |       await window.waitForTimeout(600);
  67  |     }
  68  |     await writeFile(path.join(root, 'note.md'), '# Changed working tree\n');
  69  |     await git('add', 'note.md');
  70  |     await window.waitForTimeout(700);
  71  |     await graph.evaluate(element => (element as unknown as { refresh(): void }).refresh());
  72  |     await window.waitForTimeout(700);
  73  |     expect(await observed.evaluate(({ state, observer }) => {
  74  |       observer.disconnect();
  75  |       return { removedRows: state.removedRows, rowConnected: state.row.isConnected,
  76  |         detailsConnected: state.details.isConnected, focused: state.shadow.activeElement === state.row,
  77  |         scrollDelta: state.shadow.querySelector('.scroller')!.scrollTop - state.scroll };
> 78  |     })).toEqual({ removedRows: 0, rowConnected: true, detailsConnected: true, focused: true, scrollDelta: 0 });
      |         ^ Error: expect(received).toEqual(expected) // deep equality
  79  |     await expect.poll(() => graph.evaluate(element => (element as unknown as { data: { commits: unknown[] } }).data.commits.length)).toBe(110);
  80  |     await window.screenshot({ path: test.info().outputPath('graph-stable-refresh.png') });
  81  |     await git('commit', '-m', 'Visible new commit');
  82  |     await expect.poll(() => graph.evaluate(element => (element as unknown as { data: { commits: { message: string }[] } }).data.commits[0]?.message)).toBe('Visible new commit');
  83  |     expect(errors).toEqual([]);
  84  |   } finally {
  85  |     if (app) await disposeApplication(app);
  86  |     await rm(root, { recursive: true, force: true });
  87  |     await rm(configRoot, { recursive: true, force: true });
  88  |   }
  89  | });
  90  | 
  91  | test('Graph resizes, refreshes and opens immutable Markdown revisions in existing review', async () => {
  92  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-history-'));
  93  |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-history-config-'));
  94  |   const remote = await mkdtemp(path.join(os.tmpdir(), 'setdown-history-remote-'));
  95  |   const peer = await mkdtemp(path.join(os.tmpdir(), 'setdown-history-peer-'));
  96  |   const file = path.join(root, 'note.md');
  97  |   const git = (...args: string[]) => exec('git', args, { cwd: root });
  98  |   let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  99  |   try {
  100 |     await git('init', '-b', 'main');
  101 |     await git('config', 'user.name', 'History Test');
  102 |     await git('config', 'user.email', 'history@example.test');
  103 |     await writeFile(file, '# First revision\n\n$$x^2$$\n');
  104 |     await git('add', '.'); await git('commit', '-m', 'Initial document');
  105 |     const first = (await git('rev-parse', 'HEAD')).stdout.trim();
  106 |     await writeFile(file, '# Second revision\n\n$$x^2 + y^2$$\n');
  107 |     await git('commit', '-am', 'Revise document');
  108 |     const second = (await git('rev-parse', 'HEAD')).stdout.trim();
  109 |     await exec('git', ['init', '--bare', remote]);
  110 |     await git('remote', 'add', 'origin', remote);
  111 |     await git('push', '-u', 'origin', 'main');
  112 |     for (const name of ['extra-one', 'extra-two', 'extra-three']) await git('branch', name);
  113 |     await writeFile(file, '# Working document\n');
  114 |     const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  115 |     app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: configRoot } });
  116 |     const window = await app.firstWindow();
  117 |     const errors: string[] = [];
  118 |     window.on('pageerror', (error) => errors.push(error.message));
  119 |     await window.evaluate(async (folder) => {
  120 |       await (window as unknown as { marktex: { restoreProjectFolder(root: string): Promise<unknown> } }).marktex.restoreProjectFolder(folder);
  121 |       sessionStorage.setItem('setdown:git-graph-panel', JSON.stringify({ expanded: true, ratio: .55 }));
  122 |     }, root);
  123 |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  124 |     await focusApplication(app);
  125 |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  126 |     await window.getByRole('button', { name: 'Source Control', exact: true }).click();
  127 |     const graph = window.locator('web-git-graph');
  128 |     await expect.poll(async () => ({
  129 |       rows: await graph.locator('.row').count(),
  130 |       busy: await graph.getAttribute('aria-busy'),
  131 |       graphErrors: await window.locator('.history-error').allTextContents(),
  132 |       appErrors: await window.locator('.project-error').allTextContents()
  133 |     })).toEqual({ rows: 2, busy: 'false', graphErrors: [], appErrors: [] });
  134 |     const pane = window.getByRole('region', { name: 'Git history', exact: true });
  135 |     const separator = window.getByRole('button', { name: 'Resize Git Graph' });
  136 |     // The pinned shadow adapter must survive theme changes and expose the
  137 |     // upstream branch picker, without the standalone table/duplicate toolbar.
  138 |     await expect(graph.locator('.header')).toBeHidden();
  139 |     await expect(graph.locator('.refresh')).toBeHidden();
  140 |     await expect(graph.locator('.row').first()).toHaveCSS('font-size', '11px');
  141 |     await expect(graph.locator('.row').first()).toHaveCSS('height', '24px');
  142 |     await expect(graph.locator('.setdown-auto')).toHaveAttribute('aria-pressed', 'true');
  143 |     await expect.poll(() => graph.evaluate((element) => (element as unknown as { refs: string[] }).refs))
  144 |       .toEqual(['refs/heads/main', 'refs/remotes/origin/main']);
  145 |     await expect(graph.locator(`.row[data-oid="${second}"] .ref:visible`)).toHaveCount(2);
  146 |     await graph.getByRole('button', { name: 'Select branches and tags' }).click();
  147 |     await expect(graph.locator('.menu')).toBeVisible();
  148 |     await graph.getByRole('menuitem', { name: 'Show All' }).click();
  149 |     await expect(graph.locator('.setdown-auto')).toHaveAttribute('aria-pressed', 'false');
  150 |     await expect(graph.locator(`.row[data-oid="${second}"] .ref:visible`)).toHaveCount(4);
  151 |     await graph.getByRole('button', { name: 'Select branches and tags' }).click();
  152 |     await expect(graph.locator('.menu')).toHaveCount(0);
  153 |     await graph.getByRole('button', { name: 'Auto branch filter' }).click();
  154 |     await expect(graph.locator(`.row[data-oid="${second}"] .ref:visible`)).toHaveCount(2);
  155 |     await window.screenshot({ path: test.info().outputPath('graph-light.png') });
  156 |     await app.evaluate(({ Menu }) => { Menu.getApplicationMenu()?.getMenuItemById('preview-theme-night')?.click(); });
  157 |     await expect(graph).toHaveAttribute('theme', 'dark');
  158 |     await window.screenshot({ path: test.info().outputPath('graph-dark.png') });
  159 |     await app.evaluate(({ Menu }) => { Menu.getApplicationMenu()?.getMenuItemById('preview-theme-github-light')?.click(); });
  160 |     await expect(graph).toHaveAttribute('theme', 'light');
  161 | 
  162 |     const before = (await pane.boundingBox())!;
  163 |     const handle = (await separator.boundingBox())!;
  164 |     await window.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  165 |     await window.mouse.down(); await window.mouse.move(handle.x + handle.width / 2, handle.y - 65, { steps: 6 }); await window.mouse.up();
  166 |     expect((await pane.boundingBox())!.height).toBeGreaterThan(before.height + 40);
  167 |     await separator.press('ArrowDown');
  168 |     const toggle = pane.getByRole('button', { name: 'Graph', exact: true });
  169 |     await toggle.click(); await expect(graph).toHaveCount(0);
  170 |     await expect(pane.getByRole('button')).toHaveCount(1);
  171 |     await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  172 |     await toggle.click(); await expect(graph.locator('.row')).toHaveCount(2);
  173 |     await graph.locator(`.row[data-oid="${second}"]`).click();
  174 |     await graph.locator('.tree-file').click();
  175 |     const modified = window.locator('.review-content:not(.inactive) .modified-in-monaco-diff-editor');
  176 |     await expect(modified.locator('.view-lines:not([monaco-view-zone])')).toContainText('Second revision');
  177 |     await expect(window.locator('.review-content:not(.inactive) .original-in-monaco-diff-editor .view-lines:not([monaco-view-zone])')).toContainText('First revision');
  178 |     await expect(window.locator('.git-diff-tab')).toContainText(second.slice(0, 8));
```