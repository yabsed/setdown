# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: git/git-review-tabs.spec.ts >> keeps staged and live working-tree reviews in separate tabs
- Location: test/e2e/git/git-review-tabs.spec.ts:187:1

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "Inserted one"
Received string:    "# Stagedline oneline twoWorking treeTailFiller paragraph 1Filler paragraph 2Filler paragraph 3Filler paragraph 4Filler paragraph 5Filler paragraph 6Filler paragraph 7Filler paragraph 8Filler paragraph 9Filler paragraph 10Filler paragraph 11Filler paragraph 12Filler paragraph 13Filler paragraph 14Filler paragraph 15Filler paragraph 16Filler paragraph 17Filler paragraph 18Filler paragraph 19Filler paragraph 20Filler paragraph 21Filler paragraph 22Filler paragraph 23Filler paragraph 24"
```

# Test source

```ts
  233 |     await staged.locator('.git-change-open').click();
  234 |     await expect(window.locator('.git-diff-tab')).toHaveCount(1);
  235 |     await expect(window.locator('.git-diff-tab')).toContainText('review.md (Index)');
  236 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  237 |     await expect(window.locator('.git-diff-editor:visible .original-in-monaco-diff-editor .view-lines'))
  238 |       .toContainText('Base');
  239 |     await expect(window.locator('.git-diff-editor:visible .modified-in-monaco-diff-editor .view-lines'))
  240 |       .toContainText('Staged');
  241 | 
  242 |     await changed.locator('.git-change-open').click();
  243 |     await expect(window.locator('.git-diff-tab')).toHaveCount(2);
  244 |     await expect(window.locator('.git-diff-tab').nth(0)).toContainText('review.md (Index)');
  245 |     await expect(window.locator('.git-diff-tab').nth(1)).toContainText('review.md (Working Tree)');
  246 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  247 |     await expect(window.locator('.git-diff-editor:visible .modified-in-monaco-diff-editor .view-lines'))
  248 |       .toContainText('Working tree ?');
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
  312 |     await expect(window.locator('.git-diff-editor:visible .original-in-monaco-diff-editor .view-lines'))
  313 |       .toContainText('Staged');
  314 |     await expect(window.locator('.git-diff-editor:visible .modified-in-monaco-diff-editor .view-lines'))
  315 |       .toContainText('Working tree');
  316 |     await window.locator('.git-diff-tab').nth(0).click();
  317 |     await window.getByRole('button', { name: 'View Source Diff' }).click();
  318 |     await expect(window.locator('.git-diff-editor:visible .original-in-monaco-diff-editor .view-lines'))
  319 |       .toContainText('Base');
  320 |     const sourceFirstFrame = await window.evaluate(async () => {
  321 |       const tabs = document.querySelectorAll<HTMLButtonElement>('.git-diff-tab');
  322 |       const started = performance.now();
  323 |       tabs[1]?.click();
  324 |       return await new Promise<{ elapsed: number; text: string }>((resolve) => {
  325 |         requestAnimationFrame(() => resolve({
  326 |           elapsed: performance.now() - started,
  327 |           text: (Array.from(document.querySelectorAll<HTMLElement>('.modified-in-monaco-diff-editor .view-lines')).find(node => node.checkVisibility())
  328 |             ?.textContent ?? '').replace(/\s+/g, ' '),
  329 |         }));
  330 |       });
  331 |     });
  332 |     expect(sourceFirstFrame.elapsed).toBeLessThan(80);
