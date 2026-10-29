# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> native notebook analysis uses lightweight diagnostics with IPython and isolated cell ranges
- Location: test/e2e/notebook/notebook.spec.ts:365:1

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
    14 × locator resolved to <span role="status" title="Kernel idle" aria-label="Kernel idle" class="kernel-state svelte-yxkx1d">…</span>
       - unexpected value "idle"

```

```yaml
- status "Kernel idle": idle
```

# Test source

```ts
  308 |     await expect(page.locator('.notebook-sticky')).toHaveCount(0);
  309 |     await expect.poll(() => page.locator('[data-cell-id="heading"]').evaluate(node =>
  310 |       node.getBoundingClientRect().top - node.closest('.notebook-scroll')!.getBoundingClientRect().top)).toBeCloseTo(30, 0);
  311 |     expect(JSON.parse(await readFile(file, 'utf8')).cells[1].source).toBe(source);
  312 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  313 | });
  314 | 
  315 | test('Python cells run in one kernel, persist results, and reset discards variables', async () => {
  316 |   test.setTimeout(90_000);
  317 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-run-')), file = path.join(root, 'run.ipynb');
  318 |   const value = notebook(); value.cells[2].source = 'numbers.append(4)\nprint(sum(numbers))';
  319 |   await writeFile(file, JSON.stringify(value));
  320 |   const python = process.env.SETDOWN_TEST_NOTEBOOK_PYTHON
  321 |     ?? execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  322 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  323 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  324 |   try {
  325 |     const page = await application.firstWindow(); await focusApplication(application);
  326 |     await expect(page.locator('.kernel-state')).toHaveText('stopped');
  327 |     await application.evaluate(({ dialog }, python) => {
  328 |       dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [python] });
  329 |     }, python);
  330 |     await page.getByRole('combobox', { name: 'Python environment', exact: true }).selectOption('__choose__');
  331 |     await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
  332 |     const cell = page.locator('[data-cell-id="use"]');
  333 |     await expect(cell.locator('.notebook-outputs')).toContainText('10', { timeout: 60_000 });
  334 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
  335 |     await expect(cell.locator('.execution')).toHaveText('[2]');
  336 |     await page.keyboard.press('Control+s');
  337 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].outputs[0]?.text).toContain('10');
  338 |     await cell.getByRole('button', { name: 'Output 1 actions', exact: true }).click();
  339 |     await cell.getByRole('button', { name: 'Copy cell output', exact: true }).click();
  340 |     await expect(cell.locator('.output-feedback[role="status"]')).toHaveText('Copied');
  341 |     await expect(cell.locator('.output-feedback[role="status"]')).toBeVisible();
  342 |     expect((await application.evaluate(({ clipboard }) => clipboard.readText())).trim()).toBe('10');
  343 |     // Cancel before window closing starts: variables must survive the canceled quit.
  344 |     await application.evaluate(({ app }) => { app.once('before-quit', event => event.preventDefault()); app.quit(); });
  345 |     const editor = cell.getByRole('textbox', { name: /Code cell editor/ });
  346 |     await editor.press('Control+a'); await page.keyboard.insertText('import time\ntime.sleep(0.5)\nnumbers.append(4)\nprint(sum(numbers))');
  347 |     await editor.press('Shift+Enter');
  348 |     await expect(page.locator('.notebook-cell')).toHaveCount(4);
  349 |     const next = page.locator('.notebook-cell').nth(3);
  350 |     await expect(next.locator('.monaco-editor')).toHaveClass(/focused/);
  351 |     await page.keyboard.insertText('print(sum(numbers))'); await page.keyboard.press('Alt+Enter');
  352 |     await expect(page.locator('.notebook-cell')).toHaveCount(5);
  353 |     await expect(next.locator('.notebook-outputs')).toContainText('14', { timeout: 60_000 });
  354 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
  355 | 
  356 |     await page.getByRole('button', { name: 'Reset kernel', exact: true }).click();
  357 |     await expect(page.locator('.kernel-state')).toHaveText('stopped');
  358 |     await cell.getByRole('button', { name: 'Run cell', exact: true }).click();
  359 |     await expect(cell.locator('.notebook-outputs')).toContainText('NameError', { timeout: 60_000 });
  360 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
  361 |     await page.keyboard.press('Control+s');
  362 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  363 | });
  364 | 
  365 | test('native notebook analysis uses lightweight diagnostics with IPython and isolated cell ranges', async () => {
  366 |   test.setTimeout(90_000);
  367 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-analysis-')), file = path.join(root, 'analysis.ipynb');
  368 |   const sources = ['%who\nimport math\nimport asyncio\nimport only_a', 'await asyncio.sleep(0)\nprint(math.sqrt(9), only_a.VALUE)\ndisplay(1)\nget_ipython()', 'count: int = "wrong"'];
  369 |   const pythonA = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  370 |   const pythonB = path.join(root, 'env-b', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  371 |   for (const name of ['.venv', 'env-b']) execFileSync(process.env.SETDOWN_TEST_NOTEBOOK_PYTHON ?? 'python3', ['-m', 'venv', '--without-pip', '--system-site-packages', path.join(root, name)]);
  372 |   const packages = execFileSync(pythonA, ['-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], { encoding: 'utf8' }).trim();
  373 |   await mkdir(packages, { recursive: true }); await writeFile(path.join(packages, 'only_a.py'), 'VALUE = 42\n');
  374 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: sources.map((source, i) => ({ id: `cell${i}`, cell_type: 'code', metadata: {}, source, execution_count: null, outputs: [] })) }));
  375 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  376 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  377 |   try {
  378 |     const page = await application.firstWindow();
  379 |     await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30_000 });
  380 |     await page.getByRole('combobox', { name: 'Python environment', exact: true }).selectOption(pythonA);
  381 |     await page.evaluate(async ({ file, sources, pythonA, pythonB }) => {
  382 |       const api = (window as any).marktex.language;
  383 |       const state = (window as any).notebookAnalysis = { diagnostics: {} as Record<string, any>, connection: null, other: undefined };
  384 |       api.onEvent((event: any) => { if (event.type === 'diagnostics' && event.id === 'analysis-other') state.other = event.diagnostics; });
  385 |       api.onEvent((event: any) => { if (event.type === 'diagnostics' && event.id === 'analysis-probe') state.diagnostics[`${event.version}:${event.cell}`] = event; });
  386 |       state.connection = await api.open({ id: 'analysis-probe', generation: 'probe', path: file, python: pythonA, notebook: 'python', text: '', version: 1,
  387 |         cells: sources.map((text: string, i: number) => ({ id: `cell${i}`, version: 1, text })) });
  388 |       await api.open({ id: 'analysis-other', generation: 'other', path: file, python: pythonB, notebook: 'python', text: '', version: 1,
  389 |         cells: [{ id: 'only', version: 1, text: 'import only_a' }] });
  390 |     }, { file, sources, pythonA, pythonB });
  391 |     await expect.poll(() => page.evaluate(() => (window as any).notebookAnalysis.other?.some((d: any) => d.code === 'reportMissingImports')), { timeout: 30_000 }).toBe(true);
  392 |     const diagnostics = (version: number, id: string) => page.evaluate(({ version, id }) => (window as any).notebookAnalysis.diagnostics[`${version}:${id}`]?.diagnostics, { version, id });
  393 |     await expect.poll(() => diagnostics(1, 'cell0'), { timeout: 30_000 }).toEqual([]);
  394 |     await expect.poll(() => diagnostics(1, 'cell1'), { timeout: 30_000 }).toEqual([]);
  395 |     await expect.poll(() => diagnostics(1, 'cell2'), { timeout: 30_000 }).toEqual([]);
  396 |     await page.evaluate(async () => { await (window as any).marktex.language.changeNotebook('analysis-probe', 2, [
  397 |       { id: 'cell0', version: 2, text: 'values = [' }, { id: 'cell1', version: 2, text: 'print(missing_name)' }, { id: 'cell2', version: 2, text: 'count: int = 1' },
  398 |     ]); });
  399 |     await expect.poll(async () => (await diagnostics(2, 'cell0'))?.some((d: any) => d.severity === 1), { timeout: 30_000 }).toBe(true);
  400 |     await expect.poll(async () => (await diagnostics(2, 'cell1'))?.some((d: any) => d.code === 'reportUndefinedVariable' && d.severity === 2), { timeout: 30_000 }).toBe(true);
  401 |     await expect.poll(() => diagnostics(2, 'cell2'), { timeout: 30_000 }).toEqual([]);
  402 |     await page.evaluate(async () => { await (window as any).marktex.language.changeNotebook('analysis-probe', 3, [
  403 |       { id: 'cell2', version: 3, text: 'numbers = [1, 2]' }, { id: 'cell1', version: 3, text: 'print(sum(numbers))' },
  404 |     ]); });
  405 |     await expect.poll(() => diagnostics(3, 'cell1'), { timeout: 30_000 }).toEqual([]);
  406 |     await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
  407 |     await expect(page.locator('[data-cell-id="cell1"] .notebook-outputs')).toContainText('42', { timeout: 60_000 });
> 408 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
      |                                                 ^ Error: expect(locator).toHaveText(expected) failed
  409 |     await page.evaluate(() => { (window as any).marktex.language.close('analysis-probe'); (window as any).marktex.language.close('analysis-other'); });
  410 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  411 | });
  412 | 
  413 | test('scrolling preserves focused editors and measured output height; cell copy and reader search keep their scope', async () => {
  414 |   test.setTimeout(60_000);
  415 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-layout-')), file = path.join(root, 'layout.ipynb');
  416 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
  417 |     { id: 'intro', cell_type: 'markdown', metadata: {}, source: '# Searchable heading\n\nUnique reader text.' },
  418 |     ...Array.from({ length: 35 }, (_, i) => ({ id: `code-${i}`, cell_type: 'code', metadata: { keep: i }, source: `value_${i} = ${i}`, execution_count: null,
  419 |       outputs: i ? [] : [{ output_type: 'stream', name: 'stdout', text: Array.from({ length: 100 }, (_, j) => `output ${j}`).join('\n') }] })),
  420 |   ] }));
  421 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  422 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  423 |   try {
  424 |     const page = await application.firstWindow(); await focusApplication(application);
  425 |     const first = page.locator('[data-cell-id="code-0"]'), editor = first.getByRole('textbox', { name: /Code cell editor/ }), scroll = page.locator('.notebook-scroll');
  426 |     await expect(first.locator('.notebook-outputs')).toContainText('output 99');
  427 |     await editor.focus(); const mounted = await editor.elementHandle();
  428 |     const ime = await page.context().newCDPSession(page);
  429 |     await ime.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
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
```