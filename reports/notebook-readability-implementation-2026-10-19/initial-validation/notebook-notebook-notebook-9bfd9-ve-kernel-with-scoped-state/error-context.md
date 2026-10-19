# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> notebook stdin, variables and restart-all use the live kernel with scoped state
- Location: test/e2e/notebook/notebook.spec.ts:432:1

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Variables', exact: true })

```

# Test source

```ts
  350 |     const height = await first.evaluate(node => node.getBoundingClientRect().height);
  351 |     await scroll.evaluate(node => node.scrollTop = 3500);
  352 |     await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(3000);
  353 |     expect(await mounted!.evaluate(node => node.isConnected && document.activeElement === node)).toBe(true);
  354 |     expect(Math.abs(await first.evaluate(node => node.getBoundingClientRect().height) - height)).toBeLessThan(3);
  355 |     await ime.send('Input.insertText', { text: '한' }); await ime.detach();
  356 |     await expect(first.locator('.view-lines')).toContainText('한');
  357 |     await page.locator('[data-cell-id="code-20"]').getByRole('button', { name: 'Select cell', exact: true }).click();
  358 |     await expect(first.locator('.monaco-editor')).toHaveCount(0);
  359 |     await expect(first.locator('.notebook-outputs')).toHaveCount(0);
  360 |     expect(Math.abs(await first.evaluate(node => node.getBoundingClientRect().height) - height)).toBeLessThan(3);
  361 |     await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  362 |     await expect(page.locator('.notebook-cell')).toHaveCount(37);
  363 |     await page.keyboard.press('Control+z'); await expect(page.locator('.notebook-cell')).toHaveCount(36);
  364 |     await page.keyboard.press('Control+f');
  365 |     const find = page.getByRole('textbox', { name: 'Find in notebook', exact: true });
  366 |     await find.fill('Unique reader'); await find.pressSequentially(' text');
  367 |     await expect(find).toHaveValue('Unique reader text');
  368 |     await find.press('Enter');
  369 |     await expect(find).toBeFocused();
  370 |     await writeFile(test.info().outputPath('search-geometry.json'), JSON.stringify(await page.evaluate(() => { const reader = document.querySelector('[data-cell-id="intro"] .cell-markdown')!; const scroll = document.querySelector('.notebook-scroll')!; return { reader: reader.getBoundingClientRect().toJSON(), scroll: scroll.getBoundingClientRect().toJSON(), top: scroll.scrollTop, window: { x: window.scrollX, y: window.scrollY }, search: document.querySelector('.notebook-search')?.textContent, value: (document.querySelector('.notebook-search input') as HTMLInputElement)?.value }; })));
  371 |     await expect(page.locator('[data-cell-id="intro"] .cell-markdown')).toBeInViewport();
  372 |     await expect(page.locator('[data-cell-id="intro"] .cell-editor')).toHaveCount(0);
  373 |     await expect(page.locator('.notebook-search')).toContainText('1/1');
  374 |     await page.screenshot({ path: test.info().outputPath('notebook-reform.png') });
  375 |     await page.keyboard.press('Escape'); await page.keyboard.press('Control+s');
  376 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  377 | });
  378 | 
  379 | test('notebook convenience commands preserve data through replace, split, clear and image export', async () => {
  380 |   test.setTimeout(90_000);
  381 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-tools-ui-')), file = path.join(root, 'convenience.ipynb');
  382 |   const value = notebook();
  383 |   value.cells[1].outputs = [{ output_type: 'display_data', metadata: {}, data: { 'image/png': png, 'text/plain': 'image-search-target' } }] as any;
  384 |   await writeFile(file, JSON.stringify(value));
  385 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  386 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  387 |   try {
  388 |     const page = await application.firstWindow(); await focusApplication(application);
  389 |     const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  390 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  391 |     const command = async (label: string) => { await page.getByRole('button', { name: 'Commands…', exact: true }).click(); await page.getByRole('region', { name: 'Notebook commands' }).getByRole('button', { name: label, exact: true }).click(); };
  392 |     await page.getByRole('button', { name: 'Outline', exact: true }).click();
  393 |     await expect(page.getByRole('navigation', { name: 'Notebook outline' })).toContainText('Notebook');
  394 |     await page.getByRole('button', { name: 'Toggle notebook section' }).click(); await expect(page.locator('[data-cell-id="define"]')).toBeHidden();
  395 |     await page.getByRole('button', { name: 'Toggle notebook section' }).click(); await expect(page.locator('[data-cell-id="define"]')).toBeVisible();
  396 |     await page.getByRole('button', { name: 'View full size' }).click(); await expect(page.getByRole('dialog', { name: 'Notebook image viewer' })).toBeVisible();
  397 |     await page.getByRole('button', { name: 'Close image', exact: true }).click();
  398 |     const imageFile = path.join(root, 'image.png');
  399 |     await application.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, imageFile);
  400 |     await page.getByRole('button', { name: 'Save image…', exact: true }).click();
  401 |     await expect.poll(async () => readFile(imageFile).then(data => data.toString('base64'), () => '')).toBe(png);
  402 |     await page.locator('[data-cell-id="use"]').getByRole('button', { name: 'Select cell', exact: true }).click(); await page.keyboard.press('Control+f');
  403 |     await page.getByRole('textbox', { name: 'Find in notebook', exact: true }).fill('numbers');
  404 |     await page.getByRole('textbox', { name: 'Replace in notebook', exact: true }).fill('values');
  405 |     await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  406 |     await expect(page.locator('.notebook-notice')).toContainText('Replaced source matches'); await page.keyboard.press('Control+s');
  407 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('values.append(4)');
  408 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await page.keyboard.press('Control+s');
  409 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('numbers.append(4)');
  410 |     await page.getByRole('combobox', { name: 'Notebook search scope' }).selectOption('outputs');
  411 |     await page.getByRole('textbox', { name: 'Find in notebook', exact: true }).fill('image-search-target');
  412 |     await page.getByRole('button', { name: 'Next notebook match' }).click(); await expect(page.locator('.search-snippet')).toContainText('image-search-target');
  413 |     await page.getByRole('button', { name: 'Close notebook search' }).click();
  414 |     const editor = page.locator('[data-cell-id="define"]').getByRole('textbox', { name: /Code cell editor/ });
  415 |     await editor.press('Control+Home'); await editor.press('ArrowRight');
  416 |     await command('Split cell at cursor'); await expect(page.locator('.notebook-cell')).toHaveCount(4);
  417 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await expect(page.locator('.notebook-cell')).toHaveCount(3);
  418 |     await editor.press('Control+Home'); await editor.press('ArrowRight'); await editor.press('F2');
  419 |     await page.getByRole('textbox', { name: 'New symbol name' }).fill('renamed_numbers');
  420 |     await page.getByRole('button', { name: 'Rename across cells', exact: true }).click();
  421 |     await expect(page.getByRole('textbox', { name: 'New symbol name' })).toBeHidden(); await page.keyboard.press('Control+s');
  422 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('renamed_numbers.append(4)');
  423 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
  424 |     await command('Clear all outputs'); await expect(page.locator('.notebook-outputs')).toHaveCount(0);
  425 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await expect(page.locator('.notebook-outputs img')).toBeVisible();
  426 |     await page.keyboard.press('Control+s');
  427 |     expect(JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
  428 |     expect(errors).toEqual([]); await page.screenshot({ path: test.info().outputPath('notebook-convenience.png') });
  429 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  430 | });
  431 | 
  432 | test('notebook stdin, variables and restart-all use the live kernel with scoped state', async () => {
  433 |   test.setTimeout(90_000);
  434 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-variables-')), file = path.join(root, 'variables.ipynb');
  435 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [
  436 |     { id: 'input', cell_type: 'code', metadata: {}, source: 'answer = input("Name: ")\nitems = list(range(250))\nprint(answer)', execution_count: null, outputs: [] },
  437 |     { id: 'use', cell_type: 'code', metadata: {}, source: 'print(len(items))', execution_count: null, outputs: [] },
  438 |   ] }));
  439 |   const python = process.env.SETDOWN_TEST_NOTEBOOK_PYTHON ?? execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  440 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  441 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  442 |   try {
  443 |     const page = await application.firstWindow(); await focusApplication(application);
  444 |     await application.evaluate(({ dialog }, python) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [python] }); }, python);
  445 |     await page.getByRole('combobox', { name: 'Python environment', exact: true }).selectOption('__choose__');
  446 |     await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
  447 |     await page.getByRole('textbox', { name: 'Kernel input' }).fill('한글'); await page.getByRole('button', { name: 'Send input' }).click();
  448 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
  449 |     await expect(page.locator('[data-cell-id="use"] .notebook-outputs')).toContainText('250');
