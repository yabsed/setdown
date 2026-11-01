# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workspace/workspace-zoom.spec.ts >> Git review, ordinary editors and a second window preserve md zoom scopes without replacing models
- Location: test/e2e/workspace/workspace-zoom.spec.ts:365:39

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.git-diff-editor')
Expected substring: "Zoom undo sentinel"
Received string:    "1234# BeforeText1234# AfterText undo sentinelZoom"
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('.git-diff-editor') with timeout 5000ms
  - waiting for locator('.git-diff-editor')
    14 × locator resolved to <div class="git-diff-editor" data-keybinding-context="2">…</div>
       - unexpected value "1234# BeforeText1234# AfterText undo sentinelZoom"

```

```yaml
- toolbar:
  - button "More Actions...": 
- toolbar:
  - button "Revert Block": 
- code:
  - textbox "Staged version"
- code:
  - textbox "Current document"
- img
```

# Test source

```ts
  300 |     await expect.poll(async () => Number(await pdfZoom().inputValue())).toBeGreaterThan(1);
  301 |     await reader.getByRole('button', { name: '100%', exact: true }).click();
  302 |     const before = await coordinate();
  303 |     await page.mouse.move(point.x, point.y); await page.keyboard.down('Control');
  304 |     await page.mouse.wheel(0, -80); await page.keyboard.up('Control');
  305 |     await expect.poll(async () => Number(await pdfZoom().inputValue())).toBeGreaterThan(1);
  306 |     const after = await coordinate();
  307 |     expect(Math.abs(after[0] - before[0])).toBeLessThan(.005);
  308 |     expect(Math.abs(after[1] - before[1])).toBeLessThan(.005);
  309 |     await expect(page.getByRole('button', { name: 'Reset pdf zoom', exact: true })).toHaveText(`${Math.round(Number(await pdfZoom().inputValue()) * 100)}%`);
  310 |     await page.getByRole('button', { name: 'Reset pdf zoom', exact: true }).click();
  311 |     await expect(pdfZoom()).toHaveValue('1');
  312 |     await page.getByRole('button', { name: 'Zoom pdf in', exact: true }).click();
  313 |     await expect.poll(async () => Number(await pdfZoom().inputValue())).toBeCloseTo(1.1, 4);
  314 |     const savedPdfZoom = await pdfZoom().inputValue();
  315 |     expect((await state(app)).factor).toBe(1);
  316 |     expect(await activeTextZoom(page)).toBe(110);
  317 |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), other);
  318 |     await expect(reader).toHaveAttribute('data-pdf-pages', '12'); await expect(pdfZoom()).toHaveValue('1');
  319 |     await page.getByRole('tab').filter({ hasText: 'one.pdf' }).click();
  320 |     await expect(pdfZoom()).toHaveValue(savedPdfZoom);
  321 |     await page.keyboard.press('Control+0'); await expect(pdfZoom()).toHaveValue(savedPdfZoom);
  322 |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), image);
  323 |     const imageReader = page.getByRole('region', { name: 'Image reader', exact: true });
  324 |     await expect(imageReader).toHaveAttribute('data-image-ready', 'true');
  325 |     await imageReader.getByRole('button', { name: '100%', exact: true }).click();
  326 |     const viewport = imageReader.getByRole('region', { name: 'Image canvas' });
  327 |     await viewport.evaluate(node => { node.scrollLeft = 500; node.scrollTop = 400; });
  328 |     const imageBox = (await viewport.boundingBox())!;
  329 |     const imagePoint = { x: imageBox.x + 240, y: imageBox.y + 210 };
  330 |     const imageCoordinate = () => imageReader.locator('img').evaluate((node, point) => {
  331 |       const r = node.getBoundingClientRect(); return [(point.x - r.left) / r.width, (point.y - r.top) / r.height];
  332 |     }, imagePoint);
  333 |     await pinch(app, 1.3, viewport);
  334 |     await expect.poll(async () => Number(await imageReader.getByRole('combobox', { name: 'Image zoom' }).inputValue())).toBeGreaterThan(1);
  335 |     await imageReader.getByRole('button', { name: '100%', exact: true }).click();
  336 |     const imageBefore = await imageCoordinate();
  337 |     await page.mouse.move(imagePoint.x, imagePoint.y); await page.keyboard.down('Control');
  338 |     await page.mouse.wheel(0, -80); await page.keyboard.up('Control');
  339 |     const imageZoom = () => imageReader.getByRole('combobox', { name: 'Image zoom' });
  340 |     await expect.poll(async () => Number(await imageZoom().inputValue())).toBeCloseTo(1.1, 4);
  341 |     const imageAfter = await imageCoordinate();
  342 |     expect(Math.abs(imageAfter[0] - imageBefore[0])).toBeLessThan(.001);
  343 |     expect(Math.abs(imageAfter[1] - imageBefore[1])).toBeLessThan(.001);
  344 |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), otherImage);
  345 |     await expect(imageReader).toHaveAttribute('data-image-ready', 'true'); await expect(imageZoom()).toHaveValue('1');
  346 |     await page.getByRole('tab').filter({ hasText: 'large.svg' }).click();
  347 |     await expect(imageZoom()).toHaveValue('1.1');
  348 |     await expect(page.getByRole('button', { name: 'Reset image zoom', exact: true })).toHaveText('110%');
  349 |     await page.getByRole('button', { name: 'Reset image zoom', exact: true }).click();
  350 |     await expect(imageZoom()).toHaveValue('1');
  351 |     await page.getByRole('button', { name: 'Zoom image in', exact: true }).click();
  352 |     await expect(imageZoom()).toHaveValue('1.1');
  353 |     await page.keyboard.press('Control+='); await page.keyboard.press('Control+0');
  354 |     await expect(imageZoom()).toHaveValue('1.1');
  355 |     expect(await activeTextZoom(page)).toBe(110);
  356 |     await imageReader.getByRole('button', { name: 'Fit width', exact: true }).click();
  357 |     await expect(imageZoom()).toHaveValue('fit-width');
  358 |     const fitWidth = await imageReader.locator('img').evaluate(node => node.getBoundingClientRect().width);
  359 |     await page.keyboard.press('Control+=');
  360 |     await expect.poll(() => imageReader.locator('img').evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(fitWidth - 20);
  361 |     await expect(imageZoom()).toHaveValue('fit-width');
  362 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  363 | });
  364 | 
  365 | for (const extension of ['md', 'ts']) test(`Git review, ordinary editors and a second window preserve ${extension} zoom scopes without replacing models`, async () => {
  366 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-review-zoom-'));
  367 |   const file = path.join(root, `review.${extension}`);
  368 |   const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  369 |   git('init', '-b', 'main'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
  370 |   await writeFile(path.join(root, '.gitignore'), 'config/\n');
  371 |   await writeFile(file, '# Before\n\nText\n'); git('add', '.'); git('commit', '-m', 'base');
  372 |   await writeFile(file, '# After\n\nText\n');
  373 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  374 |   const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  375 |   try {
  376 |     const page = await app.firstWindow(); await focusApplication(app);
  377 |     const menuIds = await page.evaluate(async () => (await window.marktex.getApplicationMenu('application-menu-view')).map(item => item.id));
  378 |     expect(menuIds).toContain('menu-reset-zoom');
  379 |     expect(menuIds).not.toContain('menu-reset-text-zoom');
  380 |     expect(menuIds).not.toContain('menu-reset-terminal-zoom');
  381 |     await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
  382 |     await page.reload();
  383 |     await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  384 |     await page.getByRole('button', { name: 'Source Control', exact: true }).click();
  385 |     await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) }).locator('.git-change-open').click();
  386 |     const editor = page.getByRole('textbox', { name: 'Current document', exact: true });
  387 |     await expect(editor).toBeEditable();
  388 |     await editor.press('Control+End'); await editor.pressSequentially('Zoom undo sentinel');
  389 |     await pinch(app, 1.3, page.locator('.git-diff-editor .monaco-editor').last());
  390 |     await expect.poll(() => activeTextZoom(page)).toBeGreaterThan(100);
  391 |     await page.getByRole('button', { name: 'Reset text zoom', exact: true }).click();
  392 |     await expect.poll(() => activeTextZoom(page)).toBe(100);
  393 |     await page.locator('.git-diff-editor .monaco-editor').last().hover();
  394 |     await page.keyboard.down('Control'); await page.mouse.wheel(0, -80); await page.keyboard.up('Control');
  395 |     await expect.poll(() => activeTextZoom(page)).toBe(110);
  396 |     await expect.poll(() => page.locator('.git-diff-editor .view-line').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(15.4, 1);
  397 |     await expect(page.getByRole('button', { name: 'Reset text zoom', exact: true })).toHaveText('110%');
  398 |     await page.getByRole('button', { name: 'Zoom text in', exact: true }).click();
  399 |     await expect(editor).toBeEditable();
> 400 |     await expect(page.locator('.git-diff-editor')).toContainText('Zoom undo sentinel');
      |                                                    ^ Error: expect(locator).toContainText(expected) failed
  401 |     await expect(page.getByRole('button', { name: 'Reset text zoom', exact: true })).toHaveText('120%');
  402 |     await page.getByRole('button', { name: 'Zoom text out', exact: true }).click();
  403 |     await expect(page.getByRole('button', { name: 'Reset text zoom', exact: true })).toHaveText('110%');
  404 |     // Text sizing must retain the editable model and undo stack.
  405 |     await editor.press('Control+z');
  406 |     await expect(page.locator('.git-diff-editor')).not.toContainText('Zoom undo sentinel');
  407 |     await page.getByRole('tab').filter({ hasText: `review.${extension}` }).first().click();
  408 |     if (extension === 'md') await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
  409 |     await expect.poll(() => page.locator('.editor-surface .view-line').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(14, 1);
  410 |     await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-new-window'));
  411 |     const shells = () => app.windows().filter(window => window.url().startsWith('file:'));
  412 |     await expect.poll(() => shells().length).toBe(2);
  413 |     const second = shells().find(window => window !== page)!;
  414 |     await expect.poll(() => second.evaluate(() => window.marktex.getZoom())).toMatchObject({ text: 100, app: 100 });
  415 |     await second.evaluate(() => window.marktex.executeApplicationMenuItem('menu-zoom-in'));
  416 |     await expect.poll(() => page.evaluate(() => window.marktex.getZoom())).toMatchObject({ text: 100, app: 110 });
  417 |     await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => Math.abs(window.webContents.getZoomFactor() - 1.1) < .0001))).toBe(true);
  418 |     await second.getByRole('button', { name: 'New Document', exact: true }).click();
  419 |     const reset = second.getByRole('button', { name: 'Reset text zoom', exact: true });
  420 |     await second.getByRole('button', { name: 'Zoom text in', exact: true }).click();
  421 |     await expect(reset).toHaveText('110%');
  422 |     await reset.click();
  423 |     await expect(reset).toHaveText('100%');
  424 |     await expect.poll(() => page.locator('.editor-surface .view-line').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(14, 1);
  425 |     expect(await page.evaluate(async () => (await window.marktex.getZoom()).app)).toBe(110);
  426 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  427 | });
  428 | 
  429 | test('two Markdown tabs retain independent zoom in native readers and Monaco', async () => {
  430 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-markdown-tab-zoom-'));
  431 |   const first = path.join(root, 'first.md'), second = path.join(root, 'second.md');
  432 |   await writeFile(first, '# First\n\nFirst tab text\n');
  433 |   await writeFile(second, '# Second\n\nSecond tab text\n');
  434 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  435 |   const app = await electron.launch({ args: ['.', first], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  436 |   try {
  437 |     const page = await app.firstWindow(); await focusApplication(app);
  438 |     const reset = page.getByRole('button', { name: 'Reset text zoom', exact: true });
  439 |     const increase = page.getByRole('button', { name: 'Zoom text in', exact: true });
  440 |     const nativeFactor = async () => (await state(app)).rows.find(row => row.visible)?.factor;
  441 |     await expect.poll(nativeFactor).toBe(1);
  442 |     for (let gesture = 0; gesture < 5; gesture++) {
  443 |       const previous = (await nativeFactor())!;
  444 |       await pinch(app, 1.02);
  445 |       await expect.poll(nativeFactor).toBeGreaterThan(previous);
  446 |     }
  447 |     const pinched = (await nativeFactor())!;
  448 |     await pinch(app, .75);
  449 |     await expect.poll(nativeFactor).toBeLessThan(pinched);
  450 |     expect((await state(app)).factor).toBe(1);
  451 |     await reset.click(); await expect.poll(nativeFactor).toBe(1);
  452 |     await increase.click(); await expect(reset).toHaveText('110%');
  453 |     await expect.poll(nativeFactor).toBeCloseTo(1.1, 4);
  454 |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), second);
  455 |     await expect(page.getByRole('tab', { name: /second.md/ })).toHaveAttribute('aria-selected', 'true');
  456 |     await expect(reset).toHaveText('100%'); await expect.poll(nativeFactor).toBe(1);
  457 |     await increase.click(); await increase.click(); await expect(reset).toHaveText('120%');
  458 |     await expect.poll(nativeFactor).toBeCloseTo(1.2, 4);
  459 |     await page.getByRole('tab', { name: /first.md/ }).click();
  460 |     await expect(reset).toHaveText('110%'); await expect.poll(nativeFactor).toBeCloseTo(1.1, 4);
  461 |     await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
  462 |     const font = () => page.locator('.focused-content .view-line').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  463 |     await expect.poll(font).toBeCloseTo(15.4, 1);
  464 |     await reset.click(); await expect.poll(font).toBe(14);
  465 |     await page.getByRole('tab', { name: /second.md/ }).click();
  466 |     await expect(reset).toHaveText('120%'); await expect.poll(nativeFactor).toBeCloseTo(1.2, 4);
  467 |     await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
  468 |     await expect.poll(font).toBeCloseTo(16.8, 1);
  469 |     await page.getByRole('tab', { name: /first.md/ }).click();
  470 |     await expect(reset).toHaveText('100%'); await expect.poll(font).toBe(14);
  471 |   } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
  472 | });
  473 | 
  474 | 
  475 | test('touchpad pinch zooms text, notebook outputs and terminal tabs independently', async () => {
  476 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pinch-'));
  477 |   const file = path.join(root, 'first.txt'), notebook = path.join(root, 'cells.ipynb');
  478 |   await writeFile(file, 'Original text\n');
  479 |   await writeFile(notebook, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
  480 |     { id: 'output', cell_type: 'code', metadata: {}, source: 'print(42)', execution_count: 1,
  481 |       outputs: [{ output_type: 'stream', name: 'stdout', text: '42\n' }] },
  482 |   ] }));
  483 |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  484 |   const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  485 |   try {
  486 |     const page = await app.firstWindow(); await focusApplication(app);
  487 |     const editor = page.locator('.editor-surface .monaco-editor');
  488 |     await expect(editor).toBeVisible();
  489 |     for (let gesture = 0; gesture < 5; gesture++) {
  490 |       const previous = await activeTextZoom(page);
  491 |       await pinch(app, 1.02, editor);
  492 |       await expect.poll(() => activeTextZoom(page)).toBeGreaterThan(previous);
  493 |     }
  494 |     const textZoom = await activeTextZoom(page);
  495 |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), notebook);
  496 |     const output = page.locator('.notebook-outputs');
  497 |     await expect(output).toContainText('42');
  498 |     await pinch(app, 1.3, output);
  499 |     await expect.poll(() => activeTextZoom(page)).toBeGreaterThan(100);
  500 |     const notebookZoom = await activeTextZoom(page);
```