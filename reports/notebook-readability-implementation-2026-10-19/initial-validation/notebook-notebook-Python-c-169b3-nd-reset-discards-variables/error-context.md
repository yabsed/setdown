# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> Python cells run in one kernel, persist results, and reset discards variables
- Location: test/e2e/notebook/notebook.spec.ts:237:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('[data-cell-id="use"]').locator('.output-actions [role="status"]')
Expected: "Copied"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveText" locator('[data-cell-id="use"]').locator('.output-actions [role="status"]') with timeout 5000ms
  - waiting for locator('[data-cell-id="use"]').locator('.output-actions [role="status"]')

```

```yaml
- main:
  - button "Toggle Folder Tools": Setdown
  - navigation "Application menu":
    - button "File"
    - button "View"
    - button "Edit"
    - button "Window"
  - region "Editor group":
    - navigation "Open documents":
      - tablist:
        - tab "run.ipynb ×" [selected]:
          - text: run.ipynb
          - button "×"
      - button "New document"
      - button "New web tab"
      - button "New terminal"
    - button "Back" [disabled]: ←
    - button "Forward" [disabled]: →
    - textbox "Address or file path":
      - /placeholder: Search or enter an address
      - text: file:///tmp/setdown-notebook-run-iFiqr7/run.ipynb
    - group "Text zoom":
      - button "Zoom text out"
      - button "Reset text zoom": 100%
      - button "Zoom text in"
  - region "Rendered Markdown"
  - region "Markdown source editor"
  - toolbar "Notebook":
    - button "+ Code"
    - button "+ Markdown"
    - button "Commands…"
    - button "Run all cells": ▶ Run All
    - combobox "Python environment":
      - option "Select Python…" [disabled]
      - option "miniconda3 · Saved · /home/yabsed/miniconda3/bin/python3" [selected]
      - option "miniconda3 · Conda · /home/yabsed/miniconda3/bin/python"
      - option "Python · bin · PATH · /usr/bin/python3"
      - option "fetalguard · Conda · /home/yabsed/miniconda3/envs/fetalguard/bin/python"
      - option "vlmflash · Conda · /home/yabsed/miniconda3/envs/vlmflash/bin/python"
      - option "Choose executable…"
    - status: idle
  - group "Notebook cell":
    - button "Drag to move cell": ⠿
    - button "Select cell": Md
    - group "Cell actions":
      - combobox "Cell type":
        - option "Code"
        - option "Markdown" [selected]
        - option "Raw"
      - button "Edit"
      - button "Collapse cell input": −
      - button "Move cell up": ↑
      - button "Move cell down": ↓
      - button "Add code cell below": +
      - button "Duplicate cell": ⧉
      - button "Delete cell": ×
    - heading "Notebook" [level=1]
    - paragraph:
      - text: A
      - strong: Markdown
      - text: cell.
      - math: x 2 x^2
    - paragraph:
      - img "pixel"
    - paragraph
  - group "Notebook cell":
    - button "Run cell": ▷
    - button "Drag to move cell": ⠿
    - button "Select cell": "[1]"
    - group "Cell actions":
      - combobox "Cell type":
        - option "Code" [selected]
        - option "Markdown"
        - option "Raw"
      - button "Collapse cell input": −
      - button "Move cell up": ↑
      - button "Move cell down": ↓
      - button "Add code cell below": +
      - button "Duplicate cell": ⧉
      - button "Delete cell": ×
    - code:
      - textbox "Code cell editor"
    - status: ✓ Completed· 0.00 s
  - group "Notebook cell":
    - button "Run cell": ▷
    - button "Drag to move cell": ⠿
    - button "Select cell": "[2]"
    - group "Cell actions":
      - combobox "Cell type":
        - option "Code" [selected]
        - option "Markdown"
        - option "Raw"
      - button "Collapse cell input": −
      - button "Move cell up": ↑
      - button "Move cell down": ↓
      - button "Add code cell below": +
      - button "Duplicate cell": ⧉
      - button "Collapse cell output": ▾
      - button "Clear output"
      - button "Delete cell": ×
    - code:
      - textbox "Code cell editor"
    - status: ✓ Completed· 0.02 s
    - text: "10"
    - button "Copy cell output": Copy output
    - status: Copied
