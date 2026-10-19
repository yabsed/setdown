# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> notebook cells reuse Markdown and Python, preserve outputs on save, and retain Undo across deletion
- Location: test/e2e/notebook/notebook.spec.ts:105:1

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Undo cell operation', exact: true })

```

# Test source

```ts
  51  |     await code.hover(); await expect(code.locator('.cell-toolbar')).toHaveCSS('opacity', '1');
  52  |     expect(await code.boundingBox()).toEqual(before);
  53  |     const input = code.getByRole('textbox', { name: /Code cell editor/ });
  54  |     await input.focus(); await input.press('Control+Home');
  55  |     await expect(code.locator('.view-overlays .current-line')).toHaveCount(1);
  56  |     await expect(page.locator('[data-cell-id="use"] .view-overlays .current-line')).toHaveCount(0);
  57  |     await code.getByRole('button', { name: 'Select cell', exact: true }).click();
  58  |     await expect(code.locator('.view-overlays .current-line')).toHaveCount(0);
  59  |     await code.getByRole('combobox', { name: 'Output format' }).selectOption('text/plain');
  60  |     await expect(code.locator('.notebook-outputs pre')).toHaveText('Two-line 2.117');
  61  |     await expect(code.locator('.notebook-outputs pre')).toHaveCSS('font-family', /D2Coding/);
  62  |     await code.getByRole('combobox', { name: 'Output format' }).selectOption('');
  63  |     await expect(code.locator('.output-html td').first()).toHaveCSS('text-align', 'right');
  64  |     await code.getByRole('button', { name: 'Collapse cell output', exact: true }).click();
  65  |     await expect(code.locator('.notebook-outputs')).toHaveCount(0);
  66  |     await code.getByRole('button', { name: '▸ Show output', exact: true }).click();
  67  |     await expect(code.locator('.output-html table')).toBeVisible();
  68  |     // A keyboard path must reveal actions without needing hover or double-click.
  69  |     await md.getByRole('button', { name: 'Select cell', exact: true }).focus();
  70  |     await expect(md.locator('.cell-toolbar')).toHaveCSS('opacity', '1');
  71  |     await md.getByRole('button', { name: 'Edit', exact: true }).focus(); await page.keyboard.press('Enter');
  72  |     const markdownEditor = md.getByRole('textbox', { name: /Markdown cell editor/ });
  73  |     await markdownEditor.press('Control+End'); await page.keyboard.insertText('\n\n키보드 편집 유지');
  74  |     await markdownEditor.press('Escape'); await expect(md.locator('.cell-markdown')).toContainText('키보드 편집 유지');
  75  |     await page.keyboard.press('Control+s');
  76  |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
  77  |     for (const theme of ['one-dark', 'github-light']) {
  78  |       await application.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), theme);
  79  |       await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-editor-background').trim())).toBe(theme === 'one-dark' ? '#282c34' : '#ffffff');
  80  |       await page.mouse.move(1, 1); await page.screenshot({ path: test.info().outputPath(`reading-${theme}.png`) });
  81  |     }
  82  |     // Use a real group split: a narrow standalone window doesn't test pane-local sizing.
  83  |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), other);
  84  |     await expect(page.getByRole('tab', { name: /other.ipynb/ })).toHaveAttribute('aria-selected', 'true');
  85  |     const data = await page.evaluateHandle(() => new DataTransfer());
  86  |     await page.getByRole('tab', { name: /other.ipynb/ }).dispatchEvent('dragstart', { dataTransfer: data });
  87  |     const body = page.locator('.group-body').first(), box = (await body.boundingBox())!;
  88  |     const point = { clientX: box.x + box.width * .98, clientY: box.y + box.height / 2, dataTransfer: data };
  89  |     await body.dispatchEvent('dragover', point); await expect(page.locator('.group-drop-overlay')).toBeVisible();
  90  |     await body.dispatchEvent('drop', point); await data.dispose();
  91  |     await expect(page.locator('.editor-group')).toHaveCount(2);
  92  |     const group = page.locator('.editor-group').first();
  93  |     const toolbar = group.locator('.notebook-toolbar');
  94  |     expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(44);
  95  |     expect(await toolbar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  96  |     await expect(toolbar.getByRole('button', { name: 'Outline', exact: true })).toBeHidden();
  97  |     await toolbar.getByRole('button', { name: 'Commands…', exact: true }).click();
  98  |     await group.getByRole('button', { name: 'Toggle outline', exact: true }).click();
  99  |     await expect(group.getByRole('navigation', { name: 'Notebook outline' })).toBeVisible();
  100 |     await expect(group.getByRole('combobox', { name: 'Python environment', exact: true })).toBeVisible();
  101 |     await page.screenshot({ path: test.info().outputPath('reading-split.png') });
  102 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  103 | });
  104 | 
  105 | test('notebook cells reuse Markdown and Python, preserve outputs on save, and retain Undo across deletion', async () => {
  106 |   test.setTimeout(90_000);
  107 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-config-'));
  108 |   const file = path.join(root, 'example.ipynb'), original = JSON.stringify(notebook(), null, 2) + '\n';
  109 |   await writeFile(file, original);
  110 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  111 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  112 |   application.on('console', message => { if (message.type() === 'error') console.log('notebook main:', message.text()); });
  113 |   application.process().stderr?.on('data', data => console.log('notebook process:', String(data)));
  114 |   try {
  115 |     const page = await application.firstWindow(); await focusApplication(application);
  116 |     page.on('pageerror', error => console.log('notebook renderer:', error));
  117 |     await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'notebook');
  118 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  119 |     await expect(page.locator('.cell-markdown h1')).toHaveText('Notebook');
  120 |     await expect(page.locator('.cell-markdown img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  121 |     await expect(page.locator('.cell-markdown math')).toHaveCount(1);
  122 |     await expect(page.locator('.notebook-outputs')).toContainText('Saved table');
  123 |     expect(await page.locator('.notebook-outputs script, .notebook-outputs iframe, .notebook-outputs svg, .notebook-outputs [style]').count()).toBe(0);
  124 |     expect(await page.evaluate(() => (window as unknown as { notebookInjected?: boolean }).notebookInjected)).toBeUndefined();
  125 |     await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30_000 });
  126 |     await page.evaluate(() => {
  127 |       const state = { starts: 0 }; (window as any).notebookConnections = state;
  128 |       window.marktex.language.onEvent(event => { if (event.type === 'status' && event.state === 'starting') state.starts++; });
  129 |     });
  130 |     const markdown = page.locator('[data-cell-id="intro"]');
  131 |     await markdown.getByRole('button', { name: 'Edit', exact: true }).click();
  132 |     const markdownEditor = markdown.getByRole('textbox', { name: /Markdown cell editor/ });
  133 |     await markdownEditor.press('Control+End'); await markdownEditor.press('Enter');
  134 |     await page.keyboard.insertText('Latest preview text');
  135 |     const cdp = await page.context().newCDPSession(page);
  136 |     await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
  137 |     await markdownEditor.press('Escape');
  138 |     await expect(markdownEditor).toBeAttached();
  139 |     await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  140 |     await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  141 |     await cdp.send('Input.insertText', { text: '한' }); await cdp.detach();
  142 |     await markdownEditor.press('Escape');
  143 |     await expect(markdown.locator('.cell-markdown')).toContainText('Latest preview text한');
  144 |     // Restore the source using its retained text history before preservation assertions.
  145 |     await markdown.getByRole('button', { name: 'Edit', exact: true }).click();
  146 |     await markdownEditor.press('Control+a'); await page.keyboard.insertText((notebook().cells[0].source as string[]).join(''));
  147 |     await markdownEditor.press('Escape');
  148 |     await page.locator('[data-cell-id="use"]').getByRole('button', { name: 'Drag to move cell' })
  149 |       .dragTo(markdown, { targetPosition: { x: 40, y: 5 } });
  150 |     await expect(page.locator('.notebook-cell').first()).toHaveAttribute('data-cell-id', 'use');
> 151 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
      |                                                                                  ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  152 |     await expect(page.locator('.notebook-cell').first()).toHaveAttribute('data-cell-id', 'intro');
  153 |     const cell = page.locator('[data-cell-id="use"]'), editor = cell.getByRole('textbox', { name: /Code cell editor/ });
  154 |     const mountedEditor = await editor.elementHandle();
  155 |     await editor.press('Control+End'); await editor.press('Enter'); await editor.pressSequentially('numbers.');
  156 |     expect(await mountedEditor!.evaluate(element => element.isConnected)).toBe(true);
  157 |     await editor.press('Control+Space');
  158 |     await expect(page.locator('.suggest-widget.visible')).toContainText('append', { timeout: 10_000 });
  159 |     await editor.press('Escape'); await editor.press('Control+a'); await page.keyboard.insertText('numbers.append(42)');
  160 |     await editor.press('Control+s');
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
```