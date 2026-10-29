# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> VS Code notebook defaults preserve normal table wrapping, horizontal code scroll and command-mode execution focus
- Location: test/e2e/notebook/notebook.spec.ts:577:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 1800
Received:   1567

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
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
  530 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
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
> 612 |     await expect.poll(() => code.locator('.cell-editor').evaluate(node => node.clientHeight)).toBeGreaterThan(1800);
      |                                                                                               ^ Error: expect(received).toBeGreaterThan(expected)
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
  631 |       expect(result.wordLines).toBe(1); expect(result.tableHeight).toBeLessThan(340);
  632 |       if (width === 420) expect(result.overflow).toBe(true);
  633 |       // No permanent action footer under the output; only padding and a scrollbar.
  634 |       expect(result.bodyHeight - result.tableBottom).toBeLessThan(25);
  635 |       measures.push({ width, ...result });
  636 |       await code.locator('.output-body').screenshot({ path: test.info().outputPath(`dataframe-${width}.png`) });
  637 |     }
  638 |     await writeFile(test.info().outputPath('dataframe-geometry.json'), JSON.stringify(measures, null, 2));
  639 |     await code.getByRole('button', { name: 'More cell actions', exact: true }).click();
  640 |     await page.keyboard.press('Delete'); await expect(page.locator('.notebook-cell')).toHaveCount(3);
  641 |     await page.keyboard.press('Escape'); await expect(code.getByRole('button', { name: 'More cell actions', exact: true })).toBeFocused();
  642 |     await end.getByRole('button', { name: 'Edit', exact: true }).click();
  643 |     await end.getByRole('textbox', { name: /Markdown cell editor/ }).press('Shift+Enter');
  644 |     await expect(page.locator('.notebook-cell')).toHaveCount(4);
  645 |     const added = page.locator('.notebook-cell').last();
  646 |     await expect(added).toHaveAttribute('data-cell-kind', 'markdown');
  647 |     await expect(added.getByRole('textbox', { name: /Markdown cell editor/ })).toBeFocused();
  648 |     await page.keyboard.press('Alt+Enter');
  649 |     await expect(page.locator('.notebook-cell')).toHaveCount(5);
  650 |     await expect(page.locator('.notebook-cell').last()).toHaveAttribute('data-cell-kind', 'code');
  651 |     await page.keyboard.press('Control+s');
  652 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
  653 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  654 | });
  655 | 
```