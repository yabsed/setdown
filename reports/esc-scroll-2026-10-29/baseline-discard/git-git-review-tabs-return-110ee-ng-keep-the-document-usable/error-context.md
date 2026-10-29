# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: git/git-review-tabs.spec.ts >> returning from a review, discarding, and saving keep the document usable
- Location: ../../../../../apps/desktop/test/e2e/git/git-review-tabs.spec.ts:370:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

- Expected  - 1
+ Received  + 1

- # Base
+ # Changed on disk
  ↵

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
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
  403 |     const workingTreeEditor = window.locator('.git-diff-editor').getByRole('textbox').nth(1);
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
> 431 |     await expect.poll(() => readFile(documentPath, 'utf8')).toBe('# Base\n');
      |                                                             ^ Error: expect(received).toBe(expected) // Object.is equality
  432 |     await expect(changed.locator('.git-change-open')).toHaveCount(0);
  433 |     await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);
  434 |     await expect(window.locator('.editor-surface .view-lines')).toContainText('Unsaved buffer text');
  435 |     await expect.poll(async () => (await reading.evaluateAll<string>('document.body.innerText'))
  436 |       .some((text) => text?.includes('Saved after discard')), { timeout: 20_000 }).toBe(true);
  437 |     await window.waitForTimeout(3_000);
  438 |     await expect(documentEditor).toBeFocused();
  439 |     expect(await window.evaluate(() => document.hasFocus())).toBe(true);
  440 |     await expect.poll(() => shellHasKeyboardFocus(application)).toBe(true);
  441 |     await documentEditor.pressSequentially(' continues');
  442 |     await application.evaluate(({ dialog }) => {
  443 |       const messages: string[] = [];
  444 |       (globalThis as typeof globalThis & { saveConflicts: string[] }).saveConflicts = messages;
  445 |       dialog.showMessageBox = async (...args: unknown[]) => {
  446 |         messages.push((args.at(-1) as { message: string }).message);
  447 |         return { response: 1, checkboxChecked: false };
  448 |       };
  449 |     });
  450 |     await window.keyboard.press('Control+S');
  451 |     await expect.poll(() => readFile(documentPath, 'utf8')).toContain('Saved after discard continues');
  452 |     await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(0);
  453 |     await expect(documentEditor).toBeFocused();
  454 |     expect(await application.evaluate(() => (globalThis as typeof globalThis & { saveConflicts: string[] }).saveConflicts))
  455 |       .toEqual(['This file was changed by another application.']);
  456 |   } finally {
  457 |     await disposeApplication(application);
  458 |     await rm(root, { recursive: true, force: true });
  459 |     await rm(configRoot, { recursive: true, force: true });
  460 |   }
  461 | });
  462 | 
```