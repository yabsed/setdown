# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: git/git-review-tabs.spec.ts >> keeps staged and live working-tree reviews in separate tabs
- Location: ../../../../../apps/desktop/test/e2e/git/git-review-tabs.spec.ts:187:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.modified-in-monaco-diff-editor .view-lines')
Expected substring: "Working tree ?"
Error: strict mode violation: locator('.modified-in-monaco-diff-editor .view-lines') resolved to 2 elements:
    1) <div data-mprt="8" aria-hidden="true" role="presentation" class="view-lines monaco-mouse-cursor-text">…</div> aka getByText('# Stagedline oneline').first()
    2) <div data-mprt="8" aria-hidden="true" role="presentation" class="view-lines monaco-mouse-cursor-text">…</div> aka getByText('# Stagedline oneline twoWorking tree ?Inserted oneInserted twoTailFiller')

Call log:
  - Expect "toContainText" locator('.modified-in-monaco-diff-editor .view-lines') with timeout 5000ms
  - waiting for locator('.modified-in-monaco-diff-editor .view-lines')

```

# Test source

```ts
  148 |   try {
  149 |     const window = await application.firstWindow();
  150 |     // Rendered view lines in the original (left) pane. The model has 3 lines;
  151 |     // with word wrap on, the long line renders as many view lines.
  152 |     const originalViewLineCount = () => window.evaluate(() =>
  153 |       document.querySelectorAll('.original-in-monaco-diff-editor .view-lines > div').length);
  154 |     await window.evaluate(async (folderPath) => {
  155 |       await (window as typeof window & {
  156 |         marktex: { restoreProjectFolder(path: string): Promise<unknown> };
  157 |       }).marktex.restoreProjectFolder(folderPath);
  158 |     }, root);
  159 |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  160 |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  161 |     await window.getByRole('button', { name: 'Source Control' }).click();
  162 |     const changed = window.locator('.scm-group').filter({
  163 |       has: window.getByText('CHANGES', { exact: true }),
  164 |     });
  165 |     await changed.locator('.git-change-open').click();
  166 |     await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
  167 |       .toContainText('Long line:');
  168 | 
  169 |     await expect.poll(originalViewLineCount, { timeout: 10_000 })
  170 |       .toBeGreaterThan(5);
  171 | 
  172 |     await window.locator('.document-tab:not(.git-diff-tab)').click();
  173 |     await expect(window.locator('.git-diff-editor')).toBeHidden();
  174 |     await window.locator('.git-diff-tab').click();
  175 |     await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
  176 |       .toContainText('Long line:');
  177 | 
  178 |     await expect.poll(originalViewLineCount, { timeout: 10_000 })
  179 |       .toBeGreaterThan(5);
  180 |   } finally {
  181 |     await disposeApplication(application);
  182 |     await rm(root, { recursive: true, force: true });
  183 |     await rm(configRoot, { recursive: true, force: true });
  184 |   }
  185 | });
  186 | 
  187 | test('keeps staged and live working-tree reviews in separate tabs', async () => {
  188 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-tabs-'));
  189 |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-review-config-'));
  190 |   const documentPath = path.join(root, 'review.md');
  191 |   await exec('git', ['init'], { cwd: root });
  192 |   await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  193 |   await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  194 |   await writeFile(documentPath, '# Base\n', 'utf8');
  195 |   await exec('git', ['add', 'review.md'], { cwd: root });
  196 |   await exec('git', ['commit', '-m', 'base'], { cwd: root });
  197 |   const filler = Array.from({ length: 90 }, (_, index) => `Filler paragraph ${index + 1}`);
  198 |   await writeFile(documentPath, [
  199 |     '# Staged', '', 'line one', 'line two', 'Working tree', '', 'Tail', '', ...filler, '',
  200 |   ].join('\n'), 'utf8');
  201 |   await exec('git', ['add', 'review.md'], { cwd: root });
  202 |   await writeFile(documentPath, [
  203 |     '# Staged', '', 'line one', 'line two', 'Working tree ?', '',
  204 |     'Inserted one', '', 'Inserted two', '', 'Tail', '', ...filler, '',
  205 |   ].join('\n'), 'utf8');
  206 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  207 |   const application = await electron.launch({
  208 |     args: ['.', documentPath],
  209 |     env: { ...environment, XDG_CONFIG_HOME: configRoot },
  210 |   });
  211 | 
  212 |   try {
  213 |     const window = await application.firstWindow();
  214 |     const reading = previews(application);
  215 |     await window.evaluate(async (folderPath) => {
  216 |       await (window as typeof window & {
  217 |         marktex: { restoreProjectFolder(path: string): Promise<unknown> };
  218 |       }).marktex.restoreProjectFolder(folderPath);
  219 |     }, root);
  220 |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  221 |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  222 |     await window.getByRole('button', { name: 'Source Control' }).click();
  223 | 
  224 |     const staged = window.locator('.scm-group').filter({
  225 |       has: window.getByText('STAGED CHANGES', { exact: true }),
  226 |     });
  227 |     const changed = window.locator('.scm-group').filter({
  228 |       has: window.getByText('CHANGES', { exact: true }),
  229 |     });
  230 |     await expect(staged.locator('.git-change-open')).toContainText('review.md');
  231 |     await expect(changed.locator('.git-change-open')).toContainText('review.md');
  232 | 
  233 |     await staged.locator('.git-change-open').click();
  234 |     await expect(window.locator('.git-diff-tab')).toHaveCount(1);
  235 |     await expect(window.locator('.git-diff-tab')).toContainText('review.md (Index)');
  236 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  237 |     await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
  238 |       .toContainText('Base');
  239 |     await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
  240 |       .toContainText('Staged');
  241 | 
  242 |     await changed.locator('.git-change-open').click();
  243 |     await expect(window.locator('.git-diff-tab')).toHaveCount(2);
  244 |     await expect(window.locator('.git-diff-tab').nth(0)).toContainText('review.md (Index)');
  245 |     await expect(window.locator('.git-diff-tab').nth(1)).toContainText('review.md (Working Tree)');
  246 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  247 |     await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
> 248 |       .toContainText('Working tree ?');
      |        ^ Error: expect(locator).toContainText(expected) failed
  249 | 
  250 |     await window.getByRole('button', { name: 'View Rendered Diff' }).click();
  251 |     await window.locator('.git-diff-tab').nth(0).click();
  252 |     await window.getByRole('button', { name: 'View Rendered Diff' }).click();
  253 |     await window.locator('.git-diff-tab').nth(1).click();
  254 | 
  255 |     await window.locator('.git-diff-tab').nth(0).click();
  256 |     await window.locator('.git-diff-tab').nth(1).click();
  257 |     await expect(window.locator('.git-review-header')).toHaveCount(0);
  258 |     // Index keeps one page; editable Working Tree eagerly seeds its A/B pair.
  259 |     await expect.poll(async () => (await diffPreviews(application)).length, { timeout: 20_000 })
  260 |       .toBe(3);
  261 |     const warmed = await diffPreviews(application);
  262 |     const warmedIdentity = warmed.map(({ id, url }) => ({ id, url }))
  263 |       .sort((left, right) => left.id - right.id);
  264 |     const firstFrame = await window.evaluate(async () => {
  265 |       const tabs = document.querySelectorAll<HTMLButtonElement>('.git-diff-tab');
  266 |       const started = performance.now();
  267 |       tabs[0]?.click();
  268 |       return await new Promise<{ elapsed: number; selected: boolean }>((resolve) => {
  269 |         requestAnimationFrame(() => resolve({
  270 |           elapsed: performance.now() - started,
  271 |           selected: tabs[0]?.getAttribute('aria-selected') === 'true',
  272 |         }));
  273 |       });
  274 |     });
  275 |     expect(firstFrame.selected).toBe(true);
  276 |     expect(firstFrame.elapsed).toBeLessThan(80);
  277 |     await expect.poll(async () => (await diffPreviews(application)).find((view) => view.visible)?.text)
  278 |       .toContain('Base');
  279 |     await window.locator('.git-diff-tab').nth(1).click();
  280 |     await expect.poll(async () => (await diffPreviews(application)).find((view) => view.visible)?.text)
  281 |       .toContain('Working tree');
  282 |     expect((await diffPreviews(application)).map(({ id, url }) => ({ id, url }))
  283 |       .sort((left, right) => left.id - right.id)).toEqual(warmedIdentity);
  284 |     const renderedBefore = `Array.from(document.querySelectorAll('.setdown-rendered-diff-before'))
  285 |       .map((node) => node.textContent).join(' ')`;
  286 |     const renderedAfter = `Array.from(document.querySelectorAll('.setdown-rendered-diff-after'))
  287 |       .map((node) => node.textContent).join(' ')`;
  288 |     await expect.poll(() => reading.evaluate<string>(renderedBefore)).toContain('Staged');
  289 |     expect(await reading.evaluate<string>(renderedBefore)).not.toContain('Base');
  290 |     await expect.poll(() => reading.evaluate<string>(renderedAfter)).toContain('Working tree');
  291 |     const alignment = await reading.evaluate<{
  292 |       display: string; changed: number; tail: number;
  293 |     }>(`(() => {
  294 |       const split = document.querySelector('.setdown-rendered-diff-split');
  295 |       const before = document.querySelector('.setdown-diff-removed');
  296 |       const after = document.querySelector('.setdown-diff-added');
  297 |       const tails = Array.from(document.querySelectorAll('.setdown-rendered-diff-split p'))
  298 |         .filter((node) => node.textContent?.trim() === 'Tail');
  299 |       return {
  300 |         display: split ? getComputedStyle(split).display : '',
  301 |         changed: before && after
  302 |           ? Math.abs(before.getBoundingClientRect().top - after.getBoundingClientRect().top) : -1,
  303 |         tail: tails.length === 2
  304 |           ? Math.abs(tails[0].getBoundingClientRect().top - tails[1].getBoundingClientRect().top) : -1,
  305 |       };
  306 |     })()`);
  307 |     expect(alignment).toMatchObject({ display: 'block' });
  308 |     expect(alignment?.changed).toBeLessThan(2);
  309 |     expect(alignment?.tail).toBeLessThan(2);
  310 | 
  311 |     await window.getByRole('button', { name: 'View Source Diff' }).click();
  312 |     await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
  313 |       .toContainText('Staged');
  314 |     await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
  315 |       .toContainText('Working tree');
  316 |     await window.locator('.git-diff-tab').nth(0).click();
  317 |     await window.getByRole('button', { name: 'View Source Diff' }).click();
  318 |     await expect(window.locator('.original-in-monaco-diff-editor .view-lines'))
  319 |       .toContainText('Base');
  320 |     const sourceFirstFrame = await window.evaluate(async () => {
  321 |       const tabs = document.querySelectorAll<HTMLButtonElement>('.git-diff-tab');
  322 |       const started = performance.now();
  323 |       tabs[1]?.click();
  324 |       return await new Promise<{ elapsed: number; text: string }>((resolve) => {
  325 |         requestAnimationFrame(() => resolve({
  326 |           elapsed: performance.now() - started,
  327 |           text: (document.querySelector('.modified-in-monaco-diff-editor .view-lines')
  328 |             ?.textContent ?? '').replace(/\s+/g, ' '),
  329 |         }));
  330 |       });
  331 |     });
  332 |     expect(sourceFirstFrame.elapsed).toBeLessThan(80);
  333 |     expect(sourceFirstFrame.text).toContain('Inserted one');
  334 |     const workingTreeEditor = window.locator('.git-diff-editor').getByRole('textbox').nth(1);
  335 |     await expect(workingTreeEditor).toBeEditable();
  336 |     await workingTreeEditor.press('Control+End');
  337 |     await workingTreeEditor.pressSequentially('\nShared draft');
  338 |     await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);
  339 |     await expect.poll(async () => (await diffPreviews(application))
  340 |       .some((preview) => preview.text.includes('Shared draft')), { timeout: 20_000 }).toBe(true);
  341 |     await window.waitForTimeout(3_000);
  342 |     await expect(workingTreeEditor).toBeFocused();
  343 |     expect(await window.evaluate(() => document.hasFocus())).toBe(true);
  344 |     await expect.poll(() => shellHasKeyboardFocus(application)).toBe(true);
  345 |     await workingTreeEditor.pressSequentially(' continues');
  346 |     await expect(window.locator('.modified-in-monaco-diff-editor .view-lines'))
  347 |       .toContainText('Shared draft continues');
  348 | 
```