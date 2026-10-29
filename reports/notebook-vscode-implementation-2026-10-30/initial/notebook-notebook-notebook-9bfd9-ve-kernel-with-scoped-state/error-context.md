# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> notebook stdin, variables and restart-all use the live kernel with scoped state
- Location: test/e2e/notebook/notebook.spec.ts:514:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('.kernel-state')
Expected: "idle"
Received: "idle"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('.kernel-state') with timeout 5000ms
  - waiting for locator('.kernel-state')
    - locator resolved to <span role="status" title="Kernel busy" aria-label="Kernel busy" class="kernel-state svelte-yxkx1d">…</span>
    - unexpected value "busy"
    13 × locator resolved to <span role="status" title="Kernel idle" aria-label="Kernel idle" class="kernel-state svelte-yxkx1d">…</span>
       - unexpected value "idle"

```

```yaml
- status "Kernel idle": idle
```

# Test source

```ts
  430 |     const height = await first.evaluate(node => node.getBoundingClientRect().height);
  431 |     await scroll.evaluate(node => node.scrollTop = 3500);
  432 |     await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(3000);
  433 |     expect(await mounted!.evaluate(node => node.isConnected && document.activeElement === node)).toBe(true);
  434 |     expect(Math.abs(await first.evaluate(node => node.getBoundingClientRect().height) - height)).toBeLessThan(3);
  435 |     await ime.send('Input.insertText', { text: '한' }); await ime.detach();
  436 |     await expect(first.locator('.view-lines')).toContainText('한');
  437 |     await page.locator('[data-cell-id="code-20"]').getByRole('button', { name: 'Select cell', exact: true }).click();
  438 |     await expect(first.locator('.monaco-editor')).toHaveCount(0);
  439 |     await expect(first.locator('.notebook-outputs')).toHaveCount(0);
  440 |     expect(Math.abs(await first.evaluate(node => node.getBoundingClientRect().height) - height)).toBeLessThan(3);
  441 |     await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  442 |     await expect(page.locator('.notebook-cell')).toHaveCount(37);
  443 |     await page.keyboard.press('Control+z'); await expect(page.locator('.notebook-cell')).toHaveCount(36);
  444 |     await page.keyboard.press('Control+f');
  445 |     const find = page.getByRole('textbox', { name: 'Find in notebook', exact: true });
  446 |     await find.fill('Unique reader'); await find.pressSequentially(' text');
  447 |     await expect(find).toHaveValue('Unique reader text');
  448 |     await find.press('Enter');
  449 |     await expect(find).toBeFocused();
  450 |     await writeFile(test.info().outputPath('search-geometry.json'), JSON.stringify(await page.evaluate(() => { const reader = document.querySelector('[data-cell-id="intro"] .cell-markdown')!; const scroll = document.querySelector('.notebook-scroll')!; return { reader: reader.getBoundingClientRect().toJSON(), scroll: scroll.getBoundingClientRect().toJSON(), top: scroll.scrollTop, window: { x: window.scrollX, y: window.scrollY }, search: document.querySelector('.notebook-search')?.textContent, value: (document.querySelector('.notebook-search input') as HTMLInputElement)?.value }; })));
  451 |     await expect(page.locator('[data-cell-id="intro"] .cell-markdown')).toBeInViewport();
  452 |     await expect(page.locator('[data-cell-id="intro"] .cell-editor')).toHaveCount(0);
  453 |     await expect(page.locator('.notebook-search')).toContainText('1/1');
  454 |     await page.screenshot({ path: test.info().outputPath('notebook-reform.png') });
  455 |     await page.keyboard.press('Escape'); await page.keyboard.press('Control+s');
  456 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  457 | });
  458 | 
  459 | test('notebook convenience commands preserve data through replace, split, clear and image export', async () => {
  460 |   test.setTimeout(90_000);
  461 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-tools-ui-')), file = path.join(root, 'convenience.ipynb');
  462 |   const value = notebook();
  463 |   value.cells[1].outputs = [{ output_type: 'display_data', metadata: {}, data: { 'image/png': png, 'text/plain': 'image-search-target' } }] as any;
  464 |   await writeFile(file, JSON.stringify(value));
  465 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  466 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  467 |   try {
  468 |     const page = await application.firstWindow(); await focusApplication(application);
  469 |     const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  470 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  471 |     const command = async (label: string) => { await page.getByRole('button', { name: 'Commands…', exact: true }).click(); await page.getByRole('region', { name: 'Notebook commands' }).getByRole('button', { name: label, exact: true }).click(); };
  472 |     await page.getByRole('button', { name: 'Outline', exact: true }).click();
  473 |     await expect(page.getByRole('navigation', { name: 'Notebook outline' })).toContainText('Notebook');
  474 |     await page.getByRole('button', { name: 'Toggle notebook section' }).click(); await expect(page.locator('[data-cell-id="define"]')).toBeHidden();
  475 |     await page.getByRole('button', { name: 'Toggle notebook section' }).click(); await expect(page.locator('[data-cell-id="define"]')).toBeVisible();
  476 |     await page.getByRole('button', { name: 'Output 1 actions', exact: true }).click();
  477 |     await page.getByRole('button', { name: 'View full size' }).click(); await expect(page.getByRole('dialog', { name: 'Notebook image viewer' })).toBeVisible();
  478 |     await page.getByRole('button', { name: 'Close image', exact: true }).click();
  479 |     const imageFile = path.join(root, 'image.png');
  480 |     await application.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, imageFile);
  481 |     await page.getByRole('button', { name: 'Output 1 actions', exact: true }).click();
  482 |     await page.getByRole('button', { name: 'Save image…', exact: true }).click();
  483 |     await expect.poll(async () => readFile(imageFile).then(data => data.toString('base64'), () => '')).toBe(png);
  484 |     await page.locator('[data-cell-id="use"]').getByRole('button', { name: 'Select cell', exact: true }).click(); await page.keyboard.press('Control+f');
  485 |     await page.getByRole('textbox', { name: 'Find in notebook', exact: true }).fill('numbers');
  486 |     await page.getByRole('textbox', { name: 'Replace in notebook', exact: true }).fill('values');
  487 |     await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  488 |     await expect(page.locator('.notebook-notice')).toContainText('Replaced source matches'); await page.keyboard.press('Control+s');
  489 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('values.append(4)');
  490 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await page.keyboard.press('Control+s');
  491 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('numbers.append(4)');
  492 |     await page.getByRole('combobox', { name: 'Notebook search scope' }).selectOption('outputs');
  493 |     await page.getByRole('textbox', { name: 'Find in notebook', exact: true }).fill('image-search-target');
  494 |     await page.getByRole('button', { name: 'Next notebook match' }).click(); await expect(page.locator('.search-snippet')).toContainText('image-search-target');
  495 |     await page.getByRole('button', { name: 'Close notebook search' }).click();
  496 |     const editor = page.locator('[data-cell-id="define"]').getByRole('textbox', { name: /Code cell editor/ });
  497 |     await editor.press('Control+Home'); await editor.press('ArrowRight');
  498 |     await command('Split cell at cursor'); await expect(page.locator('.notebook-cell')).toHaveCount(4);
  499 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await expect(page.locator('.notebook-cell')).toHaveCount(3);
  500 |     await editor.press('Control+Home'); await editor.press('ArrowRight'); await editor.press('F2');
  501 |     await page.getByRole('textbox', { name: 'New symbol name' }).fill('renamed_numbers');
  502 |     await page.getByRole('button', { name: 'Rename across cells', exact: true }).click();
  503 |     await expect(page.getByRole('textbox', { name: 'New symbol name' })).toBeHidden(); await page.keyboard.press('Control+s');
  504 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('renamed_numbers.append(4)');
  505 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
  506 |     await command('Clear all outputs'); await expect(page.locator('.notebook-outputs')).toHaveCount(0);
  507 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await expect(page.locator('.notebook-outputs img')).toBeVisible();
  508 |     await page.keyboard.press('Control+s');
  509 |     expect(JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
  510 |     expect(errors).toEqual([]); await page.screenshot({ path: test.info().outputPath('notebook-convenience.png') });
  511 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  512 | });
  513 | 
  514 | test('notebook stdin, variables and restart-all use the live kernel with scoped state', async () => {
  515 |   test.setTimeout(90_000);
  516 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-variables-')), file = path.join(root, 'variables.ipynb');
  517 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [
  518 |     { id: 'input', cell_type: 'code', metadata: {}, source: 'answer = input("Name: ")\nitems = list(range(250))\nprint(answer)', execution_count: null, outputs: [] },
  519 |     { id: 'use', cell_type: 'code', metadata: {}, source: 'print(len(items))', execution_count: null, outputs: [] },
  520 |   ] }));
  521 |   const python = process.env.SETDOWN_TEST_NOTEBOOK_PYTHON ?? execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  522 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  523 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  524 |   try {
  525 |     const page = await application.firstWindow(); await focusApplication(application);
  526 |     await application.evaluate(({ dialog }, python) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [python] }); }, python);
  527 |     await page.getByRole('combobox', { name: 'Python environment', exact: true }).selectOption('__choose__');
  528 |     await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
  529 |     await page.getByRole('textbox', { name: 'Kernel input' }).fill('한글'); await page.getByRole('button', { name: 'Send input' }).click();
