# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> notebook project extraPaths resolve imports and hover, reload live, and retain real missing-import diagnostics
- Location: test/e2e/notebook/notebook.spec.ts:614:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('[data-cell-id="imports"]').locator('.squiggly-warning')
Expected: 2
Received: 0
Timeout:  30000ms

Call log:
  - Expect "toHaveCount" locator('[data-cell-id="imports"]').locator('.squiggly-warning') with timeout 30000ms
  - waiting for locator('[data-cell-id="imports"]').locator('.squiggly-warning')
    63 × locator resolved to 0 elements
       - unexpected value "0"

```

# Test source

```ts
  529 |   test.setTimeout(90_000);
  530 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-tools-ui-')), file = path.join(root, 'convenience.ipynb');
  531 |   const value = notebook();
  532 |   value.cells[1].outputs = [{ output_type: 'display_data', metadata: {}, data: { 'image/png': png, 'text/plain': 'image-search-target' } }] as any;
  533 |   await writeFile(file, JSON.stringify(value));
  534 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  535 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  536 |   try {
  537 |     const page = await application.firstWindow(); await focusApplication(application);
  538 |     const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  539 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  540 |     const command = async (label: string) => { await page.getByRole('button', { name: 'Commands…', exact: true }).click(); await page.getByRole('region', { name: 'Notebook commands' }).getByRole('button', { name: label, exact: true }).click(); };
  541 |     await page.getByRole('button', { name: 'Outline', exact: true }).click();
  542 |     await expect(page.getByRole('navigation', { name: 'Notebook outline' })).toContainText('Notebook');
  543 |     await page.getByRole('button', { name: 'Toggle notebook section' }).click(); await expect(page.locator('[data-cell-id="define"]')).toBeHidden();
  544 |     await page.getByRole('button', { name: 'Toggle notebook section' }).click(); await expect(page.locator('[data-cell-id="define"]')).toBeVisible();
  545 |     await page.getByRole('button', { name: 'Output 1 actions', exact: true }).click();
  546 |     await page.getByRole('button', { name: 'View full size' }).click(); await expect(page.getByRole('dialog', { name: 'Notebook image viewer' })).toBeVisible();
  547 |     await page.getByRole('button', { name: 'Close image', exact: true }).click();
  548 |     const imageFile = path.join(root, 'image.png');
  549 |     await application.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, imageFile);
  550 |     await page.getByRole('button', { name: 'Output 1 actions', exact: true }).click();
  551 |     await page.getByRole('button', { name: 'Save image…', exact: true }).click();
  552 |     await expect.poll(async () => readFile(imageFile).then(data => data.toString('base64'), () => '')).toBe(png);
  553 |     await page.locator('[data-cell-id="use"]').getByRole('button', { name: 'Select cell', exact: true }).click(); await page.keyboard.press('Control+f');
  554 |     await page.getByRole('textbox', { name: 'Find in notebook', exact: true }).fill('numbers');
  555 |     await page.getByRole('textbox', { name: 'Replace in notebook', exact: true }).fill('values');
  556 |     await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  557 |     await expect(page.locator('.notebook-notice')).toContainText('Replaced source matches'); await page.keyboard.press('Control+s');
  558 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('values.append(4)');
  559 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await page.keyboard.press('Control+s');
  560 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('numbers.append(4)');
  561 |     await page.getByRole('combobox', { name: 'Notebook search scope' }).selectOption('outputs');
  562 |     await page.getByRole('textbox', { name: 'Find in notebook', exact: true }).fill('image-search-target');
  563 |     await page.getByRole('button', { name: 'Next notebook match' }).click(); await expect(page.locator('.search-snippet')).toContainText('image-search-target');
  564 |     await page.getByRole('button', { name: 'Close notebook search' }).click();
  565 |     const editor = page.locator('[data-cell-id="define"]').getByRole('textbox', { name: /Code cell editor/ });
  566 |     await editor.press('Control+Home'); await editor.press('ArrowRight');
  567 |     await command('Split cell at cursor'); await expect(page.locator('.notebook-cell')).toHaveCount(4);
  568 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await expect(page.locator('.notebook-cell')).toHaveCount(3);
  569 |     await editor.press('Control+Home'); await editor.press('ArrowRight'); await editor.press('F2');
  570 |     await page.getByRole('textbox', { name: 'New symbol name' }).fill('renamed_numbers');
  571 |     await page.getByRole('button', { name: 'Rename across cells', exact: true }).click();
  572 |     await expect(page.getByRole('textbox', { name: 'New symbol name' })).toBeHidden(); await page.keyboard.press('Control+s');
  573 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('renamed_numbers.append(4)');
  574 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
  575 |     await command('Clear all outputs'); await expect(page.locator('.notebook-outputs')).toHaveCount(0);
  576 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click(); await expect(page.locator('.notebook-outputs img')).toBeVisible();
  577 |     await page.keyboard.press('Control+s');
  578 |     expect(JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
  579 |     expect(errors).toEqual([]); await page.screenshot({ path: test.info().outputPath('notebook-convenience.png') });
  580 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  581 | });
  582 | 
  583 | test('notebook stdin, variables and restart-all use the live kernel with scoped state', async () => {
  584 |   test.setTimeout(90_000);
  585 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-variables-')), file = path.join(root, 'variables.ipynb');
  586 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [
  587 |     { id: 'input', cell_type: 'code', metadata: {}, source: 'answer = input("Name: ")\nitems = list(range(250))\nprint(answer)', execution_count: null, outputs: [] },
  588 |     { id: 'use', cell_type: 'code', metadata: {}, source: 'print(len(items))', execution_count: null, outputs: [] },
  589 |   ] }));
  590 |   const python = process.env.SETDOWN_TEST_NOTEBOOK_PYTHON ?? execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  591 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  592 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  593 |   try {
  594 |     const page = await application.firstWindow(); await focusApplication(application);
  595 |     await application.evaluate(({ dialog }, python) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [python] }); }, python);
  596 |     await page.getByRole('combobox', { name: 'Python environment', exact: true }).selectOption('__choose__');
  597 |     await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
  598 |     await page.getByRole('textbox', { name: 'Kernel input' }).fill('한글'); await page.getByRole('button', { name: 'Send input' }).click();
  599 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
  600 |     await expect(page.locator('[data-cell-id="use"] .notebook-outputs')).toContainText('250');
  601 |     await page.getByRole('button', { name: 'Variables', exact: true }).click();
  602 |     const variables = page.getByRole('region', { name: 'Notebook variables' });
  603 |     await variables.getByRole('button', { name: 'items', exact: true }).click(); await expect(variables).toContainText('1–100 of 250');
  604 |     await variables.getByRole('button', { name: 'Next 100' }).click(); await expect(variables).toContainText('101–200 of 250');
  605 |     await variables.getByRole('button', { name: 'All variables' }).click(); await expect(variables.getByRole('button', { name: 'answer', exact: true })).toBeVisible();
  606 |     await page.getByRole('button', { name: 'Commands…', exact: true }).click(); await page.getByRole('button', { name: 'Restart kernel and run all', exact: true }).click();
  607 |     await expect(variables).toContainText('Variables are available when the local kernel is idle.');
  608 |     await page.getByRole('textbox', { name: 'Kernel input' }).fill('restart'); await page.getByRole('button', { name: 'Send input' }).click();
  609 |     await expect(page.locator('.kernel-state')).toHaveText('idle'); await expect(variables.getByRole('button', { name: 'items', exact: true })).toBeVisible();
  610 |     await expect(page.locator('[data-cell-id="use"] .execution')).toHaveText('[2]'); await page.keyboard.press('Control+s');
  611 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  612 | });
  613 | 
  614 | test('notebook project extraPaths resolve imports and hover, reload live, and retain real missing-import diagnostics', async () => {
  615 |   test.setTimeout(90_000);
  616 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-paths-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-paths-config-'));
  617 |   const file = path.join(root, 'imports.ipynb'), settings = path.join(root, '.vscode', 'settings.json');
  618 |   await mkdir(path.join(root, '.git')); await mkdir(path.dirname(settings));
  619 |   await mkdir(path.join(root, 'src 한글', 'vlmflash_demo'), { recursive: true });
  620 |   await writeFile(path.join(root, 'src 한글', 'vlmflash_demo', '__init__.py'), '"""Local VLM module documentation."""\nVALUE = 42\n');
  621 |   const source = 'import vlmflash_demo\nimport definitely_missing_setdown_control';
  622 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [{ id: 'imports', cell_type: 'code', metadata: {}, source, execution_count: null, outputs: [] }] }));
  623 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  624 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  625 |   try {
  626 |     const page = await application.firstWindow(); await focusApplication(application);
  627 |     const cell = page.locator('[data-cell-id="imports"]');
  628 |     await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30000 });
