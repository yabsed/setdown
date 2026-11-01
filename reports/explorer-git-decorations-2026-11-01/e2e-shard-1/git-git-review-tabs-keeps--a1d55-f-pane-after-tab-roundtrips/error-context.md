# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: git/git-review-tabs.spec.ts >> keeps word wrap in the original diff pane after tab roundtrips
- Location: test/e2e/git/git-review-tabs.spec.ts:146:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 5
Received:   4

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  86  |     await refreshSourceControl.evaluate((button) => {
  87  |       const states: boolean[] = [];
  88  |       (window as typeof window & { refreshDisabledStates?: boolean[] }).refreshDisabledStates = states;
  89  |       new MutationObserver(() => states.push((button as HTMLButtonElement).disabled))
  90  |         .observe(button, { attributes: true, attributeFilter: ['disabled'] });
  91  |     });
  92  |     await refreshSourceControl.click();
  93  |     await window.waitForTimeout(250);
  94  |     expect(await window.evaluate(() =>
  95  |       (window as typeof window & { refreshDisabledStates?: boolean[] }).refreshDisabledStates))
  96  |       .not.toContain(true);
  97  | 
  98  |     const staged = window.locator('.scm-group').filter({
  99  |       has: window.getByText('STAGED CHANGES', { exact: true }),
  100 |     });
  101 |     const changed = window.locator('.scm-group').filter({
  102 |       has: window.getByText('CHANGES', { exact: true }),
  103 |     });
  104 |     await staged.getByRole('button', { name: 'Collapse STAGED CHANGES' }).click();
  105 |     await expect(staged.locator('.git-changes')).toHaveCount(0);
  106 |     await staged.getByRole('button', { name: 'Expand STAGED CHANGES' }).click();
  107 |     await expect(staged.locator('.git-changes')).toBeVisible();
  108 |     await changed.getByRole('button', { name: 'Collapse CHANGES' }).click();
  109 |     await expect(changed.locator('.git-changes')).toHaveCount(0);
  110 |     await changed.getByRole('button', { name: 'Expand CHANGES' }).click();
  111 |     await expect(changed.locator('.git-changes')).toBeVisible();
  112 |     await staged.locator('.git-change-open').click();
  113 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  114 |     await expect(window.locator('.git-diff-editor:visible .original-in-monaco-diff-editor .view-lines'))
  115 |       .toContainText('Base');
  116 |     await expect(window.locator('.git-diff-editor:visible .modified-in-monaco-diff-editor .view-lines'))
  117 |       .toContainText('Staged');
  118 | 
  119 |     await changed.locator('.git-change-open').click();
  120 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  121 |     await expect(window.locator('.git-diff-editor:visible .modified-in-monaco-diff-editor .view-lines'))
  122 |       .toContainText('Working tree change');
  123 |     // A review is local-only, but still owns its accepted split when Chromium
  124 |     // substitutes a coordinate-less terminal leave for the DOM drop.
  125 |     const moving = window.locator('.git-diff-tab[aria-selected="true"]');
  126 |     const data = await window.evaluateHandle(() => new DataTransfer());
  127 |     await moving.dispatchEvent('dragstart', { dataTransfer: data });
  128 |     const body = (await window.locator('.group-body').boundingBox())!;
  129 |     await moving.dispatchEvent('dragover', { dataTransfer: data,
  130 |       clientX: body.x + body.width - 5, clientY: body.y + body.height / 2 });
  131 |     await expect(window.locator('.group-drop-overlay')).toBeVisible();
  132 |     await moving.dispatchEvent('dragleave', { dataTransfer: data, relatedTarget: null });
  133 |     await data.evaluate(transfer => Object.defineProperty(transfer, 'dropEffect', { value: 'move' }));
  134 |     await moving.dispatchEvent('dragend', { dataTransfer: data });
  135 |     await data.dispose();
  136 |     await expect(window.locator('.editor-group')).toHaveCount(2);
  137 |     await expect(window.locator('.group-drop-overlay')).toBeHidden();
  138 |     await expect(window.locator('.git-diff-editor:visible').filter({ hasText: 'Working tree change' })).toHaveCount(1);
  139 |   } finally {
  140 |     await disposeApplication(application);
  141 |     await rm(root, { recursive: true, force: true });
  142 |     await rm(configRoot, { recursive: true, force: true });
  143 |   }
  144 | });
  145 | 
  146 | test('keeps word wrap in the original diff pane after tab roundtrips', async () => {
  147 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-wrap-'));
  148 |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-wrap-config-'));
  149 |   const documentPath = path.join(root, 'wrap.md');
  150 |   const longLine = `Long line: ${'wrap me please '.repeat(30)}`;
  151 |   await exec('git', ['init'], { cwd: root });
  152 |   await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  153 |   await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  154 |   await writeFile(documentPath, `# Base\n\n${longLine}\n`, 'utf8');
  155 |   await exec('git', ['add', 'wrap.md'], { cwd: root });
  156 |   await exec('git', ['commit', '-m', 'base'], { cwd: root });
  157 |   await writeFile(documentPath, `# Changed\n\n${longLine}\n`, 'utf8');
  158 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  159 |   const application = await electron.launch({
  160 |     args: ['.', documentPath],
  161 |     env: { ...environment, XDG_CONFIG_HOME: configRoot },
  162 |   });
  163 | 
  164 |   try {
  165 |     const window = await application.firstWindow();
  166 |     // Rendered view lines in the original (left) pane. The model has 3 lines;
  167 |     // with word wrap on, the long line renders as many view lines.
  168 |     const originalViewLineCount = () => window.evaluate(() =>
  169 |       document.querySelectorAll('.original-in-monaco-diff-editor .view-lines > div').length);
  170 |     await window.evaluate(async (folderPath) => {
  171 |       await (window as typeof window & {
  172 |         marktex: { restoreProjectFolder(path: string): Promise<unknown> };
  173 |       }).marktex.restoreProjectFolder(folderPath);
  174 |     }, root);
  175 |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  176 |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  177 |     await window.getByRole('button', { name: 'Source Control' }).click();
  178 |     const changed = window.locator('.scm-group').filter({
  179 |       has: window.getByText('CHANGES', { exact: true }),
  180 |     });
  181 |     await changed.locator('.git-change-open').click();
  182 |     await expect(window.locator('.git-diff-editor:visible .original-in-monaco-diff-editor .view-lines'))
  183 |       .toContainText('Long line:');
  184 | 
  185 |     await expect.poll(originalViewLineCount, { timeout: 10_000 })
> 186 |       .toBeGreaterThan(5);
      |        ^ Error: expect(received).toBeGreaterThan(expected)
  187 | 
  188 |     await window.locator('.document-tab:not(.git-diff-tab)').click();
  189 |     await expect(window.locator('.git-diff-editor')).toBeHidden();
  190 |     await window.locator('.git-diff-tab').click();
  191 |     await expect(window.locator('.git-diff-editor:visible .original-in-monaco-diff-editor .view-lines'))
  192 |       .toContainText('Long line:');
  193 | 
  194 |     await expect.poll(originalViewLineCount, { timeout: 10_000 })
  195 |       .toBeGreaterThan(5);
  196 |   } finally {
  197 |     await disposeApplication(application);
  198 |     await rm(root, { recursive: true, force: true });
  199 |     await rm(configRoot, { recursive: true, force: true });
  200 |   }
  201 | });
  202 | 
  203 | test('keeps staged and live working-tree reviews in separate tabs', async () => {
  204 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-tabs-'));
  205 |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-config-'));
  206 |   const documentPath = path.join(root, 'review.md');
  207 |   await exec('git', ['init'], { cwd: root });
  208 |   await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  209 |   await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  210 |   await writeFile(documentPath, '# Base\n', 'utf8');
  211 |   await exec('git', ['add', 'review.md'], { cwd: root });
  212 |   await exec('git', ['commit', '-m', 'base'], { cwd: root });
  213 |   const filler = Array.from({ length: 90 }, (_, index) => `Filler paragraph ${index + 1}`);
  214 |   await writeFile(documentPath, [
  215 |     '# Staged', '', 'line one', 'line two', 'Working tree', '', 'Tail', '', ...filler, '',
  216 |   ].join('\n'), 'utf8');
  217 |   await exec('git', ['add', 'review.md'], { cwd: root });
  218 |   await writeFile(documentPath, [
  219 |     '# Staged', '', 'line one', 'line two', 'Working tree ?', '',
  220 |     'Inserted one', '', 'Inserted two', '', 'Tail', '', ...filler, '',
  221 |   ].join('\n'), 'utf8');
  222 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  223 |   const application = await electron.launch({
  224 |     args: ['.', documentPath],
  225 |     env: { ...environment, XDG_CONFIG_HOME: configRoot },
  226 |   });
  227 | 
  228 |   try {
  229 |     const window = await application.firstWindow();
  230 |     const reading = previews(application);
  231 |     await window.evaluate(async (folderPath) => {
  232 |       await (window as typeof window & {
  233 |         marktex: { restoreProjectFolder(path: string): Promise<unknown> };
  234 |       }).marktex.restoreProjectFolder(folderPath);
  235 |     }, root);
  236 |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  237 |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  238 |     await window.getByRole('button', { name: 'Source Control' }).click();
  239 | 
  240 |     const staged = window.locator('.scm-group').filter({
  241 |       has: window.getByText('STAGED CHANGES', { exact: true }),
  242 |     });
  243 |     const changed = window.locator('.scm-group').filter({
  244 |       has: window.getByText('CHANGES', { exact: true }),
  245 |     });
  246 |     await expect(staged.locator('.git-change-open')).toContainText('review.md');
  247 |     await expect(changed.locator('.git-change-open')).toContainText('review.md');
  248 | 
  249 |     await staged.locator('.git-change-open').click();
  250 |     await expect(window.locator('.git-diff-tab')).toHaveCount(1);
  251 |     await expect(window.locator('.git-diff-tab')).toContainText('review.md (Index)');
  252 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  253 |     await expect(window.locator('.git-diff-editor:visible .original-in-monaco-diff-editor .view-lines'))
  254 |       .toContainText('Base');
  255 |     await expect(window.locator('.git-diff-editor:visible .modified-in-monaco-diff-editor .view-lines'))
  256 |       .toContainText('Staged');
  257 | 
  258 |     await changed.locator('.git-change-open').click();
  259 |     await expect(window.locator('.git-diff-tab')).toHaveCount(2);
  260 |     await expect(window.locator('.git-diff-tab').nth(0)).toContainText('review.md (Index)');
  261 |     await expect(window.locator('.git-diff-tab').nth(1)).toContainText('review.md (Working Tree)');
  262 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  263 |     await expect(window.locator('.git-diff-editor:visible .modified-in-monaco-diff-editor .view-lines'))
  264 |       .toContainText('Working tree ?');
  265 | 
  266 |     await window.getByRole('button', { name: 'View Rendered Diff' }).click();
  267 |     await window.locator('.git-diff-tab').nth(0).click();
  268 |     await window.getByRole('button', { name: 'View Rendered Diff' }).click();
  269 |     await window.locator('.git-diff-tab').nth(1).click();
  270 | 
  271 |     await window.locator('.git-diff-tab').nth(0).click();
  272 |     await window.locator('.git-diff-tab').nth(1).click();
  273 |     await expect(window.locator('.git-review-header')).toHaveCount(0);
  274 |     // Index keeps one page; editable Working Tree eagerly seeds its A/B pair.
  275 |     await expect.poll(async () => (await diffPreviews(application)).length, { timeout: 20_000 })
  276 |       .toBe(3);
  277 |     const warmed = await diffPreviews(application);
  278 |     const warmedIdentity = warmed.map(({ id, url }) => ({ id, url }))
  279 |       .sort((left, right) => left.id - right.id);
  280 |     const firstFrame = await window.evaluate(async () => {
  281 |       const tabs = document.querySelectorAll<HTMLButtonElement>('.git-diff-tab');
  282 |       const started = performance.now();
  283 |       tabs[0]?.click();
  284 |       return await new Promise<{ elapsed: number; selected: boolean }>((resolve) => {
  285 |         requestAnimationFrame(() => resolve({
  286 |           elapsed: performance.now() - started,
```