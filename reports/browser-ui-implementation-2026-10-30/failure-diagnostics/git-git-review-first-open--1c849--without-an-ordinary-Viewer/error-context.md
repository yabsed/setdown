# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: git/git-review-first-open.spec.ts >> first Working Tree opens directly in Monaco without an ordinary Viewer
- Location: test/e2e/git/git-review-first-open.spec.ts:101:1

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'View Rendered Diff' })
    - locator resolved to <button type="button" aria-label="View Rendered Diff" class="mode-toggle svelte-1gz7xv1" title="View Rendered Diff (Ctrl/Cmd+E)">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
      - waiting 100ms
    58 × waiting for element to be visible, enabled and stable
       - element is not visible
     - retrying click action
       - waiting 500ms

```

# Test source

```ts
  67  |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  68  | });
  69  | 
  70  | test('SCM offers file and comparison side opens, reuses the target group, and keeps shared edits', async () => {
  71  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-scm-side-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-scm-side-config-'));
  72  |   const file = path.join(root, 'review.txt');
  73  |   await exec('git', ['init'], { cwd: root }); await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  74  |   await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  75  |   await writeFile(file, 'base\n'); await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-m', 'base'], { cwd: root });
  76  |   await writeFile(file, 'working\n');
  77  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  78  |   const application = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: config } });
  79  |   try {
  80  |     const page = await application.firstWindow(); await page.evaluate(root => window.marktex.restoreProjectFolder(root), root);
  81  |     await Promise.all([page.waitForEvent('load'), page.reload()]); await focusApplication(application);
  82  |     await page.getByRole('button', { name: 'Toggle Folder Tools' }).click(); await page.getByRole('button', { name: 'Source Control', exact: true }).click();
  83  |     const more = page.getByRole('button', { name: 'Actions for review.txt', exact: true });
  84  |     await more.click(); await page.getByRole('menuitem', { name: 'Open File', exact: true }).click();
  85  |     const ordinary = page.locator('.document-tab:not(.git-diff-tab)'); await expect(ordinary).toHaveCount(1);
  86  |     for (let i = 0; i < 2; i++) {
  87  |       await ordinary.click(); await more.click(); await page.getByRole('menuitem', { name: 'Open Changes to the Side', exact: true }).click();
  88  |       await expect(page.locator('.editor-group')).toHaveCount(2); await expect(page.locator('.git-diff-tab')).toHaveCount(1);
  89  |     }
  90  |     const source = page.locator('.modified-in-monaco-diff-editor').getByRole('textbox'); await source.press('Control+End'); await source.pressSequentially('shared');
  91  |     await expect(page.locator('.editor-surface .view-lines, .group-editor-host .view-lines')).toContainText('shared');
  92  |     await page.getByRole('button', { name: 'Open File to the Side', exact: true }).click();
  93  |     await expect(page.locator('.editor-group')).toHaveCount(3); await expect(page.locator('.document-tab:not(.git-diff-tab)')).toHaveCount(2);
  94  |     await page.locator('.git-diff-tab .tab-close').click(); await expect(page.locator('.editor-group')).toHaveCount(2);
  95  |     await expect(page.locator('.editor-surface .view-lines, .group-editor-host .view-lines')).toHaveCount(2);
  96  |     for (const content of await page.locator('.editor-surface .view-lines, .group-editor-host .view-lines').all()) await expect(content).toContainText('shared');
  97  |     expect(await readFile(file, 'utf8')).toBe('working\n');
  98  |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  99  | });
  100 | 
  101 | test('first Working Tree opens directly in Monaco without an ordinary Viewer', async () => {
  102 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-first-'));
  103 |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-first-config-'));
  104 |   const documentPath = path.join(root, 'review.md');
  105 |   await exec('git', ['init'], { cwd: root });
  106 |   await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  107 |   await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  108 |   await writeFile(documentPath, '# Original\n\n$$x^2 + y^2 = z^2$$\n');
  109 |   await exec('git', ['add', '.'], { cwd: root });
  110 |   await exec('git', ['commit', '-m', 'base'], { cwd: root });
  111 |   await writeFile(documentPath, '# Working tree\n\n$$x^2 + y^2 = z^2$$\n');
  112 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  113 |   const application = await electron.launch({ args: ['.'], env: { ...environment, XDG_CONFIG_HOME: configRoot } });
  114 |   try {
  115 |     const window = await application.firstWindow();
  116 |     window.on('pageerror', error => console.error('Renderer failure:', error));
  117 |     window.on('console', message => { if (message.type() === 'error') console.error('Renderer console:', message.text()); });
  118 |     await window.evaluate(async (folder) => {
  119 |       await (window as typeof window & {
  120 |         marktex: { restoreProjectFolder(path: string): Promise<unknown> };
  121 |       }).marktex.restoreProjectFolder(folder);
  122 |     }, root);
  123 |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  124 |     await focusApplication(application);
  125 |     // A synthetic/native dragend may report screen (0, 0). Keep the window
  126 |     // away from the screen origin so that an in-window cancel cannot be
  127 |     // mistaken for a detach based on that sentinel coordinate.
  128 |     await application.evaluate(({ BrowserWindow }) => {
  129 |       BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())?.setPosition(120, 80);
  130 |     });
  131 |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  132 |     await window.getByRole('button', { name: 'Source Control', exact: true }).click();
  133 |     await application.evaluate(({ ipcMain }) => {
  134 |       const state = globalThis as typeof globalThis & { reviewOpeningShows: string[] };
  135 |       state.reviewOpeningShows = [];
  136 |       ipcMain.on('preview:show', (_event, request: { tabId: string | null }) => {
  137 |         if (request.tabId) state.reviewOpeningShows.push(request.tabId);
  138 |       });
  139 |     });
  140 |     await window.locator('.git-change-open').click();
  141 |     const modified = window.locator('.modified-in-monaco-diff-editor');
  142 |     await expect(modified.locator('.view-lines')).toContainText('Working tree');
  143 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  144 |     const shown = () => application.evaluate(() =>
  145 |       (globalThis as typeof globalThis & { reviewOpeningShows: string[] }).reviewOpeningShows);
  146 |     expect(await shown()).toEqual([]);
  147 | 
  148 |     const source = modified.getByRole('textbox');
  149 |     await source.press('Control+End');
  150 |     await source.pressSequentially('\nShared edit');
  151 |     await expect(window.locator('.document-tab:not(.git-diff-tab)')).toHaveCount(0);
  152 |     await expect(window.locator('.git-diff-tab .tab-dirty')).toHaveCount(1);
  153 |     // The ordinary editor must borrow the exact same model/history on first use.
  154 |     await window.evaluate(file => globalThis.window.marktex.openLink(`marktex-resource://file${file}`), documentPath);
  155 |     await expect.poll(previews(application).hasVisible).toBe(true);
  156 |     await window.getByRole('button', { name: 'Switch to Editor' }).click();
  157 |     const ordinary = window.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  158 |     await expect(window.locator('.editor-surface .view-lines')).toContainText('Shared edit');
  159 |     await ordinary.press('Control+z');
  160 |     await expect(window.locator('.editor-surface .view-lines')).not.toContainText('Shared edit');
  161 |     await ordinary.press('Control+Shift+z');
  162 |     await ordinary.press('Control+s');
  163 |     await expect.poll(() => readFile(documentPath, 'utf8')).toContain('Shared edit');
  164 | 
  165 |     await window.locator('.git-change-open').click();
  166 |     await expect(modified.locator('.view-lines')).toContainText('Shared edit');
> 167 |     try { await window.getByRole('button', { name: 'View Rendered Diff' }).click(); } catch(error) {console.log('GITDEBUG',await window.evaluate(() => ({bar:document.querySelector('.location-bar')?.outerHTML,editor:document.querySelector('.git-diff-view')?.outerHTML?.slice(0,500)})));throw error;}
      |                                                                            ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  168 |     await expect.poll(previews(application).hasVisible).toBe(true);
  169 |     const ordinaryTab = window.locator('.document-tab:not(.git-diff-tab)');
  170 |     const drag = await window.evaluateHandle(() => new DataTransfer());
  171 |     await ordinaryTab.dispatchEvent('dragstart', { dataTransfer: drag });
  172 |     await expect.poll(previews(application).hasVisible).toBe(false);
  173 |     await ordinaryTab.dispatchEvent('dragend', { dataTransfer: drag, clientX: 100, clientY: 100 });
  174 |     await drag.dispose();
  175 |     await expect(window.locator('.git-diff-tab')).toHaveAttribute('aria-selected', 'true');
  176 |     await expect.poll(previews(application).hasVisible).toBe(true);
  177 |   } finally {
  178 |     await disposeApplication(application);
  179 |     await rm(root, { recursive: true, force: true });
  180 |     await rm(configRoot, { recursive: true, force: true });
  181 |   }
  182 | });
  183 | 
  184 | test('two Working Tree groups and an ordinary view share edits, Undo and independent native readers', async () => {
  185 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-groups-'));
  186 |   const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-groups-config-'));
  187 |   const file = path.join(root, 'shared.md');
  188 |   await exec('git', ['init'], { cwd: root });
  189 |   await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  190 |   await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  191 |   await writeFile(file, '# Base\n\nOriginal.\n');
  192 |   await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-m', 'base'], { cwd: root });
  193 |   await writeFile(file, '# Working\n\nShared content.\n');
  194 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  195 |   const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  196 |   try {
  197 |     const page = await app.firstWindow();
  198 |     const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  199 |     await page.evaluate(root => window.marktex.restoreProjectFolder(root), root);
  200 |     await Promise.all([page.waitForEvent('load'), page.reload()]); await focusApplication(app);
  201 |     await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  202 |     await page.getByRole('button', { name: 'Source Control', exact: true }).click();
  203 |     await page.locator('.git-change-open').click();
  204 |     await expect(page.locator('.git-diff-tab')).toHaveCount(1);
  205 |     await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-editor-commands'));
  206 |     const commands = page.getByRole('dialog', { name: 'Commands', exact: true });
  207 |     await commands.getByRole('searchbox').fill('Split editor right');
  208 |     await commands.getByRole('option').filter({ hasText: 'Split editor right' }).click();
  209 |     await expect(page.locator('.editor-group')).toHaveCount(2);
  210 |     await expect(page.locator('.git-diff-tab')).toHaveCount(2);
  211 |     const panes = page.locator('.review-content:not(.inactive) .modified-in-monaco-diff-editor');
  212 |     await expect(panes).toHaveCount(2);
  213 |     await expect(panes.nth(1).locator('.view-lines:not([monaco-view-zone])')).toContainText('Shared content.');
  214 |     const right = panes.nth(1).getByRole('textbox');
  215 |     await right.press('Control+End'); await right.pressSequentially('\nShared across all views');
  216 |     await expect(panes.nth(0).locator('.view-lines:not([monaco-view-zone])')).toContainText('Shared across all views');
  217 |     await expect(page.locator('.tab-dirty')).toHaveCount(3);
  218 |     await page.locator('.document-tab:not(.git-diff-tab)').click();
  219 |     await expect.poll(previews(app).hasVisible).toBe(true);
  220 |     await page.getByRole('button', { name: 'Switch to Editor' }).click();
  221 |     const ordinary = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  222 |     await expect(page.locator('.editor-surface .view-lines')).toContainText('Shared across all views');
  223 |     await ordinary.press('Control+z');
  224 |     await expect(page.locator('.review-content:not(.inactive) .modified-in-monaco-diff-editor .view-lines:not([monaco-view-zone])')).not.toContainText('Shared across all views');
  225 |     await ordinary.press('Control+Shift+z'); await ordinary.press('Control+s');
  226 |     await expect.poll(() => readFile(file, 'utf8')).toContain('Shared across all views');
  227 |     await expect(page.locator('.tab-dirty')).toHaveCount(0);
  228 |     // Both review views can be rendered at once, and closing one cannot hide the other.
  229 |     await page.locator('.git-diff-tab').nth(0).click();
  230 |     await page.getByRole('button', { name: 'View Rendered Diff' }).click();
  231 |     await page.locator('.git-diff-tab').nth(1).click();
  232 |     await page.getByRole('button', { name: 'View Rendered Diff' }).click();
  233 |     const readers = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
  234 |       .filter(view => view.getVisible()).map(view => view.getBounds()));
  235 |     await expect.poll(async () => (await readers()).length).toBe(2);
  236 |     const boxes = (await readers()).sort((a, b) => a.x - b.x);
  237 |     expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x + 1);
  238 |     await page.locator('.git-diff-tab').nth(0).locator('.tab-close').click();
  239 |     await expect(page.locator('.git-diff-tab')).toHaveCount(1);
  240 |     await expect.poll(async () => (await readers()).length).toBe(1);
  241 |     expect(errors).toEqual([]);
  242 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  243 | });
  244 | 
```