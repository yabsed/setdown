# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notebook/notebook.spec.ts >> notebook cells reuse Markdown and Python, preserve outputs on save, and retain Undo across deletion
- Location: test/e2e/notebook/notebook.spec.ts:112:1

# Error details

```
TimeoutError: locator.dragTo: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('[data-cell-id="use"]').getByRole('button', { name: 'Drag to move cell' })
    - locator resolved to <button draggable="true" title="Drag to move cell" aria-label="Drag to move cell" class="drag-handle svelte-1ig84k">…</button>
  - attempting move and down action
    2 × waiting for element to be visible and stable
      - element is visible and stable
      - scrolling into view if needed
      - done scrolling
      - <button aria-pressed="false" aria-label="Select cell" class="execution svelte-1ig84k" title="Select cell · Shift selects a range · Ctrl/Cmd toggles selection">[ ]</button> from <div class="cell-input svelte-1ig84k source-mode">…</div> subtree intercepts pointer events
    - retrying move and down action
    - waiting 20ms
    2 × waiting for element to be visible and stable
      - element is visible and stable
      - scrolling into view if needed
      - done scrolling
      - <button aria-pressed="false" aria-label="Select cell" class="execution svelte-1ig84k" title="Select cell · Shift selects a range · Ctrl/Cmd toggles selection">[ ]</button> from <div class="cell-input svelte-1ig84k source-mode">…</div> subtree intercepts pointer events
    - retrying move and down action
      - waiting 100ms
    58 × waiting for element to be visible and stable
       - element is visible and stable
       - scrolling into view if needed
       - done scrolling
       - <button aria-pressed="false" aria-label="Select cell" class="execution svelte-1ig84k" title="Select cell · Shift selects a range · Ctrl/Cmd toggles selection">[ ]</button> from <div class="cell-input svelte-1ig84k source-mode">…</div> subtree intercepts pointer events
     - retrying move and down action
       - waiting 500ms

```

# Test source

