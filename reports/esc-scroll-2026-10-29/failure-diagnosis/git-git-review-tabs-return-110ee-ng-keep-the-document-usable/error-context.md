# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: git/git-review-tabs.spec.ts >> returning from a review, discarding, and saving keep the document usable
- Location: test/e2e/git/git-review-tabs.spec.ts:370:1

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
  403 |     await application.evaluate(({ ipcMain }) => {
  404 |       const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
  405 |       const original = handlers.get('project:git-discard')!;
  406 |       ipcMain.removeHandler('project:git-discard');
  407 |       ipcMain.handle('project:git-discard', async (...args) => {
  408 |         try { const result = await original(...args); return result; }
  409 |         catch (error) { throw Error(`DISCARD_TRACE: ${String(error)}`); }
  410 |       });
  411 |     });
  412 |     const workingTreeEditor = window.locator('.git-diff-editor:visible').getByRole('textbox').nth(1);
  413 |     await workingTreeEditor.press('Control+End');
  414 |     await workingTreeEditor.pressSequentially('\nUnsaved buffer text');
  415 |     await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);
  416 | 
  417 |     await workingTreeEditor.press('Control+C');
  418 |     await window.locator('.document-tab:not(.git-diff-tab)').click();
  419 |     await expect(window.locator('.git-review')).toBeHidden();
  420 |     await expect(window.locator('.git-diff-editor')).toBeHidden();
  421 |     await expect.poll(reading.hasVisible).toBe(true);
  422 | 
  423 |     await window.locator('.git-diff-tab').click();
  424 |     await changed.getByRole('button', { name: 'Discard All Changes' }).click();
  425 |     const confirmation = window.getByRole('alertdialog');
  426 |     await expect(confirmation).toContainText('Unsaved editor edits are kept');
  427 |     await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  428 |     expect(await readFile(documentPath, 'utf8')).toBe('# Changed on disk\n');
  429 |     await changed.getByRole('button', { name: 'Discard All Changes' }).click();
  430 |     await confirmation.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  431 |     await window.locator('.document-tab:not(.git-diff-tab)').click();
  432 |     await window.getByRole('button', { name: 'Switch to Editor' }).click();
  433 |     await expect(window.locator('.editor-surface')).toBeVisible();
  434 |     await window.locator('.editor-surface .monaco-editor').click({ position: { x: 120, y: 80 } });
  435 |     const documentEditor = window.locator('.editor-surface')
  436 |       .getByRole('textbox', { name: 'Editor content' });
  437 |     await window.keyboard.press('Control+End');
  438 |     await window.keyboard.insertText('\nSaved after discard');
  439 | 
  440 |     console.log('DISCARD ERROR', await window.locator('.project-error').allTextContents());
> 441 |     await expect.poll(() => readFile(documentPath, 'utf8')).toBe('# Base\n');
      |                                                             ^ Error: expect(received).toBe(expected) // Object.is equality
  442 |     await expect(changed.locator('.git-change-open')).toHaveCount(0);
  443 |     await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(1);
  444 |     await expect(window.locator('.editor-surface .view-lines')).toContainText('Unsaved buffer text');
  445 |     await expect.poll(async () => (await reading.evaluateAll<string>('document.body.innerText'))
  446 |       .some((text) => text?.includes('Saved after discard')), { timeout: 20_000 }).toBe(true);
  447 |     await window.waitForTimeout(3_000);
  448 |     await expect(documentEditor).toBeFocused();
  449 |     expect(await window.evaluate(() => document.hasFocus())).toBe(true);
  450 |     await expect.poll(() => shellHasKeyboardFocus(application)).toBe(true);
  451 |     await documentEditor.pressSequentially(' continues');
  452 |     await application.evaluate(({ dialog }) => {
  453 |       const messages: string[] = [];
  454 |       (globalThis as typeof globalThis & { saveConflicts: string[] }).saveConflicts = messages;
  455 |       dialog.showMessageBox = async (...args: unknown[]) => {
  456 |         messages.push((args.at(-1) as { message: string }).message);
  457 |         return { response: 1, checkboxChecked: false };
  458 |       };
  459 |     });
  460 |     await window.keyboard.press('Control+S');
  461 |     await expect.poll(() => readFile(documentPath, 'utf8')).toContain('Saved after discard continues');
  462 |     await expect(window.locator('.document-tab:not(.git-diff-tab) .tab-dirty')).toHaveCount(0);
  463 |     await expect(documentEditor).toBeFocused();
  464 |     expect(await application.evaluate(() => (globalThis as typeof globalThis & { saveConflicts: string[] }).saveConflicts))
  465 |       .toEqual(['This file was changed by another application.']);
  466 |   } finally {
  467 |     await disposeApplication(application);
  468 |     await rm(root, { recursive: true, force: true });
  469 |     await rm(configRoot, { recursive: true, force: true });
  470 |   }
  471 | });
  472 | 
```