# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> long notebook cells meet the scroll viewport without a blank strip at 90% app zoom
- Location: test/e2e/notebook/notebook.spec.ts:244:39

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 1
Received:   1.010589599609375

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  205 | 
  206 | test('long cells grow with their contents and scroll only the notebook, including keyboard navigation', async () => {
  207 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-scroll-')), file = path.join(root, 'long.ipynb');
  208 |   const lines = Array.from({ length: 120 }, (_, i) => `value_${i} = ${i}`);
  209 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
  210 |     { id: 'long', cell_type: 'code', metadata: {}, source: lines.join('\n'), outputs: [], execution_count: null },
  211 |     { id: 'next', cell_type: 'markdown', metadata: {}, source: '# Next cell' },
  212 |   ] }));
  213 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  214 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  215 |   try {
  216 |     const page = await application.firstWindow(); await focusApplication(application);
  217 |     const cell = page.locator('[data-cell-id="long"]'), host = cell.locator('.cell-editor'), scroll = page.locator('.notebook-scroll');
  218 |     const editor = cell.getByRole('textbox', { name: /Code cell editor/ });
  219 |     await expect(editor).toBeAttached();
  220 |     await expect.poll(() => host.evaluate(element => element.clientHeight)).toBeGreaterThan(2000);
  221 |     expect(await cell.locator('.editor-viewport').evaluate(node => node.clientHeight)).toBeLessThanOrEqual(await scroll.evaluate(node => node.clientHeight));
  222 |     expect(await cell.locator('.view-line').count()).toBeLessThan(80);
  223 |     const bounds = await host.boundingBox(); if (!bounds) throw Error('Missing cell bounds');
  224 |     await page.mouse.move(bounds.x + 150, bounds.y + 80); await page.mouse.wheel(0, 450);
  225 |     await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  226 |     // Focus without Playwright scrolling the entire oversized textbox into view.
  227 |     await editor.focus(); await page.keyboard.press('Control+End');
  228 |     await expect(cell.locator('.view-line').filter({ hasText: 'value_119 = 119' })).toBeInViewport();
  229 |     await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(1500);
  230 |     await page.keyboard.press('Control+Home');
  231 |     await expect(cell.locator('.view-line').filter({ hasText: /^value_0\s*=\s*0$/ })).toBeInViewport();
  232 |     // Removing content shrinks the cell; restoring it grows it again without a cap.
  233 |     // Delete the selection as one edit (typing quotes would create Monaco's own
  234 |     // auto-closing undo boundaries, unrelated to content-size restoration).
  235 |     await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  236 |     await expect.poll(() => host.evaluate(element => element.clientHeight)).toBeLessThan(150);
  237 |     await page.keyboard.press('Control+z');
  238 |     await expect.poll(() => host.evaluate(element => element.clientHeight)).toBeGreaterThan(2000);
  239 |     await page.keyboard.press('Control+s');
  240 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[0].source).toBe(lines.join('\n'));
  241 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  242 | });
  243 | 
  244 | for (const appZoom of [100, 130, 90]) test(`long notebook cells meet the scroll viewport without a blank strip at ${appZoom}% app zoom`, async () => {
  245 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-sticky-')), file = path.join(root, 'sticky.ipynb');
  246 |   const source = Array.from({ length: 140 }, (_, index) => `value_${index} = ${index}`).join('\n');
  247 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
  248 |     { id: 'heading', cell_type: 'markdown', metadata: {}, source: '### Tiles\n\nSection heading.' },
  249 |     { id: 'long', cell_type: 'code', metadata: {}, source, outputs: [], execution_count: null },
  250 |     { id: 'end', cell_type: 'markdown', metadata: {}, source: '## End\n\nAfter the long cell.' },
  251 |   ] }));
  252 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  253 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  254 |   try {
  255 |     const page = await application.firstWindow(); await focusApplication(application);
  256 |     await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1041, 801));
  257 |     await page.evaluate(steps => window.marktex.changeZoom(steps, 'app'), (appZoom - 100) / 10);
  258 |     await expect.poll(() => page.evaluate(async () => (await window.marktex.getZoom()).app)).toBe(appZoom);
  259 |     const scroll = page.locator('.notebook-scroll'), cell = page.locator('[data-cell-id="long"]');
  260 |     // Sticky headings are opt-in, as in VS Code; still exercise their scroll contract.
  261 |     await expect(page.locator('.notebook-sticky')).toHaveCount(0);
  262 |     await page.getByRole('button', { name: 'Commands…', exact: true }).click();
  263 |     await page.getByRole('button', { name: 'Toggle sticky headings', exact: true }).click();
  264 |     await expect(page.locator('[data-cell-id="heading"] h3')).toHaveText('Tiles');
  265 |     await expect.poll(() => cell.locator('.cell-editor').evaluate(node => node.clientHeight)).toBeGreaterThan(2500);
  266 |     const initial = await page.evaluate(() => {
  267 |       const scroll = document.querySelector('.notebook-scroll')!, heading = document.querySelector('[data-cell-id="heading"]')!;
  268 |       const frame = document.querySelector('[data-cell-id="long"] .cell-editor')!, line = frame.querySelector('.view-line')!;
  269 |       return { startGap: heading.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
  270 |         lineInset: line.getBoundingClientRect().top - frame.getBoundingClientRect().top };
  271 |     });
  272 |     expect(initial.startGap).toBeCloseTo(30, 0);
  273 |     const geometry = () => page.evaluate(lineInset => {
  274 |       const scroll = document.querySelector('.notebook-scroll')!.getBoundingClientRect();
  275 |       const frame = document.querySelector('[data-cell-id="long"] .cell-editor')!.getBoundingClientRect();
  276 |       const editor = document.querySelector('[data-cell-id="long"] .editor-viewport')!.getBoundingClientRect();
  277 |       const line = [...document.querySelectorAll('[data-cell-id="long"] .view-line')]
  278 |         .find(node => node.getBoundingClientRect().top >= scroll.top && node.getBoundingClientRect().bottom <= scroll.bottom);
  279 |       const rect = line?.getBoundingClientRect(), index = Number(/value_(\d+)/.exec(line?.textContent ?? '')?.[1]);
  280 |       // A zoomed DOMRect height is pixel-quantized; multiplying that rounding by
  281 |       // the line index invents drift. Monaco lays out lines in logical CSS pixels.
  282 |       const lineHeight = line ? parseFloat(getComputedStyle(line).lineHeight) : 0;
  283 |       return { gap: editor.top - scroll.top, bottomGap: editor.bottom - scroll.bottom, endGap: frame.bottom - editor.bottom,
  284 |         lineError: rect ? rect.top - (frame.top + lineInset + index * lineHeight) : Infinity, line: line?.textContent };
  285 |     }, initial.lineInset);
  286 |     for (const offset of [1100, 1257, 900]) {
  287 |       await scroll.evaluate((node, offset) => node.scrollTop = offset, offset);
  288 |       await expect(page.locator('.notebook-sticky')).toHaveText('Tiles');
  289 |       await expect.poll(async () => Math.abs((await geometry()).gap)).toBeLessThan(1);
  290 |       await expect.poll(async () => Math.abs((await geometry()).bottomGap)).toBeLessThan(1);
  291 |       await expect.poll(async () => Math.abs((await geometry()).lineError)).toBeLessThan(1);
  292 |     }
  293 |     await writeFile(test.info().outputPath('sticky-geometry.json'), JSON.stringify({ appZoom, initial, scrolled: await geometry() }, null, 2));
  294 |     await page.screenshot({ path: test.info().outputPath('sticky-scroll.png') });
  295 |     // The editor also follows a resized viewport while still inside the long cell.
  296 |     await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(941, 701));
  297 |     await expect.poll(async () => Math.abs((await geometry()).gap)).toBeLessThan(1);
  298 |     await expect.poll(async () => Math.abs((await geometry()).bottomGap)).toBeLessThan(1);
  299 |     await expect.poll(async () => Math.abs((await geometry()).lineError)).toBeLessThan(1);
  300 |     await scroll.evaluate(node => {
  301 |       const frame = node.querySelector('[data-cell-id="long"] .cell-editor')!;
  302 |       node.scrollTop += frame.getBoundingClientRect().bottom - node.getBoundingClientRect().top - 100;
  303 |     });
  304 |     await expect.poll(async () => Math.abs((await geometry()).endGap)).toBeLessThan(1);
> 305 |     await expect.poll(async () => Math.abs((await geometry()).lineError)).toBeLessThan(1);
      |                                                                           ^ Error: expect(received).toBeLessThan(expected)
  306 |     await expect(cell.locator('.view-line').filter({ hasText: /^value_139\s*=\s*139$/ })).toBeInViewport();
  307 |     await scroll.evaluate(node => node.scrollTop = 0);
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
```