> 530 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
      |                                                 ^ Error: expect(locator).toHaveText(expected) failed
  531 |     await expect(page.locator('[data-cell-id="use"] .notebook-outputs')).toContainText('250');
  532 |     await page.getByRole('button', { name: 'Variables', exact: true }).click();
  533 |     const variables = page.getByRole('region', { name: 'Notebook variables' });
  534 |     await variables.getByRole('button', { name: 'items', exact: true }).click(); await expect(variables).toContainText('1–100 of 250');
  535 |     await variables.getByRole('button', { name: 'Next 100' }).click(); await expect(variables).toContainText('101–200 of 250');
  536 |     await variables.getByRole('button', { name: 'All variables' }).click(); await expect(variables.getByRole('button', { name: 'answer', exact: true })).toBeVisible();
  537 |     await page.getByRole('button', { name: 'Commands…', exact: true }).click(); await page.getByRole('button', { name: 'Restart kernel and run all', exact: true }).click();
  538 |     await expect(variables).toContainText('Variables are available when the local kernel is idle.');
  539 |     await page.getByRole('textbox', { name: 'Kernel input' }).fill('restart'); await page.getByRole('button', { name: 'Send input' }).click();
  540 |     await expect(page.locator('.kernel-state')).toHaveText('idle'); await expect(variables.getByRole('button', { name: 'items', exact: true })).toBeVisible();
  541 |     await expect(page.locator('[data-cell-id="use"] .execution')).toHaveText('[2]'); await page.keyboard.press('Control+s');
  542 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  543 | });
  544 | 
  545 | test('notebook project extraPaths resolve imports and hover, reload live, and retain real missing-import diagnostics', async () => {
  546 |   test.setTimeout(90_000);
  547 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-paths-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-paths-config-'));
  548 |   const file = path.join(root, 'imports.ipynb'), settings = path.join(root, '.vscode', 'settings.json');
  549 |   await mkdir(path.join(root, '.git')); await mkdir(path.dirname(settings));
  550 |   await mkdir(path.join(root, 'src 한글', 'vlmflash_demo'), { recursive: true });
  551 |   await writeFile(path.join(root, 'src 한글', 'vlmflash_demo', '__init__.py'), '"""Local VLM module documentation."""\nVALUE = 42\n');
  552 |   const source = 'import vlmflash_demo\nimport definitely_missing_setdown_control';
  553 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [{ id: 'imports', cell_type: 'code', metadata: {}, source, execution_count: null, outputs: [] }] }));
  554 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  555 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  556 |   try {
  557 |     const page = await application.firstWindow(); await focusApplication(application);
  558 |     const cell = page.locator('[data-cell-id="imports"]');
  559 |     await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30000 });
  560 |     await expect(cell.locator('.squiggly-warning')).toHaveCount(2, { timeout: 30000 });
  561 |     await writeFile(settings, '{\n// Workspace-relative path, including Unicode\n"python.analysis.extraPaths": ["${workspaceFolder}/src 한글"],\n}\n');
  562 |     await expect(cell.locator('.squiggly-warning')).toHaveCount(1, { timeout: 30000 });
  563 |     const info = await page.evaluate(async ({ file, source }) => {
  564 |       const api = (window as any).marktex.language;
  565 |       const connection = await api.open({ id: 'paths-probe', generation: 'paths', path: file, notebook: 'python', text: '', version: 1, cells: [{ id: 'imports', version: 1, text: source }] });
  566 |       const hover = await api.request('paths-probe', 1, 'paths-hover', 'textDocument/hover', { cell: 'imports', position: { line: 0, character: 10 } });
  567 |       api.close('paths-probe'); return { connection, hover };
  568 |     }, { file, source });
  569 |     expect(JSON.stringify(info.connection.context)).toContain('.vscode'); expect(JSON.stringify(info.connection.context)).toContain('src 한글');
  570 |     expect(JSON.stringify(info.hover)).toContain('Local VLM module documentation');
  571 |     await writeFile(settings, '{"python.analysis.extraPaths": []}\n');
  572 |     await expect(cell.locator('.squiggly-warning')).toHaveCount(2, { timeout: 30000 });
  573 |     expect(await readFile(file, 'utf8')).toContain('definitely_missing_setdown_control');
  574 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  575 | });
  576 | 
  577 | test('VS Code notebook defaults preserve normal table wrapping, horizontal code scroll and command-mode execution focus', async () => {
  578 |   test.setTimeout(90_000);
  579 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-vscode-')), file = path.join(root, 'design.ipynb');
  580 |   // The pandas 2.3.3 fixture used for the measured VS Code comparison.
  581 |   const html = await readFile('test/fixtures/notebook/dataframe.html', 'utf8');
  582 |   const value = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
  583 |     { id: 'intro', cell_type: 'markdown', metadata: {}, source: '# Notebook\n\nAn introduction.' },
  584 |     { id: 'code', cell_type: 'code', metadata: {}, source: `label = "${'long_source_'.repeat(80)}"\n` + Array.from({ length: 80 }, (_, i) => `value_${i} = ${i}`).join('\n'), execution_count: 20,
  585 |       outputs: [{ output_type: 'display_data', data: { 'text/html': html, 'image/png': png, 'text/plain': 'table fallback' }, metadata: {} }] },
  586 |     { id: 'end', cell_type: 'markdown', metadata: {}, source: '## Conclusion' },
  587 |   ] };
  588 |   await writeFile(file, JSON.stringify(value));
  589 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  590 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  591 |   try {
  592 |     const page = await application.firstWindow(); await focusApplication(application);
  593 |     const code = page.locator('[data-cell-id="code"]'), intro = page.locator('[data-cell-id="intro"]'), end = page.locator('[data-cell-id="end"]');
  594 |     const scroll = page.locator('.notebook-scroll');
  595 |     const command = async (name: string) => { await page.getByRole('button', { name: 'Commands…', exact: true }).click(); await page.getByRole('region', { name: 'Notebook commands' }).getByRole('button', { name, exact: true }).click(); };
  596 |     await expect(intro.locator('h1')).toHaveText('Notebook');
  597 |     await expect(code.locator('.line-numbers')).toHaveCount(0);
  598 |     await expect(page.locator('.notebook-sticky')).toHaveCount(0);
  599 |     await intro.getByRole('button', { name: 'Edit', exact: true }).click();
  600 |     await intro.getByRole('textbox', { name: /Markdown cell editor/ }).press('Shift+Enter');
  601 |     await expect(code).toBeFocused();
  602 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  603 |     await code.press('Enter');
  604 |     const editor = code.getByRole('textbox', { name: /Code cell editor/ });
  605 |     await editor.press('Control+Home'); await editor.press('End');
  606 |     const horizontal = () => code.locator('.view-lines').evaluate(node => node.getBoundingClientRect().left - node.closest('.cell-editor')!.getBoundingClientRect().left);
  607 |     await expect.poll(horizontal).toBeLessThan(-500);
  608 |     const before = await horizontal();
  609 |     await scroll.evaluate(node => node.scrollTop += 300);
  610 |     await expect.poll(horizontal).toBeCloseTo(before, 0);
  611 |     await command('Toggle code word wrap');
  612 |     await expect.poll(() => code.locator('.cell-editor').evaluate(node => node.clientHeight)).toBeGreaterThan(1800);
  613 |     await command('Toggle code word wrap');
  614 |     await expect.poll(() => code.locator('.cell-editor').evaluate(node => node.clientHeight)).toBeLessThan(1800);
  615 |     await code.locator('.execution').click();
  616 |     await command('Toggle cell line numbers'); await expect(code.locator('.line-numbers').first()).toBeVisible();
  617 |     await code.locator('.output-placeholder, .notebook-outputs').scrollIntoViewIfNeeded();
  618 |     // HTML precedes raster fallbacks, but the original MIME bundle remains intact.
  619 |     await expect(code.locator('.output-html table')).toBeVisible();
  620 |     await expect(code.locator('.notebook-outputs img')).toHaveCount(0);
  621 |     const measures = [];
  622 |     for (const width of [420, 560, 780]) {
  623 |       await code.locator('.output-body').evaluate((node, width) => { node.style.width = `${width + 16}px`; node.style.boxSizing = 'border-box'; }, width);
  624 |       const result = await code.locator('.output-body').evaluate(node => {
  625 |         const table = node.querySelector('table')!, label = table.querySelector('tbody th')!;
  626 |         const word = label.firstChild!, range = document.createRange(); range.setStart(word, 0); range.setEnd(word, 8);
  627 |         return { tableWidth: table.getBoundingClientRect().width, tableHeight: table.getBoundingClientRect().height,
  628 |           wordLines: range.getClientRects().length, overflow: node.scrollWidth > node.clientWidth,
  629 |           bodyHeight: node.clientHeight, tableBottom: table.getBoundingClientRect().bottom - node.getBoundingClientRect().top };
  630 |       });
```