> 333 |     expect(sourceFirstFrame.text).toContain('Inserted one');
      |                                   ^ Error: expect(received).toContain(expected) // indexOf
  334 |     const workingTreeEditor = window.locator('.git-diff-editor:visible').getByRole('textbox').nth(1);
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
  346 |     await expect(window.locator('.git-diff-editor:visible .modified-in-monaco-diff-editor .view-lines'))
  347 |       .toContainText('Shared draft continues');
  348 | 
  349 |     await workingTreeEditor.press('Escape');
  350 |     await expect(window.getByRole('button', { name: 'View Source Diff' })).toBeVisible();
  351 |     await expect.poll(async () => (await diffPreviews(application)).find((view) => view.visible)?.scrollY)
  352 |       .toBeGreaterThan(0);
  353 | 
  354 |     await window.locator('.document-tab:not(.git-diff-tab)').click();
  355 |     await expect.poll(reading.hasVisible).toBe(true);
  356 |     await expect.poll(() => reading.evaluate('document.body.innerText')).toContain('Shared draft');
  357 | 
  358 |     await changed.getByRole('button', { name: 'Stage All' }).click();
  359 |     await expect.poll(() => readFile(documentPath, 'utf8')).toContain('Shared draft continues');
  360 |     await expect.poll(async () => (await exec('git', ['show', ':review.md'], { cwd: root })).stdout)
  361 |       .toContain('Shared draft continues');
  362 |     await expect(changed.locator('.git-change-open')).toHaveCount(0);
  363 |   } finally {
  364 |     await disposeApplication(application);
  365 |     await rm(root, { recursive: true, force: true });
  366 |     await rm(configRoot, { recursive: true, force: true });
  367 |   }
  368 | });
  369 | 
  370 | test('returning from a review, discarding, and saving keep the document usable', async () => {
  371 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-discard-'));
  372 |   const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-discard-config-'));
  373 |   const documentPath = path.join(root, 'discard.md');
  374 |   await exec('git', ['init'], { cwd: root });
  375 |   await exec('git', ['config', 'user.email', 'setdown@example.test'], { cwd: root });
  376 |   await exec('git', ['config', 'user.name', 'Setdown Test'], { cwd: root });
  377 |   await writeFile(documentPath, '# Base\n', 'utf8');
  378 |   await exec('git', ['add', 'discard.md'], { cwd: root });
  379 |   await exec('git', ['commit', '-m', 'base'], { cwd: root });
  380 |   await writeFile(documentPath, '# Changed on disk\n', 'utf8');
  381 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  382 |   const application = await electron.launch({
  383 |     args: ['.', documentPath],
  384 |     env: { ...environment, XDG_CONFIG_HOME: configRoot },
  385 |   });
  386 | 
  387 |   try {
  388 |     const window = await application.firstWindow();
  389 |     const reading = previews(application);
  390 |     await window.evaluate(async (folderPath) => {
  391 |       await (window as typeof window & {
  392 |         marktex: { restoreProjectFolder(path: string): Promise<unknown> };
  393 |       }).marktex.restoreProjectFolder(folderPath);
  394 |     }, root);
  395 |     await Promise.all([window.waitForEvent('load'), window.reload()]);
  396 |     await window.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  397 |     await window.getByRole('button', { name: 'Source Control' }).click();
  398 |     const changed = window.locator('.scm-group').filter({
  399 |       has: window.getByText('CHANGES', { exact: true }),
  400 |     });
  401 |     await changed.locator('.git-change-open').click();
  402 |     await expect(window.getByRole('button', { name: 'View Rendered Diff' })).toBeVisible();
  403 |     const workingTreeEditor = window.locator('.git-diff-editor:visible').getByRole('textbox').nth(1);
  404 |     await workingTreeEditor.press('Control+End');
  405 |     await workingTreeEditor.pressSequentially('\nUnsaved buffer text');
  406 |     await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);
  407 | 
  408 |     await workingTreeEditor.press('Control+C');
  409 |     await window.locator('.document-tab:not(.git-diff-tab)').click();
  410 |     await expect(window.locator('.git-review')).toBeHidden();
  411 |     await expect(window.locator('.git-diff-editor')).toBeHidden();
  412 |     await expect.poll(reading.hasVisible).toBe(true);
  413 | 
  414 |     await window.locator('.git-diff-tab').click();
  415 |     await changed.getByRole('button', { name: 'Discard All Changes' }).click();
  416 |     const confirmation = window.getByRole('alertdialog');
  417 |     await expect(confirmation).toContainText('Unsaved editor edits are kept');
  418 |     await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  419 |     expect(await readFile(documentPath, 'utf8')).toBe('# Changed on disk\n');
  420 |     await changed.getByRole('button', { name: 'Discard All Changes' }).click();
  421 |     await confirmation.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  422 |     await window.locator('.document-tab:not(.git-diff-tab)').click();
  423 |     await window.getByRole('button', { name: 'Switch to Editor' }).click();
  424 |     await expect(window.locator('.editor-surface')).toBeVisible();
  425 |     await window.locator('.editor-surface .monaco-editor').click({ position: { x: 120, y: 80 } });
  426 |     const documentEditor = window.locator('.editor-surface')
  427 |       .getByRole('textbox', { name: 'Editor content' });
  428 |     await window.keyboard.press('Control+End');
  429 |     await window.keyboard.insertText('\nSaved after discard');
  430 | 
  431 |     await expect.poll(() => readFile(documentPath, 'utf8')).toBe('# Base\n');
  432 |     await expect(changed.locator('.git-change-open')).toHaveCount(0);
  433 |     await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);
```