> 629 |     await expect(cell.locator('.squiggly-warning')).toHaveCount(2, { timeout: 30000 });
      |                                                     ^ Error: expect(locator).toHaveCount(expected) failed
  630 |     await writeFile(settings, '{\n// Workspace-relative path, including Unicode\n"python.analysis.extraPaths": ["${workspaceFolder}/src 한글"],\n}\n');
  631 |     await expect(cell.locator('.squiggly-warning')).toHaveCount(1, { timeout: 30000 });
  632 |     const info = await page.evaluate(async ({ file, source }) => {
  633 |       const api = (window as any).marktex.language;
  634 |       const connection = await api.open({ id: 'paths-probe', generation: 'paths', path: file, notebook: 'python', text: '', version: 1, cells: [{ id: 'imports', version: 1, text: source }] });
  635 |       const hover = await api.request('paths-probe', 1, 'paths-hover', 'textDocument/hover', { cell: 'imports', position: { line: 0, character: 10 } });
  636 |       api.close('paths-probe'); return { connection, hover };
  637 |     }, { file, source });
  638 |     expect(JSON.stringify(info.connection.context)).toContain('.vscode'); expect(JSON.stringify(info.connection.context)).toContain('src 한글');
  639 |     expect(JSON.stringify(info.hover)).toContain('Local VLM module documentation');
  640 |     await writeFile(settings, '{"python.analysis.extraPaths": []}\n');
  641 |     await expect(cell.locator('.squiggly-warning')).toHaveCount(2, { timeout: 30000 });
  642 |     expect(await readFile(file, 'utf8')).toContain('definitely_missing_setdown_control');
  643 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  644 | });
  645 | 
  646 | test('VS Code notebook defaults preserve normal table wrapping, horizontal code scroll and command-mode execution focus', async () => {
  647 |   test.setTimeout(90_000);
  648 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-vscode-')), file = path.join(root, 'design.ipynb');
  649 |   // The pandas 2.3.3 fixture used for the measured VS Code comparison.
  650 |   const html = await readFile('test/fixtures/notebook/dataframe.html', 'utf8');
  651 |   const value = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
  652 |     { id: 'intro', cell_type: 'markdown', metadata: {}, source: '# Notebook\n\nAn introduction.' },
  653 |     { id: 'code', cell_type: 'code', metadata: {}, source: `label = "${'long_source_'.repeat(80)}"\n` + Array.from({ length: 80 }, (_, i) => `value_${i} = ${i}`).join('\n'), execution_count: 20,
  654 |       outputs: [{ output_type: 'display_data', data: { 'text/html': html, 'image/png': png, 'text/plain': 'table fallback' }, metadata: {} }] },
  655 |     { id: 'end', cell_type: 'markdown', metadata: {}, source: '## Conclusion' },
  656 |   ] };
  657 |   await writeFile(file, JSON.stringify(value));
  658 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  659 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  660 |   try {
  661 |     const page = await application.firstWindow(); await focusApplication(application);
  662 |     const code = page.locator('[data-cell-id="code"]'), intro = page.locator('[data-cell-id="intro"]'), end = page.locator('[data-cell-id="end"]');
  663 |     const scroll = page.locator('.notebook-scroll');
  664 |     const command = async (name: string) => { await page.getByRole('button', { name: 'Commands…', exact: true }).click(); await page.getByRole('region', { name: 'Notebook commands' }).getByRole('button', { name, exact: true }).click(); };
  665 |     await expect(intro.locator('h1')).toHaveText('Notebook');
  666 |     await expect(code.locator('.line-numbers')).toHaveCount(0);
  667 |     await expect(page.locator('.notebook-sticky')).toHaveCount(0);
  668 |     await intro.getByRole('button', { name: 'Edit', exact: true }).click();
  669 |     await intro.getByRole('textbox', { name: /Markdown cell editor/ }).press('Shift+Enter');
  670 |     await expect(code).toBeFocused();
  671 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  672 |     await code.press('Enter');
  673 |     const editor = code.getByRole('textbox', { name: /Code cell editor/ });
  674 |     await editor.press('Control+Home'); await editor.press('End');
  675 |     const horizontal = () => code.locator('.view-lines').evaluate(node => node.getBoundingClientRect().left - node.closest('.cell-editor')!.getBoundingClientRect().left);
  676 |     await expect.poll(horizontal).toBeLessThan(-500);
  677 |     const before = await horizontal();
  678 |     await scroll.evaluate(node => node.scrollTop += 300);
  679 |     await expect.poll(horizontal).toBeCloseTo(before, 0);
  680 |     const unwrappedHeight = await code.locator('.cell-editor').evaluate(node => node.clientHeight);
  681 |     await command('Toggle code word wrap');
  682 |     await expect.poll(() => code.locator('.cell-editor').evaluate(node => node.clientHeight)).toBeGreaterThan(unwrappedHeight + 100);
  683 |     await command('Toggle code word wrap');
  684 |     // Restore the long line to the viewport so the horizontal scrollbar is present
  685 |     // in both height measurements (Monaco measures visible line widths).
  686 |     await editor.press('Control+Home'); await editor.press('End');
  687 |     await expect.poll(() => code.locator('.cell-editor').evaluate(node => node.clientHeight)).toBe(unwrappedHeight);
  688 |     await code.locator('.execution').click();
  689 |     await command('Toggle cell line numbers'); await expect(code.locator('.line-numbers').first()).toBeVisible();
  690 |     await code.locator('.output-placeholder, .notebook-outputs').scrollIntoViewIfNeeded();
  691 |     // HTML precedes raster fallbacks, but the original MIME bundle remains intact.
  692 |     await expect(code.locator('.output-html table')).toBeVisible();
  693 |     await expect(code.locator('.notebook-outputs img')).toHaveCount(0);
  694 |     const measures = [];
  695 |     for (const width of [420, 560, 780]) {
  696 |       await code.locator('.output-body').evaluate((node, width) => { node.style.width = `${width + 16}px`; node.style.boxSizing = 'border-box'; }, width);
  697 |       const result = await code.locator('.output-body').evaluate(node => {
  698 |         const table = node.querySelector('table')!, label = table.querySelector('tbody th')!;
  699 |         const word = label.firstChild!, range = document.createRange(); range.setStart(word, 0); range.setEnd(word, 8);
  700 |         return { tableWidth: table.getBoundingClientRect().width, tableHeight: table.getBoundingClientRect().height,
  701 |           wordLines: range.getClientRects().length, overflow: node.scrollWidth > node.clientWidth,
  702 |           bodyHeight: node.clientHeight, tableBottom: table.getBoundingClientRect().bottom - node.getBoundingClientRect().top };
  703 |       });
  704 |       expect(result.wordLines).toBe(1); expect(result.tableHeight).toBeLessThan(340);
  705 |       if (width === 420) expect(result.overflow).toBe(true);
  706 |       // No permanent action footer under the output; only padding and a scrollbar.
  707 |       expect(result.bodyHeight - result.tableBottom).toBeLessThan(25);
  708 |       measures.push({ width, ...result });
  709 |       await code.locator('.output-body').screenshot({ path: test.info().outputPath(`dataframe-${width}.png`) });
  710 |     }
  711 |     await writeFile(test.info().outputPath('dataframe-geometry.json'), JSON.stringify(measures, null, 2));
  712 |     await code.getByRole('button', { name: 'More cell actions', exact: true }).click();
  713 |     await page.keyboard.press('Delete'); await expect(page.locator('.notebook-cell')).toHaveCount(3);
  714 |     await page.keyboard.press('Escape'); await expect(code.getByRole('button', { name: 'More cell actions', exact: true })).toBeFocused();
  715 |     await end.getByRole('button', { name: 'Edit', exact: true }).click();
  716 |     await end.getByRole('textbox', { name: /Markdown cell editor/ }).press('Shift+Enter');
  717 |     await expect(page.locator('.notebook-cell')).toHaveCount(4);
  718 |     const added = page.locator('.notebook-cell').last();
  719 |     await expect(added).toHaveAttribute('data-cell-kind', 'markdown');
  720 |     await expect(added.getByRole('textbox', { name: /Markdown cell editor/ })).toBeFocused();
  721 |     await page.keyboard.press('Alt+Enter');
  722 |     await expect(page.locator('.notebook-cell')).toHaveCount(5);
  723 |     await expect(page.locator('.notebook-cell').last()).toHaveAttribute('data-cell-kind', 'code');
  724 |     await page.keyboard.press('Control+s');
  725 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
  726 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  727 | });
  728 | 
  729 | test('opening and switching notebooks and Markdown Escape never paint raw preview source', async () => {
```