- alert
- alert
```

# Test source

```ts
  161 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('numbers.append(42)');
  162 |     const saved = JSON.parse(await readFile(file, 'utf8'));
  163 |     expect(saved.metadata).toEqual(notebook().metadata); expect(saved.cells[0]).toEqual(notebook().cells[0]);
  164 |     expect(saved.cells[1].outputs).toEqual(notebook().cells[1].outputs);
  165 |     await cell.getByRole('button', { name: 'Delete cell', exact: true }).click();
  166 |     await expect(page.locator('.notebook-cell')).toHaveCount(2);
  167 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
  168 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  169 |     await expect(cell.locator('.view-lines')).toContainText('numbers.append(42)');
  170 |     // Cell text history is owned by the document, even when its view was deleted.
  171 |     await editor.press('Control+z'); await editor.press('Control+s');
  172 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toContain('numbers.');
  173 |     await editor.press('Control+a'); await page.keyboard.insertText('numbers.append(7)');
  174 |     await editor.press('Control+Home'); await editor.press('ArrowRight'); await editor.press('F12');
  175 |     await expect(page.locator('[data-cell-id="define"] .monaco-editor')).toHaveClass(/focused/, { timeout: 10_000 });
  176 |     expect(await page.evaluate(() => (window as any).notebookConnections.starts)).toBe(0);
  177 |     await page.screenshot({ path: test.info().outputPath('notebook.png') });
  178 |     await page.keyboard.press('Control+s');
  179 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  180 | });
  181 | 
  182 | test('unsupported notebook versions remain read-only and byte-identical', async () => {
  183 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-invalid-')), config = path.join(root, 'config'), file = path.join(root, 'future.ipynb');
  184 |   const original = '{"nbformat": 9, "nbformat_minor": 0, "cells": [], "metadata": {"keep": 12345678901234567890}}';
  185 |   await writeFile(file, original);
  186 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  187 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  188 |   application.on('console', message => { if (message.type() === 'error') console.log('notebook main:', message.text()); });
  189 |   application.process().stderr?.on('data', data => console.log('notebook process:', String(data)));
  190 |   try {
  191 |     const page = await application.firstWindow();
  192 |     await expect(page.getByRole('alert')).toContainText('Only nbformat 4');
  193 |     await expect(page.getByRole('button', { name: '+ Code', exact: true })).toBeDisabled();
  194 |     expect(await readFile(file, 'utf8')).toBe(original);
  195 |     expect(await page.locator('.notebook-cell').count()).toBe(0);
  196 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  197 | });
  198 | 
  199 | test('long cells grow with their contents and scroll only the notebook, including keyboard navigation', async () => {
  200 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-scroll-')), file = path.join(root, 'long.ipynb');
  201 |   const lines = Array.from({ length: 120 }, (_, i) => `value_${i} = ${i}`);
  202 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
  203 |     { id: 'long', cell_type: 'code', metadata: {}, source: lines.join('\n'), outputs: [], execution_count: null },
  204 |     { id: 'next', cell_type: 'markdown', metadata: {}, source: '# Next cell' },
  205 |   ] }));
  206 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  207 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  208 |   try {
  209 |     const page = await application.firstWindow(); await focusApplication(application);
  210 |     const cell = page.locator('[data-cell-id="long"]'), host = cell.locator('.cell-editor'), scroll = page.locator('.notebook-scroll');
  211 |     const editor = cell.getByRole('textbox', { name: /Code cell editor/ });
  212 |     await expect(editor).toBeAttached();
  213 |     await expect.poll(() => host.evaluate(element => element.clientHeight)).toBeGreaterThan(2000);
  214 |     expect(await cell.locator('.editor-viewport').evaluate(node => node.clientHeight)).toBeLessThanOrEqual(await scroll.evaluate(node => node.clientHeight));
  215 |     expect(await cell.locator('.view-line').count()).toBeLessThan(80);
  216 |     const bounds = await host.boundingBox(); if (!bounds) throw Error('Missing cell bounds');
  217 |     await page.mouse.move(bounds.x + 150, bounds.y + 80); await page.mouse.wheel(0, 450);
  218 |     await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  219 |     // Focus without Playwright scrolling the entire oversized textbox into view.
  220 |     await editor.focus(); await page.keyboard.press('Control+End');
  221 |     await expect(cell.locator('.view-line').filter({ hasText: 'value_119 = 119' })).toBeInViewport();
  222 |     await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(1500);
  223 |     await page.keyboard.press('Control+Home');
  224 |     await expect(cell.locator('.view-line').filter({ hasText: /^value_0\s*=\s*0$/ })).toBeInViewport();
  225 |     // Removing content shrinks the cell; restoring it grows it again without a cap.
  226 |     // Delete the selection as one edit (typing quotes would create Monaco's own
  227 |     // auto-closing undo boundaries, unrelated to content-size restoration).
  228 |     await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  229 |     await expect.poll(() => host.evaluate(element => element.clientHeight)).toBeLessThan(150);
  230 |     await page.keyboard.press('Control+z');
  231 |     await expect.poll(() => host.evaluate(element => element.clientHeight)).toBeGreaterThan(2000);
  232 |     await page.keyboard.press('Control+s');
  233 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[0].source).toBe(lines.join('\n'));
  234 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  235 | });
  236 | 
  237 | test('Python cells run in one kernel, persist results, and reset discards variables', async () => {
  238 |   test.setTimeout(90_000);
  239 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-run-')), file = path.join(root, 'run.ipynb');
  240 |   const value = notebook(); value.cells[2].source = 'numbers.append(4)\nprint(sum(numbers))';
  241 |   await writeFile(file, JSON.stringify(value));
  242 |   const python = process.env.SETDOWN_TEST_NOTEBOOK_PYTHON
  243 |     ?? execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  244 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  245 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  246 |   try {
  247 |     const page = await application.firstWindow(); await focusApplication(application);
  248 |     await expect(page.locator('.kernel-state')).toHaveText('stopped');
  249 |     await application.evaluate(({ dialog }, python) => {
  250 |       dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [python] });
  251 |     }, python);
  252 |     await page.getByRole('combobox', { name: 'Python environment', exact: true }).selectOption('__choose__');
  253 |     await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
  254 |     const cell = page.locator('[data-cell-id="use"]');
  255 |     await expect(cell.locator('.notebook-outputs')).toContainText('10', { timeout: 60_000 });
  256 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
  257 |     await expect(cell.locator('.execution')).toHaveText('[2]');
  258 |     await page.keyboard.press('Control+s');
  259 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].outputs[0]?.text).toContain('10');
  260 |     await cell.getByRole('button', { name: 'Copy cell output', exact: true }).click();