> 450 |     await page.getByRole('button', { name: 'Variables', exact: true }).click();
      |                                                                        ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  451 |     const variables = page.getByRole('region', { name: 'Notebook variables' });
  452 |     await variables.getByRole('button', { name: 'items', exact: true }).click(); await expect(variables).toContainText('1–100 of 250');
  453 |     await variables.getByRole('button', { name: 'Next 100' }).click(); await expect(variables).toContainText('101–200 of 250');
  454 |     await variables.getByRole('button', { name: 'All variables' }).click(); await expect(variables.getByRole('button', { name: 'answer', exact: true })).toBeVisible();
  455 |     await page.getByRole('button', { name: 'Commands…', exact: true }).click(); await page.getByRole('button', { name: 'Restart kernel and run all', exact: true }).click();
  456 |     await expect(variables).toContainText('Variables are available when the local kernel is idle.');
  457 |     await page.getByRole('textbox', { name: 'Kernel input' }).fill('restart'); await page.getByRole('button', { name: 'Send input' }).click();
  458 |     await expect(page.locator('.kernel-state')).toHaveText('idle'); await expect(variables.getByRole('button', { name: 'items', exact: true })).toBeVisible();
  459 |     await expect(page.locator('[data-cell-id="use"] .execution')).toHaveText('[2]'); await page.keyboard.press('Control+s');
  460 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  461 | });
  462 | 
```