```ts
  56  |     await expect(page.locator('[data-cell-id="use"] .view-overlays .current-line')).toHaveCount(0);
  57  |     await code.getByRole('button', { name: 'Select cell', exact: true }).click();
  58  |     await expect(code.locator('.view-overlays .current-line')).toHaveCount(0);
  59  |     await code.getByRole('button', { name: 'Output 1 actions', exact: true }).click();
  60  |     await code.getByRole('combobox', { name: 'Output format' }).selectOption('text/plain');
  61  |     await expect(code.locator('.notebook-outputs pre')).toHaveText('Two-line 2.117');
  62  |     await expect(code.locator('.notebook-outputs pre')).toHaveCSS('font-family', measure.codeFont);
  63  |     await code.getByRole('combobox', { name: 'Output format' }).selectOption('');
  64  |     await expect(code.locator('.output-html td').first()).toHaveCSS('text-align', 'right');
  65  |     await code.getByRole('combobox', { name: 'Output format' }).press('Escape');
  66  |     await code.getByRole('button', { name: 'More cell actions', exact: true }).click();
  67  |     await code.getByRole('button', { name: 'Collapse cell output', exact: true }).click();
  68  |     await expect(code.locator('.notebook-outputs')).toHaveCount(0);
  69  |     await code.getByRole('button', { name: '▸ Show output', exact: true }).click();
  70  |     await expect(code.locator('.output-html table')).toBeVisible();
  71  |     // A keyboard path must reveal actions without needing hover or double-click.
  72  |     await md.getByRole('button', { name: 'Select cell', exact: true }).focus();
  73  |     await expect(md.locator('.cell-toolbar')).toHaveCSS('opacity', '1');
  74  |     await md.getByRole('button', { name: 'Edit', exact: true }).focus(); await page.keyboard.press('Enter');
  75  |     const markdownEditor = md.getByRole('textbox', { name: /Markdown cell editor/ });
  76  |     await markdownEditor.press('Control+End'); await page.keyboard.insertText('\n\n키보드 편집 유지');
  77  |     await markdownEditor.press('Escape'); await expect(md.locator('.cell-markdown')).toContainText('키보드 편집 유지');
  78  |     await page.keyboard.press('Control+s');
  79  |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[1].outputs).toEqual(value.cells[1].outputs);
  80  |     for (const theme of ['one-dark', 'github-light']) {
  81  |       await application.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), theme);
  82  |       await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-editor-background').trim())).toBe(theme === 'one-dark' ? '#282c34' : '#ffffff');
  83  |       await page.mouse.move(1, 1); await page.screenshot({ path: test.info().outputPath(`reading-${theme}.png`) });
  84  |     }
  85  |     // Use a real group split: a narrow standalone window doesn't test pane-local sizing.
  86  |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), other);
  87  |     await expect(page.getByRole('tab', { name: /other.ipynb/ })).toHaveAttribute('aria-selected', 'true');
  88  |     const data = await page.evaluateHandle(() => new DataTransfer());
  89  |     await page.getByRole('tab', { name: /other.ipynb/ }).dispatchEvent('dragstart', { dataTransfer: data });
  90  |     const body = page.locator('.group-body').first(), box = (await body.boundingBox())!;
  91  |     const point = { clientX: box.x + box.width * .98, clientY: box.y + box.height / 2, dataTransfer: data };
  92  |     await body.dispatchEvent('dragover', point); await expect(page.locator('.group-drop-overlay')).toBeVisible();
  93  |     await body.dispatchEvent('drop', point); await data.dispose();
  94  |     await expect(page.locator('.editor-group')).toHaveCount(2);
  95  |     // Notebook surfaces are retained siblings of the group chrome, keyed by tab.
  96  |     const tabId = await page.getByRole('tab', { name: /reading.ipynb/ }).getAttribute('data-tab-id');
  97  |     const surface = page.locator(`[data-notebook-tab="${tabId}"]`);
  98  |     await expect(page.locator('.notebook-content:not(.inactive)')).toHaveCount(2);
  99  |     expect((await surface.boundingBox())!.width).toBeLessThan(750);
  100 |     const toolbar = surface.locator('.notebook-toolbar');
  101 |     expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(44);
  102 |     expect(await toolbar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  103 |     await expect(toolbar.getByRole('button', { name: 'Outline', exact: true })).toBeHidden();
  104 |     await toolbar.getByRole('button', { name: 'Commands…', exact: true }).click();
  105 |     await surface.getByRole('button', { name: 'Toggle outline', exact: true }).click();
  106 |     await expect(surface.getByRole('navigation', { name: 'Notebook outline' })).toBeVisible();
  107 |     await expect(surface.getByRole('combobox', { name: 'Python environment', exact: true })).toBeVisible();
  108 |     await page.screenshot({ path: test.info().outputPath('reading-split.png') });
  109 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  110 | });
  111 | 
  112 | test('notebook cells reuse Markdown and Python, preserve outputs on save, and retain Undo across deletion', async () => {
  113 |   test.setTimeout(90_000);
  114 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-config-'));
  115 |   const file = path.join(root, 'example.ipynb'), original = JSON.stringify(notebook(), null, 2) + '\n';
  116 |   await writeFile(file, original);
  117 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  118 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  119 |   application.on('console', message => { if (message.type() === 'error') console.log('notebook main:', message.text()); });
  120 |   application.process().stderr?.on('data', data => console.log('notebook process:', String(data)));
  121 |   try {
  122 |     const page = await application.firstWindow(); await focusApplication(application);
  123 |     page.on('pageerror', error => console.log('notebook renderer:', error));
  124 |     await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'notebook');
  125 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  126 |     await expect(page.locator('.cell-markdown h1')).toHaveText('Notebook');
  127 |     await expect(page.locator('.cell-markdown img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  128 |     await expect(page.locator('.cell-markdown math')).toHaveCount(1);
  129 |     await expect(page.locator('.notebook-outputs')).toContainText('Saved table');
  130 |     expect(await page.locator('.notebook-outputs script, .notebook-outputs iframe, .notebook-outputs svg, .notebook-outputs [style]').count()).toBe(0);
  131 |     expect(await page.evaluate(() => (window as unknown as { notebookInjected?: boolean }).notebookInjected)).toBeUndefined();
  132 |     await expect(page.locator('.notebook-surface')).toHaveAttribute('data-notebook-language', 'ready', { timeout: 30_000 });
  133 |     await page.evaluate(() => {
  134 |       const state = { starts: 0 }; (window as any).notebookConnections = state;
  135 |       window.marktex.language.onEvent(event => { if (event.type === 'status' && event.state === 'starting') state.starts++; });
  136 |     });
  137 |     const markdown = page.locator('[data-cell-id="intro"]');
  138 |     await markdown.getByRole('button', { name: 'Edit', exact: true }).click();
  139 |     const markdownEditor = markdown.getByRole('textbox', { name: /Markdown cell editor/ });
  140 |     await markdownEditor.press('Control+End'); await markdownEditor.press('Enter');
  141 |     await page.keyboard.insertText('Latest preview text');
  142 |     const cdp = await page.context().newCDPSession(page);
  143 |     await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
  144 |     await markdownEditor.press('Escape');
  145 |     await expect(markdownEditor).toBeAttached();
  146 |     await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  147 |     await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  148 |     await cdp.send('Input.insertText', { text: '한' }); await cdp.detach();
  149 |     await markdownEditor.press('Escape');
  150 |     await expect(markdown.locator('.cell-markdown')).toContainText('Latest preview text한');
  151 |     // Restore the source using its retained text history before preservation assertions.
  152 |     await markdown.getByRole('button', { name: 'Edit', exact: true }).click();
  153 |     await markdownEditor.press('Control+a'); await page.keyboard.insertText((notebook().cells[0].source as string[]).join(''));
  154 |     await markdownEditor.press('Escape');
  155 |     await page.locator('[data-cell-id="use"]').getByRole('button', { name: 'Drag to move cell' })
> 156 |       .dragTo(markdown, { targetPosition: { x: 40, y: 5 } });
      |        ^ TimeoutError: locator.dragTo: Timeout 30000ms exceeded.
  157 |     await expect(page.locator('.notebook-cell').first()).toHaveAttribute('data-cell-id', 'use');
  158 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
  159 |     await expect(page.locator('.notebook-cell').first()).toHaveAttribute('data-cell-id', 'intro');
  160 |     const cell = page.locator('[data-cell-id="use"]'), editor = cell.getByRole('textbox', { name: /Code cell editor/ });
  161 |     const mountedEditor = await editor.elementHandle();
  162 |     await editor.press('Control+End'); await editor.press('Enter'); await editor.pressSequentially('numbers.');
  163 |     expect(await mountedEditor!.evaluate(element => element.isConnected)).toBe(true);
  164 |     await editor.press('Control+Space');
  165 |     await expect(page.locator('.suggest-widget.visible')).toContainText('append', { timeout: 10_000 });
  166 |     await editor.press('Escape'); await editor.press('Control+a'); await page.keyboard.insertText('numbers.append(42)');
  167 |     await editor.press('Control+s');
  168 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toBe('numbers.append(42)');
  169 |     const saved = JSON.parse(await readFile(file, 'utf8'));
  170 |     expect(saved.metadata).toEqual(notebook().metadata); expect(saved.cells[0]).toEqual(notebook().cells[0]);
  171 |     expect(saved.cells[1].outputs).toEqual(notebook().cells[1].outputs);
  172 |     await cell.getByRole('button', { name: 'Delete cell', exact: true }).click();
  173 |     await expect(page.locator('.notebook-cell')).toHaveCount(2);
  174 |     await page.getByRole('button', { name: 'Undo cell operation', exact: true }).click();
  175 |     await expect(page.locator('.notebook-cell')).toHaveCount(3);
  176 |     await expect(cell.locator('.view-lines')).toContainText('numbers.append(42)');
  177 |     // Cell text history is owned by the document, even when its view was deleted.
  178 |     await editor.press('Control+z'); await editor.press('Control+s');
  179 |     await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).cells[2].source).toContain('numbers.');
  180 |     await editor.press('Control+a'); await page.keyboard.insertText('numbers.append(7)');
  181 |     await editor.press('Control+Home'); await editor.press('ArrowRight'); await editor.press('F12');
  182 |     await expect(page.locator('[data-cell-id="define"] .monaco-editor')).toHaveClass(/focused/, { timeout: 10_000 });
  183 |     expect(await page.evaluate(() => (window as any).notebookConnections.starts)).toBe(0);
  184 |     await page.screenshot({ path: test.info().outputPath('notebook.png') });
  185 |     await page.keyboard.press('Control+s');
  186 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  187 | });
  188 | 
  189 | test('unsupported notebook versions remain read-only and byte-identical', async () => {
  190 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-invalid-')), config = path.join(root, 'config'), file = path.join(root, 'future.ipynb');
  191 |   const original = '{"nbformat": 9, "nbformat_minor": 0, "cells": [], "metadata": {"keep": 12345678901234567890}}';
  192 |   await writeFile(file, original);
  193 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  194 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  195 |   application.on('console', message => { if (message.type() === 'error') console.log('notebook main:', message.text()); });
  196 |   application.process().stderr?.on('data', data => console.log('notebook process:', String(data)));
  197 |   try {
  198 |     const page = await application.firstWindow();
  199 |     await expect(page.getByRole('alert')).toContainText('Only nbformat 4');
  200 |     await expect(page.getByRole('button', { name: '+ Code', exact: true })).toBeDisabled();
  201 |     expect(await readFile(file, 'utf8')).toBe(original);
  202 |     expect(await page.locator('.notebook-cell').count()).toBe(0);
  203 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  204 | });
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
```