> 261 |     await expect(cell.locator('.output-actions [role="status"]')).toHaveText('Copied');
      |                                                                   ^ Error: expect(locator).toHaveText(expected) failed
  262 |     expect((await application.evaluate(({ clipboard }) => clipboard.readText())).trim()).toBe('10');
  263 |     // Cancel before window closing starts: variables must survive the canceled quit.
  264 |     await application.evaluate(({ app }) => { app.once('before-quit', event => event.preventDefault()); app.quit(); });
  265 |     const editor = cell.getByRole('textbox', { name: /Code cell editor/ });
  266 |     await editor.press('Control+a'); await page.keyboard.insertText('import time\ntime.sleep(0.5)\nnumbers.append(4)\nprint(sum(numbers))');
  267 |     await editor.press('Shift+Enter');
  268 |     await expect(page.locator('.notebook-cell')).toHaveCount(4);
  269 |     const next = page.locator('.notebook-cell').nth(3);
  270 |     await expect(next.locator('.monaco-editor')).toHaveClass(/focused/);
  271 |     await page.keyboard.insertText('print(sum(numbers))'); await page.keyboard.press('Alt+Enter');
  272 |     await expect(page.locator('.notebook-cell')).toHaveCount(5);
  273 |     await expect(next.locator('.notebook-outputs')).toContainText('14', { timeout: 60_000 });
  274 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
  275 | 
  276 |     await page.getByRole('button', { name: 'Reset kernel', exact: true }).click();
  277 |     await expect(page.locator('.kernel-state')).toHaveText('stopped');
  278 |     await cell.getByRole('button', { name: 'Run cell', exact: true }).click();
  279 |     await expect(cell.locator('.notebook-outputs')).toContainText('NameError', { timeout: 60_000 });
  280 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
  281 |     await page.keyboard.press('Control+s');
  282 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  283 | });
  284 | 
  285 | test('native notebook analysis uses lightweight diagnostics with IPython and isolated cell ranges', async () => {
  286 |   test.setTimeout(90_000);
  287 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-analysis-')), file = path.join(root, 'analysis.ipynb');
  288 |   const sources = ['%who\nimport math\nimport asyncio\nimport only_a', 'await asyncio.sleep(0)\nprint(math.sqrt(9), only_a.VALUE)\ndisplay(1)\nget_ipython()', 'count: int = "wrong"'];
  289 |   const pythonA = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  290 |   const pythonB = path.join(root, 'env-b', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  291 |   for (const name of ['.venv', 'env-b']) execFileSync(process.env.SETDOWN_TEST_NOTEBOOK_PYTHON ?? 'python3', ['-m', 'venv', '--without-pip', '--system-site-packages', path.join(root, name)]);
  292 |   const packages = execFileSync(pythonA, ['-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], { encoding: 'utf8' }).trim();
  293 |   await mkdir(packages, { recursive: true }); await writeFile(path.join(packages, 'only_a.py'), 'VALUE = 42\n');
  294 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: sources.map((source, i) => ({ id: `cell${i}`, cell_type: 'code', metadata: {}, source, execution_count: null, outputs: [] })) }));
  295 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  296 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  297 |   try {
  298 |     const page = await application.firstWindow();
  299 |     await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30_000 });
  300 |     await page.getByRole('combobox', { name: 'Python environment', exact: true }).selectOption(pythonA);
  301 |     await page.evaluate(async ({ file, sources, pythonA, pythonB }) => {
  302 |       const api = (window as any).marktex.language;
  303 |       const state = (window as any).notebookAnalysis = { diagnostics: {} as Record<string, any>, connection: null, other: undefined };
  304 |       api.onEvent((event: any) => { if (event.type === 'diagnostics' && event.id === 'analysis-other') state.other = event.diagnostics; });
  305 |       api.onEvent((event: any) => { if (event.type === 'diagnostics' && event.id === 'analysis-probe') state.diagnostics[`${event.version}:${event.cell}`] = event; });
  306 |       state.connection = await api.open({ id: 'analysis-probe', generation: 'probe', path: file, python: pythonA, notebook: 'python', text: '', version: 1,
  307 |         cells: sources.map((text: string, i: number) => ({ id: `cell${i}`, version: 1, text })) });
  308 |       await api.open({ id: 'analysis-other', generation: 'other', path: file, python: pythonB, notebook: 'python', text: '', version: 1,
  309 |         cells: [{ id: 'only', version: 1, text: 'import only_a' }] });
  310 |     }, { file, sources, pythonA, pythonB });
  311 |     await expect.poll(() => page.evaluate(() => (window as any).notebookAnalysis.other?.some((d: any) => d.code === 'reportMissingImports')), { timeout: 30_000 }).toBe(true);
  312 |     const diagnostics = (version: number, id: string) => page.evaluate(({ version, id }) => (window as any).notebookAnalysis.diagnostics[`${version}:${id}`]?.diagnostics, { version, id });
  313 |     await expect.poll(() => diagnostics(1, 'cell0'), { timeout: 30_000 }).toEqual([]);
  314 |     await expect.poll(() => diagnostics(1, 'cell1'), { timeout: 30_000 }).toEqual([]);
  315 |     await expect.poll(() => diagnostics(1, 'cell2'), { timeout: 30_000 }).toEqual([]);
  316 |     await page.evaluate(async () => { await (window as any).marktex.language.changeNotebook('analysis-probe', 2, [
  317 |       { id: 'cell0', version: 2, text: 'values = [' }, { id: 'cell1', version: 2, text: 'print(missing_name)' }, { id: 'cell2', version: 2, text: 'count: int = 1' },
  318 |     ]); });
  319 |     await expect.poll(async () => (await diagnostics(2, 'cell0'))?.some((d: any) => d.severity === 1), { timeout: 30_000 }).toBe(true);
  320 |     await expect.poll(async () => (await diagnostics(2, 'cell1'))?.some((d: any) => d.code === 'reportUndefinedVariable' && d.severity === 2), { timeout: 30_000 }).toBe(true);
  321 |     await expect.poll(() => diagnostics(2, 'cell2'), { timeout: 30_000 }).toEqual([]);
  322 |     await page.evaluate(async () => { await (window as any).marktex.language.changeNotebook('analysis-probe', 3, [
  323 |       { id: 'cell2', version: 3, text: 'numbers = [1, 2]' }, { id: 'cell1', version: 3, text: 'print(sum(numbers))' },
  324 |     ]); });
  325 |     await expect.poll(() => diagnostics(3, 'cell1'), { timeout: 30_000 }).toEqual([]);
  326 |     await page.getByRole('button', { name: 'Run all cells', exact: true }).click();
  327 |     await expect(page.locator('[data-cell-id="cell1"] .notebook-outputs')).toContainText('42', { timeout: 60_000 });
  328 |     await expect(page.locator('.kernel-state')).toHaveText('idle');
  329 |     await page.evaluate(() => { (window as any).marktex.language.close('analysis-probe'); (window as any).marktex.language.close('analysis-other'); });
  330 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  331 | });
  332 | 
  333 | test('scrolling preserves focused editors and measured output height; cell copy and reader search keep their scope', async () => {
  334 |   test.setTimeout(60_000);
  335 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-layout-')), file = path.join(root, 'layout.ipynb');
  336 |   await writeFile(file, JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
  337 |     { id: 'intro', cell_type: 'markdown', metadata: {}, source: '# Searchable heading\n\nUnique reader text.' },
  338 |     ...Array.from({ length: 35 }, (_, i) => ({ id: `code-${i}`, cell_type: 'code', metadata: { keep: i }, source: `value_${i} = ${i}`, execution_count: null,
  339 |       outputs: i ? [] : [{ output_type: 'stream', name: 'stdout', text: Array.from({ length: 100 }, (_, j) => `output ${j}`).join('\n') }] })),
  340 |   ] }));
  341 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  342 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  343 |   try {
  344 |     const page = await application.firstWindow(); await focusApplication(application);
  345 |     const first = page.locator('[data-cell-id="code-0"]'), editor = first.getByRole('textbox', { name: /Code cell editor/ }), scroll = page.locator('.notebook-scroll');
  346 |     await expect(first.locator('.notebook-outputs')).toContainText('output 99');
  347 |     await editor.focus(); const mounted = await editor.elementHandle();
  348 |     const ime = await page.context().newCDPSession(page);
  349 |     await ime.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
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
```